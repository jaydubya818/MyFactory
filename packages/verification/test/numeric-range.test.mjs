import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const corpus = JSON.parse(readFileSync(new URL('./corpus/quantity-safe-integer.json', import.meta.url)));
function withImplementation(source, check) {
  const directory = mkdtempSync(join(tmpdir(), 'range-corpus-'));
  try {
    mkdirSync(join(directory, 'test'));
    const files = {
      'quantity.mjs': source,
      'test/quantity.test.mjs': corpus.visibleTest,
      'test/output-contract.json': JSON.stringify(corpus.outputContract),
      'test/quantity-contract.json': JSON.stringify(corpus.publicContract),
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(join(directory, path), content);
    return check(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}
function publicChecks(directory) {
  // A child test runner must not inherit its parent's IPC/reporting context.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')));
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/quantity.test.mjs'], {
    cwd: directory, encoding: 'utf8', env, timeout: 15000,
  });
}

test('captured Attempt-8 implementation fails four public safe-range checks', () => {
  withImplementation(corpus.source, directory => {
    const result = publicChecks(directory);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /# fail 4/);
  });
});
test('deterministic control passes all 17 public checks without producing a live candidate', () => {
  withImplementation(corpus.positiveControl, directory => {
    const result = publicChecks(directory);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /# pass 17/);
  });
});
test('independent review regression rejects rounding/null and accepts the safe-range control', () => {
  const inputs = ['9007199254740992', '9007199254740993', '9'.repeat(309)];
  for (const [source, shouldPass] of [[corpus.source, false], [corpus.positiveControl, true]]) {
    withImplementation(source, directory => {
      for (const input of inputs) {
        const result = spawnSync(process.execPath, ['quantity.mjs'], {
          cwd: directory, input, encoding: 'utf8', timeout: 5000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout === '{"error":"invalid_quantity"}\n', shouldPass);
      }
    });
  }
});
