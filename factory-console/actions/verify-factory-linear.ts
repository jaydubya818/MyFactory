import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { verifyFactoryLinear } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Check the existing Linear authorization and exact workspace/team without creating an issue. Returns the verified team and check timestamp; reports refresh or access failures.",
  schema: z.object({}),
  http: { method: "POST" },
  mcpTool: true,
  readOnly: true,
  run: async () => verifyFactoryLinear(),
});
