import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { syncFactoryLinear } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "When requested, create or reconcile a WorkOrder's Linear issue in the configured team/project. Shares its title, description, acceptance criteria, type, and ID. Reuses the saved issue UUID on retry. Check the returned sync state before claiming success.",
  schema: z.object({ workOrderId: z.string().uuid() }),
  http: { method: "POST" },
  mcpTool: true,
  run: async ({ workOrderId }) => syncFactoryLinear(workOrderId),
});
