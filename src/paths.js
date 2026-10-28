import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const defaultRoot = () => path.join(os.homedir(), '.keepawake');
export const resolveHome = value => path.resolve(value || process.env.KEEPAWAKE_HOME || defaultRoot());
export const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
export const stateDir = home => path.join(home, 'state');
export const identity = home => crypto.createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex');

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function assertNotMaintaining(home) {
  const marker = readJson(path.join(stateDir(home), 'maintenance.json'));
  if (marker && processAlive(marker.pid)) throw new Error('Installation maintenance is in progress. Wait and try again.');
}
