import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
// Source-only qualification. Always create our own localhost instances; never
// read installed database URLs, environments, credentials or target selections.
const root=fileURLToPath(new URL('../',import.meta.url)),directory=mkdtempSync(join(tmpdir(),'factory-receiver-qualification-'));
const containers=[];
const command=(program,args)=>execFileSync(program,args,{encoding:'utf8',maxBuffer:8*1024*1024});
try{
 command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',join(directory,'server.key'),'-out',join(directory,'server.crt')]);
 chmodSync(join(directory,'server.key'),0o600);
 const urls=[];
 for(const purpose of ['native','witness']){
  const name='factory-receiver-'+purpose+'-'+randomUUID().slice(0,8);
  const id=command('docker',['run','-d','--pull=never','--name',name,'--label','codex.purpose=factory-receiver-qualification',
   '--tmpfs','/var/lib/postgresql/data:rw,size=536870912','-p','127.0.0.1::5432','-v',directory+':/fixture-tls:ro',
   '-e','POSTGRES_PASSWORD=disposable-local-only','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB=source_qualification',
   '--entrypoint','bash','postgres:17','-c',
   'cp /fixture-tls/server.key /tmp/server.key && cp /fixture-tls/server.crt /tmp/server.crt && chown postgres:postgres /tmp/server.key /tmp/server.crt && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key']).trim();
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('FIXTURE_CONTAINER_ID');containers.push(id);
  const port=command('docker',['port',id,'5432/tcp']).trim();if(!/^127\.0\.0\.1:\d+$/.test(port))throw Error('FIXTURE_LOCAL_PORT');
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   if(spawnSync('docker',['exec','-e','PGPASSWORD=disposable-local-only',id,'psql','-h','127.0.0.1','-U','fixture_admin','-d','source_qualification','-tAc','SELECT 1'],{stdio:'ignore'}).status===0){ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw Error('FIXTURE_POSTGRES_UNAVAILABLE');
  urls.push('postgres://fixture_admin:disposable-local-only@'+port+'/source_qualification?sslmode=verify-full');
 }
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
  NODE_EXTRA_CA_CERTS:join(directory,'server.crt'),FACTORY_RECEIVER_TEST_DATABASE_URL:urls[0],FACTORY_RECEIVER_TEST_WITNESS_URL:urls[1]};
 const imageId=command('docker',['image','inspect','--format','{{.Id}}','postgres:17']).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error('FIXTURE_IMAGE_ID');
 console.log(JSON.stringify({qualification:'ISOLATED_FACTORY_RECEIVER',imageId,containers,sourceSha:command('git',['-C',root,'rev-parse','HEAD']).trim(),node:process.version,providers:'NOT_USED'}));
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','apps/cloud-control/test/ordered-capability-receiver-postgres.test.mjs'],
  {cwd:root,env,stdio:'inherit',timeout:120000});
 if(result.error)throw result.error;if(result.status!==0)throw Error('FACTORY_RECEIVER_QUALIFICATION_FAILED');
}finally{
 for(const id of containers)command('docker',['rm','-f',id]);
 rmSync(directory,{recursive:true,force:true});
}
