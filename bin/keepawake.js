#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveHome, stateDir, assertNotMaintaining } from '../src/paths.js';
import { getStatus, request, stopDaemon } from '../src/client.js';
import { loadConfig, saveConfig, parseDuration } from '../src/config.js';
import { startDaemon } from '../src/launcher.js';
import { readStartup, configureStartup, startupCommand } from '../src/startup.js';

const help = `KeepAwake — Windows x64 / ARM64, Node.js 22+

  keepawake start                 Start in the background without a window
  keepawake status [--json]        Show current status
  keepawake pause [15m|1h|...]      Pause; omit duration to wait for resume
  keepawake resume                Resume activity
  keepawake stop                  Exit and release power requests
  keepawake config                Show configuration
  keepawake config display on|off  Keep the display on
  keepawake config activity on|off Simulate activity without moving the cursor
  keepawake config interval 55    Minimum activity interval, in seconds
  keepawake startup on|off|status  Configure startup at Windows sign-in
  keepawake lid on|off|status      Configure or restore the lid close action
  keepawake doctor [--json]       Diagnose lid settings, policies, and activity
  keepawake logs                  Show the log file path
  keepawake uninstall             Uninstall and restore saved lid settings

  --home <directory>  Use an alternative installation/settings directory
  --no-tray           Start without a tray icon (optional for start/run)
  --json              Output structured JSON
  --version           Show the version
  --backend powercfg|native  Configuration method for lid/doctor (default: powercfg)

The application runs as a standard user. Only lid configuration may require
administrator privileges, depending on Windows permissions and policies.`;

