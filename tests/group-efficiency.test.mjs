import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, registerFixtureGroup } from './group-fixture.mjs';
import { git } from '../.pi/runtime/group-store.mjs';
import { promptFor, startTask } from '../.pi/runtime/group-service.mjs';
import { turnContext } from '../.pi/runtime/turn-context.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';

test('invalid snapshot identity is rejected before creating a task branch or recovery transition', () => {
  const f = fixture(); try {
    const worktree = join(f.root, 'verification');
    registerFixtureGroup(f.store, 'verification', worktree);
    const input = { task_id: 'VERIFY', objective: 'verify joint candidate', acceptance: ['exact candidate verified'], base_ref: 'develop', integration_id: 'joint', verification_snapshot: { integration_id: 'different', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } };
    const branch = git(worktree, 'branch', '--show-current');
    assert.throws(() => startTask(f.store, 'verification', input), /verification_snapshot/);
    assert.equal(f.store.group('verification').transition, undefined);
    assert.equal(f.store.group('verification').active_task, null);
    assert.equal(git(worktree, 'branch', '--show-current'), branch);
    input.verification_snapshot.integration_id = 'joint';
    assert.deepEqual(startTask(f.store, 'verification', input).verification_snapshot, input.verification_snapshot);
  } finally { f.cleanup(); }
});

test('per-turn authority retains current work and exact snapshot identity without repeating stable contracts or ACK bodies', () => {
  const snapshot = { integration_id: 'joint', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const state = { group: { group_id: 'model', worktree: 'D:/model', generation: 2, definition_epoch: 1, applied_definition: { description: 'large stable responsibility' } },
    task: { task_id: 'T2', objective: 'large stable objective', outcome: 'pending', round: 1, integration_id: 'joint', verification_snapshot: snapshot, delivery: { commit: 'c'.repeat(40) } }, work: [{ id: 45, kind: 'implementation-1', owner: 'executor' }] };
  const context = turnContext(state, { operation_id: 'init', status: 'ready', epoch: 1, receipts: { executor: { body: 'large historical ACK' } }, work: [] }, 'executor');
  assert.equal(context.work[0].id, 45);
  assert.equal(context.task.delivery_commit, 'c'.repeat(40));
  assert.deepEqual(context.task.verification_snapshot, snapshot);
  assert.equal(context.worktree, 'D:/model');
  assert.doesNotMatch(JSON.stringify(context), /large stable|large historical|receipts/);
});

test('cross-group Coordinator message wakes the recipient task while preserving source task identity', () => {
  const f = fixture();
  try {
    registerFixtureGroup(f.store, 'peer', join(f.root, 'peer'));
    startTask(f.store, 'peer', { task_id: 'T2', objective: 'integrate two modules', acceptance: ['interfaces agree'], base_ref: 'develop' });
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'sender' });
    f.store.register('peer', 'coordinator', { pid: process.pid, launch_id: 'receiver' });
    f.store.present('peer', 'coordinator', 'receiver'); f.store.settle('peer', 'coordinator', 'receiver');
    const actor = { ...f.actor('coordinator'), launch_id: 'sender' };
    const receipt = f.store.send(actor, { group_id: 'peer', to: 'coordinator', body: 'Agree the model interface.' });
    const pending = f.store.pending('peer', 'coordinator');
    const delivery = pending.find(message => message.id === receipt.message_id);
    assert.ok(delivery, 'a message from T1 must be deliverable while the receiver works on T2');
    assert.equal(delivery.data.task_id, 'T2');
    assert.equal(delivery.data.source_task_id, 'T1');
    assert.equal(delivery.data.from_group, 'sample');
    assert.equal(f.store.claim('peer', 'coordinator', 'receiver').some(message => message.id === receipt.message_id), true);
    const tools = new RoleTools(f.store, 'sample', 'coordinator', 'sender');
    const malformed = tools.invoke('team_send', { to: 'peer:coordinator', body: 'Interface question' });
    assert.equal(malformed.code, 'INVALID_RECIPIENT');
    assert.equal(malformed.next_action, 'correct_recipient_fields');
    assert.deepEqual(malformed.expected.cross_group, { to: 'coordinator', group_id: 'target-group' });
    assert.throws(() => f.store.send(f.actor('executor'), { group_id: 'peer', to: 'coordinator', body: 'Forbidden route' }), /cross-group/);
  } finally { f.cleanup(); }
});

test('startup distinguishes unassigned peers, assigned work and pending questions', () => {
  const group = { group_id: 'sample', worktree: 'D:/group' };
  const idle = promptFor(group, 'executor', { work: [], messages: [] });
  assert.match(idle, /No work is assigned.*End idle/);
  assert.match(idle, /Do not inventory files/);
  const assigned = promptFor(group, 'executor', { work: [{ id: 45, kind: 'implementation-1' }], messages: [] });
  assert.match(assigned, /Startup assignment:.*45.*implementation-1/);
  assert.doesNotMatch(assigned, /No work is assigned/);
  assert.match(promptFor(group, 'coordinator', { work: [], messages: [{ read_at: null }] }), /Unsettled messages are available/);
});

test('clean CRLF implementation evidence matches its LF Git blob; actual rewrites remain immutable', () => {
  const f = fixture();
  try {
    f.prepare();
    git(f.wt, 'config', 'core.autocrlf', 'true');
    const path = f.file('implementation.md', '# Implementation\r\n\r\nReviewed concerns and verified behavior.\r\n');
    git(f.wt, 'add', '.'); git(f.wt, 'commit', '-m', 'Windows delivery');
    const commit = git(f.wt, 'rev-parse', 'HEAD');
    assert.equal(git(f.wt, 'status', '--porcelain'), '');
    assert.match(readFileSync(join(f.wt, path), 'utf8'), /\r\n/);
    assert.doesNotMatch(git(f.wt, 'show', `${commit}:${path}`), /\r/);
    const submitted = f.store.submit(f.actor('executor'), { kind: 'implementation', path, round: 1, commit });
    assert.equal(submitted.commit, commit);
    writeFileSync(join(f.wt, path), readFileSync(join(f.wt, path), 'utf8').replaceAll('\r\n', '\n'));
    assert.equal(f.store.submit(f.actor('executor'), { kind: 'implementation', path, round: 1, commit }).replay, true);
    f.file('implementation.md', '# Different implementation\n');
    assert.throws(() => f.store.submit(f.actor('executor'), { kind: 'implementation', path, round: 1, commit }), /immutable/);
    assert.throws(() => f.store.assertEvidence(f.store.group('sample'), f.store.task('T1')), /submitted evidence changed/);
  } finally { f.cleanup(); }
});
