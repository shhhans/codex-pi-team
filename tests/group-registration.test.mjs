import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from '../.pi/runtime/group-store.mjs';
import { startTask, updateGroup, syncGroup, finalize, launchGroup, adoptGroup } from '../.pi/runtime/group-service.mjs';
import { parseDefinition } from '../.pi/runtime/group-definitions.mjs';
import { onboardingState, submitOnboarding, beginOnboarding, sharedRoleVersion, markOnboardingStopped } from '../.pi/runtime/group-onboarding.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';
import { scheduleOnboarding } from '../scripts/group-init-runner.mjs';
import { fixture } from './group-fixture.mjs';

test('group definition parser rejects malformed schema, mismatched identity, and empty responsibilities', () => {
  assert.throws(() => parseDefinition('---\nschema_version: 2\nid: sample\nname: Sample\nworktree: "C:/tmp/group"\nbase_ref: develop\n---\n\nResponsibilities.\n', 'sample'), /schema_version/);
  assert.throws(() => parseDefinition('---\nschema_version: 1\nid: other\nname: Sample\nworktree: "C:/tmp/group"\nbase_ref: develop\n---\n\nResponsibilities.\n', 'sample'), /disagree/);
  assert.throws(() => parseDefinition('---\nschema_version: 1\nid: sample\nname: Sample\nworktree: "C:/tmp/group"\nbase_ref: develop\n---\n\n', 'sample'), /description is required/);
});

test('onboarding receipts are immutable, replayable, and reject stale definition epochs', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = onboardingState(f.store, 'sample', 'lead');
    const actor = { group_id: 'sample', role: 'executor', launch_id: f.store.session('sample', 'executor').launch_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id };
    const replay = submitOnboarding(f.store, actor, { body: state.receipts.executor.body });
    assert.equal(replay.replay, true);
    assert.throws(() => submitOnboarding(f.store, actor, { body: 'a different acknowledgement' }), /immutable/);
    updateGroup(f.store, 'sample', { description: 'Changed module responsibilities.' });
    assert.throws(() => submitOnboarding(f.store, actor, { body: 'late acknowledgement' }), /stale onboarding epoch/);
  } finally { f.cleanup(); }
});

test('role model changes alter the shared version and require fresh onboarding acknowledgements', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const sourceRoot = join(f.root, 'source'), piRoot = join(sourceRoot, '.pi');
    for (const [role, skill] of [['coordinator', 'coordinate-group'], ['executor', 'execute-group-task'], ['validator', 'review-group-task']]) {
      mkdirSync(join(piRoot, 'agents'), { recursive: true });
      mkdirSync(join(piRoot, 'skills', skill), { recursive: true });
      writeFileSync(join(piRoot, 'agents', `${role}.md`), `${role} stable instructions\n`);
      writeFileSync(join(piRoot, 'skills', skill, 'SKILL.md'), `${role} stable skill\n`);
    }
    const rolesPath = join(piRoot, 'roles.json');
    writeFileSync(rolesPath, JSON.stringify({ coordinator: { model: 'model-a' }, executor: { model: 'model-a' }, validator: { model: 'model-fixed' } }));
    const originalVersion = sharedRoleVersion(sourceRoot);
    const original = beginOnboarding(f.store, 'sample', { role_version: originalVersion });
    assert.equal(original.status, 'pending');
    const oldActors = {};
    for (const role of ['executor', 'validator', 'coordinator']) {
      const launch_id = `old-model-${role}`; oldActors[role] = { group_id: 'sample', role, launch_id, definition_epoch: original.epoch, lifecycle_id: original.operation_id };
      f.store.register('sample', role, { pid: 2147483647, launch_id, session_id: `old-model-session-${role}` });
      submitOnboarding(f.store, oldActors[role], { body: `ACK old model for ${role}.` });
    }
    markOnboardingStopped(f.store, 'sample');
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'ready');

    writeFileSync(rolesPath, JSON.stringify({ coordinator: { model: 'model-a' }, executor: { model: 'model-b' }, validator: { model: 'model-fixed' } }));
    const changedVersion = sharedRoleVersion(sourceRoot);
    assert.notEqual(changedVersion, originalVersion);
    const changed = beginOnboarding(f.store, 'sample', { role_version: changedVersion });
    assert.ok(changed.epoch > original.epoch); assert.equal(changed.status, 'pending');
    assert.deepEqual(f.store.sessions('sample'), []);
    for (const role of ['executor', 'validator', 'coordinator']) {
      assert.throws(() => submitOnboarding(f.store, oldActors[role], { body: `Late old model ACK for ${role}.` }), /stale onboarding epoch/);
    }
    assert.equal(onboardingState(f.store, 'sample', 'lead').receipts.executor, undefined);
    const archiveDir = join(f.store.root, 'session-archive', 'sample');
    const archived = readdirSync(archiveDir).map(file => JSON.parse(readFileSync(join(archiveDir, file), 'utf8')));
    assert.ok(archived.some(entry => entry.sessions.some(session => session.launch_id === oldActors.executor.launch_id)));
  } finally { f.cleanup(); }
});

