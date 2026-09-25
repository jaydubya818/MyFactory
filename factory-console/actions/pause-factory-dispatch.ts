import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { pauseFactoryDispatch } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Pause new Factory coding attempts after reading the current policy revision. Agents cannot resume dispatch; the device owner must do that.",
  schema: z.object({ expectedRevision: z.number().int().min(1) }),
  http: { method: "POST" },
  mcpTool: true,
  run: async ({ expectedRevision }) => pauseFactoryDispatch(expectedRevision),
});
