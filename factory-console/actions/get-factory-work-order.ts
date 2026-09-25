import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFactoryWorkOrder } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read one persisted local Factory WorkOrder with its runs, checks, events, and external action history. Use the returned IDs and evidence before explaining a result or blocker.",
  schema: z.object({ workOrderId: z.string().uuid() }),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async ({ workOrderId }) => getFactoryWorkOrder(workOrderId),
});
