-- No grants or table changes. Preserve migration013 and qualify its existing
-- SECURITY DEFINER lookups before either can inspect FORCE-RLS history.
CREATE OR REPLACE FUNCTION factory.receiver_role_enrolled(o text,g text,i text,b text,c text,v integer) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'FACTORY_RECEIVER_LOOKUP_OWNER_UNQUALIFIED';
 END IF;
 RETURN EXISTS(SELECT 1 FROM factory.capability_receiver_heads h WHERE h.owner_id=o AND h.organization_id=g
  AND h.installation_id=i AND h.backend_id=b AND h.incarnation=c AND h.enrollment_version=v
  AND h.receiver_sequence=1 AND h.payload->>'runtimeRole'=session_user);
END;
$$;
CREATE OR REPLACE FUNCTION factory.receiver_requires_ordering(o text,i text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'FACTORY_RECEIVER_LOOKUP_OWNER_UNQUALIFIED';
 END IF;
 RETURN EXISTS(SELECT 1 FROM factory.capability_receiver_heads
  WHERE owner_id=o AND installation_id=i AND receiver_sequence=1);
END;
$$;
