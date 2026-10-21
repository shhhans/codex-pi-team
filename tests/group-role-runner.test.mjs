import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { processStartStamp } from '../.pi/runtime/process-observation.mjs';

const runner = join(process.cwd(), 'scripts/group-role-runner.mjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return true; await pause(25); }
  return Boolean(predicate());
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function stopTree(pid) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    catch (error) { if (alive(pid)) throw error; }
  }
  else { try { process.kill(-pid, 'SIGKILL'); } catch {} }
}
function fixture(logPath = null) {
  const root = mkdtempSync(join(tmpdir(), 'pi-role-runner-'));
  const packageRoot = join(root, 'fake-package'), dist = join(packageRoot, 'dist');
  mkdirSync(dist, { recursive: true });
  const pidFile = join(root, 'child.pid'), readyFile = join(root, 'ready.json');
  writeFileSync(join(dist, 'cli.js'), `const fs=require('node:fs');
fs.writeFileSync(process.env.PI_TEST_PID_FILE,String(process.pid));
process.stdout.write('ready\\n');
process.stdin.on('data',b=>fs.writeFileSync(process.env.PI_TEST_INPUT_FILE,b.toString()));
process.stdin.on('end',()=>process.exit(23));
setInterval(()=>{},1000);
`);
  const descriptor = join(root, 'runner.json');
  writeFileSync(descriptor, JSON.stringify({ cwd: root, env: { PI_TEAM_PI_PACKAGE_ROOT: packageRoot, PI_TEST_PID_FILE: pidFile, PI_TEST_INPUT_FILE: readyFile }, args: [], log: logPath || join(root, 'rpc.log') }));
  return { root, pidFile, readyFile, descriptor, cleanup() { try { if (existsSync(pidFile)) stopTree(Number(readFileSync(pidFile, 'utf8'))); } catch {} rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } };
}

test('RPC child stays alive with stdin open while idle and receives the startup frame', async () => {
  const f = fixture();
  try {
    const descriptor = JSON.parse(readFileSync(f.descriptor, 'utf8'));
    descriptor.prompt = 'startup prompt'; writeFileSync(f.descriptor, JSON.stringify(descriptor));
    const runnerProcess = spawn(process.execPath, [runner, f.descriptor], { cwd: process.cwd(), windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32' });
    try {
      assert.equal(await until(() => existsSync(f.pidFile)), true, 'fake CLI started');
      assert.equal(await until(() => existsSync(f.readyFile)), true, 'startup prompt reached open stdin');
      const pid = Number(readFileSync(f.pidFile, 'utf8'));
      assert.ok(processStartStamp(pid), 'child identity can be observed');
      await pause(250);
      assert.equal(alive(pid), true, 'idle child remains alive while its stdin pipe stays open');
    } finally { try { stopTree(runnerProcess.pid); } catch {} }
  } finally { f.cleanup(); }
});

test('log append failure reaps the owned fake RPC child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-role-runner-log-'));
  const pkg = join(root, 'package'), dist = join(pkg, 'dist'); mkdirSync(dist, { recursive: true });
  const pidFile = join(root, 'child.pid'), logDirectory = join(root, 'not-a-log-file'); mkdirSync(logDirectory);
  writeFileSync(join(dist, 'cli.js'), `import{writeFileSync}from'node:fs';writeFileSync(process.env.PI_TEST_PID_FILE,String(process.pid));process.stdout.write('trigger\\n');setInterval(()=>{},1000);`);
  const descriptor = join(root, 'runner.json'); writeFileSync(descriptor, JSON.stringify({ cwd: root, env: { PI_TEAM_PI_PACKAGE_ROOT: pkg, PI_TEST_PID_FILE: pidFile }, args: [], log: logDirectory }));
  const processRunner = spawn(process.execPath, [runner, descriptor], { cwd: process.cwd(), windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    assert.equal(await until(() => existsSync(pidFile)), true, 'fake CLI started');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(await until(() => !alive(pid), 7000), true, 'runner reaped the child after log append failed');
    assert.equal(await until(() => processRunner.exitCode !== null), true, 'runner exited after cleanup');
  } finally { try { stopTree(processRunner.pid); } catch {} try { const pid = Number(readFileSync(pidFile, 'utf8')); stopTree(pid); } catch {} rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('SIGTERM to the runner reaps its owned RPC child', async () => {
  const f = fixture();
  try {
    const runnerProcess = spawn(process.execPath, [runner, f.descriptor], { cwd: process.cwd(), windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32' });
    assert.equal(await until(() => existsSync(f.pidFile)), true, 'fake CLI started');
    const pid = Number(readFileSync(f.pidFile, 'utf8'));
    if (process.platform === 'win32') stopTree(runnerProcess.pid);
    else runnerProcess.kill('SIGTERM');
    assert.equal(await until(() => !alive(pid), 7000), true, 'owned child exited after runner shutdown');
    if (process.platform !== 'win32') assert.equal(await until(() => runnerProcess.exitCode !== null), true, 'runner completed bounded cleanup');
  } finally { f.cleanup(); }
});
