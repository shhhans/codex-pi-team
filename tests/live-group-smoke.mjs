// Explicit, billed provider smoke. Never runs as part of deterministic tests.
// All runtime state and Git changes are confined to a disposable standalone repo.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GroupStore, git } from '../.pi/runtime/group-store.mjs';
import { createGroup, startTask, roleArgs, roleConfig, sourceRoot, finalize } from '../.pi/runtime/group-service.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-live-v2-')), main = join(root, 'main'), wt = join(root, 'group');
mkdirSync(main); git(main, 'init', '-b', 'develop'); git(main, 'config', 'user.name', 'Pi Team Smoke'); git(main, 'config', 'user.email', 'smoke@example.invalid'); git(main, 'config', 'core.autocrlf', 'false');
writeFileSync(join(main, 'AGENTS.md'), 'Standalone Pi Team v2 smoke fixture. Source is app.mjs and tests/run-tests.mjs. Process documents go under groups/<group>/tasks/<task>/. Role instructions and private skills are explicitly loaded from the harness source; there is intentionally no local .pi/ or ADR/ tree to discover. Read only the two app files and current task documents. Use native Windows PowerShell for the bash tool. team_read gives the current task and generation. Coordinator creates group.md and task.md; Executor plans, Validator performs one plan review, Executor implements, Validator reviews code, Coordinator delivers. End each turn idle.\n');
writeFileSync(join(main, 'app.mjs'), 'export const result = 1;\n');
mkdirSync(join(main, 'tests')); writeFileSync(join(main, 'tests/run-tests.mjs'), "import {result} from '../app.mjs'; if(result!==2) throw Error('expected two'); console.log('passed');\n");
git(main, 'add', '.'); git(main, 'commit', '-m', 'smoke baseline');
const store = new GroupStore(main), children = new Map();
createGroup(store, { group_id: 'smoke', worktree: wt, base_ref: 'develop' });
const packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent');
console.log(JSON.stringify({ root, main, worktree: wt }));
const log = join(root, 'events.jsonl');
function launch(role) {
  const previous = store.session('smoke', role);
  const session = previous?.session_id || randomUUID(), launch = randomUUID();
  const args = roleArgs(store, store.group('smoke'), role, session).slice(0, -1);
  const child = spawn(process.execPath, [join(packageRoot, 'dist/cli.js'), '--mode', 'rpc', ...args], { cwd: wt, windowsHide: true, env: { ...process.env, PI_TEAM_PROJECT_ROOT: main, PI_TEAM_SOURCE_ROOT: sourceRoot, PI_TEAM_GROUP_ID: 'smoke', PI_TEAM_ROLE: role, PI_TEAM_SESSION_ID: session, PI_TEAM_LAUNCH_ID: launch, PI_TEAM_ROLE_CONFIG: JSON.stringify(roleConfig()[role]) }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  child.stdout.on('data', bytes => {
    buffer += bytes.toString(); let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1);
      try { const e = JSON.parse(line); if (e.type !== 'message_update') appendFileSync(log, `${JSON.stringify({ role, event: e })}\n`); if (['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end'].includes(e.type)) console.log(JSON.stringify({ role, type: e.type, tool: e.toolName, error: e.isError })); } catch { appendFileSync(join(root, `${role}-stdout.txt`), `${line}\n`); }
    }
  });
  child.stderr.on('data', x => appendFileSync(join(root, `${role}-stderr.txt`), x));
  child.on('error', e => console.log(JSON.stringify({ role, error: e.message })));
  children.set(role, child); return child;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, timeout, description) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (predicate()) return; await sleep(500); } throw Error(`timeout: ${description}`); }
try {
  for (const role of ['coordinator', 'executor', 'validator']) launch(role);
  await until(() => store.sessions('smoke').length === 3, 60000, 'role readiness');
  startTask(store, 'smoke', { task_id: 'SMOKE-1', objective: 'Implement app.mjs result=2. Controlled negative-control exercise: Executor D1 MUST intentionally retain result=1; Validator must reject D1 against result=2, then Executor D2 fixes it. Keep the whole task tiny. Run node tests/run-tests.mjs; D1 should fail and D2 should pass. This intentional first defect tests the repair loop, it is not an exemption from acceptance. Do not request further approval. Use files and team_submit to hand off. On success Coordinator submits delivery.md.', acceptance: ['D1 review records actual failure result=1 versus expected 2', 'D2 implements result=2 and passes tests/code Review'], base_ref: 'develop' });
  await until(() => store.artifact('SMOKE-1', 'code_review', 1), 600000, 'first code review');
  if (store.artifact('SMOKE-1', 'code_review', 1).verdict !== 'changes_requested') throw Error('negative control was not rejected');
  await until(() => store.artifact('SMOKE-1', 'delivery', store.task('SMOKE-1').round), 600000, 'final delivery');
  await until(() => store.sessions('smoke').every(s => !s.busy), 60000, 'idle after delivery');
  const before = store.session('smoke', 'executor'); children.get('executor').kill();
  await until(() => children.get('executor').exitCode !== null || children.get('executor').signalCode !== null, 10000, 'executor exit');
  launch('executor');
  await until(() => store.session('smoke', 'executor').launch_id !== before.launch_id, 60000, 'executor recovery');
  if (store.session('smoke', 'executor').session_id !== before.session_id) throw Error('session identity changed');
  store.accept('SMOKE-1', 'Independent smoke driver checked D1 rejection, D2 review and result=2.');
  finalize(store, 'SMOKE-1');
  startTask(store, 'smoke', { task_id: 'SMOKE-2', objective: 'Confirm app.mjs still exports result=2. Make a minimal documentary verification task, write the required one-round plan/review and complete the same workflow. Do not change production behavior.', acceptance: ['result remains two', 'process evidence and code Review completed'], base_ref: 'develop' });
  await until(() => store.artifact('SMOKE-2', 'delivery', store.task('SMOKE-2').round), 600000, 'second task delivery');
  await until(() => store.sessions('smoke').every(s => !s.busy), 60000, 'second task idle');
  store.accept('SMOKE-2', 'Independent smoke driver checked unchanged result=2, one plan review and passing code review.');
  finalize(store, 'SMOKE-2');
  console.log(JSON.stringify({ passed: true, root, first: store.task('SMOKE-1'), second: store.task('SMOKE-2') }));
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: true, first: store.task('SMOKE-1'), second: store.task('SMOKE-2') }, null, 2));
} catch (error) { console.error(error.message); writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: false, error: error.message }, null, 2)); process.exitCode = 1; }
finally { for (const child of children.values()) child.kill(); store.close(); }
