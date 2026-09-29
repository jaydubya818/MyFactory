// Synthetic child process used to test real SQLite process races and abrupt loss.
import {SpendLedger} from '../src/spend.ts';
const [path,bindingJson]=process.argv.slice(2);
const binding=JSON.parse(bindingJson),ledger=new SpendLedger(path);
let pending=null;
process.on('message',message=>{
  if(message.kind==='arm'){
    pending=message;
    process.send?.({kind:'armed'});
    return;
  }
  if(message.kind!=='go'||!pending)return;
  const command=pending;pending=null;
  try{
    let value=null;
    const reservation={...binding,operationId:command.operationId,model:'fixture-model',pricingRevision:'fixture-v1',
      reservedMicrousd:1200,phase:command.phase??'productive'};
    switch(command.action){
      case 'reserve':value=ledger.reserve(reservation).state;break;
      case 'dispatch':ledger.markDispatched(command.operationId);break;
      case 'unknown':ledger.markUnknown(command.operationId);break;
      case 'settle':ledger.settle(command.operationId,command.actual??30,'provider-'+command.operationId,
        {input_tokens:10,output_tokens:10});break;
      case 'cancel':ledger.cancelBound(binding);break;
      case 'completion':ledger.beginCompletion(binding);break;
      default:throw new Error('Unknown fixture action');
    }
    process.send?.({kind:'result',ok:true,value});
  }catch(error){process.send?.({kind:'result',ok:false,error:error instanceof Error?error.message:String(error)});}
});
process.send?.({kind:'ready'});
