// Synthetic fixtures only: generated keys, opaque ids, no real owner, repository or grant.
import {generateKeyPairSync,sign,createHash,randomBytes} from 'node:crypto';
import {digest} from '../../../../packages/hosted-routing/src/result.ts';
import {acceptanceCriteria,criteriaSha256,tupleSha256,deriveIdentifiers,keyIdOf,projectTask,AUTHORITY_SCHEMA,factoryPins,parseExternalAlphaInstallation} from '../../src/external-alpha-authority.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const hex=n=>randomBytes(n/2).toString('hex');
export const uuid4=()=>{const h=hex(32);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export const sorted=[...['src/app.js','test/app.test.js']];

export function makeKeys(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 return {publicKey,privateKey,keyId:keyIdOf(publicKey),publicKeyPem:publicKey.export({type:'spki',format:'pem'})};
}
export function makeInstallation(keys=makeKeys(),over={}){
 const config={cohortId:uuid4(),slot:'1',ownerId:'owner-opaque-1',policySha256:hex(64),
  application:{clientId:'external-alpha-'+hex(32),projectId:'prj_fixture1'},
  source:{repository:'fixture-org/fixture-workspace',baseSha:hex(40),treeSha:hex(40),sourceDigest:hex(64),allowedFiles:[...sorted]},
  factoryVersion:hex(64),checkCommands:['npm test'],
  caller:{credentialSha256:sha('fixture-credential-'+hex(16)),oidc:{issuer:'https://oidc.vercel.com/fixture-team',audience:'https://vercel.com/fixture-team',subject:'owner:fixture-team:project:fixture-tester-'+hex(8)+':environment:production',teamId:'team_Fixture1'}},
  keys:[{keyId:keys.keyId,publicKeyPem:keys.publicKeyPem,notBefore:'2020-01-01T00:00:00.000Z',notAfter:'2100-01-01T00:00:00.000Z'}],...over};
 return {config,installation:parseExternalAlphaInstallation(config),keys};
}
export const signDocument=(document,keys,keyId=keys.keyId)=>{
 const authoritySha256=digest(document);
 return {document,authoritySha256,keyId,signature:sign(null,Buffer.concat([Buffer.from(AUTHORITY_SCHEMA),Buffer.from([0]),Buffer.from(authoritySha256)]),keys.privateKey).toString('base64url')};
};
/** Builds a valid envelope and the exact prepare body for it. `work`/`policySha256` feed id derivation. */
export function build(ctx,{workId=uuid4(),version=1,generation=1,issuedAt=Date.now(),ttl=290000,deadlineMs=170000,policySha256=ctx.config.policySha256,checkCommands=ctx.config.checkCommands,title='Add a Priority field',description='Add a Priority field to Alpha Tasks',post}={}){
 const c=ctx.config,work={id:workId,version,generation,title,objectiveSha256:sha(description),criteriaSha256,criteriaCount:10};
 const ids=deriveIdentifiers({policySha256,work,tupleSha256});
 const iso=ms=>new Date(ms).toISOString();
 const document={schema:AUTHORITY_SCHEMA,authorityId:ids.authorityId,idempotencyKey:ids.idempotencyKey,singleUse:true,cohortId:c.cohortId,slot:c.slot,ownerId:c.ownerId,policySha256,
  application:{...c.application},source:{repository:c.source.repository,baseSha:c.source.baseSha,treeSha:c.source.treeSha,sourceDigest:c.source.sourceDigest,allowedFiles:[...c.source.allowedFiles],allowedFilesSha256:digest({version:1,files:c.source.allowedFiles})},
  work,project:{name:'Alpha Tasks',task:projectTask,criteriaSha256,tupleSha256},environment:factoryPins.environment,executionProvider:factoryPins.executionProvider,
  harness:{...factoryPins.harness},factoryVersion:c.factoryVersion,model:{...factoryPins.model},limits:structuredClone(factoryPins.limits),
  candidateWriter:{candidateSlot:1,writerId:ids.writerId,requestId:ids.requestId},
  verifier:{id:factoryPins.verifierId,verifiesExactArtifact:true,trustProducer:false,criteriaSha256},
  allowedEffects:[...factoryPins.allowedEffects],forbiddenEffects:[...factoryPins.forbiddenEffects],
  issuedAt:iso(issuedAt),notBefore:iso(issuedAt),expiresAt:iso(issuedAt+ttl)};
 const prepare={protocol:'MYFACTORY_EXECUTION_V2',requestId:ids.requestId,workId,workGeneration:generation,repository:c.source.repository,deadline:iso(issuedAt+deadlineMs),maxSpendUsd:1,
  source:{repository:c.source.repository,commit:c.source.baseSha,tree:c.source.treeSha},
  input:{title,description,kind:'feature',acceptanceCriteria:[...acceptanceCriteria],checkCommands,allowedPaths:[...c.source.allowedFiles]}};
 post?.(document,prepare);
 return {envelope:signDocument(document,ctx.keys),prepare,document,ids,issuedAt};
}
