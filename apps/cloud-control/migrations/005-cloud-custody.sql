-- Worker output belongs to Factory, independently of the disposable sandbox.
CREATE TABLE IF NOT EXISTS factory.candidate_custody (
  run_id text PRIMARY KEY REFERENCES factory.runs(id),
  candidate_commit text NOT NULL CHECK(candidate_commit ~ '^[a-f0-9]{40}$'),
  candidate_tree text NOT NULL CHECK(candidate_tree ~ '^[a-f0-9]{40}$'),
  artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_path text NOT NULL UNIQUE,
  artifact_bytes integer NOT NULL CHECK(artifact_bytes BETWEEN 1 AND 256000),
  collected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS factory.delivery_intents (
  run_id text PRIMARY KEY REFERENCES factory.runs(id),
  deployment_id text NOT NULL,
  nonce_sha256 text NOT NULL CHECK(nonce_sha256 ~ '^[a-f0-9]{64}$'),
  message_id text,
  state text NOT NULL CHECK(state IN ('SENDING','ACCEPTED','UNKNOWN','DELIVERED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz
);
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
