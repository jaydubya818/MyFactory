/** Evidence is information; these records never grant execution or publication authority. */
export interface CandidateIdentity { workOrderId: string; runId: string; commit: string; tree: string }
export interface ReviewFinding {
  id: string; category: "correctness" | "security" | "contract" | "regression";
  severity: "critical" | "high" | "medium" | "low";
  path: string; evidence: { visibility: "PUBLIC" | "RESTRICTED"; reference: string; summary: string };
}
export interface CandidateReview {
  id: string; reviewer: string; candidate: CandidateIdentity; status: "PASS" | "FAIL";
  findings: ReviewFinding[]; reportHash: string;
}
export interface RepairPolicy {
  mode: "OWNER_APPROVAL"; publicContract: string; allowedPaths: string[];
  maxRounds: number; maxOperations: number; maxBudgetMicrousd: number; maxDurationSeconds: number;
  round: { productiveOperations: 1 | 2; completionOperations: 1; budgetMicrousd: number; durationSeconds: number };
}
export interface RepairProposal {
  id: string; rootWorkOrderId: string; parent: CandidateIdentity; reviewId: string;
  reviewHash: string; objective: string; policy: RepairPolicy; hash: string;
}
export interface RepairLink {
  rootWorkOrderId: string; parent: CandidateIdentity; reviewId: string; proposalId: string;
  round: number; policy: RepairPolicy; objective: string; deadline: string; owner: string;
  permittedFindings: ReviewFinding[];
}
export interface VerificationObservation {
  candidate: CandidateIdentity; stage: "custody" | "protected" | "ci";
  status: "PASS" | "FAIL" | "UNKNOWN"; artifactHash: string; source: string;
  /** True for external publication, including publication by a consumer rather than this host. */
  published: boolean;
}
