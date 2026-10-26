import logging
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from .config import MIGRATIONS_DIR
from .normalize import is_org_related_person, name_key, person_key, person_name
from .sources.formd import FormDFiling, classify

log = logging.getLogger(__name__)


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=False)


def migrate(conn: psycopg.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
    # Serialize concurrent runners (e.g. overlapping cron invocations).
    conn.execute("SELECT pg_advisory_xact_lock(814023)")
    applied = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
    ran = []
    for path in sorted(migrations_dir.glob("*.sql")):
        if path.name in applied:
            continue
        log.info("applying migration %s", path.name)
        conn.execute(path.read_text())
        conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
        ran.append(path.name)
    conn.commit()
    return ran


def upsert_filing(conn: psycopg.Connection, f: FormDFiling) -> None:
    """Idempotent: re-ingesting the same accession (from bulk or XML) updates in place."""
    category = classify(f.industry_group, f.investment_fund_type, f.entity_name)
    entity_type = "fof" if category == "fof" else "vc_fund"
    entity_id = conn.execute(
        """
        INSERT INTO entities (type, name, name_normalized, cik, city, state, jurisdiction, entity_form)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (cik) DO UPDATE SET
            -- keep the name from the most recent filing; remember older names as aliases
            aliases = CASE WHEN entities.name <> EXCLUDED.name AND NOT (entities.name = ANY(entities.aliases))
                           THEN entities.aliases || entities.name ELSE entities.aliases END,
            name = EXCLUDED.name, name_normalized = EXCLUDED.name_normalized,
            type = EXCLUDED.type,
            city = COALESCE(EXCLUDED.city, entities.city), state = COALESCE(EXCLUDED.state, entities.state),
            jurisdiction = COALESCE(EXCLUDED.jurisdiction, entities.jurisdiction),
            entity_form = COALESCE(EXCLUDED.entity_form, entities.entity_form),
            updated_at = now()
        WHERE %s::date >= COALESCE((SELECT max(filed_at) FROM formd_filings WHERE cik = EXCLUDED.cik), '-infinity'::date)
        RETURNING id
        """,
        (entity_type, f.entity_name, name_key(f.entity_name), f.cik, f.city, f.state, f.jurisdiction,
         f.entity_form, f.filed_at),
    ).fetchone()
    if entity_id is None:  # older filing than what we have: don't overwrite entity details
        entity_id = conn.execute("SELECT id FROM entities WHERE cik = %s", (f.cik,)).fetchone()
    entity_id = entity_id[0]

    conn.execute(
        """
        INSERT INTO formd_filings (
            accession_number, entity_id, cik, submission_type, filed_at, is_amendment, previous_accession,
            industry_group, investment_fund_type, fund_category, is_40act, federal_exemptions,
            date_of_first_sale, first_sale_yet_to_occur, total_offering_amount, offering_indefinite,
            total_amount_sold, total_remaining, minimum_investment, num_investors, has_non_accredited,
            num_non_accredited, sales_commissions, finders_fees, source, source_url)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (accession_number) DO UPDATE SET
            entity_id = EXCLUDED.entity_id, submission_type = EXCLUDED.submission_type,
            filed_at = EXCLUDED.filed_at, is_amendment = EXCLUDED.is_amendment,
            previous_accession = EXCLUDED.previous_accession, industry_group = EXCLUDED.industry_group,
            investment_fund_type = EXCLUDED.investment_fund_type, fund_category = EXCLUDED.fund_category,
            is_40act = EXCLUDED.is_40act, federal_exemptions = EXCLUDED.federal_exemptions,
            date_of_first_sale = EXCLUDED.date_of_first_sale,
            first_sale_yet_to_occur = EXCLUDED.first_sale_yet_to_occur,
            total_offering_amount = EXCLUDED.total_offering_amount,
            offering_indefinite = EXCLUDED.offering_indefinite, total_amount_sold = EXCLUDED.total_amount_sold,
            total_remaining = EXCLUDED.total_remaining, minimum_investment = EXCLUDED.minimum_investment,
            num_investors = EXCLUDED.num_investors, has_non_accredited = EXCLUDED.has_non_accredited,
            num_non_accredited = EXCLUDED.num_non_accredited, sales_commissions = EXCLUDED.sales_commissions,
            finders_fees = EXCLUDED.finders_fees, source = EXCLUDED.source, source_url = EXCLUDED.source_url,
            ingested_at = now()
        """,
        (f.accession_number, entity_id, f.cik, f.submission_type, f.filed_at, f.is_amendment,
         f.previous_accession, f.industry_group, f.investment_fund_type, category, f.is_40act,
         f.federal_exemptions, f.date_of_first_sale, f.first_sale_yet_to_occur, f.total_offering_amount,
         f.offering_indefinite, f.total_amount_sold, f.total_remaining, f.minimum_investment,
         f.num_investors, f.has_non_accredited, f.num_non_accredited, f.sales_commissions,
         f.finders_fees, f.source, f.source_url),
    )

    for rp in f.related_persons:
        key = person_key(rp.first_name, rp.last_name)
        if not key or is_org_related_person(rp.first_name, rp.last_name):
            continue  # GP entities get linked as gp_firm entities in P1
        person_id = conn.execute(
            """
            INSERT INTO people (full_name, name_normalized, first_name, middle_name, last_name, city, state)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (name_normalized, state) DO UPDATE SET city = COALESCE(people.city, EXCLUDED.city)
            RETURNING id
            """,
            (person_name(rp.first_name, rp.middle_name, rp.last_name), key, rp.first_name, rp.middle_name,
             rp.last_name, rp.city, rp.state or ""),
        ).fetchone()[0]
        conn.execute(
            """
            INSERT INTO roles (person_id, entity_id, relationships, title, source, source_ref, source_url, filed_at)
            VALUES (%s, %s, %s, %s, 'formd', %s, %s, %s)
            ON CONFLICT (person_id, entity_id, source, source_ref) DO UPDATE SET
                relationships = EXCLUDED.relationships, title = EXCLUDED.title
            """,
            (person_id, entity_id, rp.relationships, rp.clarification, f.accession_number, f.source_url,
             f.filed_at),
        )


def mark(conn: psycopg.Connection, source: str, key: str, status: str, detail: dict | None = None) -> None:
    conn.execute(
        """
        INSERT INTO ingest_state (source, key, status, detail) VALUES (%s, %s, %s, %s)
        ON CONFLICT (source, key) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail,
            updated_at = now()
        """,
        (source, key, status, Jsonb(detail) if detail is not None else None),
    )


def done_keys(conn: psycopg.Connection, source: str) -> set[str]:
    return {r[0] for r in conn.execute("SELECT key FROM ingest_state WHERE source = %s AND status = 'done'", (source,))}
