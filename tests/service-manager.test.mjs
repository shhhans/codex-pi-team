import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ServiceManager, killWindowsTree } from '../.pi/runtime/service-manager.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pi-services-')), project = join(root, 'project'), runtime = join(root, 'runtime');
  mkdirSync(join(project, '.pi'), { recursive: true }); mkdirSync(runtime);
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'main'); git('config', 'core.autocrlf', 'false'); git('config', 'user.name', 'Service test'); git('config', 'user.email', 'service@example.test');
  writeFileSync(join(project, 'server.mjs'), 'setInterval(() => {}, 1000);\n');
  const config = { services: { web: { executable: process.execPath, args: ['server.mjs'], cwd: '.', ports: [] } } };
  writeFileSync(join(project, '.pi/services.json'), JSON.stringify(config)); git('add', '.'); git('commit', '-m', 'fixture');
  const manager = new ServiceManager({ root: runtime, group: () => ({ worktree: project }) });
  return { root, project, manager, git, config, cleanup() { manager.stopGroup('sample'); rmSync(root, { recursive: true, force: true }); } };
}

test('managed process survives manager recreation, task ownership conflicts, stop preserves evidence', async () => {
  const f = fixture(); try {
    const started = await f.manager.start('sample', 'web', { task_id: 'T1' }); assert.equal(started.ready, true);
    const recreated = new ServiceManager(f.manager.store); assert.equal(recreated.status('sample', 'web').process_alive, true);
    assert.equal((await recreated.start('sample', 'web', { task_id: 'T1' })).pid, started.pid);
    await assert.rejects(recreated.start('sample', 'web', { task_id: 'T2' }), /another task/);
    recreated.stop('sample', 'web'); assert.equal(recreated.status('sample', 'web').ready, false);
    assert.equal(readFileSync(started.log_path, 'utf8'), '');
  } finally { f.cleanup(); }
});

test('review service exports the requested commit and cannot hot reload worktree changes', async () => {
  const f = fixture(); try {
    const commit = f.git('rev-parse', 'HEAD');
    writeFileSync(join(f.project, 'server.mjs'), 'throw Error("worktree drift");\n');
    const started = await f.manager.start('sample', 'web', { mode: 'review', commit, task_id: 'T1' });
    assert.equal(started.ready, true); assert.equal(started.source_commit, commit);
    assert.equal(readFileSync(join(started.source_path, 'server.mjs'), 'utf8'), 'setInterval(() => {}, 1000);\n');
    assert.notEqual(started.source_path, f.project);
    assert.equal(f.manager.status('sample', 'web').snapshot_intact, true);
  } finally { f.cleanup(); }
});

test('service spec blocks shell passthrough and escaping working directories', async () => {
  const f = fixture(); try {
    f.config.services.web.command = 'echo unsafe'; writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));
    assert.throws(() => f.manager.describe('sample'), /shell commands/);
    delete f.config.services.web.command; f.config.services.web.cwd = '..'; writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));
    await assert.rejects(f.manager.start('sample', 'web'), /escapes/);
    await assert.rejects(f.manager.start('sample', 'web', { mode: 'review' }), /explicit delivery commit/);
  } finally { f.cleanup(); }
});

test('PID reuse is not authority to kill an unrelated process', async () => {
  const f = fixture(); try {
    f.manager.save({ group_id: 'sample', service_id: 'web', pid: process.pid, process_stamp: 'wrong', state: 'ready' });
    assert.equal(f.manager.status('sample', 'web').process_alive, false);
    assert.throws(() => f.manager.stop('sample', 'web'), /identity changed/);
    f.manager.save({ group_id: 'sample', service_id: 'web', pid: 0, state: 'stopped' });
  } finally { f.cleanup(); }
});

