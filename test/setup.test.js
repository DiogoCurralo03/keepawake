import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import koffi from 'koffi';
import { setTimeout as delay } from 'node:timers/promises';
import { validateRoot, parseSetupArgs, changePathValue } from '../src/setup.js';
import { readStartup } from '../src/startup.js';
import { saveConfig } from '../src/config.js';
import { startDaemon } from '../src/launcher.js';
import { stopDaemon, getStatus } from '../src/client.js';
import { writeJson, processAlive } from '../src/paths.js';
import { temporary, removeTemporary, node, cli, exec } from './helpers.js';

const flags = root => ['--root', root, '--no-path', '--no-startup', '--no-start', '--no-lid'];
const install = root => node(['scripts/install.js', ...flags(root)]);
const uninstall = root => node(['scripts/uninstall.js', ...flags(root)]);

test('setup refuses unrelated directories and links, and preserves unrelated PATH entries', () => {
  const dir = temporary();
  try {
    const foreign = path.join(dir, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'important.txt'), 'keep');
    for (const root of [foreign, os.homedir(), path.parse(dir).root]) assert.throws(() => validateRoot(root));
    const target = path.join(dir, 'empty'); fs.mkdirSync(target);
    const link = path.join(dir, 'linked'); fs.symlinkSync(target, link, 'junction'); assert.throws(() => validateRoot(link));
    const bin = 'C:\\KeepAwake\\bin', current = '%USERPROFILE%\\bin;D:\\Tools;;C:\\Other';
    const added = changePathValue(current, bin, true);
    assert.equal(changePathValue(added, bin, false), current);
    assert.equal(changePathValue(added, bin, true), added);
    assert.equal(parseSetupArgs(['--no-startup', '--no-lid']).startup, false);
    assert.throws(() => parseSetupArgs(['--root']));
    assert.equal(fs.readFileSync(path.join(foreign, 'important.txt'), 'utf8'), 'keep');
  } finally { removeTemporary(dir); }
});

test('install, locked-file rollback, update and self-uninstall preserve user state without elevation', { timeout: 120000 }, async () => {
  const dir = temporary(), home = path.join(dir, 'app'), startupBefore = await readStartup();
  try {
    await install(home);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'install.json'))).product, 'keepawake');
    saveConfig(home, { activity: false, display: false, interval: 70 });
    const first = await startDaemon(home, { tray: false }); assert.equal(first.elevated, false);
    assert.equal(JSON.parse((await cli(home, ['status', '--json'])).stdout).pid, first.pid);
    const marker = path.join(home, 'install.json'), markerBefore = fs.readFileSync(marker, 'utf8');
    const sentinel = path.join(home, 'node', 'rollback-sentinel'); fs.writeFileSync(sentinel, 'old app');
    const kernel = koffi.load('kernel32.dll');
    const open = kernel.func('void* __stdcall CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)');
    const close = kernel.func('int __stdcall CloseHandle(void*)');
    const handle = open(marker, 0x80000000, 1, null, 3, 0, null);
    assert.ok(handle && koffi.address(handle) !== BigInt.asUintN(64, -1n));
    try { await assert.rejects(install(home)); }
    finally { close(handle); }
    assert.equal(processAlive(first.pid), false);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old app');
    assert.equal(fs.readFileSync(marker, 'utf8'), markerBefore);
    assert.equal(fs.existsSync(path.join(home, 'state', 'maintenance.json')), false);
    await install(home);
    assert.equal(fs.existsSync(sentinel), false);
    const second = await startDaemon(home, { tray: false });
    assert.deepEqual(second.config, { display: false, activity: false, interval: 70 });
    // The actual installed batch wrapper must delete itself and return success.
    const wrapper = path.join(home, 'bin', 'uninstall-keepawake.cmd');
    await exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${wrapper}""`], { windowsHide: true, windowsVerbatimArguments: true, timeout: 30000 });
    assert.equal(processAlive(second.pid), false); assert.equal(fs.existsSync(home), false);
    assert.deepEqual(await readStartup(), startupBefore);
  } finally { await stopDaemon(home); removeTemporary(dir); }
});

test('an unresponsive live endpoint prevents uninstall from deleting the installation', { timeout: 60000 }, async () => {
  const dir = temporary(), home = path.join(dir, 'app');
  try {
    await install(home);
    writeJson(path.join(home, 'state', 'endpoint.json'), { pid: process.pid, port: 1, instance: 'unresponsive', token: '0'.repeat(64) });
    await assert.rejects(uninstall(home));
    assert.equal(fs.existsSync(path.join(home, 'node', 'bin', 'keepawake.js')), true);
    assert.equal(fs.existsSync(path.join(home, 'install.json')), true);
    fs.rmSync(path.join(home, 'state', 'endpoint.json'));
    await uninstall(home); assert.equal(fs.existsSync(home), false);
  } finally { removeTemporary(dir); }
});

test('the hidden WSH startup launcher starts a standard-user process and one tray', { skip: process.env.KEEPAWAKE_TRAY_TEST !== '1', timeout: 60000 }, async () => {
  const dir = temporary(), home = path.join(dir, 'app'), startupBefore = await readStartup();
  try {
    await install(home); saveConfig(home, { activity: false });
    const wscript = path.join(process.env.SystemRoot, 'System32', 'wscript.exe');
    await exec(wscript, ['//B', '//Nologo', path.join(home, 'bin', 'keepawake.wsf')], { windowsHide: true });
    let status;
    const deadline = Date.now() + 12000;
    while (!(status = await getStatus(home)) && Date.now() < deadline) await delay(100);
    assert.ok(status); assert.equal(status.elevated, false); assert.equal(status.tray, true);
    await exec(wscript, ['//B', '//Nologo', path.join(home, 'bin', 'keepawake.wsf')], { windowsHide: true });
    await delay(300); assert.equal((await getStatus(home)).pid, status.pid);
    await uninstall(home); assert.equal(processAlive(status.pid), false);
    assert.deepEqual(await readStartup(), startupBefore);
  } finally { await stopDaemon(home); removeTemporary(dir); }
});
