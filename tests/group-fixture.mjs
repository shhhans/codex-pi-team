import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { GroupStore, git } from '../.pi/runtime/group-store.mjs';
import { createGroup, startTask, syncGroup } from '../.pi/runtime/group-service.mjs';
import { submitOnboarding, markOnboardingStopped } from '../.pi/runtime/group-onboarding.mjs';

export function fixture({ documentationPaths = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pi-group-'));
  const main = join(root, 'main'), wt = join(root, 'group'); mkdirSync(main);
  git(main, 'init', '-b', 'develop'); git(main, 'config', 'core.autocrlf', 'false'); git(main, 'config', 'user.name', 'Runtime Test'); git(main, 'config', 'user.email', 'test@example.invalid');
  mkdirSync(join(main, '.pi'), { recursive: true });
  writeFileSync(join(main, '.pi/project.json'), JSON.stringify({ integration: { executable: process.execPath, args: ['tests/run-tests.mjs'] } }, null, 2));
  writeFileSync(join(main, 'README.md'), '# Sample module\n');
  writeFileSync(join(main, 'app.mjs'), 'export const result = 1;\n'); git(main, 'add', '.'); git(main, 'commit', '-m', 'baseline');
  const store = new GroupStore(main); registerFixtureGroup(store, 'sample', wt);
  const input = { task_id: 'T1', objective: 'return two', acceptance: ['result equals two'], base_ref: 'develop' };
  startTask(store, 'sample', { ...input, documentation_paths: documentationPaths, documentation_checklist: ['README matches the shipped module behavior.'] });
  const file = (name, body = `# ${name}\nEvidence and reasoning.\n`) => { const path = `groups/sample/tasks/T1/${name}`; mkdirSync(dirname(join(wt, path)), { recursive: true }); writeFileSync(join(wt, path), body); return path; };
  const actor = role => ({ group_id: 'sample', role, task_id: 'T1', generation: 1 });
  const submit = (role, kind, name, extra = {}) => store.submit(actor(role), { kind, path: file(name), ...extra });
  const alignDocs = round => {
    submit('validator', 'documentation', `documentation-${round}-1.md`, { round });
    submit('coordinator', 'documentation_review', `documentation-review-${round}-1.md`, { round, verdict: 'pass' });
  };
  const prepare = () => { submit('coordinator', 'task', 'task.md'); submit('executor', 'plan', 'plan.md'); submit('validator', 'plan_review', 'plan-review.md'); };
  const deliver = round => { file('implementation.md', `# Implementation ${round}\nPlan review addressed. Tests run.\n`); git(wt, 'add', '.'); git(wt, 'commit', '--allow-empty', '-m', `delivery ${round}`); const commit = git(wt, 'rev-parse', 'HEAD'); store.submit(actor('executor'), { kind: 'implementation', round, commit, path: 'groups/sample/tasks/T1/implementation.md' }); return commit; };
  const cleanup = () => { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); };
  return { root, main, wt, store, file, actor, submit, prepare, deliver, alignDocs, cleanup };
}

export function registerFixtureGroup(store, groupId, worktree) {
  const { onboarding } = createGroup(store, { group_id: groupId, name: `${groupId} module`, description: `Responsibilities for ${groupId}.`, worktree, base_ref: 'develop' });
  git(store.projectRoot, 'add', '.pi/project.json', `groups/${groupId}/group.md`); git(store.projectRoot, 'commit', '-m', `register ${groupId}`);
  syncGroup(store, groupId);
  for (const role of ['executor', 'validator', 'coordinator']) {
    const launch_id = `fixture-${groupId}-${role}`;
    store.register(groupId, role, { pid: 2147483647, launch_id, session_id: `session-${launch_id}` });
    submitOnboarding(store, { group_id: groupId, role, launch_id, definition_epoch: onboarding.epoch, lifecycle_id: onboarding.operation_id }, { body: `ACK responsibilities for ${role}.` });
  }
  markOnboardingStopped(store, groupId);
}
