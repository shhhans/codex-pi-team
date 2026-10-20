import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { GroupStore, git, parseCurrentState } from '../.pi/runtime/group-store.mjs';
import { startTask, finalize, roleArgs, launchGroup, stopGroup, updateGroup, syncGroup } from '../.pi/runtime/group-service.mjs';
import { call, rpc } from '../plugins/pi-team/server.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';
import { submitOnboarding, markOnboardingStopped, onboardingState } from '../.pi/runtime/group-onboarding.mjs';
import { scheduleOnboarding } from '../scripts/group-init-runner.mjs';
import { fixture, registerFixtureGroup } from './group-fixture.mjs';

function acceptReportTask(store, groupId, taskId) {
  const group = store.group(groupId);
  const task = group.active_task === taskId ? store.task(taskId) : startTask(store, groupId, { task_id: taskId, objective: 'retain a bounded report', acceptance: ['report retained'], base_ref: 'develop' });
  const prefix = `groups/${groupId}/tasks/${taskId}`;
  const write = (name, body) => {
    const path = join(group.worktree, prefix, name);
    mkdirSync(join(group.worktree, prefix), { recursive: true }); writeFileSync(path, body);
    return `${prefix}/${name}`;
  };
  const actor = role => ({ group_id: groupId, role, task_id: taskId, generation: task.generation });
  const submit = (role, kind, name, extra = {}) => store.submit(actor(role), { kind, path: write(name, `# ${name}\nReport evidence.\n`), ...extra });
  submit('coordinator', 'task', 'task.md'); submit('executor', 'plan', 'plan.md'); submit('validator', 'plan_review', 'plan-review.md');
  const implementation = write('implementation.md', '# Report only\nNo production changes.\n');
  git(group.worktree, 'add', '.'); git(group.worktree, 'commit', '-m', `report delivery ${taskId}`);
  const commit = git(group.worktree, 'rev-parse', 'HEAD');
  store.submit(actor('executor'), { kind: 'implementation', round: 1, commit, path: implementation });
  store.submit(actor('validator'), { kind: 'code_review', round: 1, commit, verdict: 'pass', path: write('code-review-01.md', '# Review\nPass.\n') });
  submit('validator', 'documentation', 'documentation-1-1.md', { round: 1 });
  submit('coordinator', 'documentation_review', 'documentation-review-1-1.md', { round: 1, verdict: 'pass' });
  submit('coordinator', 'delivery', 'delivery.md');
  const reviewDir = join(group.worktree, prefix, 'review-01'); mkdirSync(reviewDir, { recursive: true }); writeFileSync(join(reviewDir, 'log.md'), '# Independent review evidence\n');
  store.accept(taskId, 'Report acceptance criteria met.');
  return task;
}

function seedCompletedReportAndCandidate() {
  const f = fixture();
  registerFixtureGroup(f.store, 'other', join(f.root, 'other'));
  acceptReportTask(f.store, 'sample', 'T1'); finalize(f.store, 'T1', { skipTests: true });
  syncGroup(f.store, 'other');
  acceptReportTask(f.store, 'other', 'T2');
  return f;
}

test('runtime-owned identity sends without metadata and rejects a stale turn after switching tasks', () => {
  const f = fixture(); try {
    f.store.register('sample', 'executor', { pid: process.pid, launch_id: 'e' });
    const tools = new RoleTools(f.store, 'sample', 'executor', 'e');
    assert.equal(tools.invoke('team_send', { to: 'validator', body: 'hello' }).ok, true);
    const message = f.store.inbox('sample', 'validator').at(-1);
    assert.equal(message.data.task_id, 'T1');
    f.store.cancel('T1', 'switch test'); finalize(f.store, 'T1');
    startTask(f.store, 'sample', { task_id: 'T2', objective: 'next', acceptance: ['next'], base_ref: 'develop' });
    assert.equal(tools.invoke('team_send', { to: 'validator', body: 'old turn' }).code, 'STALE_TURN');
    assert.equal(f.store.inbox('sample', 'validator').filter(m => m.data.body === 'old turn').length, 0);
  } finally { f.cleanup(); }
});

test('submission inbox barrier is atomic, structured, and replay creates only one successor', () => {
  const f = fixture(); try {
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'c' });
    const tools = new RoleTools(f.store, 'sample', 'coordinator', 'c');
    tools.invoke('team_read'); const path = f.file('task.md');
    f.store.send({ group_id: 'sample', role: 'lead' }, { to: 'coordinator', body: 'late requirement' });
    assert.equal(tools.invoke('team_submit', { kind: 'task', path }).code, 'INBOX_PENDING');
    assert.equal(f.store.artifact('T1', 'task'), null);
    const read = tools.invoke('team_read'); assert.ok(read.messages.some(m => m.data.body === 'late requirement'));
    const work_id = read.work[0].id;
    assert.equal(tools.invoke('team_submit', { work_id: 9999, kind: 'task', path }).code, 'WRONG_WORK');
    const receipt = tools.invoke('team_submit', { work_id, kind: 'task', path });
    assert.equal(receipt.ok, true); assert.equal(receipt.receipt.work_id, work_id);
    assert.equal(tools.invoke('team_submit', { work_id, kind: 'task', path }).receipt.replay, true);
    assert.equal(f.store.read('sample', 'executor').work.length, 1);
  } finally { f.cleanup(); }
});

