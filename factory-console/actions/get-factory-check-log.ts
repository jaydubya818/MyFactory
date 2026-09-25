import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFactoryCheckLog } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read a recorded verification check log for a Factory WorkOrder by check ID. If unavailable, report that the log cannot be inspected.",
  schema: z.object({ workOrderId: z.string().uuid(), checkId: z.string().uuid() }),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async ({ workOrderId, checkId }) => getFactoryCheckLog(workOrderId, checkId),
});
