// Shared support for the MyEve <-> MyFactory conformance tests. Synthetic data only.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseExternalAlphaInstallation} from '../../../src/external-alpha-authority.mjs';

export const vectorsUrl=new URL('./vectors.json',import.meta.url);
export const loadVectors=()=>JSON.parse(readFileSync(vectorsUrl,'utf8'));
export const sha=v=>createHash('sha256').update(v).digest('hex');
export const CREDENTIALS={'1':'conformance-fixture-bearer-credential-0001','2':'conformance-fixture-bearer-credential-0002'};
export const CREDENTIAL=CREDENTIALS['1'];
export const oidcFor=slot=>({issuer:'https://oidc.vercel.com/fixture-team',audience:'https://vercel.com/fixture-team',subject:`owner:fixture-team:project:fixture-tester-${slot==='1'?'one':'two'}:environment:production`,teamId:'team_ConformanceFixture'});
export const OIDC=oidcFor('1');

/** Factory-side installation built from the MyEve-generated policy view plus Factory-owned caller pins. */
export function installationConfig(v,over={},view=v.installation){
 const i=view;
 return {cohortId:i.cohortId,slot:i.slot,ownerId:i.ownerId,policySha256:i.policySha256,application:{...i.application},source:{...i.source,allowedFiles:[...i.source.allowedFiles]},
  factoryVersion:i.factoryVersion,checkCommands:[...i.checkCommands],caller:{credentialSha256:sha(CREDENTIALS[i.slot]),oidc:oidcFor(i.slot)},
  keys:[{keyId:v.testKey.keyId,publicKeyPem:v.testKey.publicKeyPem,notBefore:'2020-01-01T00:00:00.000Z',notAfter:'2100-01-01T00:00:00.000Z'}],...over};
}
export const installationOf=(v,over,view)=>parseExternalAlphaInstallation(installationConfig(v,over,view));
export const grantFor=installation=>({clientId:installation.application.clientId,source:{repository:installation.source.repository,commit:installation.source.baseSha,tree:installation.source.treeSha},
 commands:[...installation.checkCommands],allowedPaths:[...installation.source.allowedFiles],maxDurationMs:300000,maxSpendUsd:1,derivedRequestId:true});

const clone=x=>JSON.parse(JSON.stringify(x));
const getAt=(o,p)=>p.reduce((x,k)=>x[k],o);
/** Rebuilds a committed mutation. Document mutations keep the signature MyEve-format signing produced. */
export function applyMutation(v,m){
 const out={envelope:clone(v.envelope),prepare:clone(v.prepare)};
 const target=out[m.target==='document'?'envelope':m.target];
 const holder=m.target==='document'?target.document:target;
 if(m.op==='set'||m.op==='replace')getAt(holder,m.path.slice(0,-1))[m.path.at(-1)]=clone(m.value);
 else if(m.op==='delete'){const parent=getAt(holder,m.path.slice(0,-1));if(Array.isArray(parent))parent.splice(m.path.at(-1),1);else delete parent[m.path.at(-1)];}
 else if(m.op==='unknown')getAt(holder,m.path)['unexpected']=1;
 else throw Error('unknown op');
 if(m.target==='document'){out.envelope.authoritySha256=m.authoritySha256;out.envelope.signature=m.signature;}
 return out;
}
/** Fresh vectors at the current clock from a MyEve checkout (opt-in: MYEVE_CHECKOUT). */
export function regenerateLive(checkout){
 const dir=mkdtempSync(join(tmpdir(),'myeve-live-vectors-')),out=join(dir,'vectors.json');
 const r=spawnSync(process.execPath,['--experimental-transform-types','--disable-warning=ExperimentalWarning',new URL('../../../scripts/generate-myeve-conformance-vectors.mjs',import.meta.url).pathname,'--myeve',checkout,'--out',out,'--live'],{encoding:'utf8',timeout:120000});
 if(r.status!==0)throw Error('LIVE_VECTOR_GENERATION_FAILED:'+(r.stderr??'').slice(0,300));
 return JSON.parse(readFileSync(out,'utf8'));
}