test('late implementation rewrite is rejected, normal model stop alerts Coordinator once and resolution permits D2', () => {
  const f = fixture(); try {
    f.prepare(); const commit = f.deliver(1);
    f.store.register('sample', 'validator', { pid: process.pid, launch_id: 'v' });
    const tools = new RoleTools(f.store, 'sample', 'validator', 'v'); tools.invoke('team_read');
    f.file('implementation.md', '# late correction\n');
    const result = tools.invoke('team_submit', { kind: 'code_review', verdict: 'pass', path: f.file('code-review-01.md') });
    assert.equal(result.ok, false); assert.match(result.code, /DELIVERY/);
    assert.equal(f.store.task('T1').review, null);
    tools.finish(); f.store.settle('sample', 'validator', 'v'); tools.finish();
    const reopened = new GroupStore(f.main);
    try { new RoleTools(reopened, 'sample', 'validator', 'v').finish(); } finally { reopened.close(); }
    assert.equal(f.store.inbox('sample', 'coordinator').filter(m => m.data.type === 'unfinished_work').length, 1);
    assert.equal(f.store.read('sample', 'validator').work[0].status, 'open');
    f.submit('coordinator', 'resolution', 'decision-1.md', { round: 1 });
    assert.equal(f.store.read('sample', 'validator').work.length, 0);
    const d2 = f.deliver(2); assert.notEqual(d2, commit);
    f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit: d2, verdict: 'pass' }); f.alignDocs(2);
    assert.equal(f.store.task('T1').review.verdict, 'pass');
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM artifacts WHERE kind='plan_review'").get().n, 1);
  } finally { f.cleanup(); }
});

test('delivery document changes cannot be hidden under task paths; independent review evidence is permitted', () => {
  const f = fixture(); try {
    f.prepare(); f.file('takeover.md', '# ownership v1\n'); const commit = f.deliver(1);
    f.file('review-01/independent.log', 'independent tests passed\n');
    f.file('takeover.md', '# silently changed v2\n');
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }), /delivery documents changed/);
    git(f.wt, 'restore', 'groups/sample/tasks/T1/takeover.md');
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' });
    assert.equal(f.store.task('T1').review.verdict, 'pass');
  } finally { f.cleanup(); }
});

test('documentation alignment is scoped, code-bound, revisable, and frozen before delivery', () => {
  const f = fixture({ documentationPaths: ['README.md'] }); try {
    f.prepare();
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 2;\n');
    const commit = f.deliver(1);
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' });
    f.file('documentation-1-1.md', '# Documentation review\nREADME describes the delivered result.\n');
    writeFileSync(join(f.wt, 'README.md'), '# Sample module\nThe module exports result 2.\n');
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 99;\n');
    assert.throws(() => f.submit('validator', 'documentation', 'documentation-1-1.md', { round: 1 }), /production files changed/);
    git(f.wt, 'restore', 'app.mjs');
    f.submit('validator', 'documentation', 'documentation-1-1.md', { round: 1 });
    const docs = f.store.task('T1').documentation;
    assert.equal(docs.code_commit, commit);
    assert.equal(git(f.wt, 'show', `${docs.commit}:README.md`), '# Sample module\nThe module exports result 2.');
    assert.deepEqual(git(f.wt, 'diff', commit, docs.commit, '--name-only').split(/\r?\n/), ['README.md']);
    f.file('documentation-review-1-1.md', '# Documentation verdict\nChanges requested: explain how the result is verified.\n');
    f.submit('coordinator', 'documentation_review', 'documentation-review-1-1.md', { round: 1, verdict: 'changes_requested' });
    assert.equal(f.store.task('T1').docs_revision, 2);
    assert.throws(() => f.submit('coordinator', 'delivery', 'delivery.md'), /No matching open work/);
    f.file('documentation-1-2.md', '# Documentation review\nREADME describes the result and verification.\n');
    writeFileSync(join(f.wt, 'README.md'), '# Sample module\nThe module exports result 2, verified by the integration check.\n');
    f.submit('validator', 'documentation', 'documentation-1-2.md', { round: 1 });
    const revised = f.store.task('T1').documentation;
    f.file('documentation-review-1-2.md', '# Documentation verdict\nPass.\n');
    f.submit('coordinator', 'documentation_review', 'documentation-review-1-2.md', { round: 1, verdict: 'pass' });
    writeFileSync(join(f.wt, 'README.md'), '# silently changed after review\n');
    assert.throws(() => f.submit('coordinator', 'delivery', 'delivery.md'), /documentation changed after submission|delivery documents changed/);
    git(f.wt, 'restore', 'README.md');
    f.file('delivery.md', '# Delivered\n'); f.submit('coordinator', 'delivery', 'delivery.md');
    assert.equal(f.store.task('T1').documentation.verdict, 'pass');
  } finally { f.cleanup(); }
});

