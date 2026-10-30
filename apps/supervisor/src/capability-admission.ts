import { AsyncLocalStorage } from 'node:async_hooks';
import { ActionError } from './actions.ts';

/**
 * Capability-controlled installations refuse new local preparation and execution start unless the call is made
 * under an authority issued to the ordered-admission receiver. The authority is only reachable through
 * `issueOrderedAuthority()`, which the host composition calls once when it enrolls the receiver; it is never read
 * from HTTP input or the environment, and ordinary connection endpoints cannot supply it.
 */
const issued = new WeakSet<object>();
export class OrderedAuthority {
  private constructor() {}
  static issue() { const authority = new OrderedAuthority(); issued.add(authority); return authority; }
  static isIssued(value: unknown): value is OrderedAuthority { return typeof value === 'object' && value !== null && issued.has(value); }
}
const context = new AsyncLocalStorage<OrderedAuthority>();

export const issueOrderedAuthority = () => OrderedAuthority.issue();
export function runWithOrderedAuthority<T>(authority: OrderedAuthority, operation: () => T): T {
  if (!OrderedAuthority.isIssued(authority)) throw new ActionError('Ordered admission authority required', 'capability_policy_unavailable', 503);
  return context.run(authority, operation);
}

export function assertLocalCapabilityAdmission() {
  if (process.env.FACTORY_CAPABILITY_CONTROL_ENABLED === 'true' && !OrderedAuthority.isIssued(context.getStore()))
    throw new ActionError('Local capability-policy revalidation is not qualified for this installation',
      'capability_policy_unavailable', 503);
}
