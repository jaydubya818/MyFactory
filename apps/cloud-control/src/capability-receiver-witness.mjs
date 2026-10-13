import pg from 'pg';
import {canonical} from '../../../packages/hosted-routing/src/result.ts';

const match=(a,b)=>canonical(a)===canonical(b);
/** Original protected resource records, not URL hostname guesses, bind distinct databases. */
export class FactoryReceiverWitness {
  constructor({databaseUrl,epoch,enrollmentId,qualificationDigest,installationDigest,resources}){
    if(!resources||resources.directEndpointVerified!==true||!resources.factoryMarker||!resources.witnessMarker
      ||!resources.myeveResourceId||new Set([resources.factoryResourceId,resources.witnessResourceId,resources.myeveResourceId]).size!==3
      ||!resources.factoryResourceId||!resources.witnessResourceId||!epoch||!enrollmentId
      ||![qualificationDigest,installationDigest].every(x=>/^[a-f0-9]{64}$/.test(x)))throw Error('FACTORY_WITNESS_PROVENANCE');
    const url=new URL(databaseUrl);
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.searchParams.get('sslmode')!=='verify-full'
      ||[...url.searchParams.keys()].some(k=>k!=='sslmode')||!url.username||url.hash)throw Error('FACTORY_WITNESS_PROVENANCE');
    this.config={epoch,enrollmentId,qualificationDigest,installationDigest};this.resources=Object.freeze({...resources});
    // C3: server bounds precede the wrapper. Never reuse a client after ambiguity.
    this.pool=new pg.Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:500,statement_timeout:1000,
      idle_in_transaction_session_timeout:1000,query_timeout:1200});this.pool.on('error',()=>{});this.uncertainSessions=[];
  }
  parameters(head){const c=this.config;return [c.enrollmentId,head.organizationId,head.installationId,head.ownerId,c.epoch,c.qualificationDigest,c.installationDigest];}
  head(value){return {...value,epoch:this.config.epoch};}
  async operation(action,phaseDeadline=performance.now()+2000){
    if(performance.now()>=phaseDeadline)throw Error('FACTORY_WITNESS_AMBIGUOUS');
    let client,expired=false,timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;client?.release(true);client=undefined;reject(Error('FACTORY_WITNESS_AMBIGUOUS'));},Math.max(0,Math.min(2000,phaseDeadline-performance.now())));});
    // A timed-out session is never returned to the pool. Its server-side CAS
    // transaction terminates before another session is permitted to supersede it.
    try{return await Promise.race([(async()=>{const acquired=await this.pool.connect();if(expired){acquired.release(true);throw Error('FACTORY_WITNESS_AMBIGUOUS');}client=acquired;return action(client);})(),deadline]);}
    finally{clearTimeout(timer);client?.release(true);}
  }
  async assertPriorTermination(client){
    // Establish visibility of this restricted role's own session before treating
    // an empty activity query as proof that an earlier CAS has terminated.
    const own=await client.query("SELECT pid,backend_start::text AS started,usename,datname,state,pg_backend_pid() AS backend_pid,current_user AS role,current_database() AS database,current_setting('statement_timeout') AS statement_timeout,current_setting('idle_in_transaction_session_timeout') AS idle_timeout FROM pg_stat_activity WHERE pid=pg_backend_pid()");
    const session=own.rows?.[0];
    if(own.rowCount!==1||own.rows?.length!==1||!session||!Number.isSafeInteger(session.pid)||session.pid<=0
      ||session.pid!==client.processID||session.pid!==session.backend_pid||typeof session.started!=='string'||!Number.isFinite(Date.parse(session.started))
      ||!session.role||session.usename!==session.role||!session.database||session.datname!==session.database||session.state!=='active'
      ||session.statement_timeout!=='1s'||session.idle_timeout!=='1s')throw Error('FACTORY_WITNESS_SESSION_UNAVAILABLE');
    const pending=async(sql,parameters)=>{
      const result=await client.query(sql,parameters);
      if(!Number.isSafeInteger(result.rowCount)||result.rowCount<0||result.rowCount!==result.rows?.length)throw Error('FACTORY_WITNESS_SESSION_UNAVAILABLE');
      if(result.rowCount)throw Error('FACTORY_WITNESS_CAS_PENDING');
    };
    // Restart-safe: the original restricted witness role cannot have another
    // active/transactional backend whose earlier CAS may still commit.
    await pending("SELECT 1 FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid() AND state IS DISTINCT FROM 'idle'");
    for(const original of this.uncertainSessions)await pending('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND usename=current_user',[original.pid,original.started]);
    this.uncertainSessions=[];
    return {pid:session.pid,started:session.started};
  }
  async read(expected,deadline){
    return this.operation(async client=>{
      await this.assertPriorTermination(client);
      const row=(await client.query('SELECT capability_witness.read_head($1,$2,$3,$4,$5,$6,$7) AS head',this.parameters(expected))).rows[0];
      if(!row?.head)throw Error('FACTORY_WITNESS_UNAVAILABLE');return row.head;
    },deadline);
  }
  async assert(expected,deadline){if(!match(await this.read(expected,deadline),this.head(expected)))throw Error('FACTORY_RECEIVER_RESTORED');}
  async advance(previous,next,deadline){
    let session;
    try{return await this.operation(async client=>{
      session=await this.assertPriorTermination(client);
      await client.query('BEGIN');await client.query('SET LOCAL synchronous_commit=on');
      const row=(await client.query('SELECT capability_witness.advance_head($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS head',
        [...this.parameters(previous),previous.revision,previous.digest,next.revision,next.digest])).rows[0];
      await client.query('COMMIT');
      if(!match(row?.head,this.head(next)))throw Error('FACTORY_WITNESS_AMBIGUOUS');return row.head;
    },deadline);}catch(error){
      if(session){
        if(this.uncertainSessions.length>=4)throw Error('FACTORY_WITNESS_CAS_PENDING');
        this.uncertainSessions.push(session);
      }
      throw error;
    }
  }
  async close(){await this.pool.end();}
}
