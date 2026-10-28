import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { enableLid, restoreLid, policyFile, lidStatus } from '../src/power-policy.js';
import { readJson } from '../src/paths.js';
import { createPowerPolicyNative } from '../src/power-native.js';
import { temporary, removeTemporary } from './helpers.js';

const scheme = '381b4222-f694-41f0-9685-ff5bb260df2e';
function fake(home, initial = { ac: 1, dc: 2 }) {
  return {
    values: { ...initial }, writes: [], failure: null, refresh() {}, active: () => scheme,
    read(_scheme, mode) { return this.values[mode]; },
    write(_scheme, mode, value) {
      if (value === 0 && this.values[mode] !== 0) assert.equal(readJson(policyFile(home)).schemes[scheme][mode], this.values[mode], 'backup must precede mutation');
      if (this.failure?.(mode, value)) throw new Error('Simulated policy failure');
      this.values[mode] = value; this.writes.push({ mode, value });
    }
  };
}

test('lid configuration is journaled, idempotent and restores exact previous values', () => {
  const home = temporary(), native = fake(home);
  try {
    assert.deepEqual(enableLid(home, native), { scheme, ac: 0, dc: 0 });
    enableLid(home, native); assert.equal(native.writes.length, 2);
    restoreLid(home, native); assert.deepEqual(native.values, { ac: 1, dc: 2 });
    assert.equal(fs.existsSync(policyFile(home)), false);
    restoreLid(home, native); assert.equal(native.writes.length, 4);
  } finally { removeTemporary(home); }
});

test('uninstall preserves later user changes and never fabricates default values', () => {
  const home = temporary(), native = fake(home, { ac: 0, dc: 1 });
  try {
    enableLid(home, native); native.values.dc = 3;
    restoreLid(home, native); assert.deepEqual(native.values, { ac: 0, dc: 3 });
    assert.deepEqual(native.writes, [{ mode: 'dc', value: 0 }]);
  } finally { removeTemporary(home); }
});

test('a failed second write rolls back the first and keeps a recoverable journal', () => {
  const home = temporary(), native = fake(home);
  try {
    native.failure = (mode, value) => mode === 'dc' && value === 0;
    assert.throws(() => enableLid(home, native), /Simulated/);
    assert.deepEqual(native.values, { ac: 1, dc: 2 });
    assert.ok(fs.existsSync(policyFile(home)));
    native.failure = null; restoreLid(home, native);
    assert.equal(fs.existsSync(policyFile(home)), false);
  } finally { removeTemporary(home); }
});

test('failed restoration keeps the remaining backup for retry', () => {
  const home = temporary(), native = fake(home);
  try {
    enableLid(home, native); native.failure = mode => mode === 'dc';
    assert.throws(() => restoreLid(home, native));
    assert.deepEqual(native.values, { ac: 1, dc: 0 });
    assert.deepEqual(readJson(policyFile(home)).schemes[scheme], { dc: 2 });
    native.failure = null; restoreLid(home, native);
    assert.deepEqual(native.values, { ac: 1, dc: 2 });
  } finally { removeTemporary(home); }
});

test('native power-policy probe only reads the real machine', () => {
  const status = lidStatus(createPowerPolicyNative());
  assert.match(status.scheme, /^[a-f0-9-]{36}$/);
  assert.ok(status.ac >= 0 && status.ac <= 3); assert.ok(status.dc >= 0 && status.dc <= 3);
});
