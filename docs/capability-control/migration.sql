CREATE SCHEMA capability_control;

CREATE TABLE capability_control.installations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','qualification')),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE capability_control.platform_owner_bindings (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  organization_id text NOT NULL,
  owner_id text NOT NULL,
  id text NOT NULL UNIQUE,
  revision integer NOT NULL CHECK (revision > 0),
  authentication_record_id text NOT NULL CHECK (length(btrim(authentication_record_id)) > 0),
  administration_record_id text NOT NULL CHECK (length(btrim(administration_record_id)) > 0),
  membership_record_id text NOT NULL CHECK (length(btrim(membership_record_id)) > 0),
  installation_record_id text NOT NULL CHECK (length(btrim(installation_record_id)) > 0),
  audit_record_id text NOT NULL CHECK (length(btrim(audit_record_id)) > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id,owner_id)
);

CREATE TABLE capability_control.owner_state (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  owner_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  preferences jsonb NOT NULL DEFAULT '{}',
  budgets jsonb NOT NULL DEFAULT '{}',
  controls jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (installation_id,owner_id)
);

CREATE TABLE capability_control.commands (
  installation_id text NOT NULL,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id,owner_id,request_id),
  FOREIGN KEY (installation_id,owner_id) REFERENCES capability_control.owner_state
);

CREATE TABLE capability_control.audit (
  installation_id text NOT NULL,
  owner_id text NOT NULL,
  revision integer NOT NULL,
  request_id uuid NOT NULL,
  actor_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('settings','sofie')),
  capability_id text NOT NULL,
  operation text NOT NULL,
  previous jsonb NOT NULL,
  current jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id,owner_id,revision),
  FOREIGN KEY (installation_id,owner_id,request_id) REFERENCES capability_control.commands
);

CREATE TABLE capability_control.control_requests (
  installation_id text NOT NULL,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  capability_id text NOT NULL,
  revision integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('pause','revoke')),
  status text NOT NULL DEFAULT 'PENDING_BACKEND' CHECK (status IN ('PENDING_BACKEND','ACKNOWLEDGED')),
  backend_receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id,owner_id,request_id),
  FOREIGN KEY (installation_id,owner_id,request_id) REFERENCES capability_control.commands
);

CREATE TABLE capability_control.evidence (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  organization_id text NOT NULL,
  owner_id text NOT NULL,
  registry_version text NOT NULL,
  facts jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  source_record_id text NOT NULL,
  PRIMARY KEY (installation_id,owner_id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['platform_owner_bindings','owner_state','commands','audit','control_requests','evidence'] LOOP
    EXECUTE format('ALTER TABLE capability_control.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE capability_control.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY owner_scope ON capability_control.%I USING (owner_id = current_setting(''myeve.capability_owner'',true) AND installation_id = current_setting(''myeve.capability_installation'',true)) WITH CHECK (owner_id = current_setting(''myeve.capability_owner'',true) AND installation_id = current_setting(''myeve.capability_installation'',true))', table_name);
  END LOOP;
END $$;

CREATE FUNCTION capability_control.immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Capability history is immutable'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON capability_control.audit FOR EACH ROW EXECUTE FUNCTION capability_control.immutable_history();
CREATE TRIGGER commands_immutable BEFORE UPDATE OR DELETE ON capability_control.commands FOR EACH ROW EXECUTE FUNCTION capability_control.immutable_history();

REVOKE ALL ON SCHEMA capability_control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA capability_control FROM PUBLIC;
