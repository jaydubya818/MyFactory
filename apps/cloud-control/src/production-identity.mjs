import {getVercelOidcToken} from '@vercel/oidc';
/** Provider verifies signature/trust. These checks bind outbound credentials to
 * this exact reviewed installation before any storage/provider probe. */
export async function productionWorkloadIdentity(installation,readToken=getVercelOidcToken){
 try{
  const token=await readToken();
  if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)throw Error();
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(claims.project_id!==installation.projectId||claims.owner_id!==installation.teamId||claims.environment!=='production'||!Number.isSafeInteger(claims.exp)||claims.exp<=Math.floor(Date.now()/1000))throw Error();
  return token;
 }catch{throw Error('PRODUCTION_WORKLOAD_IDENTITY_REQUIRED');}
}
