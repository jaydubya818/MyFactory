import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getFactoryConnections } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read Linear configuration and approved sibling app scopes without secrets. Configured settings do not prove live provider access.",
  schema: z.object({}),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async () => getFactoryConnections(),
});
