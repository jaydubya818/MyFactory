import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLineEndings} from './normalize.mjs';
test('normalizes CRLF to LF',()=>assert.equal(normalizeLineEndings('one\r\ntwo'),'one\ntwo'));
test('preserves empty and LF text',()=>{assert.equal(normalizeLineEndings(''),'');assert.equal(normalizeLineEndings('one\ntwo'),'one\ntwo');});
test('rejects a non-string',()=>assert.throws(()=>normalizeLineEndings(42)));