test('onboarding cannot be marked stopped while a role is live or still busy', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const priorEpoch = f.store.group('sample').definition_epoch;
    const state = updateGroup(f.store, 'sample', { description: 'Updated sample responsibilities.' });
    assert.equal(state.status, 'pending'); assert.equal(state.epoch, priorEpoch + 1);
    const launches = {};
    for (const role of ['executor', 'validator', 'coordinator']) {
      const launch_id = `re-onboard-${role}`; launches[role] = launch_id;
      f.store.register('sample', role, { pid: 2147483647, launch_id, session_id: `re-session-${role}` });
      submitOnboarding(f.store, { group_id: 'sample', role, launch_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id }, { body: `ACK updated ${role} responsibilities.` });
    }
    f.store.updateSession('sample', 'executor', launches.executor, { pid: process.pid, busy: false });
    assert.throws(() => markOnboardingStopped(f.store, 'sample'), /have not stopped/);
    f.store.updateSession('sample', 'executor', launches.executor, { pid: 2147483647, busy: true });
    assert.throws(() => markOnboardingStopped(f.store, 'sample'), /have not stopped/);
    f.store.updateSession('sample', 'executor', launches.executor, { busy: false });
    assert.equal(markOnboardingStopped(f.store, 'sample').status, 'ready');
  } finally { f.cleanup(); }
});

test('acknowledged onboarding with only dead role processes recovers to ready without launching models', async () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'close fixture task'); finalize(f.store, 'T1');
    const state = updateGroup(f.store, 'sample', { description: 'Recovered sample responsibilities.' });
    const launches = {};
    for (const role of ['executor', 'validator', 'coordinator']) {
      const launch_id = `dead-recovery-${role}`; launches[role] = launch_id;
      f.store.register('sample', role, { pid: 2147483647, launch_id, session_id: `dead-session-${role}` });
      submitOnboarding(f.store, { group_id: 'sample', role, launch_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id }, { body: `ACK recovered ${role} responsibilities.` });
    }
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'acknowledged');
    const scheduled = scheduleOnboarding(f.store, 'sample', { timeout: 1000 });
    assert.equal(scheduled.status, 'scheduled');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && onboardingState(f.store, 'sample', 'lead').status !== 'ready') await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'ready');
    assert.ok(f.store.sessions('sample').every(session => session.pid === 2147483647));
  } finally { f.cleanup(); }
});

test('a committed desired definition applies after task completion and schedules its new epoch', () => {
  const f = fixture(); try {
    f.prepare(); const commit = f.deliver(1);
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }); f.alignDocs(1);
    f.submit('coordinator', 'delivery', 'delivery.md'); f.store.accept('T1', 'criteria checked');
    const oldEpoch = f.store.group('sample').definition_epoch;
    assert.equal(updateGroup(f.store, 'sample', { description: 'New responsibilities for next tasks.' }).status, 'waiting_for_task');
    git(f.main, 'add', 'groups/sample/group.md'); git(f.main, 'commit', '-m', 'update registered group responsibilities');
    const result = finalize(f.store, 'T1', { skipTests: true, scheduleOnboarding: () => ({ status: 'stubbed' }) });
    assert.equal(result.complete, true); assert.equal(result.initialization.status, 'stubbed');
    assert.equal(f.store.group('sample').definition_epoch, oldEpoch + 1);
    assert.equal(onboardingState(f.store, 'sample', 'lead').status, 'pending');
    assert.equal(f.store.group('sample').desired_definition, null);
    assert.ok(f.store.artifact('T1', 'delivery', 1));
    assert.match(readFileSync(join(f.main, 'groups/sample/group.md'), 'utf8'), /New responsibilities/);
    assert.equal(f.store.sessions('sample').length, 0);
  } finally { f.cleanup(); }
});

test('a recovered review cancels its pending runtime escalation before Coordinator can open an unnecessary revision', () => {
  const f = fixture(); try {
    f.prepare(); const commit = f.deliver(1);
    f.store.register('sample', 'validator', { pid: process.pid, launch_id: 'v' });
    const tools = new RoleTools(f.store, 'sample', 'validator', 'v'); tools.invoke('team_read');
    writeFileSync(join(f.wt, 'app.mjs'), 'accidental drift');
    const input = { kind: 'code_review', verdict: 'pass', path: f.file('code-review-01.md'), commit };
    assert.equal(tools.invoke('team_submit', input).ok, false); tools.finish();
    assert.ok(f.store.read('sample', 'coordinator').work.some(w => w.kind === 'blocked-1'));
    git(f.wt, 'restore', 'app.mjs');
    assert.equal(tools.invoke('team_submit', input).ok, true);
    assert.deepEqual(f.store.read('sample', 'validator').work.map(w => w.kind), ['documentation-1-1']);
    f.alignDocs(1);
    assert.deepEqual(f.store.read('sample', 'coordinator').work.map(w => w.kind), ['delivery-1']);
    assert.throws(() => f.submit('coordinator', 'resolution', 'decision-1.md', { round: 1 }), /No matching open work/);
    assert.equal(f.store.read('sample', 'executor').work.length, 0);
  } finally { f.cleanup(); }
});

