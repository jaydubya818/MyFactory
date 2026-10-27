import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,readdirSync,lstatSync,existsSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLocalGitInputTreeV4} from '../src/producer-results.ts';

const sha256=value=>createHash('sha256').update(value).digest('hex');

// Source preparation only: run this fixed-prefix group only after exact-source review.
const V4_INPUT_TEST_GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git';
const V4_INPUT_TEST_ENV={PATH:'/opt/homebrew/Cellar/git/2.48.1/bin:/usr/bin:/bin',XDG_CONFIG_HOME:'/nonexistent',
  LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:''};
function v4InputFixture(t,format='sha1'){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'v4-git-input-'))),repo=join(dir,'repo');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const command=(args,input)=>execFileSync(V4_INPUT_TEST_GIT,['--no-replace-objects','--no-lazy-fetch','--no-optional-locks',
    '-c','protocol.allow=never','-c','credential.helper=','-c','core.hooksPath=/dev/null','-c','gc.auto=0',...args],
    {cwd:'/',env:{...V4_INPUT_TEST_ENV},input,timeout:10000,killSignal:'SIGKILL',maxBuffer:4*1024*1024+1024,encoding:'utf8'}).trim();
  command(['-c','init.defaultBranch=main','init','--quiet','--object-format='+format,'--template=',repo]);
  const git=(...args)=>command(['-C',repo,...args]);
  const object=(kind,bytes)=>{
    bytes=Buffer.from(bytes);const id=command(['-C',repo,'hash-object','--literally','-w','-t',kind,'--stdin'],bytes);
    assert.equal(id,createHash(format).update(kind+' '+bytes.length+'\0').update(bytes).digest('hex'));
    return id;
  };
  const blob=object('blob','inert input\n');
  const tree=object('tree',Buffer.concat([Buffer.from('100644 file.txt\0'),Buffer.from(blob,'hex')]));
  const commitBytes=(treeId,message='inert input')=>Buffer.from('tree '+treeId+'\nauthor Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Fixture <fixture@example.invalid> 1700000000 +0000\n\n'+message+'\n');
  const commit=object('commit',commitBytes(tree));
  git('update-ref','refs/heads/main',commit);
  const path=id=>join(repo,'.git','objects',id.slice(0,2),id.slice(2));
  // Replace only regular files in this owned disposable object store. Git's
  // 0444 object mode is preserved; no source/user repository modes are changed.
  const replace=(file,bytes)=>{
    assert.ok(file.startsWith(join(repo,'.git','objects')+'/'));assert.equal(realpathSync(file),file);
    const stat=lstatSync(file);assert.ok(stat.isFile());const mode=stat.mode&0o777;
    rmSync(file);writeFileSync(file,bytes,{flag:'wx',mode});
  };
  return {dir,repo,git,object,tree,commit,commitBytes,path,replace,config:join(repo,'.git','config')};
}
function v4InputFiles(dir){
  const files={};
  const scan=(path,rel='')=>{for(const name of readdirSync(path).sort()){
    const full=join(path,name),key=join(rel,name),stat=lstatSync(full);
    if(stat.isDirectory())scan(full,key);else files[key]={size:stat.size,mode:stat.mode,hash:stat.isSymbolicLink()?'SYMLINK':sha256(readFileSync(full))};
  }};scan(dir);return files;
}

