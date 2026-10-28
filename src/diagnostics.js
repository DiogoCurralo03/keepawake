import path from 'node:path';
import { readJson, stateDir } from './paths.js';
import { inspectLid } from './power-policy.js';

export const lidResultFile = home => path.join(stateDir(home), 'lid-result.json');

export function buildDiagnostics(home, status, native) {
  const lid = inspectLid(native);
  const warnings = [];
  if (!status) warnings.push('KeepAwake is not running.');
  else if (!status.active) warnings.push('KeepAwake is paused.');
  if (lid.error) warnings.push(lid.error.message);
  else if (!lid.configured) warnings.push('Lid-close protection is not verified: the configured plan is not Do Nothing on both power sources, or a managed lid policy overrides it.');
  if (lid.policyBlocked) warnings.push('Windows reports a Group Policy restriction (1260). This is different from access-denied error 5.');
  if (status?.config.activity && status.activity?.state === 'unavailable') warnings.push(status.activity.message);
  warnings.push('Activity events and power requests do not guarantee that Windows will never lock or suspend the session.');
  let lastLidConfiguration = null;
  try { lastLidConfiguration = readJson(lidResultFile(home)); }
  catch { warnings.push('The last lid configuration result could not be read.'); }
  return {
    system: { platform: process.platform, architecture: process.arch, node: process.version },
    application: status ? { running: true, version: status.version, active: status.active, elevated: status.elevated,
      config: status.config, power: status.power, idleSeconds: status.idleSeconds, pulses: status.pulses, activity: status.activity || null }
      : { running: false },
    lid, lastLidConfiguration, warnings
  };
}
