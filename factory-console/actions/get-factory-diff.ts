import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFactoryDiff } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read the recorded candidate diff for a Factory WorkOrder. An unavailable result means the artifact is absent; do not infer changes from a commit ID alone.",
  schema: z.object({ workOrderId: z.string().uuid() }),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async ({ workOrderId }) => getFactoryDiff(workOrderId),
});
