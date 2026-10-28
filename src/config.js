import path from 'node:path';
import { readJson, writeJson, stateDir } from './paths.js';

export const defaults = Object.freeze({ display: true, activity: true, interval: 55 });

export function validateConfig(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Invalid configuration.');
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown option: ${key}`);
  const config = { ...defaults, ...input };
  if (typeof config.display !== 'boolean' || typeof config.activity !== 'boolean') throw new Error('display and activity must be booleans.');
  if (!Number.isInteger(config.interval) || config.interval < 15 || config.interval > 3600) throw new Error('interval must be an integer between 15 and 3600 seconds.');
  return config;
}

export const configFile = home => path.join(stateDir(home), 'config.json');
export const loadConfig = home => validateConfig(readJson(configFile(home), {}));
export function saveConfig(home, config) { config = validateConfig(config); writeJson(configFile(home), config); return config; }

export function parseDuration(value) {
  if (value === undefined) return -1;
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error('Invalid duration. Examples: 30s, 15m, 1h, 1d.');
  const ms = Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  if (!Number.isSafeInteger(ms) || ms < 1000 || ms > 30 * 86400000) throw new Error('Duration must be between 1 second and 30 days.');
  return ms;
}