test('one adversarial review leads to implementation, repair loop, independent acceptance and next task', () => {
  const f = fixture(); try {
    f.prepare(); assert.equal(f.store.read('sample', 'executor').work.at(-1).kind, 'implementation-1');
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 2;\n');
    const d1 = f.deliver(1);
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit: d1, verdict: 'changes_requested' });
    const d2 = f.deliver(2);
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit: d1, verdict: 'pass' }), /stale delivery/);
    f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit: d2, verdict: 'pass' });
    f.alignDocs(2);
    assert.throws(() => f.store.accept('T1', 'yes'), /not ready/);
    f.submit('coordinator', 'delivery', 'delivery.md'); f.store.accept('T1', 'criteria checked against D2');
    const done = finalize(f.store, 'T1', { skipTests: true }); assert.equal(done.complete, true);
    assert.equal(f.store.group('sample').active_task, null); assert.ok(readFileSync(join(f.main, 'groups/sample/tasks/T1/delivery.md'), 'utf8'));
    const next = startTask(f.store, 'sample', { task_id: 'T2', objective: 'next', acceptance: ['next result'], base_ref: 'develop' });
    assert.equal(next.generation, 3); assert.equal(f.store.group('sample').worktree, f.wt);
    assert.throws(() => f.store.submit(f.actor('executor'), { kind: 'plan', path: f.file('plan.md') }), /stale task/);
  } finally { f.cleanup(); }
});

test('artifact handoff is explicit, immutable, idempotent and does not create a second plan review', () => {
  const f = fixture(); try {
    f.file('task.md'); assert.equal(f.store.read('sample', 'executor').work.length, 0);
    const a = f.submit('coordinator', 'task', 'task.md'); const b = f.submit('coordinator', 'task', 'task.md'); assert.equal(b.replay, true); assert.equal(a.path, b.path);
    assert.equal(f.store.read('sample', 'executor').work.length, 1);
    f.submit('executor', 'plan', 'plan.md'); f.submit('validator', 'plan_review', 'plan-review.md');
    assert.equal(f.submit('validator', 'plan_review', 'plan-review.md').replay, true);
    f.file('plan-review.md', 'second review');
    assert.throws(() => f.store.submit(f.actor('validator'), { kind: 'plan_review', path: 'groups/sample/tasks/T1/plan-review.md' }), /immutable/);
    assert.equal(f.store.read('sample', 'executor').work.length, 1);
    assert.throws(() => f.submit('executor', 'code_review', 'code-review-01.md', { round: 1 }), /not owned/);
  } finally { f.cleanup(); }
});

test('failed submission rolls back closure and successor; missing files and wrong paths do not advance', () => {
  const f = fixture(); try {
    assert.throws(() => f.store.submit(f.actor('coordinator'), { kind: 'task', path: 'groups/sample/tasks/T1/task.md' }));
    assert.equal(f.store.read('sample', 'coordinator').work.length, 1);
    assert.throws(() => f.submit('coordinator', 'task', '../task.md'), /expected artifact path/);
    f.store.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
    assert.throws(() => f.submit('coordinator', 'task', 'task.md'), /injected storage failure/);
    assert.equal(f.store.artifact('T1', 'task'), null); assert.equal(f.store.read('sample', 'coordinator').work.length, 1);
    f.store.db.exec('DROP TRIGGER fail_message'); f.submit('coordinator', 'task', 'task.md');
    assert.equal(f.store.read('sample', 'executor').work.length, 1);
  } finally { f.cleanup(); }
});

test('undelivered/open work survives process replacement; duplicate wake does not claim concurrently', () => {
  const f = fixture(); try {
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'a', session_id: 'original' });
    assert.ok(f.store.claim('sample', 'coordinator', 'a')); assert.equal(f.store.claim('sample', 'coordinator', 'a'), null);
    f.store.settle('sample', 'coordinator', 'a');
    f.store.updateSession('sample', 'coordinator', 'a', { pid: 99999999 });
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'b', session_id: 'original' });
    assert.ok(f.store.claim('sample', 'coordinator', 'b').some(x => x.data.type === 'work_recovered'));
    assert.throws(() => f.store.updateSession('sample', 'coordinator', 'a', { busy: false }), /stale/);
    f.store.settle('sample', 'coordinator', 'b', false); assert.ok(f.store.claim('sample', 'coordinator', 'b'));
  } finally { f.cleanup(); }
});

test('review cannot approve changed production; blocked review requires recorded Coordinator resolution', () => {
  const f = fixture(); try {
    f.prepare(); const commit = f.deliver(1); writeFileSync(join(f.wt, 'app.mjs'), 'modified');
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }), /production files changed/);
    git(f.wt, 'restore', 'app.mjs');
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'blocked' });
    f.submit('coordinator', 'resolution', 'decision-1.md', { round: 1 });
    assert.equal(f.store.read('sample', 'executor').work.at(-1).kind, 'implementation-2');
  } finally { f.cleanup(); }
});

