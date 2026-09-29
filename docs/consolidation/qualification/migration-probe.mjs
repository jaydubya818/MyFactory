import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {openStorage} from '../../../packages/storage/src/index.ts';
const sourcePath='packages/storage/src/index.ts';
const extract=s=>[...s.match(/const migrations = \[([\s\S]*?)\n\];/)[1].matchAll(/`([^`]*)`/g)].map(x=>x[1]);
const original='8c5de7794ffa377420ef5dcdbda44aa9fa2328b8';
const old=extract(execFileSync('git',['show',original+':'+sourcePath],{encoding:'utf8'})),current=extract(readFileSync(sourcePath,'utf8'));
assert.deepEqual(current.slice(0,old.length),old);assert.equal(current.length,8);
const directory=mkdtempSync(join(tmpdir(),'factory-consolidation-migration-'));const checks=[];
try{
 for(const version of [0,old.length,7]){
  const path=join(directory,'v'+version+'.sqlite');let db=new DatabaseSync(path);
  for(let i=0;i<version;i++){db.exec('BEGIN');db.exec(current[i]);db.exec('PRAGMA user_version='+String(i+1));db.exec('COMMIT');}
  if(version)db.prepare("INSERT INTO work_orders(id,title,description,kind,repository_path,base_ref,acceptance_criteria_json,check_commands_json,allowed_paths_json,worker_profile,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('preserved','Preserved task','Migration fixture','feature','/fixture','main','["preserve"]','[]','["file"]','mac','queued','2026-09-01','2026-09-01');
  const before=version?db.prepare('SELECT * FROM work_orders').all():[];db.close();
  const store=openStorage(path);store.close();db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,8);if(version)assert.deepEqual(db.prepare('SELECT * FROM work_orders').all(),before);db.close();
  const reopened=openStorage(path);reopened.close();checks.push({from:version,to:8,populated:version>0,status:'PASS',replay:'PASS'});
 }
 const report={original,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prefixBytesUnchanged:true,migrations:current.map((s,i)=>({version:i+1,checksum:createHash('sha256').update(s).digest('hex')})),checks};writeFileSync(new URL('./migration-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{rmSync(directory,{recursive:true});}
