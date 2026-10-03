-- Canonical Factory execution entities only; no MyEve owners, chats or account data.
CREATE TABLE IF NOT EXISTS factory.work_orders (
  id text PRIMARY KEY,
  record jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('needs_investigation','awaiting_clarification','queued','planning','implementing','verifying','ready_for_review','awaiting_approval','awaiting_human_login','awaiting_environment','failed','interrupted','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS factory.runs (
  id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES factory.work_orders(id),
  record jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('planning','implementing','verifying','ready_for_review','failed','interrupted','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id,id)
);
CREATE TABLE IF NOT EXISTS factory.work_spend_budgets (
  work_id text PRIMARY KEY,
  work_generation integer NOT NULL CHECK (work_generation > 0),
  request_id text NOT NULL,
  work_order_id text NOT NULL REFERENCES factory.work_orders(id),
  ceiling_microusd bigint NOT NULL CHECK (ceiling_microusd BETWEEN 1 AND 9007199254740991),
  deadline text NOT NULL,
  cancelled_at text,
  created_at text NOT NULL,
  contract_version text NOT NULL,
  pricing_revision text,
  model text,
  pricing_valid_until text,
  per_operation_reserve_microusd bigint NOT NULL DEFAULT 0 CHECK (per_operation_reserve_microusd BETWEEN 0 AND 9007199254740991),
  planned_productive_operations integer NOT NULL DEFAULT 0 CHECK (planned_productive_operations >= 0),
  planned_completion_operations integer NOT NULL DEFAULT 0 CHECK (planned_completion_operations >= 0),
  max_paid_operations integer NOT NULL DEFAULT 0 CHECK (max_paid_operations >= 0),
  completion_reserve_microusd bigint NOT NULL DEFAULT 0 CHECK (completion_reserve_microusd BETWEEN 0 AND 9007199254740991),
  authority_dispatch_identity text,
  authority_factory_version text,
  authority_run_id text,
  authority_state text NOT NULL DEFAULT 'prepared' CHECK (authority_state IN ('prepared','active','fenced')),
  phase text NOT NULL DEFAULT 'productive' CHECK (phase IN ('productive','completion'))
);
CREATE TABLE IF NOT EXISTS factory.work_spend_operations (
  operation_id text PRIMARY KEY,
  work_id text NOT NULL REFERENCES factory.work_spend_budgets(work_id),
  work_generation integer NOT NULL CHECK (work_generation > 0),
  dispatch_identity text NOT NULL,
  request_id text NOT NULL,
  work_order_id text NOT NULL REFERENCES factory.work_orders(id),
  factory_version text NOT NULL,
  run_id text NOT NULL,
  model text NOT NULL,
  pricing_revision text NOT NULL,
  reserved_microusd bigint NOT NULL CHECK (reserved_microusd BETWEEN 1 AND 9007199254740991),
  actual_microusd bigint CHECK (actual_microusd BETWEEN 0 AND 9007199254740991),
  provider_request_id text,
  usage_json text,
  state text NOT NULL CHECK (state IN ('reserved','dispatched','unknown','settled')),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('productive','completion')),
  CHECK ((state = 'settled') = (actual_microusd IS NOT NULL)),
  CHECK (actual_microusd IS NULL OR actual_microusd <= reserved_microusd),
  FOREIGN KEY (work_order_id,run_id) REFERENCES factory.runs(work_order_id,id)
);
CREATE INDEX IF NOT EXISTS spend_operations_work_idx ON factory.work_spend_operations(work_id,created_at,operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS spend_provider_request_idx ON factory.work_spend_operations(provider_request_id) WHERE provider_request_id IS NOT NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
