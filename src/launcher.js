import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getStatus } from './client.js';
import { stateDir, assertNotMaintaining } from './paths.js';

export async function startDaemon(home, { tray = true } = {}) {
  assertNotMaintaining(home);
  try { const running = await getStatus(home); if (running) return running; }
  catch { /* A stale endpoint is replaced only after acquiring the OS mutex. */ }
  const installed = path.join(home, 'node', 'bin', 'keepawake.js');
  const entry = fs.existsSync(installed) ? installed : fileURLToPath(new URL('../bin/keepawake.js', import.meta.url));
  fs.mkdirSync(stateDir(home), { recursive: true });
  const log = path.join(stateDir(home), 'startup.log');
  const fd = fs.openSync(log, 'w');
  let child;
  try { child = spawn(process.execPath, [entry, 'run', '--home', home, ...(tray ? [] : ['--no-tray'])], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  let launchError;
  child.once('error', error => { launchError = error; });
  child.unref();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    try { const status = await getStatus(home); if (status) return status; }
    catch (error) { if (child.exitCode !== null && child.exitCode !== 0) throw error; }
    if (child.exitCode !== null && child.exitCode !== 0) break;
    await delay(100);
  }
  if (child.exitCode === null && !launchError) {
    child.kill(); // Only the child created by this start attempt.
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  }
  const detail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-2000).trim() : '';
  throw new Error(detail || 'KeepAwake could not start. See state/startup.log.');
}
