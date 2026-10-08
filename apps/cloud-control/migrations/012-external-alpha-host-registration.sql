-- Dedicated external alpha uses an explicitly registered, immutable host tuple.
-- This migration installs no registration, authority, grant or active policy.
CREATE TABLE factory.external_alpha_host_registration (
  singleton boolean PRIMARY KEY CHECK (singleton),
  project_id text NOT NULL CHECK (project_id ~ '^prj_[A-Za-z0-9]+$'),
  owner_scope text NOT NULL CHECK (owner_scope ~ '^external-alpha:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  custody_store_id text NOT NULL CHECK (custody_store_id ~ '^store_[A-Za-z0-9]+$'),
  database_resource_id text NOT NULL CHECK (database_resource_id ~ '^[a-z0-9-]{3,100}$'),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (singleton, project_id, owner_scope, custody_store_id, database_resource_id)
);
CREATE FUNCTION factory.protect_external_alpha_host_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'external alpha host registration is immutable'; END $$;
CREATE TRIGGER protect_external_alpha_host_registration BEFORE UPDATE OR DELETE ON factory.external_alpha_host_registration
FOR EACH ROW EXECUTE FUNCTION factory.protect_external_alpha_host_registration();
REVOKE ALL ON factory.external_alpha_host_registration FROM PUBLIC;
REVOKE ALL ON FUNCTION factory.protect_external_alpha_host_registration() FROM PUBLIC;

ALTER TABLE factory.environment ADD COLUMN external_alpha_host_registration boolean;
ALTER TABLE factory.environment ADD CONSTRAINT environment_external_alpha_registration
  FOREIGN KEY (external_alpha_host_registration, project_id, owner_scope, custody_store_id, database_resource_id)
  REFERENCES factory.external_alpha_host_registration (singleton, project_id, owner_scope, custody_store_id, database_resource_id);

-- Carry forward the exact existing legacy predicate, including its reviewed
-- canary/staging resource literals. Never rewrite the historical 007 checksum.
DO $$
DECLARE legacy text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO legacy FROM pg_constraint
    WHERE conrelid = 'factory.environment'::regclass AND conname = 'environment_production_binding';
  IF legacy IS NULL THEN RAISE EXCEPTION 'EXTERNAL_ALPHA_HOST_LEGACY_BOUNDARY_REQUIRED'; END IF;
  ALTER TABLE factory.environment DROP CONSTRAINT environment_production_binding;
  EXECUTE format('ALTER TABLE factory.environment ADD CONSTRAINT environment_production_binding CHECK (
    ((%s) AND external_alpha_host_registration IS NULL)
    OR (external_alpha_host_registration IS TRUE AND environment = ''production''
      AND project_id IS NOT NULL AND project_id ~ ''^prj_[A-Za-z0-9]+$''
      AND owner_scope IS NOT NULL AND owner_scope ~ ''^external-alpha:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$''
      AND custody_store_id IS NOT NULL AND custody_store_id ~ ''^store_[A-Za-z0-9]+$''
      AND database_resource_id IS NOT NULL AND database_resource_id ~ ''^[a-z0-9-]{3,100}$''))', legacy);
END $$;

CREATE FUNCTION factory.protect_external_alpha_host_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.external_alpha_host_registration IS TRUE THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'external alpha host marker is immutable'; END IF;
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'external alpha host marker is immutable'; END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.environment = 'production' AND NEW.external_alpha_host_registration IS TRUE THEN
    RAISE EXCEPTION 'external alpha host requires a fresh database';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_external_alpha_host_marker BEFORE UPDATE OR DELETE ON factory.environment
FOR EACH ROW EXECUTE FUNCTION factory.protect_external_alpha_host_marker();
REVOKE ALL ON FUNCTION factory.protect_external_alpha_host_marker() FROM PUBLIC;
