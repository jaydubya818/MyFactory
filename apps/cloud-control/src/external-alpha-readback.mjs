import {createPrivateKey, sign} from 'node:crypto';
import {canonical, digest} from '../../../packages/hosted-routing/src/result.ts';

export const READBACK_SCHEMA='MYFACTORY_EXTERNAL_ALPHA_READBACK_V1';
export function readbackSigner(pem){
 const key=createPrivateKey(pem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('READBACK_KEY_INVALID');
 return value=>sign(null,Buffer.concat([Buffer.from(READBACK_SCHEMA),Buffer.from([0]),Buffer.from(digest(value))]),key).toString('base64url');
}

/** Only host-retained verification and exact custody can establish a verdict. */
export function externalAlphaVerdict(row,state){
 if(!['COMPLETED','FAILED','CANCELLED','NOT_DISPATCHED'].includes(state))return 'PENDING';
 if(!row.custody)return 'NONE';
 const v=row.verification;
 if(!v?.cleanup_confirmed||v.run_id!==row.run_id||v.candidate_commit!==row.custody.candidate_commit||v.candidate_tree!==row.custody.candidate_tree||v.custody_sha256!==row.custody.artifact_sha256||v.policy_sha256!==row.snapshot.configuration.cloud?.verificationPolicySha256)return 'PARTIAL';
 return v.outcome==='PASS'&&state==='COMPLETED'?'PASS':v.outcome==='FAIL'?'FAIL':'PARTIAL';
}

export function externalAlphaReadback({body,row,receipt,authority,challenge=null,signReadback,now=Date.now()}){
 if(challenge!==null&&!/^[a-f0-9]{16,64}$/.test(challenge))throw Error('INVALID_READBACK_CHALLENGE');
 if(typeof signReadback!=='function'||!receipt?.authorityReceiptSignature||!body.spend)throw Error('EXTERNAL_ALPHA_READBACK_UNAVAILABLE');
 const a=receipt.authorityReceipt;
 if(a.requestId!==row.request_id||a.workOrderId!==row.work_order_id||a.authorityId!==authority.authority_id||a.authoritySha256!==authority.authority_sha256||row.snapshot.requestDigest!==digest(row.request)||row.snapshot.factoryVersion!==authority.document.factoryVersion||row.work_id!==authority.work_id||row.work_generation!==authority.work_generation)throw Error('EXTERNAL_ALPHA_READBACK_BINDING');
 const blocker=body.blocker??null;
 if(blocker!==null&&!/^[A-Z_]{3,80}$/.test(blocker))throw Error('EXTERNAL_ALPHA_READBACK_BINDING');
 const attestation={schema:READBACK_SCHEMA,requestId:row.request_id,workOrderId:row.work_order_id,runId:row.run_id,attemptNumber:row.snapshot.attemptNumber,
  requestDigest:digest(row.request),admittedDeadline:row.request.deadline,authorityId:a.authorityId,authoritySha256:a.authoritySha256,receiptDigest:digest(a),
  state:body.state,quiescent:body.quiescent,evidenceRef:body.evidenceRef,blocker,spend:body.spend,spendDigest:digest(body.spend),
  verdict:externalAlphaVerdict(row,body.state),challenge,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};
 // Compatibility fields remain; snapshot/identity stay server-side. Closure consumers use only the attestation.
 const {snapshot,identity,runId,...compatibility}=body;
 return {...compatibility,...receipt,readbackAttestation:attestation,readbackSignature:signReadback(attestation)};
}

export function assertExternalAlphaResult(row,result){
 const m=JSON.parse(Buffer.from(result.encoded,'base64url').toString('utf8'));
 if(canonical(m.execution)!==canonical(row.snapshot)||m.producer!=='myfactory-external-alpha'||m.keyId!=='external-alpha-result-v1'||
  (m.candidate?.commit??null)!==(row.custody?.candidate_commit??null)||(m.candidate?.tree??null)!==(row.custody?.candidate_tree??null))throw Error('EXTERNAL_ALPHA_RESULT_BINDING');
 if(m.status==='COMPLETED'&&externalAlphaVerdict(row,m.status)!=='PASS')throw Error('EXTERNAL_ALPHA_RESULT_UNVERIFIED');
 return result;
}
