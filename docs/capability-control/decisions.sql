-- Isolated qualification only. Apply after enforcement.sql; no runtime auto-migration.
CREATE TABLE capability_control.policy_decisions (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  owner_id text NOT NULL,
  backend_id text NOT NULL,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(installation_id,owner_id,backend_id,request_id)
);
ALTER TABLE capability_control.policy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_control.policy_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON capability_control.policy_decisions USING (
  owner_id=current_setting('myeve.capability_owner',true)
  AND installation_id=current_setting('myeve.capability_installation',true)
) WITH CHECK (
  owner_id=current_setting('myeve.capability_owner',true)
  AND installation_id=current_setting('myeve.capability_installation',true)
);
CREATE TRIGGER policy_decisions_immutable BEFORE UPDATE OR DELETE ON capability_control.policy_decisions
  FOR EACH ROW EXECUTE FUNCTION capability_control.immutable_history();
REVOKE ALL ON capability_control.policy_decisions FROM PUBLIC;
