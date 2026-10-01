/** Canonical opaque model reference. Validation never rewrites provider or model identity.
 * One model component, optionally prefixed by one provider component, at most 120 ASCII
 * characters total. Components start alphanumeric and contain only alphanumeric, dot,
 * underscore or hyphen. Traversal, URLs, control/space characters and extra slashes fail.
 * This grammar grants neither model eligibility nor execution authority: exact pinning
 * and provider policy remain independent checks at the gateway and spending ledger.
 */
export function isModelReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120 ||
      value.includes('..') || /\s/.test(value)) return false;
  const components = value.split('/');
  return components.length <= 2 && components.every(component =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(component));
}
