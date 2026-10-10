-- Manual isolated qualification migration. No active installation is changed.
CREATE TABLE capability_control.policy_destinations (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  owner_id text NOT NULL,
  backend_id text NOT NULL,
  incarnation text NOT NULL,
  enrollment_version integer NOT NULL CHECK(enrollment_version > 0),
  key_id text NOT NULL,
  public_jwk jsonb NOT NULL,
  PRIMARY KEY(installation_id,owner_id,backend_id)
);
CREATE TABLE capability_control.policy_changes (
  installation_id text NOT NULL,
  owner_id text NOT NULL,
  revision integer NOT NULL,
  policy_id text NOT NULL DEFAULT gen_random_uuid()::text,
  organization_id text NOT NULL,
  capability_id text NOT NULL,
  operation text NOT NULL,
  destinations jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_PROPAGATION' CHECK(status IN ('PENDING_PROPAGATION','ACKNOWLEDGED','SUPERSEDED')),
  PRIMARY KEY(installation_id,owner_id,revision),
  FOREIGN KEY(installation_id,owner_id) REFERENCES capability_control.owner_state
);
CREATE TABLE capability_control.policy_deliveries (
  installation_id text NOT NULL, owner_id text NOT NULL, revision integer NOT NULL,
  backend_id text NOT NULL, envelope jsonb NOT NULL, acknowledgment jsonb,
  PRIMARY KEY(installation_id,owner_id,revision,backend_id),
  FOREIGN KEY(installation_id,owner_id,revision) REFERENCES capability_control.policy_changes
);
CREATE FUNCTION capability_control.stage_policy_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,capability_control AS $$
DECLARE destinations jsonb; organization text;
BEGIN
  SELECT jsonb_agg(to_jsonb(d) ORDER BY backend_id) INTO destinations
    FROM capability_control.policy_destinations d
    WHERE d.installation_id=NEW.installation_id AND d.owner_id=NEW.owner_id;
  IF destinations IS NULL THEN RETURN NEW; END IF;
  UPDATE capability_control.policy_changes SET status='SUPERSEDED'
    WHERE installation_id=NEW.installation_id AND owner_id=NEW.owner_id AND status='PENDING_PROPAGATION';
  SELECT organization_id INTO organization FROM capability_control.installations WHERE id=NEW.installation_id AND active;
  IF organization IS NULL THEN RAISE EXCEPTION 'CAPABILITY_INSTALLATION_UNAVAILABLE'; END IF;
  INSERT INTO capability_control.policy_changes(installation_id,owner_id,revision,organization_id,capability_id,operation,destinations)
    VALUES(NEW.installation_id,NEW.owner_id,NEW.revision,organization,NEW.capability_id,NEW.operation,destinations);
  RETURN NEW;
END $$;
CREATE TRIGGER stage_policy_change AFTER INSERT ON capability_control.audit
  FOR EACH ROW EXECUTE FUNCTION capability_control.stage_policy_change();
DO $$ DECLARE item text;
BEGIN
  FOREACH item IN ARRAY ARRAY['policy_destinations','policy_changes','policy_deliveries'] LOOP
    EXECUTE format('ALTER TABLE capability_control.%I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('ALTER TABLE capability_control.%I FORCE ROW LEVEL SECURITY',item);
    EXECUTE format('CREATE POLICY owner_scope ON capability_control.%I USING(owner_id=current_setting(''myeve.capability_owner'',true) AND installation_id=current_setting(''myeve.capability_installation'',true)) WITH CHECK(owner_id=current_setting(''myeve.capability_owner'',true) AND installation_id=current_setting(''myeve.capability_installation'',true))',item);
  END LOOP;
END $$;
REVOKE ALL ON capability_control.policy_destinations,capability_control.policy_changes,capability_control.policy_deliveries FROM PUBLIC;
REVOKE ALL ON FUNCTION capability_control.stage_policy_change() FROM PUBLIC;
