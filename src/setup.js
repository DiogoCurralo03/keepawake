// Setup deliberately imports only Node builtins: the uninstaller must not load
// the installed Koffi DLL that it is about to remove.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopDaemon } from './client.js';
import { setStartup, restoreStartup, startupCommand } from './startup.js';
import { startDaemon } from './launcher.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const ps = value => "'" + value.replace(/'/g, "''") + "'";
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
export const defaultRoot = () => path.join(os.homedir(), '.keepawake');

function execute(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'inherit', ...options });
    let output = '', stderr = '';
    child.stdout?.on('data', data => { output += data; });
    child.stderr?.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(file)} exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
  });
}

export function parseSetupArgs(args) {
  const options = { root: defaultRoot(), path: true, startup: true, start: true, lid: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) options.root = path.resolve(args[++i]);
    else if (args[i] === '--no-path') options.path = false;
    else if (args[i] === '--no-startup') options.startup = false;
    else if (args[i] === '--no-start') options.start = false;
    else if (args[i] === '--no-lid') options.lid = false;
    else if (args[i] === '--help' || args[i] === '-h') options.help = true;
    else throw new Error(`Unknown or incomplete setup option: ${args[i]}`);
  }
  return options;
}

export function validateRoot(root) {
  root = path.resolve(root);
  if (same(root, path.parse(root).root) || same(root, os.homedir()) || same(root, source)) throw new Error('Refusing to use a system, home or source directory as the installation root');
  if (fs.existsSync(root)) {
    if (fs.lstatSync(root).isSymbolicLink() || !same(fs.realpathSync(root), root)) throw new Error('The installation root must be a real directory, not a link');
    const entries = fs.readdirSync(root);
    const marker = path.join(root, 'install.json');
    if (entries.length && !fs.existsSync(marker)) throw new Error('The target is not an empty directory or a KeepAwake installation');
    if (fs.existsSync(marker)) {
      const info = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (info.product !== 'keepawake' || info.schema !== 1 || !same(info.root, root)) throw new Error('Invalid keepawake installation marker');
    }
    for (const entry of ['node', 'bin', 'state']) {
      const item = path.join(root, entry);
      if (fs.existsSync(item) && fs.lstatSync(item).isSymbolicLink()) throw new Error(`Refusing linked installation folder: ${entry}`);
    }
  }
  return root;
}

function removeInside(root, target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing deletion outside the installation');
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function powershell(script, capture = false) {
  return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue'; " + script, 'utf16le').toString('base64')],
    capture ? { stdio: ['ignore', 'pipe', 'inherit'] } : {});
}

export function changePathValue(current, bin, add) {
  const parts = (current ? current.split(';') : []).filter(part => !part || !same(part.trim().replace(/^"(.*)"$/, '$1'), bin));
  if (add) parts.push(bin);
  return parts.join(';');
}

async function userPath(bin, add) {
  // Preserve both literal %VARIABLE% entries and the registry value kind.
  const stored = JSON.parse((await powershell(`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); $value=''; $kind='ExpandString';
    if ($key) { if ($key.GetValueNames() -contains 'Path') { $value=$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $kind=$key.GetValueKind('Path').ToString() }; $key.Dispose() };
    @{value=$value;kind=$kind} | ConvertTo-Json -Compress`, true)).trim());
  if (!['String', 'ExpandString'].includes(stored.kind)) throw new Error('The user PATH has an unsupported registry value type');
  const current = stored.value || '';
  const updated = changePathValue(current, bin, add);
  const present = current.split(';').some(part => part && same(part.trim().replace(/^"(.*)"$/, '$1'), bin));
  if (updated === current) return present;
  await powershell(`$ErrorActionPreference='Stop'; $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');
    try { $kind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],${ps(stored.kind)}); $key.SetValue('Path',${ps(updated)},$kind) } finally { $key.Dispose() };
    Add-Type -Namespace KeepAwake -Name EnvironmentBroadcast -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h,uint m,System.UIntPtr w,string l,uint f,uint t,out System.UIntPtr r);';
    $result=[UIntPtr]::Zero; [KeepAwake.EnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,3000,[ref]$result) | Out-Null`);
  return present;
}

async function stopService(root) {
  await stopDaemon(root);
}

