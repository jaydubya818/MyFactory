import pg from 'pg';
import {QueueClient} from '@vercel/queue';
import {assertStagingEnvironment,databaseConfig,stagingProjectId} from './config.mjs';
import {PostgresDispatchStore} from './postgres-dispatch.mjs';
import {PostgresSpendLedger} from './postgres-spend.mjs';
import {cloudWorkProvider} from './cloud-work-provider.mjs';
import {resultSigning} from './cloud-work-result.mjs';
import {CloudWorkControl} from './cloud-work-control.mjs';
import {PostgresVerificationStore} from './postgres-verification.mjs';
import {cloudVerifierProvider} from './cloud-verifier-provider.mjs';
import {verifyCloudCandidate,reconcileCloudVerification} from './cloud-verification.mjs';
import sourceIdentity from './source-identity.json' with {type:'json'};

export async function withCloudRuntime(env,action){
 assertStagingEnvironment(env);
 if(!/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID??''))throw Error('DEPLOYMENT_ID_REQUIRED');
 const signing=resultSigning(env),pool=new pg.Pool(databaseConfig(env.DATABASE_URL_UNPOOLED??env.DATABASE_URL));
 try{
  const marker=(await pool.query('SELECT project_id,environment FROM factory.environment WHERE singleton')).rows[0];
  if(marker?.project_id!==stagingProjectId||marker.environment!=='staging')throw Error('DATABASE_BOUNDARY_MISMATCH');
  const store=new PostgresDispatchStore(pool),spend=new PostgresSpendLedger(pool),provider=cloudWorkProvider({ledger:spend}),queue=new QueueClient({region:'iad1'});
  const verification=new PostgresVerificationStore(store),verifier=cloudVerifierProvider();
  const verifierContext=row=>({clientId:row.client_id,requestId:row.request_id,store:verification,provider:verifier,readCustody:()=>provider.readCustody(row)});
  provider.verifyCandidate=row=>verifyCloudCandidate(verifierContext(row));
  provider.reconcileVerification=row=>reconcileCloudVerification(verifierContext(row));
  const control=new CloudWorkControl({store,spend,provider,queue,signing,sourceDigest:sourceIdentity.sourceDigest,deploymentId:env.VERCEL_DEPLOYMENT_ID});
  return await action({store,spend,provider,queue,control});
 }finally{await pool.end();}
}
