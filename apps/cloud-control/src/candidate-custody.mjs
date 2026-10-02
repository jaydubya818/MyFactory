import { parsePatch, applyPatch } from 'diff';
import { createHash } from 'node:crypto';
import { canonical, sha256 } from '../../../packages/hosted-routing/src/result.ts';

const objectId=(kind,bytes)=>createHash('sha1').update(`${kind} ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
/** Bounded regular UTF-8 tree only. No filesystem, hooks, code execution or URLs. */
export function boundedFiles(value) {
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length>200||Buffer.byteLength(canonical(value))>500000)throw Error('FILE_TREE_BOUND');
  for(const [path,text] of Object.entries(value)){
    if(!/^[\w./-]+$/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git')||typeof text!=='string'||text.includes('\0')||Buffer.byteLength(text)>100000||Buffer.from(text).toString('utf8')!==text)throw Error('UNSUPPORTED_SOURCE_FILE');
    if(Object.keys(value).some(other=>other.startsWith(path+'/')))throw Error('FILE_DIRECTORY_COLLISION');
  }
  return value;
}
export function fileTree(value) {
  const files=boundedFiles(value);
  function tree(prefix){
    const children=new Map();
    for(const path of Object.keys(files).filter(p=>p.startsWith(prefix))){const rest=path.slice(prefix.length);children.set(rest.split('/')[0],rest.includes('/'));}
    const entries=[...children].sort(([a,ad],[b,bd])=>Buffer.compare(Buffer.from(a+(ad?'/':'')),Buffer.from(b+(bd?'/':''))));
    const bytes=Buffer.concat(entries.flatMap(([name,dir])=>[Buffer.from(`${dir?'40000':'100644'} ${name}\0`),Buffer.from(dir?tree(prefix+name+'/').sha:objectId('blob',files[prefix+name]),'hex')]));
    return{sha:objectId('tree',bytes),bytes};
  }
  return tree('');
}
/** Validate transport bytes before private custody. A producer report is evidence,
 * never a protected-verifier verdict or publication authorization. */
export function validateCandidateBundle(bytes,request) {
  if(!Buffer.isBuffer(bytes)||bytes.length>256000)throw Error('CANDIDATE_BUNDLE_BOUND');
  const b=JSON.parse(bytes.toString('utf8'));
  if(!b||Object.keys(b).sort().join(',')!=='base,checks,commit,commitBase64,files,patchBase64,sourceFiles,tree,treeBase64,version'||b.version!==1||b.base!==request.source.commit)throw Error('CANDIDATE_BUNDLE_BINDING');
  const sourceTree=fileTree(b.sourceFiles),candidateTree=fileTree(b.files);
  if(sourceTree.sha!==request.source.tree||candidateTree.sha!==b.tree)throw Error('CANDIDATE_TREE_MISMATCH');
  const paths=[...new Set([...Object.keys(b.sourceFiles),...Object.keys(b.files)])].filter(p=>b.sourceFiles[p]!==b.files[p]).sort();
  if(!paths.length||paths.some(p=>!request.input.allowedPaths.includes(p)))throw Error('CANDIDATE_PATH_DENIED');
  const decode=value=>{if(typeof value!=='string')throw Error('ARTIFACT_ENCODING');const data=Buffer.from(value,'base64');if(data.toString('base64')!==value)throw Error('ARTIFACT_ENCODING');return data;};
  const commit=decode(b.commitBase64),tree=decode(b.treeBase64),patch=decode(b.patchBase64);
  if(objectId('commit',commit)!==b.commit||!tree.equals(candidateTree.bytes)||!commit.toString('utf8').startsWith(`tree ${b.tree}\n`)||commit.toString('utf8').split('\n\n')[0].split('\n').filter(h=>h.startsWith('parent ')).join('\n')!==`parent ${b.base}`)throw Error('CANDIDATE_GIT_IDENTITY');
  if(!patch.length||patch.length>128000||!Array.isArray(b.checks)||b.checks.length!==request.input.checkCommands.length)throw Error('CANDIDATE_EVIDENCE_BOUND');
  const patchText=patch.toString('utf8');
  if(!Buffer.from(patchText).equals(patch)||patchText.includes('\0')||/^(?:GIT binary patch|Binary files |old mode |new mode |rename from |rename to |copy from |copy to )/m.test(patchText)||/^(?:new file mode|deleted file mode) (?!100644$)/m.test(patchText))throw Error('UNSUPPORTED_PATCH');
  const patched=new Map(Object.entries(b.sourceFiles)),seen=new Set();
  const parts=parsePatch(patchText);
  if(parts.length!==paths.length)throw Error('PATCH_FILE_SET_MISMATCH');
  for(const part of parts){
    const oldPath=part.oldFileName==='/dev/null'?null:part.oldFileName?.startsWith('a/')?part.oldFileName.slice(2):undefined;
    const newPath=part.newFileName==='/dev/null'?null:part.newFileName?.startsWith('b/')?part.newFileName.slice(2):undefined;
    const path=newPath??oldPath;
    if(oldPath===undefined||newPath===undefined||!path||(oldPath&&newPath&&oldPath!==newPath)||!paths.includes(path)||seen.has(path)||(oldPath!==null)!==patched.has(path))throw Error('PATCH_SCOPE_MISMATCH');
    seen.add(path);const result=applyPatch(patched.get(path)??'',part,{fuzzFactor:0,autoConvertLineEndings:false});
    if(result===false||(newPath===null&&result!==''))throw Error('PATCH_APPLY_FAILED');
    if(newPath===null)patched.delete(path);else patched.set(path,result);
  }
  if(canonical(Object.fromEntries(patched))!==canonical(b.files))throw Error('PATCH_TREE_MISMATCH');
  for(const [i,c] of b.checks.entries()){
    if(!c||Object.keys(c).sort().join(',')!=='command,exitCode,finishedAt,log,startedAt'||c.command!==request.input.checkCommands[i]||!Number.isInteger(c.exitCode)||typeof c.log!=='string'||Buffer.byteLength(c.log)>64000||!Number.isFinite(Date.parse(c.startedAt))||!Number.isFinite(Date.parse(c.finishedAt))||Date.parse(c.startedAt)>Date.parse(c.finishedAt))throw Error('CANDIDATE_CHECK_BINDING');
  }
  return{bundle:b,sha256:sha256(bytes),bytes:bytes.length,commit:b.commit,tree:b.tree,paths};
}
