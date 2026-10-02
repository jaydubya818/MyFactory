import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSlug} from './slug.mjs';

test('trims and lowercases a project name',()=>assert.equal(projectSlug('  New Project  '),'new-project'));
test('collapses whitespace and preserves existing hyphens',()=>assert.equal(projectSlug('My  New-Project'),'my-new-project'));
test('rejects punctuation and non-string values',()=>{
  for(const value of ['hello/world','hello!','', '   ',null,42])assert.throws(()=>projectSlug(value),/Invalid project name/);
});
