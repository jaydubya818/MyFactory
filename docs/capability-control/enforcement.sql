-- Additive qualification migration, applied after migration.sql. Never run automatically.
-- Read-only projection of a Relay administrative decision. No local policy authoring.
-- Import is unqualified until a signed, revision-fenced Relay compatibility adapter exists.
CREATE TABLE capability_control.relay_agent_evidence (
  installation_id text NOT NULL REFERENCES capability_control.installations(id),
  owner_id text NOT NULL, organization_id text NOT NULL, agent_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0), capability_ids jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  expires_at timestamptz NOT NULL, source_record_id text NOT NULL CHECK(length(btrim(source_record_id))>0),
  PRIMARY KEY(installation_id,owner_id,agent_id)
);
ALTER TABLE capability_control.relay_agent_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_control.relay_agent_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON capability_control.relay_agent_evidence USING (
  owner_id=current_setting('myeve.capability_owner',true) AND installation_id=current_setting('myeve.capability_installation',true)
) WITH CHECK (owner_id=current_setting('myeve.capability_owner',true) AND installation_id=current_setting('myeve.capability_installation',true));
REVOKE ALL ON capability_control.relay_agent_evidence FROM PUBLIC;

-- Read-only application roles may lock authoritative rows without gaining UPDATE rights.
CREATE FUNCTION capability_control.lock_admission_policy(installation text,owner text,agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF owner IS DISTINCT FROM current_setting('myeve.capability_owner',true)
    OR installation IS DISTINCT FROM current_setting('myeve.capability_installation',true) THEN
    RAISE EXCEPTION 'CAPABILITY_SCOPE_MISMATCH';
  END IF;
  PERFORM 1 FROM capability_control.installations WHERE id=installation FOR SHARE;
  INSERT INTO capability_control.owner_state(installation_id,owner_id) VALUES(installation,owner) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM capability_control.owner_state WHERE installation_id=installation AND owner_id=owner FOR UPDATE;
  PERFORM 1 FROM capability_control.platform_owner_bindings WHERE installation_id=installation AND owner_id=owner FOR SHARE;
  PERFORM 1 FROM capability_control.evidence WHERE installation_id=installation AND owner_id=owner FOR SHARE;
  PERFORM 1 FROM capability_control.relay_agent_evidence WHERE installation_id=installation AND owner_id=owner AND agent_id=agent FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION capability_control.lock_admission_policy(text,text,text) FROM PUBLIC;
