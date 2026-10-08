import pg from 'pg';
import {createPublicKey} from 'node:crypto';
import {QueueClient} from '@vercel/queue';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {databaseConfig} from './config.mjs';
import {ExternalAlphaAuthorityStore,ExternalAlphaError,receiptSigner} from './external-alpha-authority.mjs';
import {PostgresDispatchStore} from './postgres-dispatch.mjs';
import {PostgresSpendLedger} from './postgres-spend.mjs';
import {PostgresVerificationStore} from './postgres-verification.mjs';
import {CloudWorkControl} from './cloud-work-control.mjs';
import {cloudWorkProvider} from './cloud-work-provider.mjs';
import {verifyCloudCandidate,reconcileCloudVerification} from './cloud-verification.mjs';
import {externalAlphaHostInstallation} from './external-alpha-host-installation.mjs';
import {assertProductionDatabaseMarker} from './production-database.mjs';
import {productionWorkloadIdentity} from './production-identity.mjs';
import {productionModelProvider} from './production-model-provider.mjs';
import {externalAlphaReadback,readbackSigner,assertExternalAlphaResult} from './external-alpha-readback.mjs';
import {productionConfiguration,productionSpendPlan} from './production-execution-plan.mjs';
import {loadPrivateSourceRegistry,registryEntryFor} from './external-alpha-registry.mjs';
import {loadPrivateSnapshots,assertPrivateSnapshotReceipt} from './external-alpha-snapshots.mjs';
import {privateSourceCustody,validateSnapshotBytes,bindVerifierSource} from './private-source.mjs';
import {get,put} from '@vercel/blob';
import {alphaTasksVerificationPolicy,alphaTasksVerificationPolicySha256,alphaTasksVerifierProvider} from './external-alpha-verifier.mjs';
import {externalAlphaVerifierProfile} from './external-alpha-verifier-profile.mjs';
import sourceIdentity from './source-identity.json' with {type:'json'};

const deny=code=>{throw new ExternalAlphaError(code);};

export function externalAlphaSigning(env){
 const config=JSON.parse(env.FACTORY_EXTERNAL_ALPHA_RESULT_SIGNING_JSON??'null');
 if(!config||Object.keys(config).sort().join(',')!=='factoryId,key,privateKey'||config.factoryId!=='myfactory-external-alpha'||config.key?.factoryId!==config.factoryId||config.key.keyId!=='external-alpha-result-v1')throw Error('EXTERNAL_ALPHA_SIGNER_REQUIRED');
 const actual=createPublicKey(config.privateKey),expected=createPublicKey(config.key.publicKey);
 if(actual.asymmetricKeyType!=='ed25519'||!actual.export({type:'spki',format:'der'}).equals(expected.export({type:'spki',format:'der'}))||config.key.revokedAt||config.key.retiredAt||!Number.isFinite(Date.parse(config.key.activeFrom))||!Number.isFinite(Date.parse(config.key.notAfter))||Date.now()<Date.parse(config.key.activeFrom)||Date.now()>=Date.parse(config.key.notAfter))throw Error('EXTERNAL_ALPHA_SIGNER_INVALID');
 const bytes=actual.export({type:'spki',format:'der'});
 for(const [name,value] of Object.entries(env)){
  if(name==='FACTORY_EXTERNAL_ALPHA_RESULT_SIGNING_JSON'||!/^FACTORY_.*RESULT_SIGNING_JSON$/.test(name)||!value)continue;
  const other=JSON.parse(value);
  if(bytes.equals(createPublicKey(other.privateKey).export({type:'spki',format:'der'}))||bytes.equals(createPublicKey(other.key.publicKey).export({type:'spki',format:'der'})))throw Error('EXTERNAL_ALPHA_SIGNER_REUSED');
 }
 if(env.FACTORY_EXTERNAL_ALPHA_RECEIPT_SIGNING_KEY&&bytes.equals(createPublicKey(env.FACTORY_EXTERNAL_ALPHA_RECEIPT_SIGNING_KEY.replaceAll('\\n','\n')).export({type:'spki',format:'der'})))throw Error('EXTERNAL_ALPHA_SIGNER_REUSED');
 return config;
}

