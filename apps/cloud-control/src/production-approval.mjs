import {successorIntakePolicy} from './production-successor-intake.mjs';
import {alphaClientIds} from './alpha-owner-roster.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
/** Approval is immutable pre-activation material. The concrete grant binds the
 * later request UUID/deadline; neither digest depends on itself. */
export function assertConcreteProductionGrant(manifest,approvedDigest,now=Date.now()) {
 const envelope=manifest?.authorizationEnvelope,a=envelope?.approval,t=a?.manifestTemplate;
 if(!/^[a-f0-9]{64}$/.test(approvedDigest??'')||manifest?.version!==2||
  manifest.authorizationEnvelopeSha256!==approvedDigest||digest(envelope)!==approvedDigest||
  Object.keys(envelope??{}).sort().join(',')!=='approval,expiresAt,version'||envelope.version!==1||
  !Number.isFinite(Date.parse(envelope.expiresAt))||Date.parse(envelope.expiresAt)<=now||
  !Number.isSafeInteger(a?.workVersion)||a.workVersion<1||!t||t.version!==1||
  !(t.clientId==='sofie-production'||alphaClientIds.includes(t.clientId))||t.request?.requestId!==null||t.request?.deadline!==null||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(manifest.request?.requestId??'')||
  !Number.isFinite(Date.parse(manifest.request?.deadline))||Date.parse(manifest.request.deadline)<=now||
  Date.parse(manifest.request.deadline)>Date.parse(envelope.expiresAt)||Date.parse(manifest.request.deadline)>now+180000)
   throw Error('PRODUCTION_APPROVAL_BINDING');
 const {authorizationEnvelope,authorizationEnvelopeSha256,...concrete}=manifest;
 const projected={...concrete,version:1,request:{...concrete.request,requestId:null,deadline:null}};
 if(digest(projected)!==digest(t))throw Error('PRODUCTION_APPROVAL_BINDING');
 successorIntakePolicy(a);
 return a;
}
