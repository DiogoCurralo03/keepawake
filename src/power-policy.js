import path from 'node:path';
import fs from 'node:fs';
import { readJson, writeJson, stateDir, samePath } from './paths.js';

export const policyFile = home => path.join(stateDir(home), 'power-policy.json');

function load(home) {
  const ledger = readJson(policyFile(home), { schema: 1, product: 'keepawake', home, schemes: {} });
  if (ledger.schema !== 1 || ledger.product !== 'keepawake' || !samePath(ledger.home, home) || !ledger.schemes || typeof ledger.schemes !== 'object' || Array.isArray(ledger.schemes)) throw new Error('The power settings backup is invalid.');
  for (const [scheme, values] of Object.entries(ledger.schemes)) {
    if (!/^[0-9a-f-]{36}$/i.test(scheme) || !values || typeof values !== 'object' || Object.keys(values).some(mode => !['ac', 'dc'].includes(mode)) || Object.values(values).some(value => !Number.isInteger(value) || value < 0 || value > 3)) throw new Error('The lid settings backup contains invalid values.');
  }
  return ledger;
}

export function lidStatus(native) {
  const scheme = native.active();
  return { scheme, ac: native.read(scheme, 'ac'), dc: native.read(scheme, 'dc') };
}

export function enableLid(home, native) {
  const ledger = load(home), scheme = native.active();
  const previous = { ac: native.read(scheme, 'ac'), dc: native.read(scheme, 'dc') };
  if (!ledger.schemes[scheme]) ledger.schemes[scheme] = {};
  const saved = ledger.schemes[scheme];
  try {
    for (const mode of ['ac', 'dc']) {
      if (previous[mode] === 0) continue;
      // If the user changed a previously configured plan, remember that newer
      // choice before an explicit second enable, rather than an obsolete one.
      saved[mode] = previous[mode];
      writeJson(policyFile(home), ledger); // Durable backup before every write.
      native.write(scheme, mode, 0);
    }
    native.refresh(scheme);
  } catch (error) {
    // Restore this attempt, retaining the journal if any restoration fails.
    for (const mode of ['ac', 'dc']) {
      try { if (previous[mode] !== 0 && native.read(scheme, mode) === 0) native.write(scheme, mode, previous[mode]); } catch { /* recoverable from journal */ }
    }
    try { native.refresh(scheme); } catch { /* preserve original failure */ }
    throw error;
  }
  if (!Object.keys(saved).length) delete ledger.schemes[scheme];
  if (Object.keys(ledger.schemes).length) writeJson(policyFile(home), ledger);
  return lidStatus(native);
}

export function restoreLid(home, native) {
  const ledger = load(home), errors = [];
  for (const [scheme, saved] of Object.entries(ledger.schemes)) {
    const resolved = [];
    for (const [mode, before] of Object.entries(saved)) {
      try {
        // A later manual change belongs to the user and must survive uninstall.
        if (native.read(scheme, mode) === 0) native.write(scheme, mode, before);
        resolved.push(mode);
      } catch (error) {
        if (error.code === 2) resolved.push(mode);
        else errors.push(error);
      }
    }
    let refreshed = false;
    try { native.refresh(scheme); refreshed = true; }
    catch (error) { if (error.code === 2) refreshed = true; else errors.push(error); }
    if (refreshed) {
      for (const mode of resolved) delete saved[mode];
      writeJson(policyFile(home), ledger);
    }
    if (!Object.keys(saved).length) delete ledger.schemes[scheme];
  }
  if (Object.keys(ledger.schemes).length) writeJson(policyFile(home), ledger);
  else fs.rmSync(policyFile(home), { force: true });
  if (errors.length) throw new AggregateError(errors, `Could not restore all lid settings: ${errors[0].message}`);
}
