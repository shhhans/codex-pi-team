// Opt-in paid-provider acceptance. Retains the isolated repo and raw role sessions.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GroupStore, git, ROLES, alive } from '../.pi/runtime/group-store.mjs';
import { createGroup, syncGroup, startTask, roleArgs, roleConfig, sourceRoot, finalize, stopGroup } from '../.pi/runtime/group-service.mjs';
import { onboardingState } from '../.pi/runtime/group-onboarding.mjs';
import { currentSharedContext } from '../.pi/runtime/shared-context.mjs';
import { scheduleOnboarding } from '../scripts/group-init-runner.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-live-efficiency-')), main = join(root, 'main'), wt = join(root, 'group');
console.log(JSON.stringify({ evidence_root: root }));
mkdirSync(main); git(main, 'init', '-b', 'develop');
for (const [key, value] of Object.entries({ 'core.autocrlf': 'false', 'user.name': 'Pi Acceptance', 'user.email': 'acceptance@example.invalid' })) git(main, 'config', key, value);
mkdirSync(join(main, '.pi')); mkdirSync(join(main, 'tests')); mkdirSync(join(main, 'docs'));
writeFileSync(join(main, 'AGENTS.md'), 'Isolated module. app.mjs exports numeric result. Tests: node tests/run-tests.mjs. Module documentation: docs/module.md. Read assigned task before action. Keep reports concise. Lead owns group.md. Use loaded role instructions and native PowerShell.\n');
writeFileSync(join(main, 'app.mjs'), 'export const result = 1;\n');
writeFileSync(join(main, 'docs/module.md'), '# Module\napp.mjs exports result = 1.\n');
writeFileSync(join(main, 'tests/run-tests.mjs'), "import assert from 'node:assert/strict'; import {result} from '../app.mjs'; assert.equal(result,2); console.log('result=2 verified');\n");
writeFileSync(join(main, '.pi/project.json'), JSON.stringify({ integration: { executable: process.execPath, args: ['tests/run-tests.mjs'] } }));
git(main, 'add', '.'); git(main, 'commit', '-m', 'isolated baseline');
const store = new GroupStore(main), children = [], results = [];
async function until(predicate, timeout, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lifecycle = onboardingState(store, 'sample', 'lead');
    if (lifecycle?.status === 'failed') throw Error(`onboarding failed: ${lifecycle.error}`);
    const fault = store.sessions('sample').find(s => s.fault);
    if (fault) throw Error(`${fault.role}: ${fault.fault}`);
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error(`timeout: ${description}`);
}
function launch(role) {
  const prior = store.session('sample', role), launchId = randomUUID();
  const args = roleArgs(store, store.group('sample'), role, prior.session_id).slice(0, -1);
  const packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent');
  const child = spawn(process.execPath, [join(packageRoot, 'dist/cli.js'), '--mode', 'rpc', ...args], {
    cwd: wt, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PI_TEAM_PROJECT_ROOT: main, PI_TEAM_SOURCE_ROOT: sourceRoot, PI_TEAM_GROUP_ID: 'sample', PI_TEAM_ROLE: role, PI_TEAM_SESSION_ID: prior.session_id, PI_TEAM_LAUNCH_ID: launchId, PI_TEAM_ROLE_CONFIG: JSON.stringify(prior.config || roleConfig()[role]) },
  });
  child.stdout.on('data', bytes => appendFileSync(join(root, `${role}-rpc.jsonl`), bytes));
  child.stderr.on('data', bytes => appendFileSync(join(root, `${role}-stderr.txt`), bytes));
  children.push(child);
}
function metrics() {
  const total = { responses: 0, team_read: 0, notification_bytes: 0, input: 0, output: 0, cacheRead: 0 };
  for (const session of store.sessions('sample')) {
    for (const line of readFileSync(session.session_path, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const entry = JSON.parse(line), message = entry.message;
      if (entry.type === 'custom_message' && entry.customType === 'pi-team-context') total.notification_bytes += Buffer.byteLength(JSON.stringify(entry.content));
      if (!message) continue;
      if (message.role === 'assistant') {
        total.responses++;
        for (const key of ['input', 'output', 'cacheRead']) total[key] += message.usage?.[key] || 0;
        total.team_read += (message.content || []).filter(c => c.type === 'toolCall' && c.name === 'team_read').length;
      }
      if (message.role === 'user' && typeof message.content === 'string' && /Pi Team runtime context/.test(message.content)) total.notification_bytes += Buffer.byteLength(message.content);
    }
  }
  return total;
}
try {
  createGroup(store, { group_id: 'sample', name: 'Sample module', description: 'Own app.mjs numeric result contract, tests and docs/module.md. Maintain reusable team knowledge.', worktree: wt, base_ref: 'develop' });
  scheduleOnboarding(store, 'sample');
  await until(() => onboardingState(store, 'sample', 'lead')?.status === 'ready' && store.sessions('sample').every(s => !alive(s.pid)), 480000, 'finite real onboarding');
  git(main, 'add', 'groups/sample/group.md'); git(main, 'commit', '-m', 'Lead registers sample'); syncGroup(store, 'sample');
  const ids = Object.fromEntries(store.sessions('sample').map(s => [s.role, s.session_id]));
  for (const role of ROLES) launch(role);
  await until(() => store.sessions('sample').every(s => alive(s.pid)), 60000, 'persistent roles ready');
  for (const number of [1, 2]) {
    const before = metrics(), taskId = `EFF-${number}`, started = Date.now();
    startTask(store, 'sample', { task_id: taskId, base_ref: 'develop',
      objective: number === 1
        ? 'Change app.mjs result from 1 to 2; run node tests/run-tests.mjs. Align docs/module.md. Use direct planning. Coordinator: delivery must include concise reusable module knowledge under ## Shared knowledge and submit shared_context mode=update. Cite app.mjs and the test command. Keep reports short.'
        : 'Verify the integrated result=2 contract with existing node tests/run-tests.mjs, without changing production behavior. Deliver a committed implementation.md with verification evidence; no new plan or test program is needed. Use direct planning. Coordinator: retrieve published shared knowledge, reuse its version in delivery shared_context mode=reuse. Validator independently verifies and explains no-change documentation alignment. Keep reports short.',
      acceptance: ['app.mjs exports result=2 and existing tests pass', 'docs/module.md accurately describes result=2', number === 1 ? 'delivery proposes reusable knowledge with sources' : 'delivery reuses the published knowledge version'],
      documentation_paths: ['docs/module.md'], documentation_checklist: ['Document actual result=2; if already accurate explain no change.'],
    });
    await until(() => store.artifact(taskId, 'delivery', store.task(taskId).round), 600000, `${taskId} reviewed delivery`);
    await until(() => store.sessions('sample').every(s => !s.busy), 60000, 'delivery settled');
    const task = store.task(taskId), delivery = store.artifact(taskId, 'delivery', task.round);
    assert.equal(task.planning, 'direct'); assert.equal(task.review.verdict, 'pass'); assert.equal(task.documentation.verdict, 'pass');
    assert.equal(delivery.shared_context?.mode, number === 1 ? 'update' : 'reuse');
    assert.match(readFileSync(join(wt, 'app.mjs'), 'utf8'), /result\s*=\s*2/);
    assert.match(readFileSync(join(wt, 'docs/module.md'), 'utf8'), /2/);
    store.accept(taskId, 'Lead checked result, module prose, code/documentation reviews and shared knowledge source/version.');
    finalize(store, taskId);
    assert.equal(currentSharedContext(store, 'sample').version, 1);
    const after = metrics();
    results.push({ task_id: taskId, elapsed_ms: Date.now() - started, metrics: Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]])), shared_context: currentSharedContext(store, 'sample') });
    for (const session of store.sessions('sample')) assert.equal(session.session_id, ids[session.role]);
    writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: number === 2, tasks: results, evidence_root: root }, null, 2));
    console.log(JSON.stringify(results.at(-1)));
  }
} catch (error) {
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: false, error: error.stack, tasks: results, evidence_root: root }, null, 2));
  console.error(error.stack); process.exitCode = 1;
} finally {
  try { stopGroup(store, 'sample', true); }
  catch (error) {
    writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: false, cleanup_error: error.message, tasks: results, evidence_root: root }, null, 2));
    console.error(`Owned process cleanup requires inspection: ${error.message}`); process.exitCode = 1;
  }
  for (const child of children) child.kill();
  store.close();
}
