-- Factory infrastructure only. No owner account, chat, or production data.
CREATE SCHEMA IF NOT EXISTS factory;
CREATE TABLE IF NOT EXISTS factory.environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment = 'staging'),
  project_id text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO factory.environment (environment, project_id, schema_version)
VALUES ('staging', 'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4', 1)
ON CONFLICT (singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS factory.infrastructure_attempts (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose = 'deterministic-infrastructure'),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
  image text NOT NULL CHECK (image ~ '@sha256:[a-f0-9]{64}$'),
  provider_name text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('ALLOCATING', 'RUNNING', 'COLLECTED', 'FAILED', 'UNKNOWN', 'DESTROYED')),
  allocation_started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz NOT NULL,
  provider_session_id text,
  command_id text,
  artifact_sha256 text CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_path text,
  cleanup_confirmed boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deadline > allocation_started_at),
  CHECK (deadline <= allocation_started_at + interval '120 seconds'),
  CHECK (state <> 'DESTROYED' OR cleanup_confirmed)
);
-- Ambiguity consumes the sole infrastructure slot until explicitly reconciled.
CREATE UNIQUE INDEX IF NOT EXISTS infrastructure_single_active
ON factory.infrastructure_attempts ((true)) WHERE NOT cleanup_confirmed;
REVOKE ALL ON SCHEMA factory FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
