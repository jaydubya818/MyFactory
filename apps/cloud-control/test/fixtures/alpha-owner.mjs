import {digest} from '../../../../packages/hosted-routing/src/result.ts';
export function fixture(){
 const installation={version:1,environment:'production',factoryId:'myfactory-cloud-production',ownerScope:'personal-retained-owner',projectId:'prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK',callerProjectId:'prj_L6faw25wnFGUZtrLKBIccg8gIDLR',teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',custodyStoreId:'store_qBuivS8MmRxnBNnU',databaseResourceId:'dry-morning-22844424'};
 const roster={version:1,kind:'THREE_SYNTHETIC_OWNER_CLOUD_V1',environment:'production',factoryProjectId:installation.projectId,owners:['A','B','C'].map(slot=>({slot,ownerScope:'disposable-owner-'+slot,sourceProjectId:'prj_disposable'+slot,clientId:'sofie-alpha-'+slot.toLowerCase()}))};
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,VERCEL_DEPLOYMENT_ID:'dpl_disposable',FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation),FACTORY_PRODUCTION_APPLICATION_TOKEN:'a'.repeat(64),FACTORY_PROOF_TOKEN:'b'.repeat(64),FACTORY_ALPHA_OWNER_ROSTER:JSON.stringify(roster),FACTORY_ALPHA_OWNER_ROSTER_SHA256:digest(roster)};
 for(const [i,slot]of ['A','B','C'].entries()){env[`FACTORY_ALPHA_${slot}_APPLICATION_TOKEN`]=String(i+1).repeat(64);env[`FACTORY_ALPHA_${slot}_PROOF_TOKEN`]=String(i+4).repeat(64);env[`FACTORY_ALPHA_${slot}_PROOF_EXPIRES_AT`]=new Date(Date.now()+3600000).toISOString();}
 return {env,roster,installation};
}
