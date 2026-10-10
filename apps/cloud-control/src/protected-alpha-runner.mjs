import {randomUUID} from 'node:crypto';

const fail=()=>{throw Error('VERIFIER_ISOLATION_UNPROVEN');};
const relative=p=>typeof p==='string'&&p.length>0&&p.length<200&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x.toLowerCase()!=='.git');
/** Public protocol implementation, with no scenarios, expectations, labels or hidden probe code. */
export const alphaOperationDriver=`
import fs from 'node:fs';import {createInterface} from 'node:readline';import {pathToFileURL} from 'node:url';
const root=process.cwd(),file=process.env.TMPDIR+'/tasks.json',stores={};
const tasks=await import(pathToFileURL(root+'/src/tasks.js').href),render=await import(pathToFileURL(root+'/src/render.js').href);
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 let out;try{const op=JSON.parse(line);let value;
 switch(op.do){
 case 'legacy':fs.writeFileSync(file,JSON.stringify(op.data));value=null;break;
 case 'open':stores[op.store]=tasks.createStore(file);value=null;break;
 case 'create':value=stores[op.store].create(op.input);break;
 case 'update':value=stores[op.store].update(op.id,op.patch);break;
 case 'list':value=stores[op.store].list();break;
 case 'raw':value=fs.readFileSync(file,'utf8');break;
 case 'html':value=render[op.fn](op.tasks);break;
 case 'form':value=render.renderTaskForm(op.task);break;
 default:throw Error('OPERATION');}
 out={ok:true,value:value===undefined?null:JSON.parse(JSON.stringify(value))};
 }catch{out={ok:false};}
 process.stdout.write(JSON.stringify(out)+'\\n');
}
`;

/** Root controls bounds/protocol but NEVER imports candidate code. Request file is root-only, removed before exit. */
export const protectedLauncher=`
const fs=require('node:fs'),cp=require('node:child_process'),{StringDecoder}=require('node:string_decoder');
if(process.getuid()!==0)throw Error('VERIFIER_CONTROL_IDENTITY');
const path=process.argv[1],request=JSON.parse(fs.readFileSync(path,'utf8'));
const uid=Number(cp.execFileSync('id',['-u',request.user],{encoding:'utf8'}).trim()),gid=Number(cp.execFileSync('id',['-g',request.user],{encoding:'utf8'}).trim());
if(uid<1000||!Number.isInteger(uid)||!Number.isInteger(gid)||gid<1000)throw Error('VERIFIER_IDENTITY');
const flags=['--permission','--allow-fs-read='+request.dir,'--allow-fs-read='+request.scratch,'--allow-fs-write='+request.scratch];
const args=['--reuid='+uid,'--regid='+gid,'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','prlimit','--nproc=32','--nofile=64','--fsize=1048576','--core=0','node',...flags,...request.args];
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:request.scratch,TMPDIR:request.scratch,NODE_ENV:'test',CI:'1',LANG:'C',NO_COLOR:'1',UV_USE_IO_URING:'0'};
const child=cp.spawn('setpriv',args,{cwd:request.dir,env,stdio:['pipe','pipe','pipe'],detached:true});
let stdout='',stderr='',buffer='',timedOut=false,overflow=false,at=0,results=[],closed=false,totalBytes=0;
const outDecoder=new StringDecoder('utf8'),errDecoder=new StringDecoder('utf8');
const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
const timer=setTimeout(()=>{timedOut=true;kill();},request.timeoutMs);
const finish=(exitCode)=>{if(closed)return;closed=true;clearTimeout(timer);kill();fs.rmSync(path,{force:true});
 process.stdout.write(JSON.stringify(request.ops?{exitCode,timedOut,crashed:overflow||exitCode!==0||results.length!==request.ops.length,results}:{exitCode,timedOut,stdout,stderr}));};
const next=()=>{
 if(at>=request.ops.length){child.stdin.end();return;}
 const op=JSON.parse(JSON.stringify(request.ops[at]));
 if(op.id&&typeof op.id==='object'&&'$ref'in op.id){let value=results[op.id.$ref]?.value;for(const key of String(op.id.path??'').split('.').filter(Boolean))value=value?.[key];op.id=value;}
 if(op.do==='html'&&op.tasks===undefined&&op.tasksFrom!==undefined)op.tasks=results[op.tasksFrom]?.value;
 delete op.tasksFrom;child.stdin.write(JSON.stringify(op)+'\\n');
};
child.stdout.on('data',c=>{
 totalBytes+=c.length;if(totalBytes>262144){overflow=true;kill();return;}
 const decoded=outDecoder.write(c);
 if(request.ops){buffer+=decoded;if(buffer.length>262144){overflow=true;kill();return;}
 let end;while((end=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
 const r=JSON.parse(line);if(!r||typeof r.ok!=='boolean'||Object.keys(r).some(k=>!['ok','value'].includes(k))||at>=request.ops.length)throw Error();
 results.push(r);at++;next();}catch{overflow=true;kill();}}
 }else{stdout+=decoded;if(Buffer.byteLength(stdout)>262144){overflow=true;stdout='';kill();}}
});
child.stderr.on('data',c=>{totalBytes+=c.length;if(totalBytes>262144){overflow=true;kill();return;}stderr+=errDecoder.write(c);});
child.stdin.on('error',()=>{});child.on('error',()=>finish(null));child.on('close',code=>finish(code));
if(request.ops)next();else child.stdin.end();
`;