test('Lead contacts Coordinator, only Coordinators cross groups; inbox uses a cursor and bounded wait', async () => {
  const f = fixture(); try {
    registerFixtureGroup(f.store, 'other', join(f.root, 'other'));
    assert.throws(() => f.store.send(f.actor('executor'), { group_id: 'other', to: 'coordinator', body: 'request' }), /cross-group/);
    assert.throws(() => f.store.send(f.actor('validator'), { to: 'lead', body: 'report' }), /only Coordinator/);
    assert.throws(() => f.store.send({ group_id: 'sample', role: 'lead' }, { to: 'executor', body: 'work' }), /Coordinator only/);
    f.store.send(f.actor('coordinator'), { group_id: 'other', to: 'coordinator', body: 'dependency' });
    assert.equal(f.store.inbox('other', 'coordinator').at(-1).data.body, 'dependency');
    const result = await call('team_send', { project_root: f.main, group_id: 'sample', body: 'clarification' }); assert.ok(result.message_id);
    const waiting = await call('team_wait', { project_root: f.main, group_id: 'sample', timeout_ms: 0 });
    assert.equal(waiting.filter(m => m.data?.type !== 'onboarding_ack').length, 0);
    f.store.send(f.actor('coordinator'), { to: 'lead', body: 'need decision' });
    const messages = await call('team_inbox', { project_root: f.main, group_id: 'sample' });
    const business = messages.filter(m => m.data?.type !== 'onboarding_ack'); assert.equal(business.length, 1);
    assert.equal(business[0].data.body, 'need decision');
    assert.equal((await call('team_inbox', { project_root: f.main, group_id: 'sample', cursor: business[0].id })).filter(m => m.data?.type !== 'onboarding_ack').length, 0);
    const listedTools = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map(tool => tool.name);
    assert.ok(listedTools.includes('team_group_create')); assert.ok(listedTools.includes('team_inbox'));
  } finally { f.cleanup(); }
});

test('display prefix is optional and never a lifecycle transition; role launch has one tool source', () => {
  assert.equal(parseCurrentState('[current_state: "检查实现"]\nbody'), '检查实现');
  assert.equal(parseCurrentState('[current_state: broken]\nbody'), null); assert.equal(parseCurrentState('done'), null);
  const f = fixture(); try {
    const args = roleArgs(f.store, f.store.group('sample'), 'executor', 'session');
    assert.ok(args.includes('--no-extensions')); assert.ok(args.includes('--no-skills'));
    assert.ok(args.some(x => x.endsWith('group.ts'))); assert.ok(!args.some(x => /blackboard|contract-tools|intercom/.test(x)));
    assert.equal(f.store.task('T1').outcome, 'pending');
  } finally { f.cleanup(); }
});

test('SQLite rolls back a killed writer; independent processes converge on one handoff', async () => {
  const f = fixture(); try {
    const url = pathToFileURL(join(import.meta.dirname, '../.pi/runtime/group-store.mjs')).href;
    const prefix = `import {GroupStore} from ${JSON.stringify(url)}; const s=new GroupStore(${JSON.stringify(f.main)});`;
    const crashed = `${prefix} s.db.exec('BEGIN IMMEDIATE'); s.db.prepare("UPDATE work SET status='complete'").run(); process.exit(17);`;
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', crashed], { stdio: 'pipe', windowsHide: true }), e => e.status === 17);
    assert.equal(f.store.read('sample', 'coordinator').work.length, 1);
    f.file('task.md');
    const source = `${prefix} console.log(JSON.stringify(s.submit({group_id:'sample',role:'coordinator',task_id:'T1',generation:1},{kind:'task',path:'groups/sample/tasks/T1/task.md'})));s.close();`;
    const run = () => new Promise((resolve, reject) => { const c = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true }); let out = '', err = ''; c.stdout.on('data', x => out += x); c.stderr.on('data', x => err += x); c.on('error', reject); c.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(Error(err))); });
    const results = await Promise.all([run(), run()]);
    assert.equal(results.filter(x => x.replay).length, 1); assert.equal(f.store.read('sample', 'executor').work.length, 1);
  } finally { f.cleanup(); }
});

test('native Windows entrypoint and stdio Lead server expose the same authority', async () => {
  const f = fixture(); try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, '../scripts/pi-team.ps1'), 'inventory'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PI_TEAM_PROJECT_ROOT: f.main } });
    assert.equal(JSON.parse(output).groups[0].definition.id, 'sample');
    const response = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(import.meta.dirname, '../plugins/pi-team/server.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = ''; const timer = setTimeout(() => { child.kill(); reject(Error('MCP response timeout')); }, 15000);
      child.stdout.on('data', x => { buffer += x; if (buffer.includes('\n')) { clearTimeout(timer); child.kill(); resolve(JSON.parse(buffer.split('\n')[0])); } }); child.on('error', reject);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'team_send', arguments: { project_root: f.main, group_id: 'sample', body: 'durable Lead request' } } }) + '\n');
    });
    assert.equal(response.id, 7); assert.equal(f.store.inbox('sample', 'coordinator').at(-1).data.body, 'durable Lead request');
  } finally { f.cleanup(); }
});

test('Lead changes pass through Coordinator and retain old delivery evidence', () => {
  const f = fixture(); try {
    f.prepare(); const commit = f.deliver(1); f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }); f.alignDocs(1);
    f.submit('coordinator', 'delivery', 'delivery.md'); f.store.accept('T1', 'checked');
    f.store.requestChanges('T1', 'missing acceptance evidence');
    assert.equal(f.store.task('T1').outcome, 'pending'); assert.equal(f.store.read('sample', 'coordinator').work.at(-1).kind, 'revision-1');
    assert.equal(f.store.read('sample', 'executor').work.length, 0); assert.ok(f.store.artifact('T1', 'delivery', 1));
    f.submit('coordinator', 'resolution', 'decision-1.md', { round: 1 }); assert.equal(f.store.read('sample', 'executor').work.at(-1).kind, 'implementation-2');
  } finally { f.cleanup(); }
});

