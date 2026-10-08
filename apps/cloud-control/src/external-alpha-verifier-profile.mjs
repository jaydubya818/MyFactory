import {createHash} from 'node:crypto';
const fail=()=>{throw Error('VERIFIER_PROFILE_REQUIRED');};
/** This approval is host configuration, independent of producer bytes and of caller-supplied profile tables. */
export function externalAlphaVerifierProfile(env,installation){
 const text=env.FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_JSON,pin=env.FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_SHA256;
 if(typeof text!=='string'||text.length>8192||!/^[a-f0-9]{64}$/.test(pin??'')||createHash('sha256').update(text).digest('hex')!==pin)fail();
 let config;try{config=JSON.parse(text);}catch{fail();}
 if(Object.keys(config??{}).sort().join(',')!=='entries,kind,version'||config.version!==1||config.kind!=='EXTERNAL_ALPHA_VERIFIER_PROFILES_V1'||!Array.isArray(config.entries)||!config.entries.length||config.entries.length>2)fail();
 const seen=new Set();
 for(const p of config.entries){
  if(Object.keys(p??{}).sort().join(',')!=='id,kind,tree'||p.id!=='alpha-tasks-node-json-v1'||p.kind!=='PRODUCT'||!/^[a-f0-9]{40}$/.test(p.tree??'')||seen.has(p.tree))fail();
  seen.add(p.tree);
 }
 const profile=config.entries.find(p=>p.tree===installation.source.treeSha);if(!profile)fail();
 return Object.freeze({...profile});
}
