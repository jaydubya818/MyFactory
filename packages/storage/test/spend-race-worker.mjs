import {SpendLedger} from '../src/spend.ts';
const [path,bindingJson,operationId]=process.argv.slice(2);
const ledger=new SpendLedger(path);
try{
  ledger.reserve({...JSON.parse(bindingJson),operationId,model:'fixture-model',pricingRevision:'fixture-v1',
    reservedMicrousd:1200,phase:'productive'});
  process.stdout.write('ADMITTED\n');
}catch(error){
  process.stdout.write('DENIED '+(error instanceof Error?error.message:String(error))+'\n');
}finally{ledger.close();}
