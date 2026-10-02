import {cloudCodexPackage,cloudHarnessIdentity} from './cloud-harness-plan.mjs';

// Fixed, integrity-pinned installer. Runs as sandbox root before untrusted
// repository execution; it receives no host credentials or user-authored code.
export const cloudHarnessInstallScript=`
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
(async()=>{
 if(process.getuid()!==0||process.arch!=='x64'||process.platform!=='linux')throw Error('HARNESS_INSTALL_IDENTITY');
 const spec=${JSON.stringify(cloudCodexPackage)};
 const response=await fetch(spec.url,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok||!response.body)throw Error('HARNESS_PACKAGE_UNAVAILABLE');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>spec.maxCompressedBytes)throw Error('HARNESS_PACKAGE_BOUND');chunks.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(chunks);
 if('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')!==spec.integrity)throw Error('HARNESS_PACKAGE_INTEGRITY');
 const dir='/opt/factory-harness',archive=dir+'/codex.tgz';fs.mkdirSync(dir+'/bin',{recursive:true,mode:0o755});fs.writeFileSync(archive,bytes,{flag:'wx',mode:0o600});
 const entry='package/vendor/x86_64-unknown-linux-musl/codex/codex';
 const entries=cp.execFileSync('tar',['-tzf',archive],{encoding:'utf8',timeout:10000,maxBuffer:64000}).trim().split('\\n');
 if(entries.filter(x=>x===entry).length!==1||entries.some(x=>x.startsWith('/')||x.split('/').includes('..')))throw Error('HARNESS_PACKAGE_LAYOUT');
 cp.execFileSync('tar',['-xzf',archive,'--strip-components=4','-C',dir+'/bin',entry],{timeout:15000,maxBuffer:64000});fs.unlinkSync(archive);
 const binary=dir+'/bin/codex',stat=fs.lstatSync(binary);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>spec.maxUnpackedBytes)throw Error('HARNESS_BINARY_TYPE');fs.chmodSync(binary,0o755);
 const version=cp.execFileSync(binary,['--version'],{encoding:'utf8',timeout:5000,maxBuffer:1000}).trim();
 if(version!==${JSON.stringify('codex-cli '+cloudHarnessIdentity.version)})throw Error('HARNESS_VERSION_MISMATCH');
 process.stdout.write(JSON.stringify({version,integrity:spec.integrity,bytes:stat.size,uid:process.getuid()}));
})().catch(()=>{process.stderr.write('HARNESS_INSTALL_FAILED');process.exitCode=1;});
`;
