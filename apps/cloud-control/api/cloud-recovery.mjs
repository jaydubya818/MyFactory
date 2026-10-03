import {QueueClient} from '@vercel/queue';
import {withCloudRuntime} from '../src/cloud-runtime.mjs';
import {consumeCloudDelivery,retryCloudDelivery} from '../src/cloud-queue-consumer.mjs';
const queue=new QueueClient({region:'iad1'});
export default {fetch:queue.handleCallback((payload,metadata)=>withCloudRuntime(process.env,runtime=>consumeCloudDelivery(runtime,payload,metadata,process.env.VERCEL_DEPLOYMENT_ID,true)),{visibilityTimeoutSeconds:60,retry:retryCloudDelivery})};
