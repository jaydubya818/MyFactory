/**
 * Markers of the host-only OWNER_SUBSCRIPTION_LOCAL execution route (the operator's own authenticated Codex/ChatGPT login,
 * accounted by an operations-only ledger). The route is selected exclusively by trusted local host configuration; it is never
 * selectable by request fields or environment, and every hosted/cloud surface must refuse anything carrying these markers.
 * The route is bound into the Factory identity through the executor version (configurationDigest), so a subscription-route
 * Result can never verify as a metered one.
 */
export const OWNER_SUBSCRIPTION_ROUTE = 'OWNER_SUBSCRIPTION_LOCAL' as const;
export const OWNER_SUBSCRIPTION_EXECUTOR_SUFFIX = ` route=${OWNER_SUBSCRIPTION_ROUTE}`;
/** Same value as packages/storage/src/spend-policy.ts OWNER_SUBSCRIPTION_PRICING_REVISION (cross-checked by test). */
export const OWNER_SUBSCRIPTION_PRICING_REVISION_MARKER = 'owner-subscription-local.operations-v1';

export function ownerSubscriptionExecutorVersion(version: string): string {
  if (typeof version !== 'string' || !/^codex-cli \S+$/.test(version)) throw new TypeError('Exact Codex CLI version required');
  return version + OWNER_SUBSCRIPTION_EXECUTOR_SUFFIX;
}
export function isOwnerSubscriptionExecutorVersion(value: unknown): boolean {
  return typeof value === 'string' && value.includes(OWNER_SUBSCRIPTION_ROUTE);
}
/** True when any string inside a JSON value names the route or its ledger revision (hosted surfaces refuse such input). */
export function containsOwnerSubscriptionMarker(value: unknown): boolean {
  let text: string;
  try { text = JSON.stringify(value) ?? ''; } catch { return true; }
  return text.includes(OWNER_SUBSCRIPTION_ROUTE) || text.includes(OWNER_SUBSCRIPTION_PRICING_REVISION_MARKER);
}
