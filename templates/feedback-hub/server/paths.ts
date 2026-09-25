import { join } from "node:path";

export const templateRoot = join(import.meta.dirname, "..");

export function databasePath(): string {
  return process.env.FEEDBACK_HUB_DB ?? join(templateRoot, ".data", "feedback-hub.sqlite");
}
