-- External-alpha per-Work authority consumption. This is a separate table from
-- factory.production_work_authority on purpose: canary/synthetic grants and the
-- global production switches are never reused for external-owner Work.
-- A row exists only after full independent validation, in the same transaction
-- as admission. Rows are never deleted; the document and every bound identifier
-- are immutable; state only moves away from CONSUMED and never returns.
CREATE TABLE factory.external_alpha_work_authority (
  authority_id uuid PRIMARY KEY,
  authority_sha256 text NOT NULL CHECK (authority_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_id uuid NOT NULL UNIQUE,
  writer_id uuid NOT NULL UNIQUE,
  work_id uuid NOT NULL,
  work_generation integer NOT NULL CHECK (work_generation > 0),
  cohort_id uuid NOT NULL,
  slot text NOT NULL CHECK (slot IN ('1','2')),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
  key_id text NOT NULL CHECK (key_id ~ '^[a-f0-9]{64}$'),
  document jsonb NOT NULL,
  -- Factory-side ceilings, independent of anything MyEve says at runtime.
  max_operations integer NOT NULL CHECK (max_operations BETWEEN 1 AND 3),
  max_microusd bigint NOT NULL CHECK (max_microusd BETWEEN 1 AND 1000000),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'CONSUMED' CHECK (state IN ('CONSUMED','REVOKED','UNKNOWN','FENCED')),
  state_reason text CHECK (state_reason IS NULL OR length(state_reason) <= 200),
  work_order_id text,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (work_id, work_generation)
);
CREATE INDEX external_alpha_authority_cohort_idx ON factory.external_alpha_work_authority(cohort_id, state);
CREATE FUNCTION factory.protect_external_alpha_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'external alpha authority cannot be deleted'; END IF;
  IF NEW.authority_id <> OLD.authority_id OR NEW.authority_sha256 <> OLD.authority_sha256
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_id <> OLD.request_id
     OR NEW.writer_id <> OLD.writer_id OR NEW.work_id <> OLD.work_id
     OR NEW.work_generation <> OLD.work_generation OR NEW.cohort_id <> OLD.cohort_id
     OR NEW.slot <> OLD.slot OR NEW.owner_id <> OLD.owner_id OR NEW.policy_sha256 <> OLD.policy_sha256
     OR NEW.key_id <> OLD.key_id OR NEW.document <> OLD.document
     OR NEW.max_operations <> OLD.max_operations OR NEW.max_microusd <> OLD.max_microusd
     OR NEW.expires_at <> OLD.expires_at OR NEW.consumed_at <> OLD.consumed_at
     OR (OLD.work_order_id IS NOT NULL AND NEW.work_order_id IS DISTINCT FROM OLD.work_order_id)
     OR (OLD.state = 'REVOKED' AND NEW.state <> 'REVOKED')
     OR (OLD.state <> 'CONSUMED' AND NEW.state NOT IN (OLD.state,'REVOKED'))
  THEN RAISE EXCEPTION 'external alpha authority is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_external_alpha_authority BEFORE UPDATE OR DELETE ON factory.external_alpha_work_authority
FOR EACH ROW EXECUTE FUNCTION factory.protect_external_alpha_authority();

-- Insert-only revocations of one authority, a whole cohort, or a signing key.
CREATE TABLE factory.external_alpha_revocation (
  subject_kind text NOT NULL CHECK (subject_kind IN ('AUTHORITY','COHORT','KEY')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (subject_kind, subject)
);
CREATE FUNCTION factory.protect_external_alpha_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'external alpha revocations are insert-only'; END $$;
CREATE TRIGGER protect_external_alpha_revocation BEFORE UPDATE OR DELETE ON factory.external_alpha_revocation
FOR EACH ROW EXECUTE FUNCTION factory.protect_external_alpha_revocation();
REVOKE ALL ON factory.external_alpha_work_authority FROM PUBLIC;
REVOKE ALL ON factory.external_alpha_revocation FROM PUBLIC;
