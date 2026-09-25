import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listFactoryWorkOrders } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "List the local software factory's persisted WorkOrders and their current states. Use this to inspect the work queue before making claims about active work.",
  schema: z.object({}),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async () => listFactoryWorkOrders(),
});
