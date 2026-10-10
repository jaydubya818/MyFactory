-- Apply once after ordering.sql; does not rewrite policy or historical approvals.
CREATE TABLE capability_control.lifecycle_receipts (
  installation_id text NOT NULL, owner_id text NOT NULL, revision integer NOT NULL,
  backend_id text NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0),
  receipt jsonb NOT NULL, envelope jsonb NOT NULL,
  PRIMARY KEY(installation_id,owner_id,revision,backend_id,sequence),
  FOREIGN KEY(installation_id,owner_id,revision) REFERENCES capability_control.policy_changes
);
ALTER TABLE capability_control.lifecycle_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_control.lifecycle_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON capability_control.lifecycle_receipts
  USING(owner_id=current_setting('myeve.capability_owner',true) AND installation_id=current_setting('myeve.capability_installation',true))
  WITH CHECK(owner_id=current_setting('myeve.capability_owner',true) AND installation_id=current_setting('myeve.capability_installation',true));
CREATE TRIGGER lifecycle_receipts_immutable BEFORE UPDATE OR DELETE ON capability_control.lifecycle_receipts
  FOR EACH ROW EXECUTE FUNCTION capability_control.immutable_history();
REVOKE ALL ON capability_control.lifecycle_receipts FROM PUBLIC;

-- Privileged enrollment remains required even if controller environment is lost.
CREATE TABLE capability_control.recovery_enrollments (
  installation_id text NOT NULL, owner_id text NOT NULL, epoch text NOT NULL CHECK(length(epoch)>0),
  PRIMARY KEY(installation_id,owner_id),
  FOREIGN KEY(installation_id,owner_id) REFERENCES capability_control.owner_state
);
ALTER TABLE capability_control.recovery_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_control.recovery_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON capability_control.recovery_enrollments
  USING(owner_id=current_setting('myeve.capability_owner',true) AND installation_id=current_setting('myeve.capability_installation',true));
REVOKE ALL ON capability_control.recovery_enrollments FROM PUBLIC;
