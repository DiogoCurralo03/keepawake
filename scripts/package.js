import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
const dist = path.join(source, 'dist');
fs.mkdirSync(dist, { recursive: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'keepawake-package-'));
const root = path.join(stage, `keepawake-${version}`);
const target = path.join(dist, `keepawake-${version}.zip`);
const ps = value => "'" + value.replaceAll("'", "''") + "'";
try {
  fs.mkdirSync(root);
  for (const name of ['src', 'bin', 'scripts', 'test', 'recovered', '.github', 'AGENTS.md', '.gitattributes', '.gitignore', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'install.cmd', 'uninstall.cmd']) fs.cpSync(path.join(source, name), path.join(root, name), { recursive: true, filter: () => true });
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Compress-Archive -LiteralPath ${ps(root)} -DestinationPath ${ps(target)} -Force`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${hash}  ${path.basename(target)}\n`);
  console.log(`Package: ${target}\nSHA-256: ${hash}`);
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid temporary directory.');
  fs.rmSync(stage, { recursive: true, force: true });
}
