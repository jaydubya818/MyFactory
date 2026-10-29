// Actual dispatch caller with detached tiny row data and inert counted effects.
// Synthetic observation is not native absence/guard or financial authority.
import test from 'node:test';import assert from 'node:assert/strict';
import {realpathSync}from'node:fs';import{tmpdir}from'node:os';
const fixtureRepository=realpathSync(tmpdir());
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
function fixture({transactionDrift=false}={}){
 const work={id:'public-work',repositoryPath:fixtureRepository,state:'failed'};
 const run={id:'public-run',workOrderId:work.id,attemptNumber:1,inputCommit:'a'.repeat(40),workspacePath:'/unused',state:'failed',finishedAt:'2026-10-28T00:00:00Z'};
 const identity={workId:'public-canonical-work',workGeneration:1,requestId:'public-request',workOrderId:work.id,factoryVersion:'b'.repeat(64),remoteRunId:run.id};
 const events=[];const row=(type,payload={})=>events.push({id:events.length+1,runId:run.id,workOrderId:work.id,type,payload});
 row('factory.prepare_requested',{workId:identity.workId});row('run.prepared');row('factory.writer_bound',identity);row('factory.dispatch_claimed',{supervisorPid:process.pid});
 let release,entered,fences=0,writes=0,terminal=0,revoked=false;const paused=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const storage={getIntake:()=>({work_order_id:work.id}),getWorkOrder:()=>structuredClone(work),getRun:()=>structuredClone(run),listEvents:()=>structuredClone(events),transaction:fn=>{if(transactionDrift)row('agent.completion_process_started',{pid:12345});return fn()},saveRun(){writes++},saveWorkOrder(){writes++},appendEvent(event){terminal++;row(event.type,event.payload)}};
 const execution={async reconcile(){entered();await paused;return {active:false,quiescent:true,settled:true,recoveryEligible:false,evidence:{synthetic:'no-native-proof'}}}};
 const producer={snapshot:()=>({version:1,factoryVersion:identity.factoryVersion})};
 const spend={fenceAuthority(){fences++;return true},read:()=>({status:'UNKNOWN'})};
 const client={id:'public-client',actions:['factory.observe'],repositoryPaths:[fixtureRepository],tokenSha256:'c'.repeat(64)};
 const control=new FactoryDispatchControl(storage,execution,producer,spend,true,undefined,false,value=>{if(revoked)throw Error('Current connection denied');return value});
 return {read:()=>control.read(client,identity.requestId),started,release:()=>release(),row,run,work,revoke:()=>revoked=true,get fences(){return fences},get writes(){return writes},get terminal(){return terminal}};
}
test('stable actual dispatch source retains existing terminal path',async()=>{const f=fixture(),p=f.read();await f.started;f.release();const r=await p;assert.equal(r.quiescent,true);assert.equal(r.state,'FAILED');assert.equal(f.terminal,1);assert.equal(f.fences,2)});
for(const change of ['process','settlement','Run','Work'])test('actual dispatch read refuses stale '+change+' after reconcile await',async()=>{
 const f=fixture(),p=f.read();await f.started;
 if(change==='process')f.row('agent.completion_process_started',{pid:12345});else if(change==='settlement')f.row('factory.execution_settled');else if(change==='Run')f.run.state='cancelled';else f.work.state='interrupted';
 f.release();const r=await p;assert.equal(r.quiescent,false);assert.equal(f.fences,0);assert.equal(f.terminal,0);assert.equal(f.writes,0);
});
test('actual dispatch terminal transaction drift retains prior fence without terminal mutation',async()=>{const f=fixture({transactionDrift:true}),p=f.read();await f.started;f.release();const r=await p;assert.equal(r.quiescent,false);assert.equal(f.fences,1);assert.equal(f.terminal,0);assert.equal(f.writes,0)});
test('actual dispatch refresh still refuses revoked connection before effects',async()=>{const f=fixture(),p=f.read();await f.started;f.revoke();f.release();await assert.rejects(p,/Current connection denied/);assert.equal(f.fences,0);assert.equal(f.terminal,0)});
