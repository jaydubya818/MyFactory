import { actionNames, parseAction, type ActionRequest, type Actor, type AgentContext } from "../src/shared/actions.ts";
import { FeedbackStore } from "./store.ts";

export function executeAction(store: FeedbackStore, request: ActionRequest, actor: Actor): unknown {
  switch (request.type) {
    case "list_feedback":
      return store.list(request.input.search, request.input.status);
    case "get_feedback":
      return store.get(request.input.id);
    case "create_feedback":
      return store.create(request.input, actor);
    case "update_feedback":
      return store.update(request.input, actor);
    case "add_note":
      return store.addNote(request.input, actor);
    case "get_agent_context": {
      const feedback = store.get(request.input.id);
      const notes = feedback.notes.length
        ? feedback.notes.map((note) => `- ${note.actor} (${note.createdAt}): ${note.body}`).join("\n")
        : "- No internal notes yet.";
      const brief = [
        `Feedback: ${feedback.title}`,
        `ID: ${feedback.id}`,
        `Status: ${feedback.status}; priority: ${feedback.priority}; version: ${feedback.version}`,
        `Source: ${feedback.source}${feedback.customer ? `; customer: ${feedback.customer}` : ""}`,
        `Description:\n${feedback.description}`,
        `Internal notes:\n${notes}`,
        "Review the evidence before changing priority or status. Record reasoning in an internal note.",
      ].join("\n\n");
      return { feedback, brief, availableActions: actionNames } satisfies AgentContext;
    }
  }
}

export function executeBrowserAction(store: FeedbackStore, value: unknown): unknown {
  return executeAction(store, parseAction(value), "user");
}
