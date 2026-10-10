import { ActionError } from './actions.ts';

export function assertLocalCapabilityAdmission() {
  if (process.env.FACTORY_CAPABILITY_CONTROL_ENABLED === 'true')
    throw new ActionError('Local capability-policy revalidation is not qualified for this installation',
      'capability_policy_unavailable', 503);
}
