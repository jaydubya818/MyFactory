import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
const docker=async(args,{input,timeout=30000}={})=>{
 if(input===undefined)return exec('docker',args,{timeout,maxBuffer:1024*1024});
 return new Promise((resolve,reject)=>{const child=execFile('docker',args,{timeout,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr}));child.stdin.end(input);});
};
const inspect=async id=>JSON.parse((await docker(['inspect',id])).stdout)[0];
const missing=()=>Object.assign(Error('NOT_FOUND'),{response:{status:404}});
/** Offline Linux confinement qualification transport. It does not assert that Docker is the live Vercel service. */
export function protectedDockerSandboxApi({image=process.env.FACTORY_VERIFIER_DOCKER_IMAGE??'node:24-bookworm'}={}){
 const allocated=new Map();
 const wrap=(name,id,info)=>{
  if(info.HostConfig.NetworkMode!=='none'||info.HostConfig.PidsLimit!==128||info.Mounts.length||Object.keys(info.NetworkSettings.Ports??{}).length)throw Error('DOCKER_QUALIFICATION_ISOLATION');
  const identity={name,image:allocated.get(name).policyImage,persistent:false,networkPolicy:'deny-all',routes:[],mounts:{},currentSession:()=>({sessionId:'sbx_'+id,networkPolicy:'deny-all',routes:[],runCommand:params=>user('root').runCommand(params),writeFiles:(files)=>user('root').writeFiles(files)})};
  const user=username=>({
   homeDir:username==='root'?'/root':'/home/'+username,
   async writeFiles(files){
    const script=`const fs=require('node:fs'),path=require('node:path');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{for(const f of JSON.parse(text)){fs.mkdirSync(path.dirname(f.path),{recursive:true,mode:0o755});fs.writeFileSync(f.path,Buffer.from(f.content,'base64'),{mode:f.mode});fs.chmodSync(f.path,f.mode);}});`;
    await docker(['exec','-i','-u','root',id,'node','-e',script],{input:JSON.stringify(files.map(f=>({...f,content:Buffer.from(f.content).toString('base64')})))});
    if(username!=='root')for(const f of files)await docker(['exec','-u','root',id,'chown',username+':'+username,f.path]);
   },
   async runCommand({cmd,args=[],cwd,timeoutMs=30000}){
    let result,exitCode=0;try{result=await docker(['exec','-u',username,...(cwd?['-w',cwd]:[]),id,cmd,...args],{timeout:timeoutMs+2000});}catch(e){result=e;exitCode=typeof e.code==='number'?e.code:1;}
    return {exitCode,stdout:async()=>result.stdout??'',stderr:async()=>result.stderr??''};
   },
  });
  return {...identity,asUser:user,async createUser(username){if(!/^fv[1-8]$/.test(username))throw Error('DOCKER_USER');await docker(['exec','-u','root',id,'useradd','-m','-s','/bin/false',username]);return user(username);},
   stop:()=>docker(['stop','--time','1',id]),delete:()=>docker(['rm','-f',id]).then(()=>{allocated.delete(name);})};
 };
 const api={
  async create(options){
   if(options.networkPolicy!=='deny-all'||options.persistent!==false||options.ports?.length||Object.keys(options.env??{}).length||allocated.has(options.name))throw Error('DOCKER_OPTIONS');
   // Use only an already cached image. No pulls, host mounts, ports, or provider requests.
   await docker(['image','inspect',image]);
   const name='factory-verifier-qualification-'+randomUUID();
   const id=(await docker(['run','-d','--pull=never','--name',name,'--network','none','--pids-limit','128','--memory','512m','--cpus','1','--cap-add','SYS_ADMIN','--security-opt','seccomp=unconfined',image,'sleep',String(Math.ceil(options.timeout/1000)+30)])).stdout.trim();
   allocated.set(options.name,{id,policyImage:options.image});
   return wrap(options.name,id,await inspect(id));
  },
  async get({name}){
   const item=allocated.get(name);if(!item)throw missing();
   let info;try{info=await inspect(item.id);}catch{throw missing();}
   if(!info.State.Running)throw missing();
   return wrap(name,item.id,info);
  },
  async cleanup(){for(const {id} of allocated.values())await docker(['rm','-f',id]).catch(()=>{});allocated.clear();},
 };
 return api;
}
