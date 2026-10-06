-- Operator-installed fixed three-owner client namespace; no grant creation.
-- The personal client's historical rows and one-Work limit remain unchanged.
ALTER TABLE factory.production_work_authority
 DROP CONSTRAINT production_work_authority_client_id_check;
ALTER TABLE factory.production_work_authority
 ADD CONSTRAINT production_work_authority_client_id_check CHECK
 (client_id IN ('sofie-production','sofie-production-validation','sofie-alpha-a','sofie-alpha-b','sofie-alpha-c'));