test('runtime-owned RoleTools can submit onboarding without task paths or user-supplied identity', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = updateGroup(f.store, 'sample', { description: 'New executor responsibilities.' });
    const launch_id = 'role-tools-onboarding';
    f.store.register('sample', 'executor', { pid: process.pid, launch_id, session_id: 'role-tools-session' });
    const tools = new RoleTools(f.store, 'sample', 'executor', launch_id);
    assert.ok(tools.invoke('team_read').lifecycle.work.some(work => work.kind === 'onboarding'));
    const result = tools.invoke('team_submit', { kind: 'onboarding', body: 'I understand the updated executor responsibilities.' });
    assert.equal(result.ok, true); assert.equal(result.receipt.definition_epoch, state.epoch);
    assert.equal(result.receipt.role, 'executor'); assert.equal(result.receipt.session_id, 'role-tools-session');
  } finally { f.cleanup(); }
});

test('unfinished onboarding emits one durable Coordinator alert and does not synthesize an acknowledgement', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = updateGroup(f.store, 'sample', { description: 'Awaiting executor acknowledgement.' });
    assert.ok(f.store.group('sample').message_epoch_start > 0);
    const launch_id = 'unfinished-onboarding';
    f.store.register('sample', 'executor', { pid: 2147483647, launch_id, session_id: 'unfinished-session' });
    const tools = new RoleTools(f.store, 'sample', 'executor', launch_id);
    tools.finish(); tools.finish();
    const alerts = f.store.inbox('sample', 'coordinator').filter(message => message.data.type === 'unfinished_work' && message.data.lifecycle_id === state.operation_id);
    assert.equal(alerts.length, 1); assert.equal(alerts[0].data.definition_epoch, state.epoch);
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'pending');
    assert.equal(onboardingState(f.store, 'sample', 'lead').receipts.executor, undefined);
  } finally { f.cleanup(); }
});

test('task start requires the registered base and unchanged fixed worktree binding', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    assert.throws(() => startTask(f.store, 'sample', { task_id: 'WRONGBASE', objective: 'x', acceptance: ['x'], base_ref: 'main' }), /must match registered group base_ref/);
    const path = join(f.main, 'groups/sample/group.md');
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace(JSON.stringify(f.wt), JSON.stringify(join(f.root, 'other-worktree'))));
    assert.throws(() => syncGroup(f.store, 'sample'), /worktree is immutable/);
    writeFileSync(path, original);
  } finally { f.cleanup(); }
});

test('acknowledged onboarding cannot start or launch a task until role processes stop', async () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = updateGroup(f.store, 'sample', { description: 'Awaiting role shutdown.' });
    const launches = {};
    for (const role of ['executor', 'validator', 'coordinator']) {
      const launch_id = `ack-not-stopped-${role}`; launches[role] = launch_id;
      f.store.register('sample', role, { pid: process.pid, launch_id, session_id: `ack-session-${role}` });
      submitOnboarding(f.store, { group_id: 'sample', role, launch_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id }, { body: `ACK ${role}.` });
      f.store.updateSession('sample', role, launch_id, { pid: 2147483647 });
    }
    git(f.main, 'add', 'groups/sample/group.md'); git(f.main, 'commit', '-m', 'commit changed registration'); syncGroup(f.store, 'sample');
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'acknowledged');
    assert.throws(() => startTask(f.store, 'sample', { task_id: 'T2', objective: 'next', acceptance: ['result'], base_ref: 'develop' }), /completed onboarding and stopped initialization processes/);
    await assert.rejects(() => launchGroup(f.store, 'sample', { headless: true }), /completed onboarding and stopped initialization processes/);
  } finally { f.cleanup(); }
});