// No candidate or hidden input is present during this trusted inspection/setup.
export const protectedInspection=`
const fs=require('node:fs'),cp=require('node:child_process');
if(process.getuid()!==0)throw Error('VERIFIER_CONTROL_IDENTITY');
for(const cmd of ['setpriv','prlimit','mount','node'])cp.execFileSync('sh',['-c','command -v '+cmd],{stdio:'ignore'});
cp.execFileSync('mount',['-o','remount,hidepid=2','/proc'],{stdio:'ignore'});
const proc=fs.readFileSync('/proc/mounts','utf8').split('\\n').find(l=>l.split(' ')[1]==='/proc');
if(!proc||!/(?:^|,)hidepid=(?:2|invisible)(?:,|$)/.test(proc.split(' ')[3]))throw Error('VERIFIER_PROC_ISOLATION');
if(!/^v24\\./.test(process.version))throw Error('VERIFIER_NODE_VERSION');
fs.mkdirSync('/root/factory-verifier-control',{recursive:true,mode:0o700});fs.chmodSync('/root/factory-verifier-control',0o700);
const stat=fs.statSync('/root/factory-verifier-control');if(stat.uid!==0||(stat.mode&0o777)!==0o700)throw Error('VERIFIER_CONTROL_FILESYSTEM');
process.stdout.write(JSON.stringify({root:true,procHidden:true,node24:true,controlPrivate:true}));
`;

