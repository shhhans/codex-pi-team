import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './group-fixture.mjs';
import { git } from '../.pi/runtime/group-store.mjs';
import { finalize, startTask } from '../.pi/runtime/group-service.mjs';
import { RoleTools } from '../.pi/runtime/role-tools.mjs';
import { currentSharedContext, freezeSharedContext, publishSharedContext } from '../.pi/runtime/shared-context.mjs';

function ready(f) {
  f.prepare(); const commit = f.deliver(1);
  f.submit('validator', 'code_review', 'code-review-01.md', { round: 1, commit, verdict: 'pass' });
  f.alignDocs(1);
  return commit;
}
function submitKnowledge(f) {
  const path = f.file('delivery.md', '# Delivery\nAcceptance passed.\n\n## Shared knowledge\napp.mjs exports result; see app.mjs.\n\n## Risks\nNone.\n');
  return f.store.submit(f.actor('coordinator'), { kind: 'delivery', path, shared_context: { mode: 'update' } });
}

test('knowledge freezes with delivery, publishes only on successful finalization, and survives restart', () => {
  const f = fixture(); try {
    const commit = ready(f), artifact = submitKnowledge(f);
    assert.equal(artifact.shared_context.content, 'app.mjs exports result; see app.mjs.');
    assert.equal(artifact.shared_context.code_commit, commit);
    assert.equal(f.store.submit(f.actor('coordinator'), { kind: 'delivery', path: artifact.path, shared_context: { mode: 'update' } }).replay, true);
    assert.equal(currentSharedContext(f.store, 'sample'), null);
    assert.equal(publishSharedContext(f.store, f.store.task('T1')), null);
    assert.throws(() => f.store.submit(f.actor('coordinator'), { kind: 'delivery', path: artifact.path }), /immutable/);
    f.store.accept('T1', 'Lead checked knowledge and acceptance');
    assert.equal(currentSharedContext(f.store, 'sample'), null);
    assert.throws(() => finalize(f.store, 'T1')); // fixture has no integration runner
    assert.equal(currentSharedContext(f.store, 'sample'), null);
    const final = finalize(f.store, 'T1', { skipTests: true });
    const pointer = currentSharedContext(f.store, 'sample');
    assert.equal(pointer.version, 1); assert.equal(pointer.content, undefined);
    assert.equal(pointer.integration_commit, final.commit);
    assert.equal(currentSharedContext(f.store, 'sample', true).content, artifact.shared_context.content);
    finalize(f.store, 'T1', { skipTests: true });
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM shared_context').get().n, 1);
    startTask(f.store, 'sample', { task_id: 'T2', objective: 'follow up', acceptance: ['contract retained'], base_ref: 'develop' });
    f.store.register('sample', 'coordinator', { pid: process.pid, launch_id: 'next' });
    const tools = new RoleTools(f.store, 'sample', 'coordinator', 'next');
    assert.equal(tools.invoke('team_read').context.shared_context.hash, pointer.hash);
    assert.equal(tools.invoke('team_read', { shared_context: true }).shared_context.content, artifact.shared_context.content);
    const reuse = freezeSharedContext(f.store, f.store.group('sample'), f.store.task('T2'), { mode: 'reuse', version: 1 }, '');
    assert.equal(reuse.hash, pointer.hash);
    assert.throws(() => freezeSharedContext(f.store, f.store.group('sample'), f.store.task('T2'), { mode: 'reuse', version: 99 }, ''), /current published/);
    const group = f.store.group('sample'); group.definition_epoch++;
    f.store.put('groups', 'sample', group);
    assert.equal(currentSharedContext(f.store, 'sample'), null);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM shared_context').get().n, 1);
    assert.throws(() => freezeSharedContext(f.store, group, f.store.task('T2'), { mode: 'reuse', version: 1 }, ''), /current published/);
  } finally { f.cleanup(); }
});

test('knowledge validation preserves old clients and rejects malformed, oversized or out-of-phase updates', () => {
  const f = fixture(); try {
    const group = f.store.group('sample'), task = f.store.task('T1');
    assert.equal(freezeSharedContext(f.store, group, task, undefined, ''), null);
    assert.throws(() => freezeSharedContext(f.store, group, task, { mode: 'reuse', version: 1 }, ''), /current published/);
    for (const text of ['# Delivery\n', '## Shared knowledge\n\n## Risks\nNo knowledge.'])
      assert.throws(() => freezeSharedContext(f.store, group, task, { mode: 'update' }, text), /nonempty/);
    assert.throws(() => freezeSharedContext(f.store, group, task, { mode: 'update' }, '## Shared knowledge\n' + 'x'.repeat(6001)), /6000/);
    assert.throws(() => f.submit('coordinator', 'task', 'task.md', { shared_context: { mode: 'update' } }), /only allowed on delivery/);
    ready(f); f.submit('coordinator', 'delivery', 'delivery.md');
    f.store.accept('T1', 'legacy accepted'); finalize(f.store, 'T1', { skipTests: true });
    assert.equal(currentSharedContext(f.store, 'sample'), null);
  } finally { f.cleanup(); }
});

test('rejected and incomplete tasks never publish knowledge', () => {
  const f = fixture(); try {
    ready(f); submitKnowledge(f); f.store.requestChanges('T1', 'knowledge needs correction');
    assert.equal(publishSharedContext(f.store, f.store.task('T1')), null);
    f.store.cancel('T1', 'explicitly incomplete');
    git(f.wt, 'add', '.'); git(f.wt, 'commit', '-m', 'preserve incomplete evidence');
    finalize(f.store, 'T1');
    assert.equal(currentSharedContext(f.store, 'sample'), null);
  } finally { f.cleanup(); }
});
