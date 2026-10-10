import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const lock=JSON.parse(await readFile('docs/capability-control/source-lock.json','utf8'));
assert.match(lock.myEveSha,/^[a-f0-9]{40}$/);
for(const [file,hash] of Object.entries(lock.files)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash,file);
console.log('Capability source provenance verified.');