test('Windows hidden launcher forwards group identity and resumes original sessions/configuration', async () => {
  const f = fixture(), previous = process.env.PI_CMD;
  try {
    const storeURL = pathToFileURL(join(import.meta.dirname, '../.pi/runtime/group-store.mjs')).href;
    const fake = `import{GroupStore}from ${JSON.stringify(storeURL)};import{writeFileSync}from'node:fs';import{join}from'node:path';const e=process.env,s=new GroupStore(e.PI_TEAM_PROJECT_ROOT),p=join(s.root,e.PI_TEAM_GROUP_ID+'-'+e.PI_TEAM_ROLE+'-test-session.jsonl');writeFileSync(p,'session');s.register(e.PI_TEAM_GROUP_ID,e.PI_TEAM_ROLE,{pid:process.pid,started_at:new Date(Date.now()-process.uptime()*1000).toISOString(),launch_id:e.PI_TEAM_LAUNCH_ID,session_id:e.PI_TEAM_SESSION_ID,session_path:p,config:JSON.parse(e.PI_TEAM_ROLE_CONFIG)});setInterval(()=>{},1000);`;
    writeFileSync(join(f.root, 'fake-role.mjs'), fake);
    const cmd = join(f.root, 'fake-pi.cmd'); writeFileSync(cmd, '@echo off\r\nnode "%~dp0fake-role.mjs" %*\r\n'); process.env.PI_CMD = cmd;
    const first = await launchGroup(f.store, 'sample', { headless: true, timeout: 15000 }); assert.equal(first.length, 3);
    const sessions = f.store.sessions('sample'); assert.equal(new Set(sessions.map(s => s.pid)).size, 3);
    stopGroup(f.store, 'sample');
    const deadline = Date.now() + 10000; while (f.store.sessions('sample').some(s => { try { process.kill(s.pid, 0); return true; } catch { return false; } }) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    await launchGroup(f.store, 'sample', { headless: true, timeout: 15000 });
    for (const old of sessions) { const current = f.store.session('sample', old.role); assert.equal(current.session_id, old.session_id); assert.deepEqual(current.config, old.config); assert.notEqual(current.launch_id, old.launch_id); }
  } finally { try { stopGroup(f.store, 'sample', true); } finally { if (previous === undefined) delete process.env.PI_CMD; else process.env.PI_CMD = previous; f.cleanup(); } }
});

test('accepted report-only deliveries from different groups can finalize sequentially', () => {
  const f = fixture(); try {
    registerFixtureGroup(f.store, 'other', join(f.root, 'other'));
    acceptReportTask(f.store, 'sample', 'T1'); acceptReportTask(f.store, 'other', 'T2');
    assert.equal(finalize(f.store, 'T1', { skipTests: true }).complete, true);
    assert.equal(finalize(f.store, 'T2', { skipTests: true }).complete, true);
  } finally { f.cleanup(); }
});

test('finalization rejects process paths without a completed accepted task record', () => {
  const f = seedCompletedReportAndCandidate(); try {
    // A real pending task record must not authorize its process files.
    registerFixtureGroup(f.store, 'pending', join(f.root, 'pending'));
    startTask(f.store, 'pending', { task_id: 'T3', objective: 'pending report', acceptance: ['retained'], base_ref: 'develop' });
    const path = 'groups/pending/tasks/T3/claim.md'; mkdirSync(join(f.main, 'groups/pending/tasks/T3'), { recursive: true }); writeFileSync(join(f.main, path), '# Pending claim\n');
    git(f.main, 'add', path); git(f.main, 'commit', '-m', 'unaccepted task evidence');
    assert.throws(() => finalize(f.store, 'T2', { skipTests: true }), /target implementation changed/);
  } finally { f.cleanup(); }
});

test('finalization rejects forged task paths and modified completed report evidence', async t => {
  await t.test('forged path', () => {
    const f = seedCompletedReportAndCandidate(); try {
      const path = 'groups/other/tasks/FORGED/claim.md'; mkdirSync(join(f.main, 'groups/other/tasks/FORGED'), { recursive: true }); writeFileSync(join(f.main, path), '# Forged claim\n');
      git(f.main, 'add', path); git(f.main, 'commit', '-m', 'forged task evidence');
      assert.throws(() => finalize(f.store, 'T2', { skipTests: true }), /target implementation changed/);
    } finally { f.cleanup(); }
  });
  await t.test('modified completed evidence', () => {
    const f = seedCompletedReportAndCandidate(); try {
      const path = join(f.main, 'groups/sample/tasks/T1/task.md'); writeFileSync(path, '# Changed after completion\n');
      git(f.main, 'add', '.'); git(f.main, 'commit', '-m', 'modify completed report');
      assert.throws(() => finalize(f.store, 'T2', { skipTests: true }), /target implementation changed/);
    } finally { f.cleanup(); }
  });
});

test('finalization continues to reject production changes since the task baseline', () => {
  const f = seedCompletedReportAndCandidate(); try {
    writeFileSync(join(f.main, 'app.mjs'), 'export const result = 99;\n'); git(f.main, 'add', 'app.mjs'); git(f.main, 'commit', '-m', 'unreviewed production change');
    assert.throws(() => finalize(f.store, 'T2', { skipTests: true }), /target implementation changed/);
  } finally { f.cleanup(); }
});

test('cutover refuses unfinished legacy work and busy group switching', () => {
  const f = fixture(); try {
    const old = join(f.store.common, 'pi-team/v1'); mkdirSync(old, { recursive: true }); writeFileSync(join(old, 'OLD.json'), JSON.stringify({ task_id: 'OLD', outcome: 'pending' }));
    assert.throws(() => f.store.assertCutover(), /OLD/);
    f.store.register('sample', 'executor', { pid: process.pid, launch_id: 'x' }); f.store.updateSession('sample', 'executor', 'x', { busy: true });
    assert.throws(() => f.store.cancel('T1', 'stop'), /busy/);
    f.store.settle('sample', 'executor', 'x'); f.store.cancel('T1', 'explicitly closed');
    assert.equal(f.store.task('T1').outcome, 'incomplete');
  } finally { f.cleanup(); }
});

test('integration test failure preserves the merge and retries without merging twice', () => {
  const f = fixture(), old = process.env.PI_INTEGRATION_NEGATIVE;
  try {
    mkdirSync(join(f.wt, 'tests')); writeFileSync(join(f.wt, 'tests/run-tests.mjs'), "if(process.env.PI_INTEGRATION_NEGATIVE) throw Error('negative-control integration failure');\n");
    f.prepare(); const commit = f.deliver(1); f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }); f.alignDocs(1);
    f.submit('coordinator', 'delivery', 'delivery.md'); f.store.accept('T1', 'checked');
    process.env.PI_INTEGRATION_NEGATIVE = '1'; assert.throws(() => finalize(f.store, 'T1'));
    const integrated = git(f.main, 'rev-parse', 'HEAD'); assert.equal(f.store.task('T1').finalization.merged, true); assert.ok(f.store.task('T1').finalization.last_error);
    delete process.env.PI_INTEGRATION_NEGATIVE;
    assert.equal(finalize(f.store, 'T1').complete, true); assert.equal(git(f.main, 'rev-parse', 'HEAD'), integrated);
    assert.equal(finalize(f.store, 'T1').complete, true);
  } finally { if (old === undefined) delete process.env.PI_INTEGRATION_NEGATIVE; else process.env.PI_INTEGRATION_NEGATIVE = old; f.cleanup(); }
});

