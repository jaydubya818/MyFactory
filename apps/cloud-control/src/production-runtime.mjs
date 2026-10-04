import pg from 'pg';
import {QueueClient} from '@vercel/queue';
import {createPublicKey} from 'node:crypto';
import {databaseConfig} from './config.mjs';
import {productionInstallation,productionCredentials,assertProductionAdmissionDisabled} from './production-installation.mjs';
import {assertProductionDatabaseMarker} from './production-database.mjs';
import {productionRuntimeComponents} from './production-runtime-components.mjs';
import sourceIdentity from './source-identity.json' with {type:'json'};

export function productionSigning(env){
 const config=JSON.parse(env.FACTORY_PRODUCTION_RESULT_SIGNING_JSON??'null');
 if(!config||Object.keys(config).sort().join(',')!=='factoryId,key,privateKey'||config.factoryId!=='myfactory-cloud-production'||config.key?.factoryId!==config.factoryId||config.key.keyId!=='production-cloud-v1')throw Error('PRODUCTION_SIGNER_REQUIRED');
 const actual=createPublicKey(config.privateKey),expected=createPublicKey(config.key.publicKey);
 if(actual.asymmetricKeyType!=='ed25519'||!actual.export({type:'spki',format:'der'}).equals(expected.export({type:'spki',format:'der'}))||config.key.revokedAt||config.key.retiredAt||!Number.isFinite(Date.parse(config.key.activeFrom))||!Number.isFinite(Date.parse(config.key.notAfter))||Date.now()<Date.parse(config.key.activeFrom)||Date.now()>=Date.parse(config.key.notAfter))throw Error('PRODUCTION_SIGNER_INVALID');
 return config;
}
export async function withProductionRuntime(env,action,{validation=false,cleanupOnly=false}={}){
 const installation=productionInstallation(env);productionCredentials(env,installation);assertProductionAdmissionDisabled(env);
 // Paid entrypoints remain closed pending the separately approved canary.
 if(!validation&&!cleanupOnly&&!/^[a-f0-9]{64}$/.test(env.FACTORY_PRODUCTION_CANARY_AUTHORIZATION_SHA256??''))throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
 const signing=productionSigning(env),pool=new pg.Pool(databaseConfig(env.DATABASE_URL_UNPOOLED??env.DATABASE_URL));
 try{
  assertProductionDatabaseMarker((await pool.query('SELECT * FROM factory.environment WHERE singleton')).rows[0],installation);
  return await action(productionRuntimeComponents({env,pool,queue:new QueueClient({region:'iad1'}),signing,sourceDigest:sourceIdentity.sourceDigest,validation,cleanupOnly}));
 }finally{await pool.end();}
}