function npmCli() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const found = candidates.find(file => file && fs.existsSync(file) && /npm-cli\.js$/i.test(file));
  if (!found) throw new Error('npm was not found next to Node.js. Install the official Node.js distribution including npm');
  return found;
}

export async function performSetup(mode, options) {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new Error('keepawake requires Windows x64 or ARM64');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
  const root = validateRoot(options.root);
  if (mode === 'uninstall' && !fs.existsSync(root)) { console.log('keepawake is not installed.'); return; }
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  if (!fs.existsSync(path.join(root, 'install.json')) && !fs.existsSync(path.join(root, 'bin', 'keepawake.cmd'))) {
    if (mode !== 'install') throw new Error('This directory is not an installed copy of keepawake');
    fs.writeFileSync(path.join(root, 'install.json'), JSON.stringify({ schema: 1, product: 'keepawake', root, path: false, status: 'incomplete' }));
  }
  const maintenanceFile = path.join(root, 'state', 'maintenance.json');
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(maintenanceFile, JSON.stringify({ pid: process.pid, token, operation: mode }));
  const bin = path.join(root, 'bin');
  const app = path.join(root, 'node');
  const stage = path.join(root, `.stage-${token}`);
  const backup = path.join(root, `.previous-${token}`);
  let swapped = false, pathAdded = false, pathRemoved = false, startupChanged = false, startupBefore;
  const originals = new Map(['package.json', 'install.json', 'uninstall.js', 'bin/keepawake.cmd', 'bin/keepawake.wsf', 'bin/uninstall-keepawake.cmd'].map(name => {
    const file = path.join(root, name);
    return [file, fs.existsSync(file) ? fs.readFileSync(file) : null];
  }));
  try {
    if (mode === 'install') {
      const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
      console.log(`Preparing keepawake ${pkg.version} for ${root}...`);
      fs.mkdirSync(stage);
      // A filter selects Node's JS copy path, avoiding older Node 22 native
      // copyDir bugs with Unicode Windows paths (nodejs/node#61950).
      for (const name of ['src', 'bin', 'scripts', 'recovered', 'AGENTS.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) fs.cpSync(path.join(source, name), path.join(stage, name), { recursive: true, filter: () => true });
      await execute(process.execPath, [npmCli(), 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
      await execute(process.execPath, [path.join(stage, 'scripts', 'probe.js')], { cwd: stage });
      await stopService(root);
      if (fs.existsSync(app)) fs.renameSync(app, backup);
      try { fs.renameSync(stage, app); swapped = true; }
      catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, app); throw error; }
      fs.mkdirSync(bin, { recursive: true });
      // Pin the exact Node runtime used by the installer; no PATH-based runtime lookup.
      fs.writeFileSync(path.join(bin, 'keepawake.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0..\\node\\bin\\keepawake.js" --home "%~dp0.." %*\r\n`, 'utf8');
      const command = `"${process.execPath}" "${path.join(app, 'bin', 'keepawake.js')}" run --home "${root}"`;
      fs.writeFileSync(path.join(bin, 'keepawake.wsf'), `<?xml version="1.0"?>\n<job id="KeepAwake"><script language="JScript"><![CDATA[\nvar shell = WScript.CreateObject("WScript.Shell");\nshell.Run(${JSON.stringify(command)}, 0, false);\n]]></script></job>\n`, 'utf8');
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
      fs.writeFileSync(path.join(root, 'uninstall.js'), `import {runSetup} from './node/src/setup.js'; await runSetup('uninstall',['--root',${JSON.stringify(root)},...process.argv.slice(2)]);\n`);
      // Leave the batch context before self-removal. Otherwise cmd.exe tries to
      // reopen the deleted file and replaces a successful Node exit with code 1.
      fs.writeFileSync(path.join(bin, 'uninstall-keepawake.cmd'), `@echo off\r\n(goto) 2>nul & "${process.execPath}" "%~dp0..\\uninstall.js" %*\r\n`, 'utf8');
      startupBefore = await setStartup(root, options.startup);
      startupChanged = true;
      if (options.path) pathAdded = !(await userPath(bin, true));
      else {
        const previous = originals.get(path.join(root, 'install.json'));
        if (previous && JSON.parse(previous).path) { await userPath(bin, false); pathRemoved = true; }
      }
      fs.writeFileSync(path.join(root, 'install.json'), JSON.stringify({ schema: 1, product: 'keepawake', version: pkg.version, root, path: options.path, startup: options.startup, node: process.execPath }, null, 2));
      if (fs.existsSync(backup)) {
        try { removeInside(root, backup); }
        catch (error) { console.warn(`The previous version could not be removed: ${error.message}`); }
      }
      console.log(`KeepAwake ${pkg.version} installed in ${root}.\nStart at sign-in: ${options.startup ? 'enabled (standard user)' : 'disabled'}.`);
      if (options.lid) {
        try { console.log((await execute(process.execPath, [path.join(app, 'scripts', 'power.js'), 'enable', root], { stdio: ['ignore', 'pipe', 'pipe'] })).trim()); }
        catch (error) { console.warn(`Installation completed, but lid-close protection is NOT configured: ${error.message}\nRun keepawake doctor --json to inspect the failure. Error 1260 identifies a policy restriction; error 5 identifies denied permission.`); }
      }
    } else if (mode === 'uninstall') {
      await stopService(root);
      const markerFile = path.join(root, 'install.json');
      const marker = fs.existsSync(markerFile) ? JSON.parse(fs.readFileSync(markerFile)) : { path: true };
      // Power helpers exit before deletion, so no native DLL is loaded here.
      if (fs.existsSync(path.join(root, 'state', 'power-policy.json'))) await execute(process.execPath, [path.join(app, 'scripts', 'power.js'), 'restore', root]);
      startupBefore = await setStartup(root, false);
      startupChanged = startupBefore?.value === startupCommand(root);
      if (options.path && marker.path) { await userPath(bin, false); pathRemoved = true; }
      // validateRoot verified ownership, the absolute target and absence of links.
      validateRoot(root);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
      console.log('keepawake stopped and uninstalled.');
    } else throw new Error('Unknown setup operation');
  } catch (error) {
    if (swapped) {
      removeInside(root, app);
      if (fs.existsSync(backup)) fs.renameSync(backup, app);
      for (const [file, previous] of originals) {
        if (previous === null) fs.rmSync(file, { force: true });
        else if (!fs.existsSync(file) || !fs.readFileSync(file).equals(previous)) fs.writeFileSync(file, previous);
      }
    }
    if (pathAdded) await userPath(bin, false);
    if (pathRemoved && fs.existsSync(root)) await userPath(bin, true);
    if (startupChanged) await restoreStartup(startupBefore, mode === 'install' && options.startup ? startupCommand(root) : null);
    throw error;
  } finally {
    if (fs.existsSync(stage)) removeInside(root, stage);
    try { if (JSON.parse(fs.readFileSync(maintenanceFile)).token === token) fs.unlinkSync(maintenanceFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function runSetup(mode, args) {
  const options = parseSetupArgs(args);
  if (options.help) { console.log(`node scripts/${mode}.js [--root <directory>] [--no-path] [--no-startup] [--no-start] [--no-lid]\nDefault: ${defaultRoot()}, per-user installation and startup.`); return; }
  const root = validateRoot(options.root);
  const key = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
  const entry = fileURLToPath(new URL('./setup-entry.js', import.meta.url));
  const command = [entry, mode, '--root', root, ...['path', 'startup', 'start', 'lid'].filter(key => !options[key]).map(key => `--no-${key}`)].map(ps).join(' ');
  // The OS mutex is held by PowerShell, not by an installed native addon. The
  // builtin-only Node child can remove its own JS files without locking a DLL.
  await powershell(`$ErrorActionPreference='Stop'; $locked=$false; $exitCode=1; $mutex=[Threading.Mutex]::new($false,${ps(`Global\\keepawake-setup-${key}`)});
    try { try { $locked=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }; if (!$locked) { throw 'Another keepawake setup is already running' }; & ${ps(process.execPath)} ${command}; $exitCode=$LASTEXITCODE }
    catch { [Console]::Error.WriteLine($_.Exception.Message) } finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }; exit $exitCode`);
  if (mode === 'install' && options.start) {
    try { const status = await startDaemon(root); console.log(`KeepAwake started as a standard user (PID ${status.pid}).`); }
    catch (error) { console.warn(`Installed. Open a terminal without administrator privileges and run keepawake start.\n${error.message}`); }
  }
}
