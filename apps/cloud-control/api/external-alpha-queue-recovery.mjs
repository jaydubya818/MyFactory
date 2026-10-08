import {QueueClient} from '@vercel/queue';
import {consumeExternalAlphaDelivery,retryExternalAlphaDelivery} from '../src/external-alpha-delivery.mjs';
const queue=new QueueClient({region:'iad1'});
export default {fetch:queue.handleCallback((payload,metadata)=>consumeExternalAlphaDelivery(process.env,payload,metadata,true),{visibilityTimeoutSeconds:60,retry:retryExternalAlphaDelivery})};
