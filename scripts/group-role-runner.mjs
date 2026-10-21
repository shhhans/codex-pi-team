// Own RPC pipes for a persistent hidden role; closing stdin would end an idle Pi.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const descriptor = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = { ...process.env, ...descriptor.env };
const cli = join(env.PI_TEAM_PI_PACKAGE_ROOT || join(env.APPDATA || '', 'npm/node_modules/@earendil-works/pi-coding-agent'), 'dist/cli.js');
let command = process.execPath, args = [cli, '--mode', 'rpc', ...descriptor.args];
if (env.PI_CMD) {
  const payload = Buffer.from(JSON.stringify({ exe: env.PI_CMD, args: ['--mode', 'rpc', ...descriptor.args] })).toString('base64');
  const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;& $d.exe @($d.args);exit $LASTEXITCODE`;
  command = 'powershell.exe'; args = ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
} else if (!existsSync(cli)) throw Error(`Pi RPC CLI is unavailable: ${cli}`);
const child = spawn(command, args, { cwd: descriptor.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.on('data', bytes => appendFileSync(descriptor.log, bytes));
child.stderr.on('data', bytes => appendFileSync(`${descriptor.log}.stderr`, bytes));
child.once('error', error => { appendFileSync(`${descriptor.log}.stderr`, `${error.message}\n`); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
child.stdin.on('error', () => {});
if (descriptor.prompt) child.stdin.write(`${JSON.stringify({ id: 'startup', type: 'prompt', message: descriptor.prompt })}\n`);
