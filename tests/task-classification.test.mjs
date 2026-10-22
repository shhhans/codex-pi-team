import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './group-fixture.mjs';
import { GroupStore, git } from '../.pi/runtime/group-store.mjs';
import { finalize } from '../.pi/runtime/group-service.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';
import { pathToFileURL } from 'node:url';

for (const task_type of ['non_change', 'small_change', 'large_change']) test(`classified ${task_type} combines review and finalizes exact documentation`, () => {
  const f = fixture({ documentationPaths: ['README.md'] });
  try {
    f.submit('coordinator', 'task', 'task.md', { task_type, planning: 'direct' });
    assert.throws(() => f.submit('coordinator', 'task', 'task.md', { task_type: 'large_change' === task_type ? 'small_change' : 'large_change', planning: 'direct' }), /immutable/);
    if (task_type !== 'non_change') writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 2;\n');
    const commit = f.deliver(1);
    // Reopen the persistent store mid-review to exercise recovery/projection.
    const reopened = new GroupStore(f.main);
    try { assert.equal(reopened.task('T1').task_type, task_type); assert.equal(reopened.read('sample', 'validator').work[0].kind, 'code_review-1'); } finally { reopened.close(); }
    if (task_type === 'small_change') writeFileSync(join(f.wt, 'README.md'), '# Module\nresult=2\n');
    const input = { round: 1, commit, verdict: 'pass' };
    f.submit('validator', 'code_review', 'code-review-01.md', input);
    assert.equal(f.submit('validator', 'code_review', 'code-review-01.md', input).replay, true);
    const t = f.store.task('T1');
    assert.equal(t.documentation.integrated_review, true);
    assert.equal(t.documentation.code_commit, commit);
    assert.equal(t.documentation.commit === commit, task_type !== 'small_change');
    assert.deepEqual(f.store.read('sample', 'coordinator').work.map(w => w.kind), ['delivery-1']);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM work WHERE task_id='T1' AND kind LIKE 'documentation%'").get().n, 0);
    f.submit('coordinator', 'delivery', 'delivery.md'); f.store.accept('T1', 'Exact combined review passed');
    finalize(f.store, 'T1', { skipTests: true });
    assert.equal(f.store.task('T1').finalization.complete, true);
    assert.equal(git(f.main, 'show', 'HEAD:app.mjs'), `export const result = ${task_type === 'non_change' ? 1 : 2};`);
  } finally { f.cleanup(); }
});

test('non-change product mismatch cannot pass and uses existing blocked resolution', () => {
  const f = fixture(); try {
    f.submit('coordinator', 'task', 'task.md', { task_type: 'non_change', planning: 'direct' });
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 2;\n');
    const commit = f.deliver(1);
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' }), /non_change delivery modifies/);
    assert.equal(f.store.artifact('T1', 'code_review', 1), null);
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'blocked' });
    assert.equal(f.store.read('sample', 'coordinator').work[0].kind, 'blocked-1');
    f.submit('coordinator', 'resolution', 'decision-1.md', { round: 1 });
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 1;\n');
    const next = f.deliver(2);
    f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit: next, verdict: 'pass' });
    assert.equal(f.store.read('sample', 'coordinator').work[0].kind, 'delivery-2');
  } finally { f.cleanup(); }
});

test('classified review rejects unauthorized drift and staged prose, then can retry', () => {
  const f = fixture({ documentationPaths: ['README.md'] }); try {
    f.submit('coordinator', 'task', 'task.md', { task_type: 'small_change', planning: 'direct' });
    const commit = f.deliver(1), input = { round: 1, commit, verdict: 'pass' };
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 99;\n');
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', input), /production files changed/);
    writeFileSync(join(f.wt, 'app.mjs'), 'export const result = 1;\n');
    writeFileSync(join(f.wt, 'README.md'), '# Changed prose\n'); git(f.wt, 'add', 'README.md');
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', input), /empty index/);
    assert.equal(f.store.task('T1').documentation, null);
    git(f.wt, 'reset', '--', 'README.md');
    f.submit('validator', 'code_review', 'code-review-01.md', input);
    writeFileSync(join(f.wt, 'README.md'), '# Later drift\n');
    assert.throws(() => f.submit('coordinator', 'delivery', 'delivery.md'), /aligned documentation changed/);
  } finally { f.cleanup(); }
});

