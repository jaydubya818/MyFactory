import type { ActionInputMap, ActionName, ActionOutputMap } from "./shared/actions.ts";

export async function sendAction<Name extends ActionName>(
  type: Name,
  input: ActionInputMap[Name],
  signal?: AbortSignal,
): Promise<ActionOutputMap[Name]> {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, input }),
    signal,
  });
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("The server returned an invalid response.");
  const payload = body as { result?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The request failed.");
  return payload.result as ActionOutputMap[Name];
}
