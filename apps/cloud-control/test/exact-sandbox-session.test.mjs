import test from 'node:test';
import assert from 'node:assert/strict';
import {exactSandboxSession} from '../src/exact-sandbox-session.mjs';
import {Sandbox} from '@vercel/sandbox';

test('installed SDK default-user resolution stays on the admitted Session',async()=>{
 let currentId='sbx_fixture_admitted',calls=0;
 const session={sessionId:currentId,runCommand:async()=>{calls++;return {exitCode:0,stdout:async()=> 'sandbox\nsandbox\n'};},writeFiles(){},readFile(){},update(){}};
 const wrapper={currentSession:()=>({...session,sessionId:currentId}),getDefaultUser:Sandbox.prototype.getDefaultUser,resolveDefaultUser:Sandbox.prototype.resolveDefaultUser,runCommand:()=>{throw Error('SDK_AUTO_RESUME_WRAPPER_REACHED');}};
 const bound=exactSandboxSession(wrapper);
 assert.deepEqual(await bound.getDefaultUser(),{username:'sandbox',group:'sandbox'});assert.equal(calls,1);
 wrapper.defaultUserPromise=undefined;currentId='sbx_fixture_replacement';
 await assert.rejects(bound.getDefaultUser(),/SANDBOX_SESSION_FENCED/);assert.equal(calls,1);
});

function fixture(){
 const calls=[],session={sessionId:'sbx_fixture_admitted'};let current=session;
 for(const name of ['runCommand','writeFiles','readFile','readFileToBuffer','getCommand','mkDir','update'])session[name]=function(...args){assert.equal(this,session);calls.push({name,args});return name;};
 const wrapper={currentSession:()=>current,image:'fixture-image',
  asUser(user){return {runCommand:options=>this.runCommand({...options,user}),writeFiles:files=>this.writeFiles(files,user)};},
  createUser(user){return this.runCommand({cmd:'fixture-create-user',user});},
  getDefaultUser(){return this.asUser('fixture-default');}};
 for(const name of ['runCommand','writeFiles','readFile','readFileToBuffer','getCommand','mkDir','updateNetworkPolicy','resume','extendTimeout','openInteractive','snapshot'])wrapper[name]=()=>{throw Error('SDK_AUTO_RESUME_WRAPPER_REACHED');};
 return {calls,session,wrapper,replace:()=>{current={...session,sessionId:'sbx_fixture_replacement'};}};
}

test('worker operations use admitted Session methods and never convenience auto-resume',()=>{
 const f=fixture(),bound=exactSandboxSession(f.wrapper);
 for(const name of ['runCommand','writeFiles','readFile','readFileToBuffer','getCommand','mkDir'])assert.equal(bound[name]('fixture-argument'),name);
 assert.equal(bound.updateNetworkPolicy('deny-all',{signal:'fixture-signal'}),'update');
 assert.deepEqual(f.calls.at(-1),{name:'update',args:[{networkPolicy:'deny-all'},{signal:'fixture-signal'}]});
 assert.equal(bound.image,'fixture-image');
 bound.asUser('fixture-user').runCommand({cmd:'node'});bound.asUser('fixture-user').writeFiles([]);bound.createUser('fixture-user');bound.getDefaultUser().runCommand({cmd:'node'});
 assert.equal(f.calls.length,11);assert.equal(f.calls.at(-1).args[0].user,'fixture-default');
});

test('replacement Session fences all command, file and policy helpers before dispatch',()=>{
 const f=fixture(),bound=exactSandboxSession(f.wrapper),user=bound.asUser('fixture-user');f.replace();
 for(const name of ['runCommand','writeFiles','readFile','readFileToBuffer','getCommand','mkDir','updateNetworkPolicy'])assert.throws(()=>bound[name]('fixture-argument'),/SANDBOX_SESSION_FENCED/);
 assert.throws(()=>user.runCommand({cmd:'node'}),/SANDBOX_SESSION_FENCED/);assert.throws(()=>user.writeFiles([]),/SANDBOX_SESSION_FENCED/);assert.throws(()=>bound.createUser('fixture-user'),/SANDBOX_SESSION_FENCED/);
 assert.equal(f.calls.length,0);
});

test('authority extension APIs are denied and mandatory Session operations are required',()=>{
 const f=fixture(),bound=exactSandboxSession(f.wrapper);
 for(const name of ['resume','extendTimeout','openInteractive','snapshot'])assert.throws(()=>bound[name](),/SANDBOX_AUTHORITY_EXTENSION_DENIED/);
 for(const name of ['runCommand','writeFiles','readFile','update'])assert.throws(()=>exactSandboxSession({...f.wrapper,currentSession:()=>({...f.session,[name]:undefined})}),/SANDBOX_SESSION_API_REQUIRED/);
 for(const sessionId of [undefined,'','unknown-session',17])assert.throws(()=>exactSandboxSession({...f.wrapper,currentSession:()=>({...f.session,sessionId})}),/SANDBOX_SESSION_API_REQUIRED/);
 assert.equal(f.calls.length,0);
});
