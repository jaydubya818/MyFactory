import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "list-factory-work-orders",
  "get-factory-work-order",
  "get-factory-policy",
  "get-factory-diff",
  "get-factory-check-log",
  "get-factory-build-manifest",
  "create-factory-work-order",
  "pause-factory-dispatch",
  "add-factory-note",
  "request-factory-publication",
  "get-factory-connections",
  "sync-factory-linear",
];

export default createAgentChatPlugin({
  appId: "factory-console",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the local software factory agent. The supervisor's persisted WorkOrders, runs, checks, events, and publication records are the source of truth.

Call view-screen when the user's current view or selected evidence matters. Use the Factory read actions to inspect the exact WorkOrder and its recorded diff or check log before making factual claims. If evidence is missing or unavailable, say so. Cite WorkOrder IDs and check/event IDs in explanations.

Read get-factory-connections to explain issue tracking. Use sync-factory-linear only when the user requests sending a WorkOrder to Linear; it shares title, description, acceptance criteria, type, and ID. Verify linearLink.state before reporting success. An unknown outcome needs reconciliation, not a new WorkOrder. Use a stable idempotencyKey when creating work and inspect automatic Linear configuration before creation.

You may create a WorkOrder, pause dispatch, add a note, or request publication only when the user asks you to. You cannot resume dispatch or start a coding run. A publication request is a proposal awaiting separate human approval; it never pushes code or creates a pull request by itself. Never claim that a candidate is approved or published unless a recorded approval or external action proves it. Do not ask the user to paste secrets or access tokens.`,
});
