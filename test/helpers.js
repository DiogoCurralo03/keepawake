import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stopDaemon } from '../src/client.js';

export const project = fileURLToPath(new URL('../', import.meta.url));
export const exec = promisify(execFile);
export const node = (args, options = {}) => exec(process.execPath, args, { cwd: project, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, ...options });
export const cli = (home, args) => node(['bin/keepawake.js', '--home', home, ...args]);
export function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "keepawake test ' \u00e7 ")); }
export function removeTemporary(dir) {
  if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(dir).startsWith('keepawake test ')) throw new Error('Invalid test cleanup directory');
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
export function isolated(t) {
  const dir = temporary(), home = path.join(dir, 'app');
  t.after(async () => { await stopDaemon(home); removeTemporary(dir); });
  return { dir, home };
}
