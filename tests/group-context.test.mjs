import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './group-fixture.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

test('work inference rejects ambiguous ownership and stale turns; next identity restores context', () => {
  const f = fixture(); try {
    f.prepare();
    f.store.register('sample', 'executor', { pid: process.pid, launch_id: 'executor-live' });
    const tools = new RoleTools(f.store, 'sample', 'executor', 'executor-live');
    const before = tools.invoke('team_read');
    f.store.addWork(f.store.task('T1'), 'implementation-2', 'executor');
    const ambiguous = tools.invoke('team_submit', { kind: 'implementation' });
    assert.equal(ambiguous.code, 'AMBIGUOUS_WORK');
    assert.equal(ambiguous.expected.length, 2);
    assert.deepEqual(ambiguous.current_work.map(w => w.round), [1, 2]);
    const completedCoordinatorWork = f.store.db.prepare("SELECT id FROM work WHERE task_id='T1' AND owner='coordinator'").get();
    assert.equal(tools.invoke('team_submit', { kind: 'task', work_id: completedCoordinatorWork.id }).code, 'WRONG_WORK');
    const group = f.store.group('sample'); group.active_task = null; group.generation++;
    f.store.put('groups', 'sample', group);
    assert.equal(tools.invoke('team_read').code, 'STALE_TURN');
    assert.equal(tools.invoke('team_submit', { kind: 'implementation' }).code, 'STALE_TURN');
    tools.begin();
    const after = tools.invoke('team_read');
    assert.equal(after.task, null);
    assert.equal(after.group.generation, group.generation);
    assert.ok(after.context);
    assert.notEqual(after.context_ref, before.context_ref);
  } finally { f.cleanup(); }
});

test('team_read projects compact stable context, message deltas and authoritative work cards', () => {
  const f = fixture(); try {
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'c' });
    const tools = new RoleTools(f.store, 'sample', 'coordinator', 'c');
    const first = tools.invoke('team_read');
    assert.equal(first.context.task.objective, 'return two');
    assert.equal(first.group.worktree, f.wt);
    assert.equal(first.group.definition_epoch, f.store.group('sample').definition_epoch);
    assert.equal(first.work[0].artifact_path, 'groups/sample/tasks/T1/task.md');
    assert.ok(first.messages.every(m => !['onboarding_ack', 'onboarding'].includes(m.data.type)));
    assert.equal('sessions' in first, false);
    const next = tools.invoke('team_read'); assert.equal('context' in next, false);
    f.store.send({ group_id: 'sample', role: 'lead' }, { to: 'coordinator', body: 'late' });
    const detailWithMessage = tools.invoke('team_read', { detail: true }); assert.ok(detailWithMessage.messages.some(m => m.data.body === 'late'));
    const late = tools.invoke('team_read'); assert.equal(late.messages[0].data.body, 'late');
    assert.equal(tools.invoke('team_read').messages.length, 0);
    tools.invalidateReadContext();
    const recovered = tools.invoke('team_read'); assert.ok(recovered.context); assert.ok(recovered.messages.some(m => m.data.body === 'late'));
    assert.equal(tools.invoke('team_read').messages.length, 0);
    f.store.settle('sample', 'coordinator', 'c', true);
    assert.equal(tools.invoke('team_read').messages.length, 0);
    assert.ok(tools.invoke('team_read', { detail: true }).sessions);
    const lifecycleRow = f.store.db.prepare('SELECT data FROM group_lifecycle WHERE group_id=?').get('sample');
    const lifecycle = JSON.parse(lifecycleRow.data); lifecycle.status = 'pending'; lifecycle.receipts = { executor: { body: 'executor ACK body' }, validator: { body: 'validator ACK body' } };
    f.store.db.prepare('UPDATE group_lifecycle SET data=? WHERE group_id=?').run(JSON.stringify(lifecycle), 'sample');
    const onboarding = tools.invoke('team_read');
    assert.equal(onboarding.lifecycle.receipts.executor.body, 'executor ACK body');
    assert.equal(onboarding.lifecycle.receipts.validator.body, 'validator ACK body');
  } finally { f.cleanup(); }
});

test('team_submit infers owned work path and round, but reports conflicting arguments', () => {
  const f = fixture(); try {
    f.prepare(); f.deliver(1);
    f.store.register('sample', 'validator', { pid: process.pid, launch_id: 'v' });
    const tools = new RoleTools(f.store, 'sample', 'validator', 'v');
    const read = tools.invoke('team_read');
    const work = read.work.find(w => w.kind === 'code_review-1');
    assert.equal(work.round, 1); assert.equal(work.artifact_path, 'groups/sample/tasks/T1/code-review-01.md');
    const path = join(f.wt, work.artifact_path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '# Review\nPass.\n');
    const submitted = tools.invoke('team_submit', { kind: 'code_review', verdict: 'pass' }); assert.equal(submitted.ok, true, JSON.stringify(submitted));
    tools.invoke('team_read');
    const replay = tools.invoke('team_submit', { work_id: work.id, kind: 'code_review', verdict: 'pass' });
    assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.receipt.replay, true);
    const current = tools.invoke('team_read');
    const mismatch = tools.invoke('team_submit', { kind: 'documentation', path: 'wrong.md', round: 1 });
    assert.equal(mismatch.code, 'WORK_PATH_CONFLICT');
    assert.deepEqual(mismatch.expected, { work_id: current.work.find(w => w.kind === 'documentation-1-1').id, path: 'groups/sample/tasks/T1/documentation-1-1.md', round: 1 });
    assert.ok(mismatch.current_work.some(w => w.kind === 'documentation-1-1'));
    const wrongOwner = tools.invoke('team_submit', { work_id: 99999, kind: 'code_review' });
    assert.equal(wrongOwner.code, 'WRONG_WORK'); assert.ok(wrongOwner.expected); assert.ok(Array.isArray(wrongOwner.current_work));
    const wrongRound = tools.invoke('team_submit', { kind: 'documentation', path: 'groups/sample/tasks/T1/documentation-1-1.md', round: 2 });
    assert.equal(wrongRound.code, 'WORK_ROUND_CONFLICT'); assert.equal(wrongRound.expected.round, 1);
    const task = f.store.task('T1'); task.docs_revision = 2; f.store.put('tasks', 'T1', task);
    assert.equal(tools.artifactPath('documentation-1-1', 'T1'), 'groups/sample/tasks/T1/documentation-1-1.md');
    assert.equal(tools.artifactPath('documentation-2', 'T1'), 'groups/sample/tasks/T1/documentation-2-2.md');
    assert.equal(tools.artifactPath('revision-1', 'T1'), 'groups/sample/tasks/T1/decision-1.md');
  } finally { f.cleanup(); }
});
