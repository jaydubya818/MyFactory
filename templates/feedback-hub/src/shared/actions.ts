export const feedbackStatuses = ["new", "reviewing", "planned", "closed"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const feedbackPriorities = ["unset", "low", "medium", "high"] as const;
export type FeedbackPriority = (typeof feedbackPriorities)[number];

export const feedbackSources = ["manual", "support", "interview", "in_app"] as const;
export type FeedbackSource = (typeof feedbackSources)[number];

export type Actor = "user" | "agent";

export interface Feedback {
  id: string;
  title: string;
  description: string;
  source: FeedbackSource;
  customer: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  version: number;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

export interface FeedbackNote {
  id: string;
  feedbackId: string;
  body: string;
  actor: Actor;
  createdAt: string;
}

export interface FeedbackEvent {
  id: number;
  feedbackId: string;
  actor: Actor;
  summary: string;
  createdAt: string;
}

export interface FeedbackDetail extends Feedback {
  notes: FeedbackNote[];
  events: FeedbackEvent[];
}

export interface AgentContext {
  feedback: FeedbackDetail;
  brief: string;
  availableActions: readonly string[];
}

export interface ActionInputMap {
  list_feedback: { search?: string; status?: FeedbackStatus | "all" };
  get_feedback: { id: string };
  create_feedback: {
    title: string;
    description: string;
    source: FeedbackSource;
    customer?: string;
  };
  update_feedback: {
    id: string;
    expectedVersion: number;
    changes: Partial<Pick<Feedback, "title" | "description" | "source" | "customer" | "status" | "priority">>;
  };
  add_note: { id: string; body: string };
  get_agent_context: { id: string };
}

export interface ActionOutputMap {
  list_feedback: Feedback[];
  get_feedback: FeedbackDetail;
  create_feedback: FeedbackDetail;
  update_feedback: FeedbackDetail;
  add_note: FeedbackDetail;
  get_agent_context: AgentContext;
}

export type ActionName = keyof ActionInputMap;
export type ActionRequest = {
  [Name in ActionName]: { type: Name; input: ActionInputMap[Name] };
}[ActionName];

export const actionNames = [
  "list_feedback",
  "get_feedback",
  "create_feedback",
  "update_feedback",
  "add_note",
  "get_agent_context",
] as const satisfies readonly ActionName[];

// The UI and agent CLI call these same actions. Keep the map current when adding a control.
export const capabilities = [
  { uiAction: "Search and filter inbox", action: "list_feedback" },
  { uiAction: "Refresh inbox", action: "list_feedback" },
  { uiAction: "Open feedback detail", action: "get_feedback" },
  { uiAction: "Capture feedback", action: "create_feedback" },
  { uiAction: "Edit or triage feedback", action: "update_feedback" },
  { uiAction: "Add an internal note", action: "add_note" },
  { uiAction: "View or copy agent brief", action: "get_agent_context" },
] as const satisfies readonly { uiAction: string; action: ActionName }[];

export class ValidationError extends Error {
  readonly status = 400;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ValidationError(`${name}.${key} is not supported.`);
  }
}

function string(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new ValidationError(`${name} must be text.`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new ValidationError(`${name} is required.`);
  if (trimmed.length > max) throw new ValidationError(`${name} must be ${max} characters or fewer.`);
  return trimmed;
}

function choice<T extends string>(value: unknown, name: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new ValidationError(`${name} must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

export function parseAction(value: unknown): ActionRequest {
  const request = object(value, "action");
  onlyKeys(request, ["type", "input"], "action");
  const input = object(request.input, "input");

  switch (request.type) {
    case "list_feedback": {
      onlyKeys(input, ["search", "status"], "input");
      return {
        type: "list_feedback",
        input: {
          ...(input.search === undefined ? {} : { search: string(input.search, "search", 120, true) }),
          ...(input.status === undefined ? {} : { status: choice<FeedbackStatus | "all">(input.status, "status", ["all", ...feedbackStatuses]) }),
        },
      };
    }
    case "get_feedback":
    case "get_agent_context": {
      onlyKeys(input, ["id"], "input");
      return { type: request.type, input: { id: string(input.id, "id", 80) } };
    }
    case "create_feedback": {
      onlyKeys(input, ["title", "description", "source", "customer"], "input");
      return {
        type: "create_feedback",
        input: {
          title: string(input.title, "title", 120),
          description: string(input.description, "description", 5000),
          source: choice(input.source, "source", feedbackSources),
          customer: input.customer === undefined ? "" : string(input.customer, "customer", 100, true),
        },
      };
    }
    case "update_feedback": {
      onlyKeys(input, ["id", "expectedVersion", "changes"], "input");
      if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) {
        throw new ValidationError("expectedVersion must be a positive integer.");
      }
      const rawChanges = object(input.changes, "changes");
      onlyKeys(rawChanges, ["title", "description", "source", "customer", "status", "priority"], "changes");
      if (Object.keys(rawChanges).length === 0) throw new ValidationError("At least one change is required.");
      const changes: ActionInputMap["update_feedback"]["changes"] = {};
      if (rawChanges.title !== undefined) changes.title = string(rawChanges.title, "title", 120);
      if (rawChanges.description !== undefined) changes.description = string(rawChanges.description, "description", 5000);
      if (rawChanges.source !== undefined) changes.source = choice(rawChanges.source, "source", feedbackSources);
      if (rawChanges.customer !== undefined) changes.customer = string(rawChanges.customer, "customer", 100, true);
      if (rawChanges.status !== undefined) changes.status = choice(rawChanges.status, "status", feedbackStatuses);
      if (rawChanges.priority !== undefined) changes.priority = choice(rawChanges.priority, "priority", feedbackPriorities);
      if (Object.keys(changes).length === 0) throw new ValidationError("At least one change is required.");
      return {
        type: "update_feedback",
        input: { id: string(input.id, "id", 80), expectedVersion: input.expectedVersion as number, changes },
      };
    }
    case "add_note": {
      onlyKeys(input, ["id", "body"], "input");
      return { type: "add_note", input: { id: string(input.id, "id", 80), body: string(input.body, "body", 2000) } };
    }
    default:
      throw new ValidationError(`Unknown action: ${String(request.type)}.`);
  }
}
