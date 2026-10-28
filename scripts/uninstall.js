import { runSetup } from '../src/setup.js';

try { await runSetup('uninstall', process.argv.slice(2)); }
catch (error) { console.error(`keepawake uninstall: ${error.message}`); process.exitCode = 1; }
