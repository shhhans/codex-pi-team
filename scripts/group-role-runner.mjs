// Own the RPC pipes for one persistent hidden role. In particular, keep the
// child's stdin open while idle; closing it ends the Pi session.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { processStartStamp } from '../.pi/runtime/process-observation.mjs';
import { killWindowsTree } from '../.pi/runtime/service-manager.mjs';

const descriptor = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = { ...process.env, ...descriptor.env };
const cli = join(env.PI_TEAM_PI_PACKAGE_ROOT || join(env.APPDATA || '', 'npm/node_modules/@earendil-works/pi-coding-agent'), 'dist/cli.js');
let command = process.execPath, args = [cli, '--mode', 'rpc', ...descriptor.args];
if (env.PI_CMD) {
  const payload = Buffer.from(JSON.stringify({ exe: env.PI_CMD, args: ['--mode', 'rpc', ...descriptor.args] })).toString('base64');
  const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;& $d.exe @($d.args);exit $LASTEXITCODE`;
  command = 'powershell.exe'; args = ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
} else if (!existsSync(cli)) throw Error(`Pi RPC CLI is unavailable: ${cli}`);

const child = spawn(command, args, { cwd: descriptor.cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
let childStamp = null;
let childExited = false;
let shuttingDown = null;
let requestedExit = null;

function stillOwnsChild() {
  if (!child.pid || childExited) return false;
  const current = processStartStamp(child.pid);
  return Boolean(childStamp && current && current === childStamp);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function stopOwnedChild() {
  if (!stillOwnsChild()) return;
  if (process.platform === 'win32') {
    killWindowsTree({ pid: child.pid, process_stamp: childStamp });
    return;
  }
  // POSIX uses a dedicated process group so a native wrapper and its descendants
  // are bounded to this launch. Verify the group leader immediately before each
  // signal; never signal a reused PID/group.
  if (!stillOwnsChild()) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && stillOwnsChild()) await delay(40);
  if (stillOwnsChild()) {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

function fail(reason, exitCode = 1) {
  requestedExit = exitCode;
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async () => {
    try { await stopOwnedChild(); }
    catch (error) {
      try { appendFileSync(`${descriptor.log}.stderr`, `RPC child cleanup failed after ${reason}: ${error.message}\n`); } catch {}
      process.exitCode = 1;
    }
    process.exitCode = requestedExit ?? exitCode;
  })();
  return shuttingDown;
}

function log(path, bytes) {
  try { appendFileSync(path, bytes); }
  catch (error) { void fail(`log append failed (${path}): ${error.message}`); }
}

child.once('spawn', () => { childStamp = processStartStamp(child.pid); });
child.stdout.on('data', bytes => log(descriptor.log, bytes));
child.stderr.on('data', bytes => log(`${descriptor.log}.stderr`, bytes));
child.once('error', error => {
  try { appendFileSync(`${descriptor.log}.stderr`, `${error.message}\n`); } catch {}
  void fail(`child spawn error: ${error.message}`);
});
child.once('exit', code => {
  childExited = true;
  if (shuttingDown) return;
  process.exitCode = code ?? 1;
});
child.stdin.on('error', error => {
  if (!childExited && error.code !== 'EPIPE') void fail(`child stdin failed: ${error.message}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { void fail(signal, signal === 'SIGINT' ? 130 : 143); });
}
process.on('uncaughtException', error => { void fail(`uncaught exception: ${error.stack || error}`); });
process.on('unhandledRejection', error => { void fail(`unhandled rejection: ${error?.stack || error}`); });

if (descriptor.prompt) child.stdin.write(`${JSON.stringify({ id: 'startup', type: 'prompt', message: descriptor.prompt })}\n`);
