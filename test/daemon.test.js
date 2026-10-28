import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemon } from '../src/launcher.js';
import { getStatus, request, readEndpoint, endpointFile, stopDaemon } from '../src/client.js';
import { saveConfig } from '../src/config.js';
import { writeJson, processAlive } from '../src/paths.js';
import { isolated, cli } from './helpers.js';

test('daemon accepts authenticated control, persists configuration and exits cleanly', { timeout: 30000 }, async t => {
  const { home } = isolated(t);
  saveConfig(home, { activity: false });
  const started = await startDaemon(home, { tray: false });
  assert.equal(started.elevated, false); assert.equal(started.active, true); assert.equal(started.tray, false);
  const endpoint = readEndpoint(home), url = `http://127.0.0.1:${endpoint.port}/v1/status`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-keepawake-token': '0'.repeat(64) } })).status, 401);
  assert.equal((await fetch(url, { headers: { origin: 'https://example.com', 'x-keepawake-token': endpoint.token } })).status, 403);
  assert.equal((await request(home, 'pause', { duration: -1 })).active, false);
  assert.equal((await request(home, 'resume', {})).active, true);
  await request(home, 'config', { display: false });
  assert.equal((await getStatus(home)).config.display, false);
  await assert.rejects(request(home, 'config', { activity: 'wrong' }));
  assert.equal((await getStatus(home)).config.activity, false);
  await stopDaemon(home);
  assert.equal(processAlive(started.pid), false); assert.equal(fs.existsSync(endpointFile(home)), false);
  const restarted = await startDaemon(home, { tray: false });
  assert.notEqual(restarted.pid, started.pid); assert.equal(restarted.config.display, false);
  assert.equal(restarted.config.activity, false);
  const status = JSON.parse((await cli(home, ['status', '--json'])).stdout);
  assert.equal(status.pid, restarted.pid); assert.equal(status.running, true);
});

test('simultaneous starts converge on one process and survive an abrupt crash', { timeout: 45000 }, async t => {
  const { home } = isolated(t); saveConfig(home, { activity: false });
  const starts = await Promise.all(Array.from({ length: 4 }, () => startDaemon(home, { tray: false })));
  assert.equal(new Set(starts.map(status => status.pid)).size, 1);
  const first = starts[0];
  process.kill(first.pid, 'SIGKILL');
  const deadline = Date.now() + 5000;
  while (processAlive(first.pid) && Date.now() < deadline) await delay(50);
  assert.equal(processAlive(first.pid), false);
  const restarted = await startDaemon(home, { tray: false });
  assert.notEqual(restarted.pid, first.pid); assert.equal(restarted.active, true);
});

test('pause survives restart and timed pause resumes without input', { timeout: 30000 }, async t => {
  const { home } = isolated(t); saveConfig(home, { activity: false });
  await startDaemon(home, { tray: false }); await request(home, 'pause', { duration: -1 }); await stopDaemon(home);
  assert.equal((await startDaemon(home, { tray: false })).active, false);
  await request(home, 'pause', { duration: 1000 });
  const deadline = Date.now() + 8000;
  while (!(await getStatus(home)).active && Date.now() < deadline) await delay(100);
  assert.equal((await getStatus(home)).active, true); assert.equal((await getStatus(home)).pulses, 0);
});

test('live maintenance prevents a startup and stale maintenance does not', { timeout: 30000 }, async t => {
  const { home } = isolated(t); saveConfig(home, { activity: false });
  const marker = path.join(home, 'state', 'maintenance.json');
  writeJson(marker, { pid: process.pid }); await assert.rejects(startDaemon(home, { tray: false }), /Installation/);
  writeJson(marker, { pid: 0 }); assert.equal((await startDaemon(home, { tray: false })).active, true);
});
