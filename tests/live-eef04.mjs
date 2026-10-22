// Opt-in EEF-04 acceptance on the existing isolated efficiency fixture. Not part of deterministic suites.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GroupStore, git, alive } from '../.pi/runtime/group-store.mjs';
import { reconcileRegistration, startTask, launchGroup, stopGroup, finalize } from '../.pi/runtime/group-service.mjs';
import { onboardingState } from '../.pi/runtime/group-onboarding.mjs';
import { currentSharedContext } from '../.pi/runtime/shared-context.mjs';
import { observeProcesses } from '../.pi/runtime/process-observation.mjs';
import { scheduleOnboarding } from '../scripts/group-init-runner.mjs';

const evidence = process.env.PI_TEAM_EEF_EVIDENCE;
assert.ok(evidence, 'PI_TEAM_EEF_EVIDENCE is required'); mkdirSync(evidence, {recursive:true});
const main = process.env.PI_TEAM_EEF_PROJECT;
assert.ok(main, 'PI_TEAM_EEF_PROJECT is required');
const store = new GroupStore(main), groupId = 'sample', taskId = 'EEF-04';
const wt = store.group(groupId).worktree;
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let result = { passed: false, task_id: taskId, evidence_root: evidence };
async function until(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lifecycle = onboardingState(store, groupId, 'lead');
    if (lifecycle?.status === 'failed') throw Error(`onboarding failed: ${lifecycle.error}`);
    const fault = store.sessions(groupId).find(s => s.fault);
    if (fault) throw Error(`${fault.role}: ${fault.fault}`);
    if (check()) return;
    await sleep(1000);
  }
  throw Error(`timeout: ${label}`);
}
function summarize(start, end) {
  const roles = {};
  for (const session of store.sessions(groupId)) {
    const rows = readFileSync(session.session_path, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    const messages = rows.filter(e => e.timestamp >= start && e.timestamp <= end && e.message?.role === 'assistant');
    const calls = messages.flatMap(e => e.message.content.filter(c => c.type === 'toolCall').map(c => ({ ...c, at: e.timestamp })));
    const stats = { response_window_seconds: 0, responses: messages.length, tools: calls.length, team_read: 0, submit_body_bytes: 0, input: 0, output: 0, cacheRead: 0, tools_by_name: {} };
    for (const e of messages) { const requestAt = typeof e.message.timestamp === 'number' ? e.message.timestamp : Date.parse(e.message.timestamp); const duration = Date.parse(e.timestamp) - requestAt; if (Number.isFinite(duration) && duration >= 0) stats.response_window_seconds += duration / 1000; }
    for (const e of messages) for (const key of ['input', 'output', 'cacheRead']) stats[key] += e.message.usage?.[key] || 0;
    for (const call of calls) {
      stats.tools_by_name[call.name] = (stats.tools_by_name[call.name] || 0) + 1;
      if (call.name === 'team_read') stats.team_read++;
      if (call.name === 'team_submit') stats.submit_body_bytes += Buffer.byteLength(call.arguments.body || '');
    }
    roles[session.role] = stats;
  }
  return roles;
}
try {
  assert.equal(store.group(groupId).active_task, null);
  assert.equal(git(main, 'status', '--porcelain'), '');
  assert.equal(git(wt, 'status', '--porcelain'), '');
  save('source.json', { source_root: process.cwd(), files: Object.fromEntries(['.pi/runtime/group-store.mjs','.pi/runtime/group-service.mjs','.pi/runtime/integration-snapshot.mjs','.pi/runtime/shared-context.mjs','.pi/runtime/document-alignment.mjs','.pi/runtime/turn-context.mjs','.pi/runtime/role-tools.mjs','.pi/communication/extensions/group.ts','.pi/agents/coordinator.md','.pi/agents/executor.md','.pi/agents/validator.md','.pi/skills/coordinate-group/SKILL.md','.pi/skills/review-group-task/SKILL.md','.pi/skills/execute-group-task/SKILL.md','AGENTS.md','ADR/0009-persistent-group-workflow.md'].map(p => { const content=readFileSync(p,'utf8'); const dest=p.replaceAll('/','__'); copyFileSync(p,join(evidence,dest)); return [p,{snapshot:dest,characters:content.length,sha256:createHash('sha256').update(content).digest('hex')}]; })) });
  save('before.json', { group: store.group(groupId), lifecycle: onboardingState(store, groupId, 'lead'), sessions: store.sessions(groupId), knowledge: currentSharedContext(store, groupId, true) });
  const priorSessions=store.sessions(groupId), observed=observeProcesses(priorSessions.map(s=>s.pid)), recovered=[];
  for(const session of priorSessions) {
    const actual=observed.get(session.pid);
    if(actual.status==='unknown') throw Error('cannot verify prior '+session.role+' process identity');
    if(actual.status==='running' && session.process_start_stamp && actual.stamp!==session.process_start_stamp) {
      recovered.push({role:session.role,pid:session.pid,recorded_stamp:session.process_start_stamp,actual_stamp:actual.stamp,action:'clear_stale_fixture_registration_preserve_unrelated_process'});
      store.updateSession(groupId,session.role,session.launch_id,{pid:null,launcher_pid:null,launcher_owned:false});
    }
  }
  save('preflight-process-recovery.json',recovered);
  const initial = reconcileRegistration(store, groupId);
  save('reinitialization.json', initial);
  scheduleOnboarding(store, groupId);
  await until(() => onboardingState(store, groupId, 'lead')?.status === 'ready' && store.sessions(groupId).every(s => !alive(s.pid)), 480000, 'new instruction epoch onboarding');
  save('onboarding.json', { lifecycle: onboardingState(store, groupId, 'lead'), sessions: store.sessions(groupId) });
  assert.equal(git(main, 'status', '--porcelain'), '');
  assert.equal(currentSharedContext(store, groupId), null);
  const started = Date.now();
  startTask(store, groupId, {
    task_id: taskId, base_ref: 'develop',
    objective: 'Verify the integrated result=2 contract with existing node tests/run-tests.mjs, without changing production behavior. Deliver a committed implementation.md with verification evidence; no new plan or test program is needed. Classify as non_change with direct planning. Coordinator: use the current-epoch shared knowledge if available; otherwise propose a concise sourced replacement for the new epoch, treating old-epoch knowledge as historical. Validator independently verifies task results and absence of product changes in one combined review. Keep reports short.',
    acceptance: ['app.mjs exports result=2 and existing tests pass', 'docs/module.md accurately describes result=2', 'delivery references or proposes sourced shared knowledge valid for the current definition epoch'],
    documentation_paths: ['docs/module.md'], documentation_checklist: ['Document actual result=2; if already accurate explain no change.'],
  });
  save('start.json', { started_at: new Date(started).toISOString(), task: store.task(taskId), group: store.group(groupId) });
  console.log(JSON.stringify({ phase: 'task_started', task_id: taskId, epoch: store.group(groupId).definition_epoch }));
  await launchGroup(store, groupId, { headless: true });
  await until(() => !!store.artifact(taskId, 'delivery', store.task(taskId).round), 600000, 'reviewed EEF-04 delivery');
  await until(() => store.sessions(groupId).every(s => !s.busy), 60000, 'delivery settled');
  const task = store.task(taskId), delivery = store.artifact(taskId, 'delivery', task.round);
  assert.equal(task.task_type, 'non_change');
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM work WHERE task_id=? AND kind LIKE 'documentation%'").get(taskId).n, 0);
  assert.equal(task.documentation.integrated_review, true);
  assert.equal(task.planning, 'direct'); assert.equal(task.review.verdict, 'pass'); assert.equal(task.documentation.verdict, 'pass');
  assert.equal(task.review.commit, task.delivery.commit); assert.equal(task.documentation.code_commit, task.delivery.commit);
  assert.equal(delivery.shared_context?.mode, 'update');
  assert.equal(delivery.shared_context.definition_epoch, store.group(groupId).definition_epoch);
  assert.equal(git(wt, 'diff', task.base_commit, task.documentation.commit, '--', 'app.mjs', 'docs/module.md', 'tests/run-tests.mjs'), '');
  assert.match(readFileSync(join(wt, 'app.mjs'), 'utf8'), /result\s*=\s*2/);
  assert.match(readFileSync(join(wt, 'docs/module.md'), 'utf8'), /result\s*=\s*2/);
  execFileSync(process.execPath, ['tests/run-tests.mjs'], { cwd: wt, stdio: 'pipe', windowsHide: true });
  const prefix = join(wt, 'groups', groupId, 'tasks', taskId);
  const taskText = readFileSync(join(prefix, 'task.md'), 'utf8');
  const deliveryText = readFileSync(join(prefix, 'delivery.md'), 'utf8');
  const mainDelivery = deliveryText.split(/^## Shared knowledge[ \t]*\r?$/m)[0];
  const sizes = { task: { bytes: Buffer.byteLength(taskText), characters: taskText.length, within_budget: taskText.length <= 1200 }, delivery: { bytes: Buffer.byteLength(deliveryText), characters: deliveryText.length, main_characters: mainDelivery.length, within_budget: mainDelivery.length <= 1500 }, knowledge_characters: delivery.shared_context.content.length };
  const messages = store.db.prepare('SELECT id,data FROM messages WHERE group_id=?').all(groupId).map(r => ({ id: r.id, ...JSON.parse(r.data) })).filter(m => m.task_id === taskId && ['work', 'delivery'].includes(m.type));
  const start = messages[0].at, end = messages.at(-1).at;
  const phases = messages.slice(0, -1).map((m, i) => ({ kind: m.kind, start: m.at, end: messages[i + 1].at, seconds: (Date.parse(messages[i + 1].at) - Date.parse(m.at)) / 1000 }));
  save('delivery-review.json', { task, delivery, sizes, messages, phases });
  store.accept(taskId, 'Lead independently checked result=2, unchanged production diff, oracle exit 0, exact passing code/documentation reviews and sourced current-epoch knowledge.');
  finalize(store, taskId);
  const knowledge = currentSharedContext(store, groupId, true);
  assert.equal(knowledge.source_task, taskId);
  result = { ...result, passed: true, start, end, dispatch_to_delivery_seconds: (Date.parse(end) - Date.parse(start)) / 1000, dispatch_to_finalization_seconds: (Date.now() - started) / 1000, phases, sizes, roles: summarize(start, end), knowledge, final_task: store.task(taskId) };
  console.log(JSON.stringify({ phase: 'complete', seconds: result.dispatch_to_delivery_seconds, sizes, roles: result.roles }));
} catch (error) {
  result.error = error.stack;
  console.error(error.stack); process.exitCode = 1;
} finally {
  try {
    stopGroup(store, groupId, true);
    await until(() => store.sessions(groupId).every(s => !alive(s.pid)), 15000, 'owned role processes stopped');
  } catch (error) { result.passed = false; result.cleanup_error = error.message; process.exitCode = 1; }
  result.sessions_after_stop = store.sessions(groupId).map(s => ({ ...s, live: alive(s.pid) }));
  for (const session of store.sessions(groupId)) {
    try { copyFileSync(session.session_path, join(evidence, session.role + '-session.jsonl')); } catch {}
  }
  save('result.json', result);
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const database = join(store.root, 'groups.sqlite'); store.close();
  copyFileSync(database, join(evidence, 'groups.sqlite'));
}
