import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroupStore, git, ROLES } from '../.pi/runtime/group-store.mjs';
import { serializeDefinition } from '../.pi/runtime/group-definitions.mjs';
import { roleConfig } from '../.pi/runtime/group-service.mjs';
import { observeProcesses, processStartStamp } from '../.pi/runtime/process-observation.mjs';
import { blackboardSnapshot, startBlackboard } from '../scripts/group-blackboard.mjs';
import { fixture } from './group-fixture.mjs';

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('independent Blackboard discovers definitions without launching or changing workflow', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-board-'));
  git(root, 'init', '-b', 'develop');
  const store = new GroupStore(root);
  mkdirSync(join(root, 'groups', 'sample'), { recursive: true });
  writeFileSync(join(root, 'groups', 'sample', 'group.md'), serializeDefinition({ group_id: 'sample', worktree: join(root, 'worktree'), description: 'Own sample capability.' }));
  mkdirSync(join(root, 'groups', 'invalid')); writeFileSync(join(root, 'groups', 'invalid', 'group.md'), 'bad configuration');
  const server = startBlackboard(store);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const data = await (await fetch(`${url}/api/groups`, { headers: { connection: 'close' } })).json();
    assert.equal(data.groups.find(g => g.group_id === 'sample').registered, true);
    assert.match(data.groups.find(g => g.group_id === 'invalid').error, /front matter/);
    const sample = data.groups.find(g => g.group_id === 'sample');
    assert.deepEqual(sample.roles.map(role => role.role), ROLES);
    assert.ok(sample.roles.every(role => role.model === null && role.process.status === 'not_started' && role.recent_activity === null && role.fault === null));
    assert.equal('current_work' in sample, false); assert.equal(sample.task, null);
    const page = await (await fetch(`${url}/`, { headers: { connection: 'close' } })).text();
    const client = await (await fetch(`${url}/client.mjs`, { headers: { connection: 'close' } })).text();
    assert.match(page, /<script type="module" src="\/client\.mjs"><\/script>/);
    assert.match(client, /dataset\.role/); assert.match(client, /Coordinator/); assert.match(client, /Executor/); assert.match(client, /Validator/);
    assert.equal(store.list().length, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal((await fetch(`${url}/api/groups`, { method: 'POST', headers: { connection: 'close' } })).status, 405);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  } finally {
    await closeServer(server); store.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('role snapshots report model, verified process identity, activity and fault without changing runtime tables', async () => {
  const f = fixture(), server = startBlackboard(f.store);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const launchIds = {};
    const config = roleConfig();
    const pidByRole = { executor: 90000001, validator: 90000002, coordinator: 90000003 };
    for (const role of ROLES) {
      const session = f.store.session('sample', role), launch = session.launch_id; launchIds[role] = launch;
      f.store.updateSession('sample', role, launch, {
        pid: pidByRole[role], process_start_stamp: `stamp-${role}`, config: config[role],
        current_state: `${role} is checking the report`, state_at: `2026-10-20T08:0${ROLES.indexOf(role)}:00.000Z`,
        fault: role === 'executor' ? 'independent role fault' : null,
      });
    }
    const counts = () => Object.fromEntries(['groups', 'tasks', 'sessions', 'messages', 'work', 'artifacts'].map(table => [table, f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    const before = counts();
    const observations = new Map([
      [90000001, { status: 'running', stamp: 'stamp-executor' }],
      [90000002, { status: 'running', stamp: 'reused-pid-stamp' }],
      [90000003, { status: 'stopped', reason: 'recorded process exited' }],
    ]);
    const snapshot = blackboardSnapshot(f.store, { observeProcesses: pids => { assert.deepEqual([...pids].sort(), [90000001, 90000002, 90000003]); return observations; } });
    const roles = snapshot.groups.find(group => group.group_id === 'sample').roles;
    for (const role of ROLES) assert.deepEqual(roles.find(item => item.role === role).model, { provider: config[role].provider, id: config[role].model });
    assert.equal(roles.find(item => item.role === 'executor').process.status, 'running');
    assert.equal(roles.find(item => item.role === 'executor').fault, 'independent role fault');
    assert.deepEqual(roles.find(item => item.role === 'executor').recent_activity, { text: 'executor is checking the report', at: '2026-10-20T08:01:00.000Z' });
    assert.equal(roles.find(item => item.role === 'validator').process.status, 'stopped');
    assert.match(roles.find(item => item.role === 'validator').process.reason, /复用/);
    assert.equal(roles.find(item => item.role === 'coordinator').process.status, 'stopped');
    assert.ok(roles.find(item => item.role === 'coordinator').recent_activity.text.includes('coordinator is checking'));
    assert.deepEqual(counts(), before);

    f.store.updateSession('sample', 'validator', launchIds.validator, { process_start_stamp: null });
    const missingIdentity = blackboardSnapshot(f.store, { observeProcesses: () => new Map([[90000001, observations.get(90000001)], [90000002, { status: 'running', stamp: 'some stamp' }], [90000003, observations.get(90000003)]]) });
    const validator = missingIdentity.groups.find(group => group.group_id === 'sample').roles.find(item => item.role === 'validator');
    assert.equal(validator.process.status, 'unknown');
    assert.ok(validator.recent_activity.text.includes('validator is checking'));

    const failedObservation = blackboardSnapshot(f.store, { observeProcesses: () => { throw Error('query failed'); } });
    assert.ok(failedObservation.groups.find(group => group.group_id === 'sample').roles.every(role => role.process.status === 'unknown'));

    const url = `http://127.0.0.1:${server.address().port}/api/groups`;
    const first = await (await fetch(url, { headers: { connection: 'close' } })).json();
    f.store.updateSession('sample', 'executor', launchIds.executor, { current_state: 'fresh activity visible', state_at: '2026-10-20T09:00:00.000Z' });
    const second = await (await fetch(url, { headers: { connection: 'close' } })).json();
    assert.notEqual(first.groups.find(group => group.group_id === 'sample').roles.find(role => role.role === 'executor').recent_activity.text,
      second.groups.find(group => group.group_id === 'sample').roles.find(role => role.role === 'executor').recent_activity.text);
    assert.equal(second.groups.find(group => group.group_id === 'sample').roles.find(role => role.role === 'executor').recent_activity.at, '2026-10-20T09:00:00.000Z');
  } finally {
    await closeServer(server);
    f.cleanup();
  }
});

test('Blackboard reports snapshot failures as HTTP 500 JSON', async () => {
  const server = startBlackboard({ list() { throw Error('snapshot failure'); } });
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/groups`, { headers: { connection: 'close' } });
    assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'snapshot failure' });
  } finally { await closeServer(server); }
});

test('registration records process identity and read-only observation verifies only this test process', () => {
  const f = fixture(); try {
    const launch_id = 'observe-current-test-process';
    const session = f.store.register('sample', 'executor', { pid: process.pid, launch_id, session_id: 'observation-session' });
    const observed = observeProcesses([process.pid]).get(process.pid);
    assert.equal(observed.status, 'running'); assert.ok(observed.stamp);
    assert.equal(session.process_start_stamp, processStartStamp(process.pid));
    assert.equal(session.process_start_stamp, observed.stamp);
    const snapshot = blackboardSnapshot(f.store);
    assert.equal(snapshot.groups.find(group => group.group_id === 'sample').roles.find(role => role.role === 'executor').process.status, 'running');
  } finally { f.cleanup(); }
});