test('V4 Git input identity: exact admitted commit differs from HEAD and workspace, returns only identity without writes',t=>{
  const f=v4InputFixture(t),otherTree=f.object('tree',Buffer.alloc(0));
  const other=f.object('commit',f.commitBytes(otherTree,'different HEAD'));f.git('update-ref','refs/heads/main',other);
  writeFileSync(join(f.repo,'file.txt'),'unrelated mutable workspace\n');const before=v4InputFiles(f.dir);
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
  assert.deepEqual(v4InputFiles(f.dir),before);
});
test('V4 Git input identity: SHA-256 is explicit and mixed repository or header formats refuse',t=>{
  const f=v4InputFixture(t,'sha256');assert.equal(f.commit.length,64);
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,'a'.repeat(40)),/format/);
  const mixed=f.object('commit',f.commitBytes('a'.repeat(40)));
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,mixed),/tree header/);
});
test('V4 Git input identity: packed objects use the same bounded host Git path without loose fallback',t=>{
  const f=v4InputFixture(t);f.git('repack','-a','-d');
  assert.ok(readdirSync(join(f.repo,'.git','objects','pack')).some(name=>name.endsWith('.pack')));
  assert.match(readFileSync(join(f.repo,'.git','objects','info','packs'),'utf8'),/^P pack-[a-f0-9]{40}\.pack\n/m);
  assert.equal(existsSync(f.path(f.commit)),false);const before=v4InputFiles(f.dir);
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
  assert.deepEqual(v4InputFiles(f.dir),before);
});
test('V4 Git input identity: replacement refs cannot replace the supplied commit or its tree',t=>{
  const f=v4InputFixture(t),otherTree=f.object('tree',Buffer.alloc(0)),other=f.object('commit',f.commitBytes(otherTree,'replacement'));
  f.git('replace',f.commit,other);
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
});
test('V4 Git input identity: fresh child environment excludes inherited config, object, helper and provider redirection',t=>{
  const f=v4InputFixture(t),trace=join(f.dir,'must-not-exist.trace'),hostile=join(f.dir,'hostile.gitconfig');
  writeFileSync(hostile,'[include]\n path = /nonexistent/never-read\n[credential]\n helper = /nonexistent/never-execute\n');
  const overrides={GIT_DIR:join(f.dir,'wrong.git'),GIT_COMMON_DIR:join(f.dir,'wrong-common'),GIT_WORK_TREE:join(f.dir,'wrong-worktree'),
    GIT_OBJECT_DIRECTORY:join(f.dir,'wrong-objects'),GIT_ALTERNATE_OBJECT_DIRECTORIES:join(f.dir,'wrong-alternates'),
    GIT_CONFIG_SYSTEM:hostile,GIT_CONFIG_GLOBAL:hostile,GIT_CONFIG_PARAMETERS:"'include.path=/nonexistent/never-read'",
    GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'include.path',GIT_CONFIG_VALUE_0:'/nonexistent/never-read',
    GIT_EXEC_PATH:'/nonexistent',GIT_TRACE:trace,GIT_TRACE_PACKET:trace,GIT_ASKPASS:'/nonexistent/never-execute',
    GIT_SSH_COMMAND:'/nonexistent/never-execute',GIT_PROXY_COMMAND:'/nonexistent/never-execute',
    GIT_NO_LAZY_FETCH:'0',GIT_NO_REPLACE_OBJECTS:'0',GIT_ALLOW_PROTOCOL:'https:ssh:file',
    NODE_OPTIONS:'--require=/nonexistent/never-load',OPENAI_API_KEY:'INERT-NOT-A-CREDENTIAL',ANTHROPIC_API_KEY:'INERT-NOT-A-CREDENTIAL'};
  const previous=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]));
  try{
    Object.assign(process.env,overrides);
    assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
    assert.equal(existsSync(trace),false);
  }finally{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('V4 Git input identity: includes, credentials, promisor and unsupported repository configuration refuse before object reads',t=>{
  const f=v4InputFixture(t),original=readFileSync(f.config);
  const rejected=['[include]\n path=/nonexistent/never-read\n','[includeIf "gitdir:*"]\n path=/nonexistent/never-read\n',
    '[credential]\n helper=/nonexistent/never-execute\n','[core]\n worktree=/nonexistent/never-use\n',
    '[core]\n alternateRefsCommand=/nonexistent/never-execute\n','[remote "origin"]\n url=forbidden://inert\n promisor=true\n',
    '[extensions]\n partialClone=inert\n','[core]\n unknownPolicy=true\n'];
  for(const extra of rejected){writeFileSync(f.config,Buffer.concat([original,Buffer.from(extra)]));
    assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/configuration/);}
  writeFileSync(f.config,original);assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
});
test('V4 Git input identity: ordinary inert clone remote and branch metadata do not grant network access',t=>{
  const f=v4InputFixture(t);writeFileSync(f.config,readFileSync(f.config,'utf8')+'[remote "origin"]\n url=forbidden://inert\n fetch=+refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n remote=origin\n merge=refs/heads/main\n');
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,'f'.repeat(40)),/Missing|command failed/);
});
test('V4 Git input identity: alternates, promisor packs, shallow and linked layout markers refuse without fetching',t=>{
  const f=v4InputFixture(t);
  for(const relative of ['objects/info/alternates','objects/info/http-alternates','objects/pack/pack-'+('a'.repeat(40))+'.promisor',
    'shallow','commondir','config.worktree','info/grafts']){
    const path=join(f.repo,'.git',relative);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'/nonexistent/never-use\n');
    assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));rmSync(path);
  }
});
test('V4 Git input identity: missing, wrong-kind and corrupt commit or tree objects refuse',t=>{
  const f=v4InputFixture(t);assert.throws(()=>readLocalGitInputTreeV4(f.repo,'f'.repeat(40)));
  const blob=f.object('blob','wrong kind');assert.throws(()=>readLocalGitInputTreeV4(f.repo,blob),/wrong-kind|command failed/);
  const wrongTree=f.object('commit',f.commitBytes(blob));assert.throws(()=>readLocalGitInputTreeV4(f.repo,wrongTree),/wrong-kind|command failed/);
  const missingTree=f.object('commit',f.commitBytes('f'.repeat(40)));assert.throws(()=>readLocalGitInputTreeV4(f.repo,missingTree));
  for(const id of [f.commit,f.tree]){const original=readFileSync(f.path(id));f.replace(f.path(id),'corrupt compressed object');
    try{assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/command failed|wrong-kind|hash mismatch/);}
    finally{f.replace(f.path(id),original);}}
});
test('V4 Git input identity: a well-formed object stored under another object ID fails typed raw hashing',t=>{
  const f=v4InputFixture(t),other=f.object('commit',f.commitBytes(f.tree,'different raw bytes'));
  f.replace(f.path(f.commit),readFileSync(f.path(other)));
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/typed hash mismatch/);
});
test('V4 Git input identity: unique canonical tree header and exact object IDs are mandatory',t=>{
  const f=v4InputFixture(t);
  for(const header of ['tree '+f.tree+'\ntree '+f.tree,'tree '+f.tree+'\ntree','tree '+f.tree.toUpperCase(),
    'tree '+('a'.repeat(64)),' tree '+f.tree,'tree '+f.tree+' extra','author Inert\ntree '+f.tree]){
    const id=f.object('commit',Buffer.from(header+'\n\ninert\n'));assert.throws(()=>readLocalGitInputTreeV4(f.repo,id),/tree header/);
  }
  for(const id of ['HEAD',f.commit.slice(1),f.commit.toUpperCase(),f.commit+'^{tree}','-v','a'.repeat(41),'a'.repeat(10000),'a'.repeat(39)+'\n'])
    assert.throws(()=>readLocalGitInputTreeV4(f.repo,id),/identity/);
  for(const repo of ['relative',f.repo+'\0','/'+('a'.repeat(4096))])assert.throws(()=>readLocalGitInputTreeV4(repo,f.commit),/identity/);
});
test('V4 Git input identity: object, metadata and directory byte/count bounds fail closed',t=>{
  const f=v4InputFixture(t),hugeCommit=f.object('commit',Buffer.concat([f.commitBytes(f.tree),Buffer.alloc(4*1024*1024)]));
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,hugeCommit),/oversized/);
  const hugeTree=f.object('tree',Buffer.alloc(4*1024*1024+1)),commit=f.object('commit',f.commitBytes(hugeTree));
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,commit),/oversized/);
  const original=readFileSync(f.config);writeFileSync(f.config,Buffer.alloc(16*1024+1));
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/size limit/);writeFileSync(f.config,original);
  for(let i=0;i<1025;i++)writeFileSync(join(f.repo,'.git','objects','pack','pack-'+i.toString(16).padStart(40,'0')+'.idx'),'');
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/directory bound/);
});
test('V4 Git input identity: symlinked repository, config, object, pack and linked Git directory refuse',t=>{
  const f=v4InputFixture(t),alias=join(f.dir,'alias');symlinkSync(f.repo,alias);
  assert.throws(()=>readLocalGitInputTreeV4(alias,f.commit),/directory/);
  for(const path of [f.config,f.path(f.commit)]){
    const saved=path+'.saved';renameSync(path,saved);symlinkSync(saved,path);
    assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));rmSync(path);renameSync(saved,path);
  }
  const pack=join(f.repo,'.git','objects','pack','pack-'+('a'.repeat(40))+'.idx');symlinkSync(f.config,pack);
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));rmSync(pack);
  const gitDir=join(f.repo,'.git'),saved=join(f.dir,'saved.git');renameSync(gitDir,saved);symlinkSync(saved,gitDir);
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));rmSync(gitDir);writeFileSync(gitDir,'gitdir: '+saved+'\n');
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));
});
test('V4 Git input identity: bare, unsupported and contradictory repository formats refuse',t=>{
  const f=v4InputFixture(t),original=readFileSync(f.config,'utf8');
  for(const config of [original.replace('bare = false','bare = true'),original.replace('repositoryformatversion = 0','repositoryformatversion = 9'),
    original+'[extensions]\n objectFormat=sha256\n',original+'[extensions]\n refStorage=reftable\n']){
    writeFileSync(f.config,config);assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit));
  }
  writeFileSync(f.config,original);
});
test('V4 Git input identity: reviewed helper unchanged, explicit producer only and fixed command/time controls',()=>{
  const source=readFileSync(new URL('../src/producer-results.ts',import.meta.url));
  const text=source.toString('utf8');
  assert.equal(sha256(text.slice(text.indexOf("import { createHash as localGitHashV4 }"))),'0b7986b95959f16e8e99b7b6be1054a55ca1eae2fdb1ba48b0d2bec48a38ee09');
  for(const file of ['server.ts','dispatch-control.ts','evidence-transport.ts','local-execution-provider.ts','jobs.ts'])
    assert.doesNotMatch(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),/LocalProducerResultsV4|readLocalGitInputTreeV4/);
  assert.ok(text.includes("executable: '/opt/homebrew/Cellar/git/2.48.1/bin/git'"));
  assert.ok(text.includes("executableSha256: '7ed424dafb29f1d4e3df1ca215efcba044b19cc78cf8b8df5a74cbdbfcbf4899'"));
  assert.ok(text.includes('objectBytes: 4 * 1024 * 1024'));assert.ok(text.includes('timeoutMs: 10_000'));
  assert.ok(text.includes("killSignal: 'SIGKILL'"));assert.ok(text.includes('Date.now() + LOCAL_GIT_INPUT_V4.timeoutMs'));
  assert.ok(text.includes("'--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks'"));
  assert.ok(text.includes("'protocol.allow=never'"));assert.ok(text.includes("'--no-includes'"));
  // This asserts configured bounds, not a fault-injected wall-clock timeout proof.
});


