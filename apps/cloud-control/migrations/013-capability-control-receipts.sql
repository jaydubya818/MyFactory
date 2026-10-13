-- Receiver history only; no policy registry, execution ledger, enrollment or grants.
-- Migration numbering verified unused against the exact selected source.
CREATE FUNCTION factory.protect_capability_receiver_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Factory capability receiver history is immutable'; END $$;
REVOKE ALL ON FUNCTION factory.protect_capability_receiver_history() FROM PUBLIC;

CREATE TABLE factory.capability_fences (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key)
);
ALTER TABLE factory.capability_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.capability_fences FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.capability_fences USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.capability_fences
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.capability_fences FROM PUBLIC;

CREATE TABLE factory.capability_control_observations (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key)
);
ALTER TABLE factory.capability_control_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.capability_control_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.capability_control_observations USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.capability_control_observations
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.capability_control_observations FROM PUBLIC;

CREATE TABLE factory.capability_admission_references (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key)
);
ALTER TABLE factory.capability_admission_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.capability_admission_references FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.capability_admission_references USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.capability_admission_references
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.capability_admission_references FROM PUBLIC;

CREATE TABLE factory.capability_receiver_heads (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key)
);
CREATE UNIQUE INDEX capability_receiver_head_sequence ON factory.capability_receiver_heads(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,receiver_sequence);
ALTER TABLE factory.capability_receiver_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.capability_receiver_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.capability_receiver_heads USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.capability_receiver_heads
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.capability_receiver_heads FROM PUBLIC;

CREATE TABLE factory.relay_policy_receipts (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key)
);
ALTER TABLE factory.relay_policy_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.relay_policy_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.relay_policy_receipts USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.relay_policy_receipts
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.relay_policy_receipts FROM PUBLIC;

CREATE TABLE factory.capability_receiver_plans (
  owner_id text NOT NULL, organization_id text NOT NULL, installation_id text NOT NULL,
  backend_id text NOT NULL, incarnation text NOT NULL, enrollment_version integer NOT NULL CHECK(enrollment_version>0),
  receiver_sequence integer NOT NULL CHECK(receiver_sequence BETWEEN 1 AND 4096),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  record_kind text NOT NULL CHECK(record_kind IN ('PLAN','OUTCOME')),
  PRIMARY KEY(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,record_key,record_kind)
);
ALTER TABLE factory.capability_receiver_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory.capability_receiver_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_receiver_scope ON factory.capability_receiver_plans USING (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
) WITH CHECK (
 owner_id=current_setting('factory.capability_owner',true)
 AND organization_id=current_setting('factory.capability_organization',true)
 AND installation_id=current_setting('factory.capability_installation',true)
 AND backend_id=current_setting('factory.capability_backend',true)
 AND incarnation=current_setting('factory.capability_incarnation',true)
 AND enrollment_version::text=current_setting('factory.capability_enrollment',true)
);
CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON factory.capability_receiver_plans
 FOR EACH ROW EXECUTE FUNCTION factory.protect_capability_receiver_history();
REVOKE ALL ON factory.capability_receiver_plans FROM PUBLIC;
-- A newly issued proof cannot revive the same consumed Work generation.
CREATE UNIQUE INDEX capability_reference_work_generation ON factory.capability_admission_references
 (owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,
 (payload->>'authority'),(payload->>'workId'),(payload->>'workGeneration'));
-- The privileged genesis head binds the original session role to its enrollment.
-- GUCs select context; they cannot choose another role's owner.
CREATE FUNCTION factory.receiver_role_enrolled(o text,g text,i text,b text,c text,v integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM factory.capability_receiver_heads h WHERE h.owner_id=o AND h.organization_id=g
  AND h.installation_id=i AND h.backend_id=b AND h.incarnation=c AND h.enrollment_version=v
  AND h.receiver_sequence=1 AND h.payload->>'runtimeRole'=session_user)
$$;
REVOKE ALL ON FUNCTION factory.receiver_role_enrolled(text,text,text,text,text,integer) FROM PUBLIC;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['capability_fences','capability_control_observations','capability_admission_references',
  'capability_receiver_heads','relay_policy_receipts','capability_receiver_plans'] LOOP
  EXECUTE format('CREATE POLICY original_receiver_role ON factory.%I AS RESTRICTIVE
   USING(factory.receiver_role_enrolled(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version))
   WITH CHECK(factory.receiver_role_enrolled(owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version))',t);
 END LOOP;
END $$;
-- The schema custodian must own the SECURITY DEFINER function with qualified
-- RLS inspection authority. Runtime receives EXECUTE only, never ownership.

-- Ordinary native endpoints cannot bypass a durable remote enrollment after a
-- controller restart. Custody owns this exact-scope inspection function.
CREATE FUNCTION factory.receiver_requires_ordering(o text,i text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,factory,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM factory.capability_receiver_heads
  WHERE owner_id=o AND installation_id=i AND receiver_sequence=1);
$$;
REVOKE ALL ON FUNCTION factory.receiver_requires_ordering(text,text) FROM PUBLIC;