test('dead busy role after a recorded acknowledgement resumes persisted session and settles without a real model', async () => {
  const f = fixture(), previousPackageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT, marker = join(f.root, 'fake-cli-ran.txt');
  try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = updateGroup(f.store, 'sample', { description: 'Recover an interrupted acknowledgement.' });
    const launches = {};
    for (const role of ['executor', 'validator', 'coordinator']) {
      const launch_id = `recover-${role}`; launches[role] = launch_id;
      const session_path = join(f.root, `${role}.jsonl`); writeFileSync(session_path, 'persisted session\n');
      f.store.register('sample', role, { pid: 2147483647, launch_id, session_id: `recover-session-${role}`, session_path });
      submitOnboarding(f.store, { group_id: 'sample', role, launch_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id }, { body: `ACK recovery for ${role}.` });
    }
    f.store.updateSession('sample', 'executor', launches.executor, { busy: true });
    const packageRoot = join(f.root, 'fake-package'), dist = join(packageRoot, 'dist'); mkdirSync(dist, { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), '{"type":"module"}\n');
    const storeURL = pathToFileURL(join(import.meta.dirname, '../.pi/runtime/group-store.mjs')).href;
    const toolsURL = pathToFileURL(join(import.meta.dirname, '../.pi/runtime/role-tools.mjs')).href;
    writeFileSync(join(dist, 'cli.js'), `import{GroupStore}from ${JSON.stringify(storeURL)};import{RoleTools}from ${JSON.stringify(toolsURL)};import{writeFileSync}from'node:fs';const e=process.env,s=new GroupStore(e.PI_TEAM_PROJECT_ROOT),r=s.session(e.PI_TEAM_GROUP_ID,e.PI_TEAM_ROLE);s.register(e.PI_TEAM_GROUP_ID,e.PI_TEAM_ROLE,{...r,pid:process.pid,launch_id:e.PI_TEAM_LAUNCH_ID});const t=new RoleTools(s,e.PI_TEAM_GROUP_ID,e.PI_TEAM_ROLE,e.PI_TEAM_LAUNCH_ID);t.invoke('team_read');t.finish();s.settle(e.PI_TEAM_GROUP_ID,e.PI_TEAM_ROLE,e.PI_TEAM_LAUNCH_ID);writeFileSync(process.env.PI_TEST_RECOVERY_FILE,'fake persisted-session resume completed');s.close();`);
    process.env.PI_TEAM_PI_PACKAGE_ROOT = packageRoot; process.env.PI_TEST_RECOVERY_FILE = marker;
    const scheduled = scheduleOnboarding(f.store, 'sample', { timeout: 5000 }); assert.equal(scheduled.status, 'scheduled');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && onboardingState(f.store, 'sample', 'lead').status !== 'ready') await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'ready');
    assert.ok(existsSync(marker));
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM messages WHERE group_id='sample' AND recipient='executor' AND json_extract(data,'$.type')='onboarding_recovery' AND read_at IS NOT NULL").get().n, 1);
    assert.equal(onboardingState(f.store, 'sample', 'lead').receipts.executor.body, 'ACK recovery for executor.');
    const scheduledMarker = join(f.store.root, `${state.operation_id}.scheduled`);
    const scheduledProcess = JSON.parse(readFileSync(scheduledMarker, 'utf8')).pid;
    const stopDeadline = Date.now() + 5000;
    while (Date.now() < stopDeadline) { try { process.kill(scheduledProcess, 0); await new Promise(resolve => setTimeout(resolve, 25)); } catch { break; } }
    try { process.kill(scheduledProcess, 0); assert.fail('onboarding recovery runner did not close'); } catch (error) { if (error?.code === 'ERR_ASSERTION') throw error; }
  } finally {
    if (previousPackageRoot === undefined) delete process.env.PI_TEAM_PI_PACKAGE_ROOT; else process.env.PI_TEAM_PI_PACKAGE_ROOT = previousPackageRoot;
    delete process.env.PI_TEST_RECOVERY_FILE; f.cleanup();
  }
});

test('unrelated legacy pending work remains preserved while current groups proceed', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const legacy = join(f.store.common, 'pi-team/v1'); mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'OLD.json'), JSON.stringify({ task_id: 'OLD', outcome: 'pending' }));
    const next = startTask(f.store, 'sample', { task_id: 'T2', objective: 'next', acceptance: ['result'], base_ref: 'develop' });
    assert.equal(next.task_id, 'T2');
    assert.equal(readFileSync(join(legacy, 'OLD.json'), 'utf8'), JSON.stringify({ task_id: 'OLD', outcome: 'pending' }));
  } finally { f.cleanup(); }
});

test('explicit adoption preserves a legacy v2 runtime row and writes its first authoritative definition', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const before = f.store.group('sample');
    const path = join(f.main, 'groups/sample/group.md'); unlinkSync(path);
    assert.equal(existsSync(path), false);
    const onboarding = adoptGroup(f.store, 'sample', { name: before.name, description: 'Adopted responsibilities.', base_ref: 'develop' });
    const after = f.store.group('sample');
    assert.equal(after.group_id, before.group_id); assert.equal(after.worktree, before.worktree);
    assert.equal(after.generation, before.generation); assert.equal(onboarding.status, 'pending');
    assert.match(readFileSync(path, 'utf8'), /Adopted responsibilities/);
  } finally { f.cleanup(); }
});
