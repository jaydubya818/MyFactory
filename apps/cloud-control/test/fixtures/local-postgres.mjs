import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {docker} from '../../src/local-execution-provider.mjs';
export async function startPostgres(root) {
  const name = "mc-1c-pg-" + randomUUID();
  await docker(["run", "-d", "--pull=never", "--name", name, "--label", "mc.checkpoint=1c", "-p", "127.0.0.1::5432", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
  let port = Number((await docker(["port", name, "5432/tcp"])).split(":").at(-1));
  let pool;
  function connect() { return new pg.Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", max: 8 }); }
  try {
    pool = connect();
    for (let i = 0; ; i++) { try { await pool.query("SELECT 1"); break; } catch (e) { if (i === 100) throw e; await new Promise(r => setTimeout(r, 100)); } }
    await pool.query("CREATE SCHEMA factory");
    for (const file of ["002-canonical-execution-ledger.sql", "004-canonical-dispatch.sql", "005-cloud-custody.sql", "006-cloud-verification.sql", "009-paid-operation-release.sql"]) {
      await pool.query(await readFile(join(root, "apps/cloud-control/migrations", file), "utf8"));
    }
    return { get pool() { return pool; }, restart: async () => { await pool.end(); await docker(["restart", name]); port = Number((await docker(["port", name, "5432/tcp"])).split(":").at(-1)); pool = connect(); for(let i=0;;i++){try{await pool.query("SELECT 1");break;}catch(e){if(i===100)throw e;await new Promise(r=>setTimeout(r,100));}} },
      stop: async () => { await pool.end(); await docker(["rm", "-f", "-v", name]); } };
  } catch (e) { await pool?.end(); await docker(["rm", "-f", "-v", name]); throw e; }
}
