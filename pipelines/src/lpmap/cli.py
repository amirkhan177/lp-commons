import argparse
import json
import logging
import sys
from datetime import date

from . import config, db, notify_web, pipeline
from .sec_client import SecClient


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lpmap", description="LP Commons data pipelines")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply pending SQL migrations")
    s = sub.add_parser("sync", help="migrate, backfill Form D bulk quarters, catch up daily filings")
    s.add_argument("--max-quarters", type=int, help="limit bulk quarters loaded this run")
    q = sub.add_parser("quarter", help="load one Form D bulk quarter, e.g. 2025q2")
    q.add_argument("quarter")
    d = sub.add_parser("day", help="load one daily index, e.g. 2025-10-01")
    d.add_argument("day", type=date.fromisoformat)
    sub.add_parser("status", help="print row counts")
    sub.add_parser("reprocess", help="re-ingest all Form D history (after parser changes); safe, idempotent")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        cfg = config.load()
    except config.ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    with db.connect(cfg.database_url) as conn:
        db.migrate(conn)
        if args.cmd == "migrate":
            return 0
        if args.cmd == "status":
            print(json.dumps(pipeline.status(conn), default=str, indent=2))
            return 0
        with SecClient(cfg.sec_user_agent, cfg.sec_max_rps) as sec:
            if args.cmd == "sync":
                stats = pipeline.sync(conn, sec, cfg.formd_backfill_from, max_quarters=args.max_quarters)
                notify_web.filings_updated(notify_web.new_filings_count(stats))
            elif args.cmd == "reprocess":
                conn.execute("DELETE FROM ingest_state WHERE source IN (%s, %s)", (pipeline.BULK_SOURCE, pipeline.DAILY_SOURCE))
                conn.commit()
                stats = pipeline.sync(conn, sec, cfg.formd_backfill_from)
            elif args.cmd == "quarter":
                yq = pipeline.parse_quarter(args.quarter)
                url = pipeline.bulk_urls(sec).get(yq)
                if url is None:
                    print(f"{args.quarter} is not published on SEC's Form D data sets page", file=sys.stderr)
                    return 1
                stats = {args.quarter: pipeline.ingest_quarter(conn, sec, *yq, url)}
            else:
                stats = {args.day.isoformat(): pipeline.ingest_day(conn, sec, args.day)}
        print(json.dumps({"run": stats, "status": pipeline.status(conn)}, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
