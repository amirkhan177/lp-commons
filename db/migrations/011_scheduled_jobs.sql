-- Bookkeeping for the web app's recurring jobs (weekly re-map, Google sync, digest; freshness checks).
CREATE TABLE scheduled_jobs (
    name         TEXT PRIMARY KEY,
    last_run_at  TIMESTAMPTZ,
    last_result  JSONB
);
