-- Authoritative verifier custody/lease belongs to Factory, never Sofie.
-- One resource per canonical Run; UNKNOWN cannot allocate a replacement.
CREATE TABLE IF NOT EXISTS factory.verification_resources (
  run_id text PRIMARY KEY REFERENCES factory.runs(id),
  lease_owner uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  provider_name text NOT NULL UNIQUE,
  provider_session_id text UNIQUE,
  candidate_commit text NOT NULL CHECK(candidate_commit ~ '^[a-f0-9]{40}$'),
  candidate_tree text NOT NULL CHECK(candidate_tree ~ '^[a-f0-9]{40}$'),
  custody_sha256 text NOT NULL CHECK(custody_sha256 ~ '^[a-f0-9]{64}$'),
  policy_sha256 text NOT NULL CHECK(policy_sha256 ~ '^[a-f0-9]{64}$'),
  image text NOT NULL,
  state text NOT NULL CHECK(state IN ('ALLOCATING','RUNNING','FINISHED','DESTROYED')),
  outcome text NOT NULL DEFAULT 'UNKNOWN' CHECK(outcome IN ('PASS','FAIL','UNKNOWN')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(checks)='array' AND jsonb_array_length(checks)<=20),
  cleanup_confirmed boolean NOT NULL DEFAULT false,
  failure text CHECK(failure ~ '^VERIFIER_[A-Z_]{1,70}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS factory_one_unresolved_verifier
  ON factory.verification_resources((true)) WHERE NOT cleanup_confirmed;
REVOKE ALL ON factory.verification_resources FROM PUBLIC;
