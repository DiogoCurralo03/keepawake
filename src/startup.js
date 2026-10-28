import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJson, samePath, writeJson } from './paths.js';

const exec = promisify(execFile);
const ps = value => "'" + value.replaceAll("'", "''") + "'";
const keyPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const valueName = 'KeepAwake.Node';
export const startupCommand = home => `"${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')}" //B //Nologo "${path.join(home, 'bin', 'keepawake.wsf')}"`;

async function powershell(script) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ${script}`, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
  return stdout.trim();
}

export async function readStartup() {
  const output = await powershell(`$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${ps(keyPath)}); $item=$null;
    if($key) { try { if($key.GetValueNames() -contains ${ps(valueName)}) { $item=@{value=$key.GetValue(${ps(valueName)},'',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$key.GetValueKind(${ps(valueName)}).ToString()} } } finally {$key.Dispose()} }; ConvertTo-Json -InputObject $item -Compress`);
  return output ? JSON.parse(output) : null;
}

async function writeStartup(item) {
  await powershell(`$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${ps(keyPath)});
    try { ${item ? `$key.SetValue(${ps(valueName)},${ps(item.value)},[Enum]::Parse([Microsoft.Win32.RegistryValueKind],${ps(item.kind)}))` : `$key.DeleteValue(${ps(valueName)},$false)`} } finally {$key.Dispose()}`);
}

export async function setStartup(home, enabled) {
  const current = await readStartup(), command = startupCommand(home);
  if (enabled) {
    if (!fs.existsSync(path.join(home, 'bin', 'keepawake.wsf'))) throw new Error('Install KeepAwake before enabling startup.');
    if (current && current.value !== command) throw new Error('Another installation already uses KeepAwake startup. Disable it first.');
    if (current?.value !== command) await writeStartup({ value: command, kind: 'String' });
  } else if (current?.value === command) await writeStartup(null);
  return current;
}

export async function restoreStartup(previous, expected) {
  const current = await readStartup();
  if ((current?.value ?? null) === expected) await writeStartup(previous);
}

export async function configureStartup(home, enabled) {
  const file = path.join(home, 'install.json'), marker = readJson(file);
  if (marker?.product !== 'keepawake' || marker.schema !== 1 || !samePath(marker.root, home)) throw new Error('Startup requires a valid installation.');
  const previous = await setStartup(home, enabled);
  try { writeJson(file, { ...marker, startup: enabled }); }
  catch (error) { await restoreStartup(previous, enabled ? startupCommand(home) : null); throw error; }
}
