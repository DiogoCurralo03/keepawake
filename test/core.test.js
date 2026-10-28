import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';
import { validateConfig, parseDuration, saveConfig, loadConfig } from '../src/config.js';
import { WindowsAwake, isWindowsElevated } from '../src/windows.js';
import { KeepAwakeDaemon } from '../src/daemon.js';
import { createAuditLog } from '../src/log.js';
import { writeJson, readJson } from '../src/paths.js';
import { temporary, removeTemporary } from './helpers.js';

test('configuration rejects invalid, unknown and inherited option names', () => {
  for (const input of [null, [], { activity: 1 }, { display: 'yes' }, { interval: 0 }, { interval: 14 }, { interval: 3601 }, { interval: 55.5 }, { unknown: true }, { toString: true }, JSON.parse('{"__proto__":{}}')]) assert.throws(() => validateConfig(input));
  assert.deepEqual(validateConfig({}), { display: true, activity: true, interval: 55 });
  assert.deepEqual(validateConfig({ activity: false, interval: 15 }), { display: true, activity: false, interval: 15 });
  assert.equal(parseDuration('15m'), 900000);
  assert.equal(parseDuration('1h'), 3600000);
  assert.equal(parseDuration(undefined), -1);
  for (const value of ['0s', '31d', '1', '-1m', '1.5h', '1h extra', '999999999999999999d']) assert.throws(() => parseDuration(value));
});

test('configuration is stored atomically in a path containing spaces, apostrophe and Unicode', () => {
  const home = temporary();
  try {
    saveConfig(home, { display: false, activity: false, interval: 100 });
    assert.deepEqual(loadConfig(home), { display: false, activity: false, interval: 100 });
    assert.equal(fs.readdirSync(path.join(home, 'state')).some(name => name.endsWith('.tmp')), false);
    const file = path.join(home, 'state', 'sample.json');
    writeJson(file, { text: 'Hello \u{1f30d}' });
    assert.deepEqual(readJson(file), { text: 'Hello \u{1f30d}' });
  } finally { removeTemporary(home); }
});

test('native power flags are set and released on the same thread', () => {
  const awake = new WindowsAwake();
  const execution = koffi.load('kernel32.dll').func('uint32 __stdcall SetThreadExecutionState(uint32)');
  try {
    awake.set(true, true);
    assert.equal(execution(0x80000000) >>> 0, 0x80000003);
    awake.set(true, false);
    assert.equal(execution(0x80000000) >>> 0, 0x80000001);
    awake.set(false);
    assert.equal(execution(0x80000000) >>> 0, 0x80000000);
    const power = awake.powerStatus();
    assert.ok(['ac', 'battery', 'unknown'].includes(power.source));
    assert.ok(power.battery === null || (power.battery >= 0 && power.battery <= 100));
    assert.ok(awake.idleSeconds() === null || awake.idleSeconds() >= 0);
    assert.equal(typeof awake.interactive(), 'boolean');
    assert.equal(typeof isWindowsElevated(), 'boolean');
  } finally { awake.close(); }
});

test('activity waits for idle, follows configuration and stops during pauses', () => {
  const home = temporary(), calls = [], awake = {
    idle: 54, powerStatus: () => ({ source: 'battery', battery: 20 }),
    set: (...args) => calls.push(args), idleSeconds() { return this.idle; }, pulse: () => { calls.push('pulse'); return true; }
  };
  try {
    const daemon = new KeepAwakeDaemon(home, { tray: false, awake });
    daemon.config = validateConfig({});
    daemon.tick(); assert.equal(daemon.pulses, 0);
    awake.idle = 56; daemon.tick(); assert.equal(daemon.pulses, 1);
    daemon.tick(); assert.equal(daemon.pulses, 1, 'polls must not flood synthetic input');
    daemon.pause(); assert.equal(daemon.active, false); assert.deepEqual(calls.at(-1), [false, true]);
    daemon.lastPulse = 0; daemon.tick(); assert.equal(daemon.pulses, 1);
    daemon.resume(); assert.equal(daemon.active, true); assert.equal(daemon.pulses, 2);
    daemon.configure({ activity: false, display: false }); daemon.lastPulse = 0; daemon.tick();
    assert.equal(daemon.pulses, 2); assert.deepEqual(calls.at(-1), [true, false]);
    daemon.pause(1000); daemon.pausedUntil = Date.now() - 1; daemon.tick(); assert.equal(daemon.active, true);
    assert.equal(readJson(path.join(home, 'state', 'runtime.json')).pausedUntil, null);
  } finally { removeTemporary(home); }
});

test('logs rotate without losing valid JSON records', () => {
  const home = temporary();
  try {
    const log = createAuditLog(home, { maxBytes: 200 });
    for (let i = 0; i < 10; i++) log.info('test', { i });
    for (const name of ['keepawake.log', 'keepawake.log.1']) {
      const lines = fs.readFileSync(path.join(home, name), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(lines.length > 0); assert.ok(lines.every(record => record.event === 'test'));
      assert.ok(fs.statSync(path.join(home, name)).size <= 200);
    }
  } finally { removeTemporary(home); }
});

test('an active runtime reports an unconfigured lid and unavailable activity separately', () => {
  const home = temporary();
  const awake = { set() {}, powerStatus: () => ({ source: 'ac', battery: 100 }), idleSeconds: () => 60, pulse: () => false };
  try {
    const daemon = new KeepAwakeDaemon(home, { awake, tray: false, lidReader: () => ({ configured: false, policyBlocked: true, ac: 1, dc: 1 }) });
    daemon.config = validateConfig({}); daemon.tick();
    const status = daemon.getStatus();
    assert.equal(status.active, true); assert.equal(status.lid.configured, false);
    assert.equal(status.activity.state, 'unavailable'); assert.equal(status.pulses, 0);
    assert.match(status.activity.message, /input desktop/);
  } finally { removeTemporary(home); }
});
