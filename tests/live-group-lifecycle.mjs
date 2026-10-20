// Explicit paid three-role acceptance; all outputs retained in an isolated repo.
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { GroupStore, git, ROLES, alive } from '../.pi/runtime/group-store.mjs';
import { createGroup, updateGroup, syncGroup, startTask, roleArgs, roleConfig, sourceRoot, finalize } from '../.pi/runtime/group-service.mjs';
import { onboardingState } from '../.pi/runtime/group-onboarding.mjs';
import { scheduleOnboarding } from '../scripts/group-init-runner.mjs';
import { ServiceManager } from '../.pi/runtime/service-manager.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-live-lifecycle-')), main = join(root, 'main'), wt = join(root, 'group');
console.log(JSON.stringify({ evidence_root: root }));
mkdirSync(main); git(main, 'init', '-b', 'develop');
git(main, 'config', 'core.autocrlf', 'false'); git(main, 'config', 'user.name', 'Pi Lifecycle Acceptance'); git(main, 'config', 'user.email', 'acceptance@example.invalid');
const listener = createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
mkdirSync(join(main, '.pi')); mkdirSync(join(main, 'tests')); mkdirSync(join(main, 'docs'));
writeFileSync(join(main, 'AGENTS.md'), 'Isolated lifecycle acceptance project. Source app.mjs exports result. Tests: node tests/run-tests.mjs. Module docs: docs/module.md. Do not edit group.md: Lead owns it. Three roles follow explicitly loaded role instructions and skills. Use native Windows PowerShell. End each turn idle; do not poll. Coordinator must operate fixture service through team_service.\n');
writeFileSync(join(main, 'app.mjs'), 'export const result = 1;\n');
writeFileSync(join(main, 'docs/module.md'), '# Module\nExports result = 1.\n');
writeFileSync(join(main, 'tests/run-tests.mjs'), "import assert from 'node:assert/strict';import {result} from '../app.mjs';assert.equal(result,2);console.log('result equals two');\n");
writeFileSync(join(main, 'service.mjs'), `import {createServer} from 'node:http';import {result} from './app.mjs';createServer((q,s)=>s.end(JSON.stringify({result}))).listen(${port},'127.0.0.1');\n`);
writeFileSync(join(main, '.pi/project.json'), JSON.stringify({ integration: { executable: process.execPath, args: ['tests/run-tests.mjs'] } }));
writeFileSync(join(main, '.pi/services.json'), JSON.stringify({ services: { fixture: { executable: process.execPath, args: ['service.mjs'], cwd: '.', ports: [port], health: { url: `http://127.0.0.1:${port}`, timeout_ms: 10000 } } } }));
git(main, 'add', '.'); git(main, 'commit', '-m', 'isolated baseline');
const store = new GroupStore(main), children = new Map(), services = new ServiceManager(store);
const log = join(root, 'events.jsonl');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lifecycle = onboardingState(store, 'sample', 'lead');
    if (lifecycle?.status === 'failed') throw Error(`onboarding failed: ${lifecycle.error}`);
    if (fn()) return;
    await sleep(500);
  }
  throw Error(`timeout: ${description}`);
}
function launch(role) {
  const previous = store.session('sample', role), launchId = randomUUID(), sessionId = previous?.session_id || randomUUID();
  const args = roleArgs(store, store.group('sample'), role, sessionId).slice(0, -1);
  const packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent');
  const child = spawn(process.execPath, [join(packageRoot, 'dist/cli.js'), '--mode', 'rpc', ...args], { cwd: wt, windowsHide: true, env: { ...process.env, PI_TEAM_PROJECT_ROOT: main, PI_TEAM_SOURCE_ROOT: sourceRoot, PI_TEAM_GROUP_ID: 'sample', PI_TEAM_ROLE: role, PI_TEAM_SESSION_ID: sessionId, PI_TEAM_LAUNCH_ID: launchId, PI_TEAM_ROLE_CONFIG: JSON.stringify(previous?.config || roleConfig()[role]) }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => appendFileSync(log, JSON.stringify({ role, data: bytes.toString() }) + '\n'));
  child.stderr.on('data', bytes => appendFileSync(join(root, `${role}-stderr.txt`), bytes));
  children.set(role, child); return child;
}
try {
  const created = createGroup(store, { group_id: 'sample', name: 'Sample module', description: 'Own the sample result capability and its module documentation. Coordinator supplies the fixture service; Executor implements; Validator reviews and aligns module prose.', worktree: wt, base_ref: 'develop' });
  scheduleOnboarding(store, 'sample');
  await until(() => onboardingState(store, 'sample', 'lead')?.status === 'ready', 600000, 'real finite onboarding');
  const initial = onboardingState(store, 'sample', 'lead');
  assert.deepEqual(Object.keys(initial.receipts).sort(), [...ROLES].sort());
  assert.ok(store.sessions('sample').every(s => !alive(s.pid)));
  const sessionsBefore = Object.fromEntries(store.sessions('sample').map(s => [s.role, s.session_id]));
  git(main, 'add', 'groups/sample/group.md'); git(main, 'commit', '-m', 'Lead registers sample group'); syncGroup(store, 'sample');
  startTask(store, 'sample', { task_id: 'LIFE-1', objective: 'Change app.mjs export result from 1 to 2. Run node tests/run-tests.mjs. Coordinator: before submitting task.md start fixture in development mode with team_service. After passing code review stop it and start fixture in review mode, inspect readiness, then check Validator documentation alignment and deliver. Validator: independently test result=2, then align docs/module.md to result=2 during assigned documentation work. Keep all reports short and precise.', acceptance: ['app result is two and test passes', 'module docs describe result two', 'Coordinator supplies development and immutable review services'], documentation_paths: ['docs/module.md'], documentation_checklist: ['Check actual exported result and document result=2; remove stale result=1 claim.'], base_ref: 'develop' });
  for (const role of ROLES) launch(role);
  await until(() => store.sessions('sample').every(s => alive(s.pid)), 60000, 'resumed role processes');
  for (const s of store.sessions('sample')) assert.equal(s.session_id, sessionsBefore[s.role]);
  await until(() => store.artifact('LIFE-1', 'delivery', store.task('LIFE-1').round), 900000, 'implementation, independent review, docs and Coordinator delivery');
  await until(() => store.sessions('sample').every(s => !s.busy), 60000, 'settled delivery');
  const task = store.task('LIFE-1'); assert.equal(task.review.verdict, 'pass'); assert.equal(task.documentation.verdict, 'pass');
  assert.match(readFileSync(join(wt, 'docs/module.md'), 'utf8'), /2/);
  const service = services.status('sample', 'fixture'); assert.equal(service.mode, 'review'); assert.equal(service.source_commit, task.delivery.commit); assert.equal(service.ready, true);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}`)).json()).result, 2);
  store.accept('LIFE-1', 'Driver independently checked actual result, passing code/docs reviews, module text and immutable service snapshot.'); finalize(store, 'LIFE-1');
  updateGroup(store, 'sample', { description: 'Own the sample result capability, its documented numeric contract, and compatibility notes. Coordinate external fixture service and maintain the three established role responsibilities.' });
  scheduleOnboarding(store, 'sample');
  await until(() => onboardingState(store, 'sample', 'lead')?.status === 'ready', 600000, 'new responsibility epoch real ACKs');
  const updated = onboardingState(store, 'sample', 'lead'); assert.ok(updated.epoch > initial.epoch);
  for (const s of store.sessions('sample')) assert.notEqual(s.session_id, sessionsBefore[s.role]);
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: true, initial, task: store.task('LIFE-1'), updated }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence_root: root }));
} catch (error) {
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2)); console.error(error.stack); process.exitCode = 1;
} finally {
  try { services.stopGroup('sample'); } catch {}
  for (const child of children.values()) child.kill();
  store.close();
}