async function main() {
  let homeArg, json = false, tray = true, backend = 'powercfg', backendExplicit = false;
  const args = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--home') { if (!process.argv[i + 1]) throw new Error('Missing value for --home.'); homeArg = process.argv[++i]; }
    else if (arg === '--json') json = true;
    else if (arg === '--no-tray') tray = false;
    else if (arg === '--backend') {
      backend = process.argv[++i]; backendExplicit = true;
      if (!['powercfg', 'native'].includes(backend)) throw new Error('Use --backend powercfg or --backend native.');
    }
    else if (arg === '--help' || arg === '-h') { console.log(help); return; }
    else if (arg === '--version' || arg === '-v') { console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version); return; }
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else args.push(arg);
  }
  const home = resolveHome(homeArg), [command = 'status', ...rest] = args;
  if (backendExplicit && !['lid', 'doctor'].includes(command)) throw new Error('--backend is only supported by lid and doctor.');
  const printStatus = status => {
    if (json) return console.log(JSON.stringify(status ? { running: true, ...status } : { running: false, home }, null, 2));
    if (!status) return console.log('KeepAwake is not running.');
    const lid = status.lid;
    const lidSummary = !lid ? 'not checked' : lid.configured ? 'Do Nothing on AC and battery'
      : lid.error ? lid.error.message : `${lid.actions?.ac || 'unknown'} on AC, ${lid.actions?.dc || 'unknown'} on battery${lid.policyBlocked ? ' (policy restricted)' : ''}; protection not verified`;
    console.log(`KeepAwake ${status.active ? 'active' : 'paused'} · PID ${status.pid} · standard user\nDisplay request: ${status.config.display ? 'on' : 'Windows default'} · activity: ${status.config.activity ? `after ${status.config.interval}s of inactivity` : 'disabled'}\nPower: ${status.power.source === 'ac' ? 'AC power' : status.power.source === 'battery' ? `battery (${status.power.battery ?? '?'}%)` : 'unknown'}\nLid: ${lidSummary}\n${home}`);
  };
  if (command === 'run') {
    if (rest.length) throw new Error('run does not accept additional arguments.');
    const { KeepAwakeDaemon } = await import('../src/daemon.js');
    const daemon = new KeepAwakeDaemon(home, { tray });
    const shutdown = () => { void daemon.stop().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); process.once('SIGHUP', shutdown);
    process.on('uncaughtException', error => { console.error(error.message); daemon.fail(error); });
    process.on('unhandledRejection', error => { console.error(error?.message || error); daemon.fail(error instanceof Error ? error : new Error(String(error))); });
    process.once('exit', () => { try { daemon.awake?.close(); } catch { /* OS releases thread requests on exit */ } });
    try { await daemon.start(); }
    catch (error) { if (error.code !== 'ALREADY_RUNNING') throw error; }
    return;
  }
  if (command === 'start' || command === 'status' || command === 'stop' || command === 'resume' || command === 'logs') {
    if (rest.length) throw new Error(`${command} does not accept additional arguments.`);
    if (command === 'start') printStatus(await startDaemon(home, { tray }));
    else if (command === 'status') printStatus(await getStatus(home));
    else if (command === 'stop') { await stopDaemon(home); printStatus(null); }
    else if (command === 'resume') printStatus(await request(home, 'resume', {}));
    else console.log(path.join(stateDir(home), 'keepawake.log'));
  } else if (command === 'pause') {
    if (rest.length > 1) throw new Error('pause accepts only one duration.');
    printStatus(await request(home, 'pause', { duration: parseDuration(rest[0]) }));
  } else if (command === 'config') {
    if (rest.length === 0) { console.log(JSON.stringify((await getStatus(home))?.config || loadConfig(home), null, 2)); return; }
    if (rest.length !== 2 || !['display', 'activity', 'interval'].includes(rest[0])) throw new Error('Use config display|activity on|off or config interval <seconds>.');
    const [key, raw] = rest;
    let value;
    if (key === 'interval' && /^\d+$/.test(raw)) value = Number(raw);
    else if (key !== 'interval' && ['on', 'off'].includes(raw)) value = raw === 'on';
    else throw new Error('Invalid configuration value.');
    assertNotMaintaining(home);
    if (await getStatus(home)) printStatus(await request(home, 'config', { [key]: value }));
    else console.log(JSON.stringify(saveConfig(home, { ...loadConfig(home), [key]: value }), null, 2));
  } else if (command === 'startup') {
    if (rest.length > 1 || !['on', 'off', 'status'].includes(rest[0] || 'status')) throw new Error('Use startup on|off|status.');
    if (rest[0] && rest[0] !== 'status') { assertNotMaintaining(home); await configureStartup(home, rest[0] === 'on'); }
    const enabled = (await readStartup())?.value === startupCommand(home);
    console.log(json ? JSON.stringify({ enabled }) : `Start at sign-in: ${enabled ? 'enabled' : 'disabled'}.`);
  } else if (command === 'lid') {
    if (rest.length > 1 || !['on', 'off', 'status'].includes(rest[0] || 'status')) throw new Error('Use lid on|off|status.');
    assertNotMaintaining(home);
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/power.js', import.meta.url)), { on: 'enable', off: 'restore', status: 'status' }[rest[0] || 'status'], home, backend], { windowsHide: true });
    console.log(stdout.trim());
    if (rest[0] === 'on' || rest[0] === 'off') {
      try { if (await getStatus(home)) await request(home, 'refresh-power', {}); } catch { /* Configuration result remains available to doctor. */ }
    }
  } else if (command === 'doctor') {
    if (rest.length) throw new Error('doctor does not accept additional arguments.');
    const { createPowerPolicyNative } = await import('../src/power-native.js');
    const { buildDiagnostics } = await import('../src/diagnostics.js');
    let status = null, connectionError = null;
    try { status = await getStatus(home); } catch (error) { connectionError = error.message; }
    const diagnostics = buildDiagnostics(home, status, createPowerPolicyNative({ backend }));
    if (connectionError) diagnostics.warnings.unshift(`Runtime status unavailable: ${connectionError}`);
    if (json) console.log(JSON.stringify(diagnostics, null, 2));
    else {
      console.log(`KeepAwake diagnostics\nRuntime: ${status ? (status.active ? 'active' : 'paused') : 'not running'}\nLid plan: AC ${diagnostics.lid.actions?.ac || 'unknown'}, battery ${diagnostics.lid.actions?.dc || 'unknown'}\nLid protection verified: ${diagnostics.lid.configured ? 'yes' : 'no'}\nConfiguration backend: ${backend}`);
      for (const warning of diagnostics.warnings) console.log(`Warning: ${warning}`);
      console.log('Use keepawake doctor --json for the complete diagnostic report.');
    }
  } else if (command === 'uninstall') {
    if (rest.length) throw new Error('uninstall does not accept additional arguments.');
    const { runSetup } = await import('../src/setup.js');
    await runSetup('uninstall', ['--root', home]);
  } else if (command === 'help') console.log(help);
  else throw new Error(`Unknown command: ${command}. Use --help.`);
}

try { await main(); }
catch (error) { console.error(`KeepAwake: ${error.stderr?.trim() || error.message}`); process.exitCode = 1; }
