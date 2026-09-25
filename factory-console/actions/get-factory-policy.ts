import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFactoryPolicy } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read the local factory's current dispatch policy and revision. Use this when explaining a held or queued WorkOrder.",
  schema: z.object({}),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async () => getFactoryPolicy(),
});
