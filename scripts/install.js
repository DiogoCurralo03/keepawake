import { runSetup } from '../src/setup.js';

try { await runSetup('install', process.argv.slice(2)); }
catch (error) { console.error(`keepawake install: ${error.message}`); process.exitCode = 1; }
