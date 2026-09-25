import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createFactoryWorkOrder } from "../server/lib/factory-supervisor";

export default defineAction({
  description: "Create a durable, scoped Factory WorkOrder from a user-requested task. This records the request and does not start a coding attempt.",
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10_000),
    kind: z.enum(["defect", "feature", "investigation"]),
    repositoryPath: z.string().trim().default(""),
    baseRef: z.string().trim().default(""),
    acceptanceCriteria: z.array(z.string().trim().min(1)).default([]),
    reproductionCommand: z.string().trim().nullable().default(null),
    expectedFailureText: z.string().trim().nullable().default(null),
    checkCommands: z.array(z.string().trim().min(1)).default([]),
    allowedPaths: z.array(z.string().trim().min(1)).default([]),
    workerProfile: z.enum(["mac", "container", "browser"]).default("mac"),
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: async (input) => createFactoryWorkOrder(input),
});
