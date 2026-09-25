import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFactoryBuildManifest } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Read the generated App builder scaffold manifest for a Factory WorkOrder, including exact file paths, byte counts, SHA-256 digests, and template identity. Reports unavailable if no saved manifest exists.",
  schema: z.object({ workOrderId: z.string().uuid() }),
  http: { method: "GET" },
  mcpTool: true,
  readOnly: true,
  run: async ({ workOrderId }) => getFactoryBuildManifest(workOrderId),
});