test('V4 Git input identity: pack catalog rejects malformed, traversal, duplicate and mixed-format entries',t=>{
  const f=v4InputFixture(t);f.git('repack','-a','-d');const catalog=join(f.repo,'.git','objects','info','packs');
  const original=readFileSync(catalog),pack=readdirSync(join(f.repo,'.git','objects','pack')).find(name=>name.endsWith('.pack'));
  for(const text of ['P ../'+pack+'\n\n','P /'+pack+'\n\n','P '+pack+'/extra\n\n','X '+pack+'\n\n',
    'P '+pack+'\nP '+pack+'\n\n','P '+pack.toUpperCase()+'\n\n','P pack-'+('a'.repeat(64))+'.pack\n\n','P '+pack]){
    f.replace(catalog,text);assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/pack catalog/);
  }
  f.replace(catalog,original);assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
});
test('V4 Git input identity: oversized and symlinked pack catalogs refuse bounded regular-file reads',t=>{
  const f=v4InputFixture(t);f.git('repack','-a','-d');const catalog=join(f.repo,'.git','objects','info','packs'),original=readFileSync(catalog);
  f.replace(catalog,Buffer.alloc(16*1024+1));assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/size limit/);
  f.replace(catalog,original);rmSync(catalog);symlinkSync(f.config,catalog);
  assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/redirection/);
  rmSync(catalog);writeFileSync(catalog,original,{flag:'wx'});
});
test('V4 Git input identity: pack catalog cannot name a missing pack or omit a local pack',t=>{
  const f=v4InputFixture(t);f.git('repack','-a','-d');const catalog=join(f.repo,'.git','objects','info','packs'),original=readFileSync(catalog);
  const pack=readdirSync(join(f.repo,'.git','objects','pack')).find(name=>name.endsWith('.pack'));
  const actual=join(f.repo,'.git','objects','pack',pack),held=join(f.dir,'held.pack');renameSync(actual,held);
  try{assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/missing Git pack catalog entry/);}finally{renameSync(held,actual);}
  f.replace(catalog,'\n');assert.throws(()=>readLocalGitInputTreeV4(f.repo,f.commit),/Incomplete Git pack catalog/);
  f.replace(catalog,original);assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
});
test('V4 Git input identity: normal packed SHA-256 catalog binds to its configured object format',t=>{
  const f=v4InputFixture(t,'sha256');f.git('repack','-a','-d');
  assert.match(readFileSync(join(f.repo,'.git','objects','info','packs'),'utf8'),/^P pack-[a-f0-9]{64}\.pack\n/m);
  assert.deepEqual(readLocalGitInputTreeV4(f.repo,f.commit),{inputCommit:f.commit,inputTree:f.tree});
});
