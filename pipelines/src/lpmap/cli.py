import argparse
import json
import logging
import sys
from datetime import date

from . import config, db, pipeline
from .sec_client import SecClient


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lpmap", description="OpenSource LP Map data pipelines")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply pending SQL migrations")
    s = sub.add_parser("sync", help="migrate, backfill Form D bulk quarters, catch up daily filings")
    s.add_argument("--max-quarters", type=int, help="limit bulk quarters loaded this run")
    q = sub.add_parser("quarter", help="load one Form D bulk quarter, e.g. 2025q2")
    q.add_argument("quarter")
    d = sub.add_parser("day", help="load one daily index, e.g. 2025-10-01")
    d.add_argument("day", type=date.fromisoformat)
    sub.add_parser("status", help="print row counts")
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
            elif args.cmd == "quarter":
                y, qn = pipeline.parse_quarter(args.quarter)
                stats = {args.quarter: pipeline.ingest_quarter(conn, sec, y, qn)}
            else:
                stats = {args.day.isoformat(): pipeline.ingest_day(conn, sec, args.day)}
        print(json.dumps({"run": stats, "status": pipeline.status(conn)}, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
