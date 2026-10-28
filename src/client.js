import path from 'node:path';
import { readJson, stateDir, samePath, processAlive } from './paths.js';
import { setTimeout as delay } from 'node:timers/promises';

export const endpointFile = home => path.join(stateDir(home), 'endpoint.json');

export function readEndpoint(home) {
  const endpoint = readJson(endpointFile(home));
  if (!endpoint) return null;
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || !Number.isInteger(endpoint.pid) || endpoint.pid <= 0 || !/^[a-f0-9]{64}$/.test(endpoint.token) || typeof endpoint.instance !== 'string') throw new Error('Invalid endpoint.');
  return endpoint;
}

export async function request(home, route = 'status', body, { timeout = 3000, endpoint = readEndpoint(home) } = {}) {
  if (!endpoint) { const error = new Error('KeepAwake is not running. Run keepawake start.'); error.code = 'NOT_RUNNING'; throw error; }
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-keepawake-token': endpoint.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout)
  });
  const status = await response.json();
  if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
  if (status.pid !== endpoint.pid || status.instance !== endpoint.instance || !status.home || !samePath(status.home, home)) throw new Error('The process identity does not match the installation.');
  return status;
}

export async function getStatus(home) {
  const endpoint = readEndpoint(home);
  if (!endpoint || !processAlive(endpoint.pid)) return null;
  return request(home, 'status', undefined, { endpoint });
}

export async function stopDaemon(home) {
  const endpoint = readEndpoint(home);
  if (!endpoint || !processAlive(endpoint.pid)) return false;
  await request(home, 'status', undefined, { endpoint });
  await request(home, 'quit', {}, { endpoint, timeout: 5000 });
  const deadline = Date.now() + 15000;
  while (processAlive(endpoint.pid) && Date.now() < deadline) await delay(100);
  if (processAlive(endpoint.pid)) throw new Error('KeepAwake has not exited yet. Its files have been preserved.');
  return true;
}
