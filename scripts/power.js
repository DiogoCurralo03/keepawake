import { resolveHome, identity } from '../src/paths.js';
import { acquireLock } from '../src/windows.js';
import { createPowerPolicyNative } from '../src/power-native.js';
import { enableLid, restoreLid, lidStatus } from '../src/power-policy.js';

let release;
try {
  const [command, homeArg] = process.argv.slice(2), home = resolveHome(homeArg);
  const native = createPowerPolicyNative();
  release = acquireLock(`Global\\keepawake-power-${identity(home)}`);
  if (command === 'enable') console.log(JSON.stringify(enableLid(home, native)));
  else if (command === 'restore') { restoreLid(home, native); console.log('Lid settings restored.'); }
  else if (command === 'status') console.log(JSON.stringify(lidStatus(native)));
  else throw new Error('Invalid power command.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { release?.(); }