test('failed classified review requests fresh implementation and cannot align prose', () => {
  const f = fixture({ documentationPaths: ['README.md'] }); try {
    f.submit('coordinator', 'task', 'task.md', { task_type: 'large_change', planning: 'plan' });
    f.submit('executor', 'plan', 'plan.md'); const commit = f.deliver(1);
    writeFileSync(join(f.wt, 'README.md'), '# Premature prose\n');
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'changes_requested' }), /production files changed/);
    writeFileSync(join(f.wt, 'README.md'), '# Sample module\n');
    f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'changes_requested' });
    const next = f.deliver(2);
    assert.throws(() => f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit, verdict: 'pass' }), /stale delivery/);
    f.submit('validator', 'code_review', 'code-review-02.md', { round: 2, commit: next, verdict: 'pass' });
  } finally { f.cleanup(); }
});

test('classification validation and injected contract preserve defaults and identity', () => {
  const f = fixture(); try {
    assert.throws(() => f.submit('coordinator', 'task', 'task.md', { task_type: 'verification' }), /task_type must/);
    f.submit('coordinator', 'task', 'task.md', { task_type: 'large_change', planning: 'review' });
    f.store.register('sample', 'executor', { pid: process.pid, launch_id: 'classified' });
    const tools = new RoleTools(f.store, 'sample', 'executor', 'classified');
    const context = tools.invoke('team_read');
    assert.equal(context.task.task_type, 'large_change');
    f.submit('executor', 'plan', 'plan.md'); f.submit('validator', 'plan_review', 'plan-review.md');
    assert.equal(f.store.read('sample', 'executor').work[0].kind, 'implementation-1');
  } finally { f.cleanup(); }
});

test('installed extension limits classified Markdown edits to change-task review', async () => {
  const packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent');
  const { loadExtensions } = await import(pathToFileURL(join(packageRoot, 'dist/core/extensions/loader.js')).href);
  for (const task_type of ['small_change', 'non_change']) {
    const f = fixture({ documentationPaths: ['README.md'] }), previous = {};
    let ext;
    const ctx = { sessionManager: { getSessionFile: () => join(f.root, 'validator.jsonl') }, ui: { setStatus() {} } };
    try {
      f.submit('coordinator', 'task', 'task.md', { task_type, planning: 'direct' });
      f.deliver(1);
      for (const [key, value] of Object.entries({ PI_TEAM_GROUP_ID: 'sample', PI_TEAM_ROLE: 'validator', PI_TEAM_LAUNCH_ID: 'guard', PI_TEAM_PROJECT_ROOT: f.main, PI_TEAM_SESSION_ID: 'guard-session' })) { previous[key] = process.env[key]; process.env[key] = value; }
      const loaded = await loadExtensions([join(import.meta.dirname, '../.pi/communication/extensions/group.ts')], f.wt);
      assert.deepEqual(loaded.errors, []); ext = loaded.extensions[0];
      for (const fn of ext.handlers.get('session_start') || []) await fn({}, ctx);
      const guard = ext.handlers.get('tool_call')[0];
      const allowed = await guard({ toolName: 'edit', input: { path: 'README.md' } }, ctx);
      assert.equal(!!allowed?.block, task_type === 'non_change');
      assert.equal((await guard({ toolName: 'edit', input: { path: 'app.mjs' } }, ctx)).block, true);
      assert.equal((await guard({ toolName: 'edit', input: { path: 'other.md' } }, ctx)).block, true);
    } finally {
      if (ext) for (const fn of ext.handlers.get('session_shutdown') || []) await fn({}, ctx);
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      f.cleanup();
    }
  }
});
