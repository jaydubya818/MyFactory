/** Bind SDK convenience helpers to one admitted Session. Sandbox.withResume is never called by worker operations. */
export function exactSandboxSession(sandbox){
 const session=sandbox.currentSession(),id=session.sessionId;
 if(!/^sbx_[A-Za-z0-9_-]+$/.test(id??'')||typeof session.runCommand!=='function'||typeof session.writeFiles!=='function'||typeof session.readFile!=='function'||typeof session.update!=='function')throw Error('SANDBOX_SESSION_API_REQUIRED');
 const exact=()=>{if(sandbox.currentSession().sessionId!==id)throw Error('SANDBOX_SESSION_FENCED');};
 let proxy;
 const direct=new Map(['runCommand','writeFiles','readFile','readFileToBuffer','getCommand','mkDir'].map(name=>[name,(...args)=>{exact();return session[name](...args);} ]));
 direct.set('updateNetworkPolicy',(policy,options)=>{exact();return session.update({networkPolicy:policy},options);});
 proxy=new Proxy(sandbox,{get(target,key){
  if(direct.has(key))return direct.get(key);
  if(['resume','extendTimeout','openInteractive','snapshot'].includes(key))return()=>{throw Error('SANDBOX_AUTHORITY_EXTENSION_DENIED');};
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(['asUser','createUser','getDefaultUser','resolveDefaultUser'].includes(key)?proxy:target):value;
 }});
 return proxy;
}
