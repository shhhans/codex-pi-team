import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { resolve, relative, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { GroupStore, parseCurrentState } from '../../runtime/group-store.mjs';
import { RoleTools } from '../../runtime/role-tools.mjs';

export default function (pi: ExtensionAPI) {
  const group = process.env.PI_TEAM_GROUP_ID!, role = process.env.PI_TEAM_ROLE!, launch = process.env.PI_TEAM_LAUNCH_ID!;
  const sessionId = process.env.PI_TEAM_SESSION_ID, config = JSON.parse(process.env.PI_TEAM_ROLE_CONFIG || 'null');
  if (!group || !role || !launch) throw Error('group runtime identity is missing');
  const store = new GroupStore(process.env.PI_TEAM_PROJECT_ROOT!);
  if (role !== 'coordinator') {
    const native = createBashToolDefinition(store.group(group).worktree, { shellPath: resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), commandPrefix: '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)', exposeSessionEnvironment: false });
    pi.registerTool({ ...native, label: 'PowerShell', description: 'Run a native Windows PowerShell command in this group worktree. Use PowerShell syntax, not Bash or WSL.', promptSnippet: 'Run native Windows PowerShell commands.' });
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let ctx: any, stopped = false, active = false, compacting = false, compactFailures = 0, turnFailed = false, turnGeneration: number | null = null;
  let threshold = 0.5, maxCompactFailures = 1;
  try { const policy = JSON.parse(readFileSync(resolve(process.env.PI_TEAM_SOURCE_ROOT || process.cwd(), '.pi/team-runtime.json'), 'utf8').replace(/^\uFEFF/, '')).compression; if (policy.threshold_percent > 0 && policy.threshold_percent <= 1) threshold = policy.threshold_percent; if (Number.isInteger(policy.max_compact_retries) && policy.max_compact_retries >= 0) maxCompactFailures = policy.max_compact_retries; } catch { /* A display/compact preference cannot corrupt work; use defaults. */ }
  let queuedSteering = false;
  const roleTools = new RoleTools(store, group, role, launch);
  const reply = (result: any) => {
    // Pi derives toolResult.isError from a thrown execution error, not from an
    // extra isError property on AgentToolResult. Preserve structured JSON.
    if (result.ok === false) throw new Error(JSON.stringify(result));
    return text(result);
  };
  const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const wake = () => {
    if (stopped || active || compacting || !ctx?.isIdle() || store.session(group, role)?.fault) return;
    const messages = store.claim(group, role, launch); if (!messages) return;
    try { pi.sendUserMessage(`Pi Team inbox: ${JSON.stringify(messages)}\nUse team_read for current task and open work. Read the submitted documents before acting.`, { deliverAs: 'followUp' }); }
    catch { store.settle(group, role, launch, false); }
  };
  const presentDuringTurn = () => {
    if (!active || compacting || stopped) return;
    const messages = store.present(group, role, launch);
    if (!messages.length) return;
    try { queuedSteering = true; pi.sendUserMessage(`Pi Team inbox: ${JSON.stringify(messages)}\nThese messages arrived during your work. Reconsider them before editing or submitting; registered deliveries remain immutable.`, { deliverAs: 'steer' }); }
    catch (e) {
      queuedSteering = false;
      for (const m of messages) store.db.prepare('UPDATE messages SET presented_at=NULL WHERE id=?').run(m.id);
      throw e;
    }
  };
  pi.on('turn_start', async () => { queuedSteering = false; });
  pi.on('tool_result', async () => { presentDuringTurn(); });
  pi.on('turn_end', async () => { presentDuringTurn(); });
  pi.registerTool({ name: 'team_read', label: 'Read group work', description: 'Read the current task/generation, open work, messages and role sessions. Use returned task identity in mutations.', parameters: Type.Object({}), async execute() { return reply(roleTools.invoke('team_read')); } });
  pi.registerTool({ name: 'team_send', label: 'Send group message', description: 'Persist a question, answer, or decision. Same-group roles may communicate; only Coordinators contact Lead or other groups. This does not submit an artifact or finish work.', parameters: Type.Object({ to: Type.String(), group_id: Type.Optional(Type.String()), body: Type.String(), task_id: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer()), refs: Type.Optional(Type.Array(Type.String())), reply_to: Type.Optional(Type.Integer()) }), async execute(_id, input) { return reply(roleTools.invoke('team_send', input)); } });
  pi.registerTool({ name: 'team_submit', label: 'Submit process document', description: 'Submit an owned document and atomically hand off work. Use work_id from team_read when possible. Identity is runtime-owned. A result with ok:false is a rejection, never a successful handoff. Kinds: task, plan, plan_review, implementation, code_review, delivery, resolution. implementation/code_review require round and full Git commit; code_review requires verdict pass, changes_requested, or blocked. Coordinator resolution requires the blocked round and decision-<round>.md. Plan review is exactly one round. Submitted documents are immutable; implementation.md is versioned by round.', parameters: Type.Object({ task_id: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer()), work_id: Type.Optional(Type.Integer()), kind: Type.String(), path: Type.String(), round: Type.Optional(Type.Integer()), commit: Type.Optional(Type.String()), verdict: Type.Optional(Type.String()) }), async execute(_id, input) { return reply(queuedSteering ? { ok: false, code: 'INBOX_PENDING', message: 'New inbox messages are queued for your next response. Reconsider before submitting.', next_action: 'read_messages_and_reconsider' } : roleTools.invoke('team_submit', input)); } });
  pi.on('session_start', async (_event, context) => {
    ctx = context;
    store.register(group, role, { launch_id: launch, pid: process.pid, started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(), session_id: sessionId, config, session_path: context.sessionManager.getSessionFile() });
    timer = setInterval(() => { try { wake(); } catch (e) { context.ui.setStatus('pi-team-health', `Runtime: ${String(e)}`); } }, 2000); timer.unref();
  });
  pi.on('agent_start', async () => { active = true; roleTools.begin(); turnFailed = false; turnGeneration = store.group(group).generation; store.updateSession(group, role, launch, { busy: true }); });
  pi.on('before_agent_start', async event => {
    const current = store.read(group, role);
    return { systemPrompt: `${event.systemPrompt}\nCurrent group context (runtime authority): ${JSON.stringify({ group: current.group, task: current.task, work: current.work })}` };
  });
  pi.on('tool_call', async event => {
    if (!['bash', 'edit', 'write'].includes(event.toolName)) return;
    if (queuedSteering) return { block: true, reason: 'New inbox messages are queued for your next response; reconsider them before continuing commands or edits.' };
    const state = store.read(group, role), t = state.task;
    if (store.db.prepare('SELECT 1 FROM operations WHERE name=?').get(`group:${group}`) || turnGeneration !== null && state.group.generation !== turnGeneration) return { block: true, reason: 'Task transition in progress or this turn belongs to the previous task; finish idle and read the next task.' };
    if (!t || t.outcome !== 'pending') return { block: true, reason: 'No open task; wait for Coordinator/Lead.' };
    if (event.toolName === 'bash') {
      // Shell commands are needed for Git inspection before planning as well as
      // tests. This is not a shell sandbox; enforce evidence/version boundaries
      // at handoff rather than guessing command intent from shell text.
      if (role === 'coordinator') return { block: true, reason: 'Coordinator has no command tool.' };
      return;
    }
    const path = relative(state.group.worktree, resolve(state.group.worktree, String((event.input as any).path || ''))).replaceAll('\\', '/');
    const taskPath = `groups/${group}/tasks/${t.task_id}/`;
    if (isAbsolute(path) || path === '..' || path.startsWith('../')) return { block: true, reason: 'Write must stay in the group worktree.' };
    const frozen = store.db.prepare('SELECT data FROM artifacts WHERE task_id=?').all(t.task_id).map((r: any) => JSON.parse(r.data)).find((a: any) => a.path === path);
    if (frozen && !(frozen.kind === 'implementation' && role === 'executor' && state.work.some(w => w.kind.startsWith('implementation-')))) return { block: true, reason: 'Submitted document is immutable. Ask Coordinator to resolve a late correction into a new delivery.' };
    if (role === 'executor' && path.startsWith(taskPath) && !state.work.some(w => w.kind === 'plan' || w.kind.startsWith('implementation-'))) return { block: true, reason: 'No open Executor work; do not edit the registered delivery during Review.' };
    if (role === 'validator' && path.startsWith(taskPath) && !(/\/code-review-\d+\.md$/.test(path) || /\/review-\d+\//.test(path) || path.endsWith('/plan-review.md'))) return { block: true, reason: 'Write independent evidence under review-NN/; never overwrite delivery evidence.' };
    if (role === 'coordinator' && !(path.startsWith(taskPath) || path === `groups/${group}/group.md`)) return { block: true, reason: 'Coordinator writes process documents only.' };
    if (role === 'validator' && !path.startsWith(taskPath)) return { block: true, reason: 'Validator writes review evidence/tests only in this task directory.' };
    if (role === 'executor' && !path.startsWith(taskPath) && !state.work.some(w => w.kind.startsWith('implementation-'))) return { block: true, reason: 'Read the single plan review before implementation; do not change production during Review.' };
  });
  pi.on('agent_end', async event => {
    turnFailed = event.messages.some((m: any) => m.role === 'assistant' && ['error', 'aborted'].includes(m.stopReason));
  });
  pi.on('agent_settled', async (_event, context) => {
    active = false;
    if (!turnFailed) roleTools.finish();
    store.settle(group, role, launch, !turnFailed);
    store.updateSession(group, role, launch, { fault: turnFailed ? 'model_error_or_abort; explicit group-resume required' : null });
    if (turnFailed) { store.notice(group, role === 'coordinator' ? 'lead' : 'coordinator', { type: 'runtime_fault', role, detail: 'Model run failed after native recovery; work remains open. Inspect and explicitly resume.' }); return; }
    const usage = context.getContextUsage();
    if (compacting || compactFailures >= maxCompactFailures || !usage || (usage.percent ?? 0) < threshold * 100) return;
    compacting = true;
    const snapshot = store.read(group, role);
    store.updateSession(group, role, launch, { compact_summary: { task: snapshot.task, work: snapshot.work, saved_at: new Date().toISOString() } });
    context.compact({ customInstructions: `Preserve group identity, active task/generation, open work, latest process-document references and unresolved decisions. Drop old tool transcripts. Resume with team_read. Current durable work: ${JSON.stringify(snapshot.work)}`, onComplete: () => { compacting = false; store.updateSession(group, role, launch, { compacted_at: new Date().toISOString() }); }, onError: () => { compacting = false; compactFailures++; context.ui.setStatus('pi-team-health', 'Compact failed; session and worktree preserved.'); } });
  });
  pi.on('message_end', async (event, context) => {
    if (event.message.role !== 'assistant') return;
    const content = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const state = parseCurrentState(content);
    if (state) { store.updateSession(group, role, launch, { current_state: state, state_at: new Date().toISOString() }); context.ui.setStatus('pi-team', state); }
  });
  pi.on('session_shutdown', async () => { stopped = true; if (timer) clearInterval(timer); store.settle(group, role, launch, false); store.close(); });
}
