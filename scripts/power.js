import { resolveHome, identity, writeJson } from '../src/paths.js';
import { acquireLock } from '../src/windows.js';
import { createPowerPolicyNative } from '../src/power-native.js';
import { enableLid, restoreLid, inspectLid } from '../src/power-policy.js';
import { powerError, powerErrorDetails } from '../src/power-error.js';
import { lidResultFile } from '../src/diagnostics.js';

let release;
const [command, homeArg, backend = 'powercfg'] = process.argv.slice(2), home = resolveHome(homeArg);
try {
  const native = createPowerPolicyNative({ backend });
  release = acquireLock(`Global\\keepawake-power-${identity(home)}`);
  if (command === 'enable') {
    enableLid(home, native);
    const status = inspectLid(native);
    if (status.error) throw Object.assign(new Error(status.error.message), status.error);
    if (!status.configured) throw powerError(status.access.ac || status.access.dc || 1260, 'Verify lid policy restrictions', backend);
    writeJson(lidResultFile(home), { ok: true, action: command, backend, checkedAt: new Date().toISOString(), status });
    console.log(JSON.stringify(status));
  } else if (command === 'restore') {
    restoreLid(home, native);
    writeJson(lidResultFile(home), { ok: true, action: command, backend, checkedAt: new Date().toISOString() });
    console.log('Lid settings restored.');
  } else if (command === 'status') console.log(JSON.stringify(inspectLid(native)));
  else throw new Error('Invalid power command.');
} catch (error) {
  if (['enable', 'restore'].includes(command)) {
    try { writeJson(lidResultFile(home), { ok: false, action: command, backend, checkedAt: new Date().toISOString(), error: powerErrorDetails(error) }); }
    catch { /* Preserve the power failure if diagnostic persistence fails. */ }
  }
  console.error(error.message); process.exitCode = 1;
}
finally { release?.(); }
