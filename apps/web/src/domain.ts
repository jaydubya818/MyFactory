import type { WorkOrderState } from "@factory/contracts";

export type Tone = "neutral" | "active" | "attention" | "success" | "quiet";

export const workOrderStates: Record<
  WorkOrderState,
  { label: string; tone: Tone; guidance: string }
> = {
  needs_investigation: {
    label: "Needs investigation",
    tone: "attention",
    guidance: "Clarify the problem and evidence before an attempt starts.",
  },
  awaiting_clarification: {
    label: "Awaiting clarification",
    tone: "attention",
    guidance: "A focused answer is needed before work can continue.",
  },
  queued: {
    label: "Queued",
    tone: "neutral",
    guidance: "The work order is ready for a bounded attempt.",
  },
  planning: {
    label: "Planning",
    tone: "active",
    guidance: "The active attempt is defining its approach.",
  },
  implementing: {
    label: "Implementing",
    tone: "active",
    guidance: "The active attempt is changing code within the approved scope.",
  },
  verifying: {
    label: "Verifying",
    tone: "active",
    guidance: "Configured checks are running against the candidate.",
  },
  ready_for_review: {
    label: "Ready for review",
    tone: "success",
    guidance: "Inspect the candidate and check results before publication.",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    tone: "attention",
    guidance: "A person must review the proposed next action.",
  },
  awaiting_human_login: {
    label: "Sign-in required",
    tone: "attention",
    guidance: "Complete sign-in in the required app or browser to continue.",
  },
  awaiting_environment: {
    label: "Environment unavailable",
    tone: "attention",
    guidance: "The required worker environment needs attention before work can continue.",
  },
  failed: {
    label: "Failed",
    tone: "attention",
    guidance: "Inspect the run and verification evidence before trying again.",
  },
  interrupted: {
    label: "Interrupted",
    tone: "attention",
    guidance: "Review the preserved history before starting another attempt.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "quiet",
    guidance: "This work order has no active attempt.",
  },
};

export const attentionStates = new Set<WorkOrderState>([
  "needs_investigation",
  "awaiting_clarification",
  "awaiting_approval",
  "awaiting_human_login",
  "awaiting_environment",
  "failed",
  "interrupted",
]);

export const runningStates = new Set<WorkOrderState>([
  "planning",
  "implementing",
  "verifying",
]);

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function shortId(value: string, length = 8): string {
  return value.length > length ? value.slice(0, length) : value;
}

export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
