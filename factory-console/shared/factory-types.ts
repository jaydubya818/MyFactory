export type {
  Check,
  ExternalAction,
  FactoryEvent,
  FactoryPolicy,
  Run,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderState,
} from "../../packages/contracts/src/index.ts";

export interface FactoryWorkOrdersResponse {
  workOrders: import("../../packages/contracts/src/index.ts").WorkOrder[];
  supervisorUiOrigin: string;
}

export interface FactoryPublicationRequest {
  id: string;
  workOrderId: string;
  runId: string;
  destination: string;
  candidateCommit: string;
  evidenceDigest: string;
  policyRevision: number;
  createdAt: string;
}

export interface FactoryBuildManifest {
  schemaVersion: number;
  outputDir: string;
  createdAt: string;
  template: { id: string; version: string; sha256: string };
  files: { path: string; sha256: string; bytes: number }[];
}

export interface FactoryManifestResult {
  available: boolean;
  manifest: FactoryBuildManifest | null;
}
