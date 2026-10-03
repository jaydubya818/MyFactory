-- Installation reconciliation only. EvidenceProvider adds no Factory migration.
-- Preserve the existing staging marker. A separate, checked initializer may bind
-- an empty, freshly provisioned database to the reviewed production installation.
ALTER TABLE factory.environment DROP CONSTRAINT IF EXISTS environment_environment_check;
ALTER TABLE factory.environment ADD CONSTRAINT environment_environment_check
  CHECK (environment IN ('staging', 'production'));
ALTER TABLE factory.environment ADD COLUMN IF NOT EXISTS owner_scope text;
ALTER TABLE factory.environment ADD COLUMN IF NOT EXISTS custody_store_id text;
ALTER TABLE factory.environment ADD COLUMN IF NOT EXISTS database_resource_id text;
ALTER TABLE factory.environment DROP CONSTRAINT IF EXISTS environment_production_binding;
ALTER TABLE factory.environment ADD CONSTRAINT environment_production_binding CHECK (
  (environment = 'staging' AND project_id = 'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4'
    AND owner_scope IS NULL AND custody_store_id IS NULL AND database_resource_id IS NULL)
  OR (environment = 'production' AND project_id = 'prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK'
    AND owner_scope IS NOT NULL AND length(owner_scope) BETWEEN 1 AND 200
    AND custody_store_id IS NOT NULL AND custody_store_id = 'store_qBuivS8MmRxnBNnU'
    AND database_resource_id IS NOT NULL AND database_resource_id = 'dry-morning-22844424')
);
REVOKE ALL ON factory.environment FROM PUBLIC;
