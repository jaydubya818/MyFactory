import { QueueClient } from '@vercel/queue';
import { withQueueStore, receiveQueueCheck } from '../src/queue-delivery.mjs';

// The queue trigger makes this function private at the platform boundary.
// The admitted nonce additionally binds a delivery to one durable staging intent.
const queue = new QueueClient({ region: 'iad1' });
export default { fetch: queue.handleCallback((payload,metadata) => withQueueStore(process.env,store => receiveQueueCheck(store,payload,metadata)), {
  visibilityTimeoutSeconds: 30,
  retry(error,metadata) {
    if (['INVALID_CHECK_MESSAGE','INVALID_CHECK_METADATA'].includes(error.message) || metadata.deliveryCount >= 3) return { acknowledge: true };
    return { afterSeconds: 10 };
  },
}) };
