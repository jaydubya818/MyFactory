import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { addFactoryNote } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Add a note to a local Factory WorkOrder's activity record. This persists the supplied text and does not start an attempt or approve publication.",
  schema: z.object({ workOrderId: z.string().uuid(), text: z.string().trim().min(1).max(4_000) }),
  http: { method: "POST" },
  mcpTool: true,
  run: async ({ workOrderId, text }) => addFactoryNote(workOrderId, text),
});
