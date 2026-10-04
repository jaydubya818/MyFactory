import {QueueClient} from '@vercel/queue';
import {withProductionRuntime} from '../src/production-runtime.mjs';
import {consumeCloudDelivery,retryCloudDelivery} from '../src/cloud-queue-consumer.mjs';
const queue=new QueueClient({region:'iad1'});
export default {fetch:queue.handleCallback((payload,metadata)=>withProductionRuntime(process.env,runtime=>consumeCloudDelivery(runtime,payload,metadata,process.env.VERCEL_DEPLOYMENT_ID,false),{validation:true}),{visibilityTimeoutSeconds:60,retry:retryCloudDelivery})};