test('task switching recovers a recorded Git/SQLite interruption and keeps operation ownership', () => {
  const f = fixture(); try {
    f.store.cancel('T1', 'unused fixture task'); finalize(f.store, 'T1');
    assert.throws(() => startTask(f.store, 'sample', { task_id: 'BAD', objective: '', acceptance: [], base_ref: 'develop' }), /objective/);
    assert.equal(f.store.group('sample').transition, undefined);
    const input = { task_id: 'T2', objective: 'next task', acceptance: ['result'], base_ref: 'develop' }, branch = 'codex/sample/T2';
    const g = f.store.group('sample'); g.transition = { input, branch, base_commit: git(f.main, 'rev-parse', 'develop') }; f.store.put('groups', 'sample', g);
    git(f.wt, 'switch', '-c', branch, g.transition.base_commit);
    const next = startTask(f.store, 'sample', input); assert.equal(next.task_id, 'T2'); assert.equal(f.store.group('sample').transition, undefined);
    f.store.operation('integration', () => assert.throws(() => f.store.operation('integration', () => {}), /in progress/));
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM operations').get().n, 0);
  } finally { f.cleanup(); }
});

test('installed Pi loads the real extension: tools, message prefix, handoff, guards and session recovery', async () => {
  const packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA || '', 'npm/node_modules/@earendil-works/pi-coding-agent');
  const { loadExtensions } = await import(pathToFileURL(join(packageRoot, 'dist/core/extensions/loader.js')).href);
  const f = fixture(); const previous = {}; const loaded = []; const steered = [];
  const ctx = { isIdle: () => true, sessionManager: { getSessionFile: () => join(f.root, 'session.jsonl') }, ui: { setStatus() {} }, getContextUsage: () => ({ percent: 0 }) };
  try {
    for (const role of ['coordinator', 'executor', 'validator']) {
      for (const [key, value] of Object.entries({ PI_TEAM_GROUP_ID: 'sample', PI_TEAM_ROLE: role, PI_TEAM_LAUNCH_ID: role, PI_TEAM_PROJECT_ROOT: f.main, PI_TEAM_SESSION_ID: `${role}-session` })) { if (!(key in previous)) previous[key] = process.env[key]; process.env[key] = value; }
      const result = await loadExtensions([join(import.meta.dirname, '../.pi/communication/extensions/group.ts')], f.wt);
      assert.deepEqual(result.errors, []);
      result.runtime.sendUserMessage = (content, options) => steered.push({ role, content, options });
      const ext = result.extensions[0]; loaded.push(ext);
      for (const fn of ext.handlers.get('session_start') || []) await fn({}, ctx);
      assert.deepEqual([...ext.tools.keys()], role === 'coordinator' ? ['team_read', 'team_send', 'team_submit', 'team_service'] : ['bash', 'team_read', 'team_send', 'team_submit']);
    }
    const [c, e, v] = loaded;
    const tool = (ext, name, input) => ext.tools.get(name).definition.execute('call', input, undefined, undefined, ctx);
    const submit = async (ext, kind, name, extra = {}) => { await tool(ext, 'team_read', {}); const result = await tool(ext, 'team_submit', { task_id: 'T1', generation: 1, kind, path: f.file(name), ...extra }); assert.equal(JSON.parse(result.content[0].text).ok, true, result.content[0].text); return result; };
    assert.equal(JSON.parse((await tool(c, 'team_read', {})).content[0].text).task.task_id, 'T1');
    await submit(c, 'task', 'task.md'); await submit(e, 'plan', 'plan.md');
    const guard = e.handlers.get('tool_call')[0];
    assert.equal((await guard({ toolName: 'write', input: { path: 'app.mjs' } }, ctx)).block, true);
    await submit(v, 'plan_review', 'plan-review.md');
    assert.equal(await guard({ toolName: 'write', input: { path: 'app.mjs' } }, ctx), undefined);
    // A notification arriving during implementation is steered before the next
    // model response. Same-batch mutations/submissions must wait for that response.
    for (const fn of e.handlers.get('agent_start')) await fn({}, ctx);
    await tool(e, 'team_read', {});
    f.store.send(f.actor('validator'), { to: 'executor', body: 'late but pre-delivery requirement' });
    for (const fn of e.handlers.get('tool_result')) await fn({ toolName: 'bash' }, ctx);
    assert.equal(steered.at(-1).options.deliverAs, 'steer');
    assert.match(steered.at(-1).content, /late but pre-delivery requirement/);
    assert.equal((await guard({ toolName: 'write', input: { path: 'app.mjs' } }, ctx)).block, true);
    await assert.rejects(() => tool(e, 'team_submit', { kind: 'implementation', path: 'missing.md' }), error => {
      assert.equal(JSON.parse(error.message).ok, false);
      assert.equal(JSON.parse(error.message).code, 'INBOX_PENDING');
      return true;
    });
    for (const fn of e.handlers.get('turn_start')) await fn({}, ctx);
    assert.equal(await guard({ toolName: 'write', input: { path: 'app.mjs' } }, ctx), undefined);
    assert.equal((await guard({ toolName: 'edit', input: { path: 'groups/sample/tasks/T1/plan.md' } }, ctx)).block, true);
    const validatorGuard = v.handlers.get('tool_call')[0];
    assert.equal((await validatorGuard({ toolName: 'write', input: { path: 'groups/sample/tasks/T1/verification/log.txt' } }, ctx)).block, true);
    assert.equal(await validatorGuard({ toolName: 'write', input: { path: 'groups/sample/tasks/T1/review-01/log.txt' } }, ctx), undefined);
    const shell = await tool(e, 'bash', { command: "Write-Output ('native-' + $PSVersionTable.PSEdition)" });
    assert.match(shell.content[0].text, /native-Desktop/);
    for (const fn of e.handlers.get('message_end')) await fn({ message: { role: 'assistant', content: [{ type: 'text', text: '[current_state: "reviewing evidence"]\nbody' }] } }, ctx);
    assert.equal(f.store.session('sample', 'executor').current_state, 'reviewing evidence');
    const sessionId = f.store.session('sample', 'executor').session_id;
    assert.equal(sessionId, 'executor-session');
    for (const fn of e.handlers.get('agent_end')) await fn({ messages: [] }, ctx);
    for (const fn of e.handlers.get('agent_settled')) await fn({}, ctx);
    assert.equal(f.store.read('sample', 'executor').work[0].kind, 'implementation-1');
    const compactOptions = []; const compactCtx = { ...ctx, getContextUsage: () => ({ percent: 60 }), compact: options => { assert.ok(f.store.session('sample', 'executor').compact_summary); compactOptions.push(options); } };
    for (const fn of e.handlers.get('agent_settled')) { await fn({}, compactCtx); await fn({}, compactCtx); }
    assert.equal(compactOptions.length, 1); compactOptions[0].onError(Error('negative control'));
    for (const fn of e.handlers.get('agent_settled')) await fn({}, compactCtx);
    assert.equal(compactOptions.length, 1); assert.equal(f.store.read('sample', 'executor').work.length, 1);
    for (const fn of e.handlers.get('agent_end')) await fn({ messages: [{ role: 'assistant', stopReason: 'error' }] }, ctx);
    for (const fn of e.handlers.get('agent_settled')) await fn({}, ctx);
    assert.match(f.store.session('sample', 'executor').fault, /explicit group-resume/);
    assert.equal(f.store.read('sample', 'executor').work.length, 1);
  } finally {
    for (const ext of loaded) for (const fn of ext.handlers.get('session_shutdown') || []) await fn({}, ctx);
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    f.cleanup();
  }
});