/** Real sandbox adapter. Attestation uses independently refreshed SDK metadata plus trusted live host inspection. */
export function protectedSandboxRunner(sandbox,{readSandbox,deadline,image}={}){
 let attested=false,count=0;
 const workspaces=new Map();
 const remaining=limit=>{const ms=Math.min(limit,deadline-Date.now());if(!Number.isSafeInteger(ms)||ms<1)throw Error('VERIFIER_DEADLINE');return ms;};
 const session=sandbox.currentSession(),sessionId=session.sessionId;
 const exact=()=>{if(sandbox.currentSession().sessionId!==sessionId)throw Error('VERIFIER_SESSION_FENCED');};
 const command=async(cmd,args,limit=10000)=>{
  exact();const ms=remaining(limit),r=await session.runCommand({cmd,args,sudo:true,timeoutMs:ms,signal:AbortSignal.timeout(ms+1000)});
  const text=await r.stdout({signal:AbortSignal.timeout(remaining(10000))});
  if(r.exitCode!==0||Buffer.byteLength(text)>524288)fail();return text;
 };
 const protectedWrite=async(path,content)=>{
  exact();const stage='/vercel/sandbox/factory-stage-'+randomUUID();
  await session.writeFiles([{path:stage,content,mode:0o600}],{signal:AbortSignal.timeout(remaining(10000))});
  await command('node',['-e',`const fs=require('node:fs');const from=${JSON.stringify(stage)},to=${JSON.stringify(path)};fs.renameSync(from,to);fs.chownSync(to,0,0);fs.chmodSync(to,0o600);const s=fs.statSync(to);if(s.uid!==0||(s.mode&0o777)!==0o600)throw Error('VERIFIER_CONTROL_FILESYSTEM');`]);
 };
 const prepare=async(user,files)=>{
  const home='/home/'+user,dir=home+'/tree',scratch=home+'/scratch';
  await command('useradd',['-m','-s','/bin/false',user]);
  const input='/root/factory-verifier-control/'+randomUUID()+'.json';
  await protectedWrite(input,JSON.stringify(files));
  const setup=`const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');const dir=${JSON.stringify(dir)},scratch=${JSON.stringify(scratch)},user=${JSON.stringify(user)},input=${JSON.stringify(input)};const uid=Number(cp.execFileSync('id',['-u',user],{encoding:'utf8'}).trim()),gid=Number(cp.execFileSync('id',['-g',user],{encoding:'utf8'}).trim());if(uid<1000||gid<1000)throw Error('VERIFIER_IDENTITY');fs.mkdirSync(dir,{mode:0o555});fs.mkdirSync(scratch,{mode:0o700});fs.chownSync(scratch,uid,gid);for(const [p,text] of Object.entries(JSON.parse(fs.readFileSync(input,'utf8')))){const target=path.join(dir,p);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o555});fs.writeFileSync(target,text,{flag:'wx',mode:0o444});}fs.rmSync(input);const verify=p=>{const s=fs.lstatSync(p);if(s.uid!==0||(s.mode&0o777)!==(s.isDirectory()?0o555:0o444)||(!s.isDirectory()&&!s.isFile()))throw Error('VERIFIER_FILE_KIND');if(s.isDirectory())for(const e of fs.readdirSync(p))verify(p+'/'+e);};verify(dir);const s=fs.statSync(scratch);if(s.uid!==uid||s.gid!==gid||(s.mode&0o777)!==0o700)throw Error('VERIFIER_SCRATCH_IDENTITY');process.stdout.write(JSON.stringify({uid,gid,readOnly:true,scratchPrivate:true}));`;
  const facts=JSON.parse(await command('node',['-e',setup]));
  if(!facts.readOnly||!facts.scratchPrivate||facts.uid<1000||facts.gid<1000)fail();
  workspaces.set(dir,user);return {dir,scratch,dispose:async()=>{workspaces.delete(dir);await command('rm',['-rf',home]);}};
 };
 const run=async(ws,args,options,ops)=>{
  const user=workspaces.get(ws.dir);if(!attested||!user)fail();
  let scratch=ws.scratch;
  if(ops){
   scratch=ws.scratch+'/probe-'+randomUUID();
   await command('node',['-e',`const fs=require('node:fs'),cp=require('node:child_process');fs.mkdirSync(${JSON.stringify(scratch)},{mode:0o700});cp.execFileSync('chown',[${JSON.stringify(user+':'+user)},${JSON.stringify(scratch)}]);`]);
  }
  const timeoutMs=remaining(options.timeoutMs),path='/root/factory-verifier-control/'+randomUUID()+'.json';
  const request={user,dir:ws.dir,scratch,args,timeoutMs,...(ops?{ops}:{})};
  const content=JSON.stringify(request);if(Buffer.byteLength(content)>131072)throw Error('VERIFIER_INPUT_BOUND');
  await protectedWrite(path,content);
  try{const text=await command('node',['-e',protectedLauncher,path],timeoutMs+1000);return JSON.parse(text);}
  finally{if(ops)await command('rm',['-rf',scratch]);}
 };
 const runner={
  id:'vercel-sandbox-verifier-v1',
  isolation:async()=>({fsConfined:attested,networkDenied:attested,envScrubbed:attested,detail:'host inspection required'}),
  async attestation(){
   if(typeof readSandbox!=='function')fail();
   const fresh=await readSandbox(),observed=fresh?.currentSession();
   if(fresh.name!==sandbox.name||fresh.image!==image||fresh.persistent!==false||fresh.networkPolicy!=='deny-all'||observed.networkPolicy!=='deny-all'||observed.sessionId!==sessionId||fresh.routes?.length!==0||observed.routes?.length!==0||fresh.interactivePort!==undefined||Object.keys(fresh.mounts??{}).length||fresh.networkId||fresh.sourceSnapshotId||fresh.currentSnapshotId)fail();
   const inspection=JSON.parse(await command('node',['-e',protectedInspection]));
   if(Object.keys(inspection).sort().join(',')!=='controlPrivate,node24,procHidden,root'||Object.values(inspection).some(v=>v!==true))fail();
   // This trusted inspection runs no candidate or hidden material. The exact drop path is checked live.
   const identityScript=`const fs=require('node:fs');const s=fs.readFileSync('/proc/self/status','utf8');const cap=k=>new RegExp('^'+k+':\\\\s+0+$','m').test(s);const keys=Object.keys(process.env).sort().join(',');if(process.getuid()<1000||process.getgid()<1000||process.getgroups().some(g=>g!==process.getgid())||!cap('CapEff')||!cap('CapBnd')||!cap('CapInh')||!cap('CapAmb')||!/^NoNewPrivs:\\s+1$/m.test(s)||keys!=='CI,HOME,LANG,NODE_ENV,NO_COLOR,PATH,TMPDIR,UV_USE_IO_URING'||process.env.UV_USE_IO_URING!=='0')throw Error('VERIFIER_DROP_IDENTITY');process.stdout.write(JSON.stringify({uid:process.getuid(),capsDropped:true,noNewPrivs:true,envScrubbed:true}));`;
   const drop=`const cp=require('node:child_process');const u='fvinspect';cp.execFileSync('useradd',['-m','-s','/bin/false',u]);const uid=cp.execFileSync('id',['-u',u],{encoding:'utf8'}).trim(),gid=cp.execFileSync('id',['-g',u],{encoding:'utf8'}).trim();process.stdout.write(cp.execFileSync('setpriv',['--reuid='+uid,'--regid='+gid,'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','prlimit','--nproc=32','--nofile=64','--fsize=1048576','--core=0','node','-e',${JSON.stringify(identityScript)}],{encoding:'utf8',timeout:3000,maxBuffer:4096,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/fvinspect',TMPDIR:'/home/fvinspect',NODE_ENV:'test',CI:'1',LANG:'C',NO_COLOR:'1',UV_USE_IO_URING:'0'}}));`;
   const identity=JSON.parse(await command('node',['-e',drop]));
   if(identity.uid<1000||identity.capsDropped!==true||identity.noNewPrivs!==true||identity.envScrubbed!==true)fail();
   attested=true;
   try{
    const guard=await prepare('fvguard',{'guard.cjs':`const fs=require('node:fs'),cp=require('node:child_process');for(const p of ['/etc/passwd','/proc/1/cmdline']){let allowed=false;try{fs.readFileSync(p);allowed=true;}catch{}if(allowed)throw Error('VERIFIER_FS_ESCAPE');}try{cp.spawnSync('true');throw Error('VERIFIER_CHILD_ESCAPE');}catch(e){if(e.code!=='ERR_ACCESS_DENIED')throw e;}process.stdout.write('GUARD_OK');`});
    const guardResult=await run(guard,[guard.dir+'/guard.cjs'],{timeoutMs:5000});
    if(guardResult.exitCode!==0||guardResult.timedOut||guardResult.stdout!=='GUARD_OK')fail();await guard.dispose();
   }catch(error){attested=false;throw error;}
   return {runnerId:runner.id,kind:'SANDBOX_DENY_ALL_V1',networkPolicy:'deny-all',filesystem:'UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE',environment:'SCRUBBED',hiddenMaterialVisibleToCandidate:false,disposable:true,image,sessionId,attestedBy:'factory-host'};
  },
  async workspace(files){
   if(!attested||++count>8)fail();
   for(const [p,text] of Object.entries(files))if(!relative(p)||typeof text!=='string')throw Error('VERIFIER_PATH_REJECTED');
   if(Object.hasOwn(files,'.factory-verifier-driver.mjs'))throw Error('VERIFIER_PATH_REJECTED');
   return prepare('fv'+count,{...files,'.factory-verifier-driver.mjs':alphaOperationDriver});
  },
  node:(ws,args,options)=>run(ws,args,options),
  probe:(ws,request,options)=>run(ws,[ws.dir+'/.factory-verifier-driver.mjs'],options,request.ops),
 };
 return runner;
}