test('Windows process-tree fallback kills the owned parent and descendant when taskkill is unavailable', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(), childPidPath = join(f.root, 'child.pid');
  try {
    writeFileSync(join(f.project, 'tree-parent.mjs'), `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});writeFileSync(process.env.PI_TEST_CHILD_PID_FILE,String(child.pid));setInterval(()=>{},1000);\n`);
    f.config.services.web.args = ['tree-parent.mjs']; f.config.services.web.env_refs = ['PI_TEST_CHILD_PID_FILE']; writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));
    process.env.PI_TEST_CHILD_PID_FILE = childPidPath;
    const started = await f.manager.start('sample', 'web', { task_id: 'T1' });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(childPidPath)) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(existsSync(childPidPath), 'service wrote the descendant PID');
    const childPid = Number(readFileSync(childPidPath, 'utf8'));
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    killWindowsTree({ pid: started.pid, process_stamp: started.process_stamp }, join(f.root, 'taskkill-unavailable.exe'));
    const stoppedBy = pid => { try { process.kill(pid, 0); return false; } catch { return true; } };
    const stopDeadline = Date.now() + 5000;
    while (Date.now() < stopDeadline && (!stoppedBy(started.pid) || !stoppedBy(childPid))) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(stoppedBy(started.pid), true, 'owned service parent exited');
    assert.equal(stoppedBy(childPid), true, 'owned service descendant exited');
  } finally { delete process.env.PI_TEST_CHILD_PID_FILE; f.cleanup(); }
});

test('Windows process-tree fallback rejects a mismatched creation stamp without killing the current process', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    assert.throws(() => killWindowsTree({ pid: process.pid, process_stamp: '1' }, join(f.root, 'taskkill-unavailable.exe')), /service PID identity changed/);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally { f.cleanup(); }
});

test('external dependencies are visible but never started, stopped, or recorded', async () => {
  const f = fixture(); try {
    f.config.services.shared = {
      external: true,
      description: 'Shared local database managed outside this group',
      health: { url: 'http://127.0.0.1:5432/health', timeout_ms: 1500 },
      ports: [5432]
    };
    writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));

    const described = f.manager.describe('sample').services.shared;
    assert.equal(described.external, true);
    assert.equal(described.owned, false);
    const status = f.manager.status('sample', 'shared');
    assert.equal(status.external, true);
    assert.equal(status.owned, false);
    assert.equal(status.process_alive, false);
    assert.equal(status.ready, null);
    assert.equal(status.health.url, 'http://127.0.0.1:5432/health');
    await assert.rejects(f.manager.start('sample', 'shared'), /external services.*cannot be started/);
    assert.throws(() => f.manager.stop('sample', 'shared'), /external services.*cannot be stopped/);
    assert.equal(f.manager.record('sample', 'shared'), null);
    assert.equal(f.manager.records().some(record => record.service_id === 'shared'), false);

    f.config.services.shared.executable = process.execPath;
    writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));
    assert.throws(() => f.manager.describe('sample'), /external service cannot define a process/);
  } finally { f.cleanup(); }
});

test('a live owned service remains inspectable and stoppable after its spec becomes external', async () => {
  const f = fixture(); try {
    const started = await f.manager.start('sample', 'web', { task_id: 'T1' });
    f.config.services.web = {
      external: true,
      description: 'The service was transferred to an external owner',
      health: { url: 'http://127.0.0.1:8080/health' }
    };
    writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));

    const status = f.manager.status('sample', 'web');
    assert.equal(status.pid, started.pid);
    assert.equal(status.process_alive, true);
    assert.equal(status.owned, true);
    assert.equal(status.configured_external, true);
    await assert.rejects(f.manager.start('sample', 'web', { task_id: 'T1' }), /cannot be started/);
    assert.equal(f.manager.stop('sample', 'web').stopped, true);
    assert.equal(f.manager.record('sample', 'web').state, 'stopped');

    f.config.services.web = { executable: process.execPath, args: ['server.mjs'], cwd: '.', ports: [] };
    writeFileSync(join(f.project, '.pi/services.json'), JSON.stringify(f.config));
  } finally { f.cleanup(); }
});

test('stale operation lock recovery removes only a proven dead owner lock', async () => {
  const f = fixture(); try {
    const release = f.manager.lock();
    assert.throws(() => f.manager.recoverLock(), /live process/);
    release();

    const lock = join(f.manager.root, 'operation.lock');
    writeFileSync(lock, JSON.stringify({ pid: 2147483647, process_stamp: 'dead-owner', started_at: '2026-01-01T00:00:00.000Z' }));
    assert.deepEqual(f.manager.recoverLock(), { recovered: true, reason: 'owner_exited' });
    assert.equal(existsSync(lock), false);

    writeFileSync(lock, '{broken');
    assert.throws(() => f.manager.recoverLock(), /unreadable/);
    assert.equal(existsSync(lock), true);
    rmSync(lock);
  } finally { f.cleanup(); }
});
