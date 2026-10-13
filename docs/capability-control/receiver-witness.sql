-- Separate witness database ONLY. Not an application migration or runtime bootstrap.
-- Custody must authorize the independent store, restricted role, immutable enrollment,
-- qualification digest, retention and restore exclusions before this schema is installed.
BEGIN;
CREATE SCHEMA capability_witness;
REVOKE ALL ON SCHEMA capability_witness FROM PUBLIC;
CREATE TABLE capability_witness.enrollments (
  enrollment_id text NOT NULL CHECK(length(enrollment_id) BETWEEN 1 AND 255),
  organization_id text NOT NULL CHECK(length(organization_id)>0),
  installation_id text NOT NULL CHECK(length(installation_id)>0),
  owner_id text NOT NULL CHECK(length(owner_id)>0),
  epoch text NOT NULL CHECK(length(epoch) BETWEEN 1 AND 255),
  runtime_role name NOT NULL,
  qualification_digest text NOT NULL CHECK(qualification_digest ~ '^[a-f0-9]{64}$'),
  installation_digest text NOT NULL CHECK(installation_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(enrollment_id,organization_id,installation_id,owner_id),
  UNIQUE(installation_id,owner_id)
);
CREATE TABLE capability_witness.heads (
  enrollment_id text NOT NULL, organization_id text NOT NULL,
  installation_id text NOT NULL, owner_id text NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(enrollment_id,organization_id,installation_id,owner_id),
  FOREIGN KEY(enrollment_id,organization_id,installation_id,owner_id)
    REFERENCES capability_witness.enrollments(enrollment_id,organization_id,installation_id,owner_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA capability_witness FROM PUBLIC;
CREATE FUNCTION capability_witness.immutable_enrollment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  RAISE EXCEPTION 'CAPABILITY_RECOVERY_ENROLLMENT_IMMUTABLE';
END $$;
CREATE TRIGGER enrollment_immutable BEFORE UPDATE OR DELETE ON capability_witness.enrollments
  FOR EACH ROW EXECUTE FUNCTION capability_witness.immutable_enrollment();
CREATE FUNCTION capability_witness.monotonic_head() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' OR NEW.enrollment_id<>OLD.enrollment_id OR NEW.organization_id<>OLD.organization_id
    OR NEW.installation_id<>OLD.installation_id OR NEW.owner_id<>OLD.owner_id OR NEW.revision<=OLD.revision THEN
    RAISE EXCEPTION 'CAPABILITY_RECOVERY_NON_MONOTONIC';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_no_truncate BEFORE TRUNCATE ON capability_witness.enrollments
  FOR EACH STATEMENT EXECUTE FUNCTION capability_witness.immutable_enrollment();
CREATE TRIGGER head_no_truncate BEFORE TRUNCATE ON capability_witness.heads
  FOR EACH STATEMENT EXECUTE FUNCTION capability_witness.immutable_enrollment();
CREATE TRIGGER head_monotonic BEFORE UPDATE OR DELETE ON capability_witness.heads
  FOR EACH ROW EXECUTE FUNCTION capability_witness.monotonic_head();

-- session_user survives SECURITY DEFINER; caller-controlled GUCs never choose an owner.
CREATE FUNCTION capability_witness.assert_enrollment(e text,o text,i text,u text,epoch_value text,q text,binding_digest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE unsafe boolean;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
    OR has_schema_privilege(session_user,'capability_witness','CREATE')
    OR has_table_privilege(session_user,'capability_witness.enrollments','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
    OR has_table_privilege(session_user,'capability_witness.heads','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
    INTO unsafe FROM pg_roles r WHERE r.rolname=session_user;
  -- NOINHERIT is insufficient: membership may still allow SET ROLE to a writer.
  IF EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(session_user,r.oid,'MEMBER') AND
    (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
      -- EXECUTE-only custody needs no predefined role, including OS/file access.
      OR left(r.rolname,3)='pg_'
      OR has_schema_privilege(r.oid,'capability_witness','CREATE')
      OR has_table_privilege(r.oid,'capability_witness.enrollments','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      OR has_table_privilege(r.oid,'capability_witness.heads','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))) THEN
    unsafe := true;
  END IF;
  IF unsafe IS DISTINCT FROM false THEN RAISE EXCEPTION 'CAPABILITY_RECOVERY_RUNTIME_UNQUALIFIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM capability_witness.enrollments x WHERE x.enrollment_id=e
    AND x.organization_id=o AND x.installation_id=i AND x.owner_id=u AND x.epoch=epoch_value
    AND x.runtime_role=session_user AND x.qualification_digest=q AND x.installation_digest=binding_digest AND x.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'CAPABILITY_RECOVERY_ENROLLMENT_REQUIRED';
  END IF;
END $$;
CREATE FUNCTION capability_witness.read_head(e text,o text,i text,u text,epoch_value text,q text,binding_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM capability_witness.assert_enrollment(e,o,i,u,epoch_value,q,binding_digest);
  SELECT jsonb_build_object('schema','capability-control.recovery-head.v1','organizationId',o,
    'installationId',i,'ownerId',u,'epoch',epoch_value,'revision',h.revision,'digest',h.digest)
    INTO result FROM capability_witness.heads h WHERE h.enrollment_id=e AND h.organization_id=o
      AND h.installation_id=i AND h.owner_id=u;
  IF result IS NULL THEN RAISE EXCEPTION 'CAPABILITY_RECOVERY_ENROLLMENT_REQUIRED'; END IF;
  RETURN result;
END $$;
CREATE FUNCTION capability_witness.advance_head(e text,o text,i text,u text,epoch_value text,q text,binding_digest text,
  previous_revision bigint,previous_digest text,next_revision bigint,next_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
  IF current_setting('synchronous_commit')<>'on' THEN
    RAISE EXCEPTION 'CAPABILITY_RECOVERY_DURABLE_COMMIT_REQUIRED';
  END IF;
  PERFORM capability_witness.assert_enrollment(e,o,i,u,epoch_value,q,binding_digest);
  IF next_revision IS NULL OR previous_revision IS NULL OR next_revision<=previous_revision
    OR next_revision>9007199254740991 OR next_digest IS NULL OR next_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'CAPABILITY_RECOVERY_NON_MONOTONIC';
  END IF;
  UPDATE capability_witness.heads h SET revision=next_revision,digest=next_digest
    WHERE h.enrollment_id=e AND h.organization_id=o AND h.installation_id=i AND h.owner_id=u
      AND h.revision=previous_revision AND h.digest=previous_digest;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'CAPABILITY_RECOVERY_QUARANTINED'; END IF;
  RETURN capability_witness.read_head(e,o,i,u,epoch_value,q,binding_digest);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA capability_witness FROM PUBLIC;
-- No role, credential, enrollment, head, grant or reset function is provisioned here.
-- Separately authorized custodian must grant a restricted runtime USAGE on this schema
-- and EXECUTE only on read_head(text,text,text,text,text,text,text) and
-- advance_head(text,text,text,text,text,text,text,bigint,text,bigint,text).
COMMIT;
