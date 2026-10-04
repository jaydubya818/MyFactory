-- Operator-installed authority, never populated by an HTTP request or a build.
-- Revocation is one-way. The manifest and its exact admitted request are immutable.
CREATE TABLE factory.production_work_authority (
  request_id uuid PRIMARY KEY,
  work_id uuid NOT NULL UNIQUE,
  client_id text NOT NULL CHECK (client_id IN ('sofie-production','sofie-production-validation')),
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('AUTHORIZED','REVOKED')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION factory.protect_production_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'production authority cannot be deleted'; END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.work_id <> OLD.work_id OR NEW.client_id <> OLD.client_id
     OR NEW.manifest <> OLD.manifest OR NEW.manifest_sha256 <> OLD.manifest_sha256
     OR NEW.created_at <> OLD.created_at OR (OLD.state = 'REVOKED' AND NEW.state <> 'REVOKED')
     OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
  THEN RAISE EXCEPTION 'production authority is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_production_authority BEFORE UPDATE OR DELETE ON factory.production_work_authority
FOR EACH ROW EXECUTE FUNCTION factory.protect_production_authority();
REVOKE ALL ON factory.production_work_authority FROM PUBLIC;
