import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestFactoryPublication } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Request publication of a reviewed candidate to a GitHub owner/repo destination. This creates a proposal only; a separate human approval is required before push or draft PR creation.",
  schema: z.object({ workOrderId: z.string().uuid(), destination: z.string().trim().min(3) }),
  http: { method: "POST" },
  mcpTool: true,
  needsApproval: false,
  run: async ({ workOrderId, destination }) => requestFactoryPublication(workOrderId, destination),
});
