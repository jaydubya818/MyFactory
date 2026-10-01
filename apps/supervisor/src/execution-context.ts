import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { validateChangedPaths } from './git.ts';
const exec = promisify(execFile);
const MAX_CONTEXT = 64 * 1024;
async function git(workspace: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', workspace, ...args], {encoding:'utf8',maxBuffer:MAX_CONTEXT,timeout:5000})).stdout;
}
function selected(path: string, allowed: string[]): boolean {
  return allowed.some(p=>p.endsWith('/**')?path.startsWith(p.slice(0,-2)):p.endsWith('/')?path.startsWith(p):p===path) ||
    /(^|\/)README(?:\.[^/]*)?$|(^|\/)package\.json$|^(test|tests)\//i.test(path);
}
function safePath(path: string): void {
  if(!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p=>p==='..'||p==='.git') || /[\x00-\x1f]/.test(path)) throw Error('Unqualified context path');
}
/** Bounded, deterministic inspection of approved source. No model, shell script, or credential lookup. */
export async function executionContext(workspace: string, inputCommit: string, allowed: string[], current = false): Promise<string> {
  if((await git(workspace,['rev-parse','HEAD'])).trim()!==inputCommit)throw Error('Context base changed');
  const records=(await git(workspace,['ls-tree','-rz','HEAD'])).split('\0').filter(Boolean);
  if(records.length>256)throw Error('Repository exceeds bounded context inventory');
  const files: Record<string,string|null> = {};
  for(const record of records){
    const match=/^(\d{6}) blob ([a-f0-9]+)\t(.+)$/.exec(record);
    if(!match)throw Error('Context requires regular tracked files');
    const [,mode,blob,path]=match;safePath(path);
    if(!selected(path,allowed))continue;
    if(mode!=='100644'&&mode!=='100755')throw Error('Context symlinks are unqualified');
    const text=await git(workspace,['cat-file','blob',blob]);
    if(text.includes('\0'))throw Error('Binary context is unqualified');
    files[path]=text;
  }
  for(const path of allowed.filter(p=>!p.includes('*')&&!p.endsWith('/'))){safePath(path);if(!(path in files))files[path]=null;}
  if(current){
    const changed=await validateChangedPaths(workspace,allowed);
    for(const path of changed){
      safePath(path);let cursor=workspace;
      try{
        for(const segment of path.split('/')){cursor=join(cursor,segment);if((await lstat(cursor)).isSymbolicLink())throw Error('Context symlink denied');}
        const stat=await lstat(cursor);if(!stat.isFile()||stat.size>MAX_CONTEXT)throw Error('Candidate context exceeds bound');
        const file=await open(cursor,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{
          const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_CONTEXT)throw Error('Candidate context exceeds bound');
          const buffer=Buffer.alloc(MAX_CONTEXT+1);let size=0;
          while(size<buffer.length){const read=await file.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
          if(size>MAX_CONTEXT||size!==stat.size||(await file.stat()).size!==size)throw Error('Candidate context changed');
          files[path]=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
        }finally{await file.close();}
      }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')files[path]=null;else throw error;}
    }
  }
  const context=JSON.stringify({base:inputCommit,inventory:records.map(r=>r.slice(r.indexOf('\t')+1)),files});
  if(Buffer.byteLength(context)>MAX_CONTEXT||context.includes('\\u0000'))throw Error('Complete context exceeds bounded text policy');
  return context;
}

/** Progress is filesystem evidence, never a model claim or writer authority. */
export async function assertImplementationProgress(workspace: string, inputCommit: string, allowed: string[]): Promise<void> {
  if((await git(workspace,['rev-parse','HEAD'])).trim()!==inputCommit)throw Error('Implementation base changed');
  await validateChangedPaths(workspace,allowed);
}
