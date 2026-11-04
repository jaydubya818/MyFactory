import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';

// Disposable Linux CI prerequisite only. This never invokes a model or changes
// executor options. Prove that the installed helper enforces the existing modes.
assert.equal(process.platform,'linux');
assert.equal(process.env.CI,'true');
const exec=promisify(execFile);
const directory=await mkdtemp(join(homedir(),'.factory-sandbox-qualification-'));
const workspace=join(directory,'workspace'),home=join(directory,'cli-home');
const outside=join(directory,'outside.txt');
let hits=0;
const server=createServer((_request,response)=>{hits++;response.end('synthetic-only');});
try{
 await mkdir(workspace);await mkdir(home);
 await exec('git',['init','-q',workspace]);
 await writeFile(outside,'unchanged');
 await writeFile(join(workspace,'.git','protected.txt'),'unchanged');
 await writeFile(join(workspace,'allowed.txt'),'unchanged');
 const version=await exec('codex',['--version'],{env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:process.env.RUNNER_TEMP??'/tmp'}});
 assert.equal(version.stdout.trim(),'codex-cli 0.157.0');
 assert(!version.stderr.includes('Refusing to create helper binaries'));
 const cliEnv={PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:process.env.RUNNER_TEMP??'/tmp',LANG:'C.UTF-8'};
 for(const command of [['/bin/echo','FACTORY_SANDBOX_MARKER'],[process.execPath,'--version'],
  [process.execPath,'-e','require("node:fs").writeSync(1,"NODE_SYNC_MARKER\\n")']]){
  const observed=await exec('codex',['-c','sandbox_mode="workspace-write"','sandbox','--',...command],
   {cwd:workspace,env:cliEnv,timeout:15000,maxBuffer:32000});
  console.log('SANDBOX_COMMAND_DIAGNOSTIC',JSON.stringify({command,stdout:observed.stdout,stderr:observed.stderr}));
  assert(observed.stdout.trim(),`Sandbox command returned no output: ${JSON.stringify(observed)}`);
 }
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal(await (await fetch(origin)).text(),'synthetic-only');
 assert.equal(hits,1);
 const probe=join(workspace,'probe.mjs');
 await writeFile(probe,`import assert from 'node:assert/strict';
  import {writeFileSync,readFileSync} from 'node:fs';import {createConnection} from 'node:net';
  const [mode,outside,port]=process.argv.slice(2);
  if(mode==='workspace-write')writeFileSync('allowed.txt','allowed');
  else assert.throws(()=>writeFileSync('allowed.txt','forbidden'));
  assert.throws(()=>writeFileSync('.git/protected.txt','forbidden'));
  assert.throws(()=>writeFileSync(outside,'forbidden'));
  assert.equal(readFileSync(outside,'utf8'),'unchanged');
  await new Promise((resolve,reject)=>{
   const socket=createConnection({host:'127.0.0.1',port:Number(port)});
   socket.once('connect',()=>{socket.destroy();reject(Error('SANDBOX_NETWORK_ESCAPED'));});
   socket.once('error',()=>resolve());socket.setTimeout(2000,()=>{socket.destroy();resolve();});
  });
  // Emit the proof synchronously before this short-lived sandbox exits.
  writeFileSync(1,JSON.stringify({mode,protectedGit:true,outsideDenied:true,networkDenied:true})+'\\n');
 `);
 for(const mode of ['workspace-write','read-only']){
  const result=await exec('codex',['-c',`sandbox_mode="${mode}"`,'sandbox','--',process.execPath,
   probe,mode,outside,String(server.address().port)],{cwd:workspace,
   env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:process.env.RUNNER_TEMP??'/tmp',LANG:'C.UTF-8'},
   timeout:15000,maxBuffer:32000});
  assert.equal(JSON.parse(result.stdout).mode,mode);
  assert(!result.stderr.includes('Refusing to create helper binaries'));
  assert.equal(await readFile(outside,'utf8'),'unchanged');
  assert.equal(await readFile(join(workspace,'.git','protected.txt'),'utf8'),'unchanged');
  assert.equal(await readFile(join(workspace,'allowed.txt'),'utf8'),'allowed');
  assert.equal(hits,1);
  console.log(result.stdout.trim());
 }
 console.log('Qualified CLI sandbox prerequisites PASS; no model or paid execution.');
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await rm(directory,{recursive:true,force:true});
}
