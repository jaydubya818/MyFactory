-- Canonical intake, event history and execution resources; no owner profile data.
CREATE TABLE IF NOT EXISTS factory.intake_receipts (
  client_id text NOT NULL,
  request_id uuid NOT NULL,
  work_id uuid NOT NULL,
  work_generation integer NOT NULL CHECK(work_generation>0),
  input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
  work_order_id text NOT NULL REFERENCES factory.work_orders(id),
  run_id text NOT NULL,
  request jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  identity jsonb,
  deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(client_id,request_id),
  UNIQUE(work_id,work_generation),
  UNIQUE(run_id),
  FOREIGN KEY(work_order_id,run_id) REFERENCES factory.runs(work_order_id,id)
);
CREATE TABLE IF NOT EXISTS factory.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES factory.work_orders(id),
  run_id text REFERENCES factory.runs(id),
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_events_order ON factory.events(work_order_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS factory_single_claim ON factory.events(run_id,type)
  WHERE type IN ('factory.dispatch_claimed','factory.stop_requested','factory.terminal');
CREATE TABLE IF NOT EXISTS factory.execution_resources (
  run_id text PRIMARY KEY REFERENCES factory.runs(id),
  provider_name text NOT NULL UNIQUE,
  provider_session_id text UNIQUE,
  state text NOT NULL CHECK(state IN ('ALLOCATING','PREPARING','READY','RUNNING','QUIESCING','COLLECTING','TERMINAL','DESTROYED')),
  lease_owner uuid NOT NULL,
  lease_generation integer NOT NULL DEFAULT 1 CHECK(lease_generation>0),
  lease_expires_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  allocation_unknown boolean NOT NULL DEFAULT true,
  cancelled_at timestamptz,
  cleanup_confirmed boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT cleanup_confirmed OR state='DESTROYED')
);
-- Initial low concurrency: ambiguity consumes the slot until reconciled teardown.
CREATE UNIQUE INDEX IF NOT EXISTS factory_one_unresolved_resource
  ON factory.execution_resources((true)) WHERE NOT cleanup_confirmed;
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