/** The execution plan the harness worker consumes. Source, scope and command come ONLY from the pinned installation. */
export function externalAlphaCheckpointPlan(installation){
 const testPath=installation.source.allowedFiles.find(f=>/(^|\/)test\//.test(f)||/\.test\./.test(f));
 if(!testPath)deny('AUTHORITY_FILES');
 return Object.freeze({production:true,source:Object.freeze({repository:installation.source.repository,commit:installation.source.baseSha,tree:installation.source.treeSha}),
  allowedPaths:[...installation.source.allowedFiles],testPath,checkCommand:installation.checkCommands[0],
  commitMessage:'Implement Alpha Tasks priority field',authorName:'MyFactory external alpha',authorEmail:'factory-external-alpha@invalid'});
}
/** Execution configuration. Derived only from the pinned installation + verifier policy; its digest feeds FactoryVersion. */
export function externalAlphaConfiguration(installation,verificationPolicySha256=alphaTasksVerificationPolicySha256){
 const plan=externalAlphaCheckpointPlan(installation),cloud=productionConfiguration.cloud;
 return Object.freeze({...productionConfiguration,commands:[...installation.checkCommands],allowedPaths:[...plan.allowedPaths],
  cloud:{...cloud,networkPolicy:'deny-all-after-pinned-harness-and-private-snapshot-v1',
   toolPolicySha256:digest({allowedPaths:plan.allowedPaths,command:plan.checkCommand,executor:productionConfiguration.executor,mode:'PRIVATE_SNAPSHOT'}),
   contextPolicySha256:digest({source:plan.source,ownerData:false,private:true,signingFactoryId:'myfactory-external-alpha'}),verificationPolicySha256}});
}
/** FactoryVersion as CloudWorkControl computes it. The operator derives installation.factoryVersion from this. */
export const externalAlphaFactoryVersion=(installation,sourceDigest=sourceIdentity.sourceDigest,verificationPolicySha256)=>
 digest({sourceDigest,configurationDigest:digest(externalAlphaConfiguration(installation,verificationPolicySha256))});

/**
 * Pure composition of the external-alpha engine on already-opened dependencies. It refuses (fail closed) unless the
 * running build and execution configuration are EXACTLY what the pinned installation (and therefore the signed
 * authority) names: source digest and FactoryVersion. Opens no connection, calls no provider and sends nothing.
 */
export function externalAlphaRuntimeComponents({env={},pool,queue,installation,signing,sourceDigest,signReceipt,signReadback,registry,snapshots,sourceCustody,provider,providerFactory,verification,verifierProfile,deploymentId=env.VERCEL_DEPLOYMENT_ID,hostInstallation}){
 if((provider&&providerFactory)||(providerFactory!==undefined&&typeof providerFactory!=='function'))deny('AUTHORITY_DISABLED');
 if(!installation||typeof signReceipt!=='function'||typeof signReadback!=='function'||!pool||!queue)deny('AUTHORITY_DISABLED');
 if(sourceDigest!==installation.source.sourceDigest)deny('AUTHORITY_SOURCE');
 const verificationPolicy=verification?.policy??alphaTasksVerificationPolicy,verificationPolicySha256=verification?.policySha256??alphaTasksVerificationPolicySha256;
 const configuration=externalAlphaConfiguration(installation,verificationPolicySha256);
 if(digest({sourceDigest,configurationDigest:digest(configuration)})!==installation.factoryVersion)deny('AUTHORITY_FACTORY_VERSION');
 if(!/^dpl_[A-Za-z0-9]+$/.test(deploymentId??''))deny('AUTHORITY_DISABLED');
 if(signing?.factoryId!=='myfactory-external-alpha'||signing?.key?.factoryId!==signing.factoryId||signing.key.keyId!=='external-alpha-result-v1')deny('AUTHORITY_DISABLED');
 const clientId=installation.application.clientId,plan=externalAlphaCheckpointPlan(installation);
 const grant=Object.freeze({clientId,source:plan.source,commands:[...installation.checkCommands],allowedPaths:[...plan.allowedPaths],maxDurationMs:300000,maxSpendUsd:1,derivedRequestId:true});
 const authority=new ExternalAlphaAuthorityStore(pool,installation,{signReceipt});
 const store=new PostgresDispatchStore(pool,{maxWorks:5,workLimitError:'EXTERNAL_ALPHA_WORK_LIMIT',custodyPrefix:'factory/production',verificationPolicySha256,strictWriterFence:true,requireVerifierPass:true,
  assertAuthority:authority.assertAuthority(),
  onDeliveryUnknown:async(client,runId)=>{
   const row=(await client.query('SELECT * FROM factory.intake_receipts WHERE run_id=$1',[runId])).rows[0];
   if(!row||!await authority.ownedRow(client,row.request_id,{currentGeneration:false}))throw new ExternalAlphaError('AUTHORITY_OWNER');
   await client.query("UPDATE factory.external_alpha_work_authority SET state='UNKNOWN',state_reason='DELIVERY_UNKNOWN' WHERE request_id=$1 AND state='CONSUMED'",[row.request_id]);
   await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced',cancelled_at=clock_timestamp() WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation]);
   await client.query('UPDATE factory.execution_resources SET cancelled_at=clock_timestamp(),lease_expires_at=clock_timestamp() WHERE run_id=$1',[runId]);
  },
  // Every record read or written through this store must belong to THIS slot's admission.
  assertRecordScope:async(client,row)=>{const a=await authority.ownedRow(client,row.request_id,{currentGeneration:false});if(row.client_id!==clientId||!a||row.work_id!==a.work_id||row.work_generation!==a.work_generation||row.snapshot.factoryVersion!==installation.factoryVersion||row.snapshot.requestDigest!==digest(row.request))throw new ExternalAlphaError('AUTHORITY_OWNER');}});
 const spend=new PostgresSpendLedger(pool,{assertPaidAuthority:authority.assertPaidAuthority(),onUnknown:authority.fenceUnknownSpend()});
 let entry,receipt;try{entry=Object.freeze({...registryEntryFor(registry,installation)});receipt=Object.freeze({...assertPrivateSnapshotReceipt(entry,snapshots?.[entry.slot])});}catch{deny('AUTHORITY_SOURCE');}
 if(!sourceCustody&&!hostInstallation?.custodyStoreId)deny('AUTHORITY_SOURCE');
 const rawCustody=sourceCustody??privateSourceCustody({put,get,storeId:hostInstallation.custodyStoreId,options:async()=>({oidcToken:await productionWorkloadIdentity(hostInstallation)})});
 const custody={async read(e,r){assertPrivateSnapshotReceipt(e,r);const read=await rawCustody.read(e,r);if(read.bytes?.length!==r.bytes)throw Error('PRIVATE_SOURCE_CUSTODY_BINDING');return{bytes:read.bytes,...validateSnapshotBytes(read.bytes,e,r.sha256)};}};
 const assertWorkAuthorized=row=>store.transaction((client,now)=>authority.assertAuthority()(client,row.request,now,'model'));
 const sourceProvider=cloudWorkProvider({ledger:spend,plan,projectId:hostInstallation?.projectId,custodyStore:hostInstallation?.custodyStoreId,custodyPrefix:'factory/production',
  providerOptions:async()=>({token:await productionWorkloadIdentity(hostInstallation),projectId:hostInstallation.projectId,teamId:hostInstallation.teamId}),
  blobOptions:async()=>({oidcToken:await productionWorkloadIdentity(hostInstallation)}),
  modelProviderForRow:row=>productionModelProvider({env,assertWorkAuthorized:()=>assertWorkAuthorized(row)}),
  // Gate 2: private-source mode. The producer receives only the digest-verified snapshot; GitHub is never reachable from it.
  ...(entry?{privateSource:{binding:{slot:entry.slot,owner:entry.owner,repo:entry.repo,commit:entry.commit,tree:entry.tree},registry,custody,receipt}}:{})});
 const injectedProvider=providerFactory?.({spend,plan,privateSource:{binding:{slot:entry.slot,owner:entry.owner,repo:entry.repo,commit:entry.commit,tree:entry.tree},registry,custody,receipt},assertWorkAuthorized})??provider;
 const workProvider=injectedProvider?{...injectedProvider,
  async prepareSource(row,note){await sourceProvider.prepareSource(row,note);await injectedProvider.prepareSource?.(row,note);},
  async readCustody(row){
   if(row.resource?.evidence?.privateSourceReceipt?.sha256!==receipt.sha256)throw Error('PRIVATE_SOURCE_CUSTODY_BINDING');
   const candidate=await injectedProvider.readCustody(row);
   await bindVerifierSource({binding:{slot:entry.slot,owner:entry.owner,repo:entry.repo,commit:entry.commit,tree:entry.tree},registry,custody,receipt,candidate});
   return candidate;
  }}:sourceProvider;
 // Gate 3: independent Alpha Tasks acceptance as the protected verifier. A provider without it is not composed.
 const verificationStore=new PostgresVerificationStore(store,{policy:verificationPolicy,policySha256:verificationPolicySha256});
 const verifierProvider=verification?.provider??alphaTasksVerifierProvider({installation,hostInstallation,productionProfile:verifierProfile??verification?.productionProfile,providerOptions:async()=>({token:await productionWorkloadIdentity(hostInstallation),projectId:hostInstallation.projectId,teamId:hostInstallation.teamId}),...verification?.deps});
 const context=row=>({clientId:row.client_id,requestId:row.request_id,store:verificationStore,provider:verifierProvider,readCustody:()=>workProvider.readCustody(row)});
 workProvider.verifyCandidate=row=>verifyCloudCandidate(context(row));
 workProvider.reconcileVerification=row=>reconcileCloudVerification(context(row));
 const control=new CloudWorkControl({store,spend,provider:workProvider,queue,signing,sourceDigest,deploymentId,ownerScope:installation.ownerId,grant,configuration,
  executionSpendPlan:productionSpendPlan,executionWorkTopic:'factory-external-alpha-work-v1',verificationPolicy:{policy:verificationPolicy,policySha256:verificationPolicySha256}});
 /** Every readback carries the signed receipt (contract amendment 7). Unavailable receipt => ambiguous failure, never a bare body. */
 const readbackWithReceipt=async(requestId,challenge=null)=>{
  const body=await control.read(requestId),row=await store.read(clientId,requestId),a=await authority.withClient(client=>authority.ownedRow(client,requestId)),rb=await authority.withClient(client=>authority.readback(client,requestId));
  if(!a)throw Error('FACTORY_REQUEST_NOT_FOUND');
  if(!rb?.authorityReceipt||!rb.authorityReceiptSignature)throw Error('EXTERNAL_ALPHA_RECEIPT_UNAVAILABLE');
  return externalAlphaReadback({body,row,authority:a,receipt:{authorityReceipt:rb.authorityReceipt,authorityReceiptSignature:rb.authorityReceiptSignature},challenge,signReadback});
 };
 const readResult=async(requestId,challenge=null)=>{
  if(!await authority.withClient(client=>authority.ownedRow(client,requestId)))throw Error('FACTORY_REQUEST_NOT_FOUND');
  const out=await control.result(requestId),row=await store.read(clientId,requestId),readback=await readbackWithReceipt(requestId,challenge);
  return out.result?{...readback,result:assertExternalAlphaResult(row,out.result)}:{...readback,pending:true,state:'PENDING',workState:readback.readbackAttestation.state};
 };
 return {authority,store,spend,queue,control,provider:workProvider,verification:verificationStore,clientId,installation,readbackWithReceipt,readResult,topics:{work:'factory-external-alpha-work-v1',recovery:'factory-external-alpha-recovery-v1'}};
}

/** Production wiring for the HTTP entry. Requires every reviewed input; any gap is a denial. */
export async function withExternalAlphaRuntime(env,installation,action,{registryLoader=loadPrivateSourceRegistry,snapshotsLoader=loadPrivateSnapshots}={}){
 const verifierProfile=externalAlphaVerifierProfile(env,installation);
 const hostInstallation=externalAlphaHostInstallation(env,installation);
 const signing=externalAlphaSigning(env);
 const pem=env.FACTORY_EXTERNAL_ALPHA_RECEIPT_SIGNING_KEY;
 if(typeof pem!=='string'||pem.length<50||pem.length>4000)deny('AUTHORITY_DISABLED');
 let signReceipt,signReadback;try{signReceipt=receiptSigner(pem.replaceAll('\\n','\n'));signReadback=readbackSigner(pem.replaceAll('\\n','\n'));}catch{deny('AUTHORITY_DISABLED');}
 let registry,snapshots;try{registry=await registryLoader(env);snapshots=await snapshotsLoader(env,registry);}catch{deny('AUTHORITY_SOURCE');}
 const pool=new pg.Pool(databaseConfig(env.DATABASE_URL_UNPOOLED??env.DATABASE_URL));
 try{
  assertProductionDatabaseMarker((await pool.query('SELECT * FROM factory.environment WHERE singleton')).rows[0],hostInstallation);
  return await action(externalAlphaRuntimeComponents({env,pool,queue:new QueueClient({region:'iad1'}),installation,signing,sourceDigest:sourceIdentity.sourceDigest,signReceipt,signReadback,registry,snapshots,hostInstallation,verifierProfile}));
 }finally{await pool.end();}
}
