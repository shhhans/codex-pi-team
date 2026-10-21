import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { resolve, relative, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { GroupStore, parseCurrentState } from '../../runtime/group-store.mjs';
import { RoleTools } from '../../runtime/role-tools.mjs';
import { turnContext } from '../../runtime/turn-context.mjs';
import { classifyProviderFault } from '../../runtime/provider-fault.mjs';
import { onboardingState } from '../../runtime/group-onboarding.mjs';
import { ServiceManager } from '../../runtime/service-manager.mjs';

export default function (pi: ExtensionAPI) {
  const group = process.env.PI_TEAM_GROUP_ID!, role = process.env.PI_TEAM_ROLE!, launch = process.env.PI_TEAM_LAUNCH_ID!;
  const sessionId = process.env.PI_TEAM_SESSION_ID, config = JSON.parse(process.env.PI_TEAM_ROLE_CONFIG || 'null');
  if (!group || !role || !launch) throw Error('group runtime identity is missing');
  const store = new GroupStore(process.env.PI_TEAM_PROJECT_ROOT!);
  const services = new ServiceManager(store);
  if (role !== 'coordinator') {
    const native = createBashToolDefinition(store.group(group).worktree, { shellPath: resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), commandPrefix: '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)', exposeSessionEnvironment: false });
    pi.registerTool({ ...native, label: 'PowerShell', description: 'Run a native Windows PowerShell command in this group worktree. Use PowerShell syntax, not Bash or WSL.', promptSnippet: 'Run native Windows PowerShell commands.' });
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let ctx: any, stopped = false, active = false, compacting = false, compactFailures = 0, turnFailed = false, turnGeneration: number | null = null, turnEpoch: number | null = null, providerFault: any = null;
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
  pi.registerTool({ name: 'team_read', label: 'Read group work', description: 'Read authoritative current work and new messages. Stable group/task context appears once per version; refresh_context requests it again. detail requests full diagnostic history and sessions. Use the returned work id and artifact_path for submission; runtime derives round and path.', parameters: Type.Object({ refresh_context: Type.Optional(Type.Boolean()), detail: Type.Optional(Type.Boolean()) }), async execute(_id, input) { return reply(roleTools.invoke('team_read', input)); } });
  pi.registerTool({ name: 'team_send', label: 'Send group message', description: 'Persist a question, answer, or decision. to is a literal role: coordinator, executor, validator or lead. For another group, Coordinator uses to:"coordinator" and group_id:"target-group" as separate fields; never use a colon address or group ID as to. Omit group_id for your own group. This does not submit an artifact or finish work.', parameters: Type.Object({ to: Type.Union([Type.Literal('coordinator'), Type.Literal('executor'), Type.Literal('validator'), Type.Literal('lead')]), group_id: Type.Optional(Type.String()), body: Type.String(), task_id: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer()), refs: Type.Optional(Type.Array(Type.String())), reply_to: Type.Optional(Type.Integer()) }), async execute(_id, input) { return reply(roleTools.invoke('team_send', input)); } });
  pi.registerTool({ name: 'team_submit', label: 'Submit owned work', description: 'Atomically submit owned work; only ok:true receipt proves handoff. Use work_id from team_read. For onboarding use kind=onboarding and body acknowledging group and role responsibilities; no path or task required. Coordinator task submission may select planning=direct (implement now), plan (plan then implement), or review (one plan review); omitted keeps review. Record the reason in task.md; scope and final independent code/documentation review are unchanged. Process kinds: task, plan, plan_review, implementation, code_review, documentation, documentation_review, delivery, resolution. Documentation reports: documentation-<round>-<revision>.md; Coordinator review: documentation-review-<round>-<revision>.md, verdict pass/changes_requested. Read current work and task for paths/versions.', parameters: Type.Object({ task_id: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer()), work_id: Type.Optional(Type.Union([Type.Integer(), Type.String()])), kind: Type.String(), planning: Type.Optional(Type.Union([Type.Literal('direct'), Type.Literal('plan'), Type.Literal('review')])), path: Type.Optional(Type.String()), body: Type.Optional(Type.String()), round: Type.Optional(Type.Integer()), commit: Type.Optional(Type.String()), verdict: Type.Optional(Type.String()) }), async execute(_id, input) { return reply(queuedSteering ? { ok: false, code: 'INBOX_PENDING', message: 'New inbox messages are queued for your next response. Reconsider before submitting.', next_action: 'read_messages_and_reconsider' } : roleTools.invoke('team_submit', input)); } });
  if (role === 'coordinator') pi.registerTool({ name: 'team_service', label: 'Manage configured service', description: 'Inspect/start/stop a named service from .pi/services.json. No arbitrary command input. Review mode exports the registered delivery commit to an isolated snapshot.', parameters: Type.Object({ action: Type.Union([Type.Literal('describe'), Type.Literal('status'), Type.Literal('start'), Type.Literal('stop'), Type.Literal('recover_lock')]), service_id: Type.Optional(Type.String()), mode: Type.Optional(Type.Union([Type.Literal('development'), Type.Literal('review')])) }), async execute(_id, input) {
    try {
      roleTools.actor();
      const state = store.read(group, role);
      if (queuedSteering) throw Error('Read new steering messages before service operations');
      if (input.action === 'describe') return text(services.describe(group));
      if (input.action === 'recover_lock') { if (!state.task || state.task.outcome !== 'pending') throw Error('service recovery requires an active task'); return text(services.recoverLock()); }
      if (!input.service_id) throw Error('service_id required');
      if (input.action === 'status') return text(services.status(group, input.service_id));
      if (!state.task || state.task.outcome !== 'pending') throw Error('service mutations require an active task');
      if (input.action === 'stop') return text(services.stop(group, input.service_id));
      if (input.mode === 'review' && !state.task.delivery) throw Error('review mode requires a registered delivery');
      return text(await services.start(group, input.service_id, { mode: input.mode, task_id: state.task.task_id, commit: input.mode === 'review' ? state.task.delivery.commit : undefined }));
    } catch (error: any) { return reply({ ok: false, code: 'SERVICE_REJECTED', message: error.message }); }
  } });
  pi.on('session_start', async (_event, context) => {
    ctx = context;
    store.register(group, role, { launch_id: launch, pid: process.pid, started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(), session_id: sessionId, config, session_path: context.sessionManager.getSessionFile() });
    timer = setInterval(() => { try { wake(); } catch (e) { context.ui.setStatus('pi-team-health', `Runtime: ${String(e)}`); } }, 2000); timer.unref();
  });
  pi.on('agent_start', async () => { active = true; roleTools.begin(); turnFailed = false; turnGeneration = store.group(group).generation; turnEpoch = store.group(group).definition_epoch; store.updateSession(group, role, launch, { busy: true }); });
  pi.on('before_agent_start', async event => {
    const current = store.read(group, role);
    return { systemPrompt: `${event.systemPrompt}\nCurrent group context (runtime authority): ${JSON.stringify(turnContext(current, onboardingState(store, group, role), role))}` };
  });
  pi.on('tool_call', async event => {
    if (!['bash', 'edit', 'write'].includes(event.toolName)) return;
    if (queuedSteering) return { block: true, reason: 'New inbox messages are queued for your next response; reconsider them before continuing commands or edits.' };
    const state = store.read(group, role), t = state.task;
    if (store.db.prepare('SELECT 1 FROM operations WHERE name=?').get(`group:${group}`) || turnGeneration !== null && state.group.generation !== turnGeneration || turnEpoch !== null && state.group.definition_epoch !== turnEpoch) return { block: true, reason: 'Task/definition transition in progress or stale turn; finish idle and read current work.' };
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
    if (path === `groups/${group}/group.md`) return { block: true, reason: 'Only Lead changes group definitions.' };
    if (role === 'validator' && path.startsWith(taskPath) && !(/\/code-review-\d+\.md$/.test(path) || /\/review-\d+\//.test(path) || /\/documentation-\d+-\d+\.md$/.test(path) || path.endsWith('/plan-review.md'))) return { block: true, reason: 'Write independent evidence or assigned documentation reports; never overwrite delivery evidence.' };
    if (role === 'coordinator' && !path.startsWith(taskPath)) return { block: true, reason: 'Coordinator writes process documents only.' };
    if (role === 'validator' && !path.startsWith(taskPath) && !(t.documentation_paths?.includes(path) && state.work.some(w => w.kind.startsWith('documentation-')))) return { block: true, reason: 'Module Markdown edits require assigned documentation work and an explicit documentation_paths entry.' };
    if (role === 'executor' && !path.startsWith(taskPath) && !state.work.some(w => w.kind.startsWith('implementation-'))) return { block: true, reason: 'No open implementation work; do not change production during planning or review.' };
  });
  pi.on('agent_end', async event => {
    turnFailed = event.messages.some((m: any) => m.role === 'assistant' && ['error', 'aborted'].includes(m.stopReason));
  });
  pi.on('agent_settled', async (_event, context) => {
    active = false;
    if (!turnFailed) roleTools.finish();
    store.settle(group, role, launch, !turnFailed);
    const fault = turnFailed ? providerFault ? `account_quota_exceeded; reset ${providerFault.reset_at || 'unknown'}; explicit group-resume required` : 'model_error_or_abort; explicit group-resume required' : null;
    store.updateSession(group, role, launch, { fault, provider_fault: turnFailed ? providerFault : null });
    if (turnFailed) { store.notice(group, role === 'coordinator' ? 'lead' : 'coordinator', { type: 'runtime_fault', role, detail: 'Model run failed after native recovery; work remains open. Inspect and explicitly resume.', ...(providerFault ? { provider_fault: providerFault } : {}) }); return; }
    const usage = context.getContextUsage();
    if (compacting || compactFailures >= maxCompactFailures || !usage || (usage.percent ?? 0) < threshold * 100) return;
    compacting = true;
    const snapshot = store.read(group, role);
    store.updateSession(group, role, launch, { compact_summary: { task: snapshot.task, work: snapshot.work, saved_at: new Date().toISOString() } });
    context.compact({ customInstructions: `Preserve group identity, active task/generation, open work, latest process-document references and unresolved decisions. Drop old tool transcripts. Resume with team_read. Current durable work: ${JSON.stringify(snapshot.work)}`, onComplete: () => { roleTools.invalidateReadContext(); compacting = false; store.updateSession(group, role, launch, { compacted_at: new Date().toISOString() }); }, onError: () => { compacting = false; compactFailures++; context.ui.setStatus('pi-team-health', 'Compact failed; session and worktree preserved.'); } });
  });
  pi.on('message_end', async (event, context) => {
    if (event.message.role !== 'assistant') return;
    const classified = event.message.stopReason === 'error' ? classifyProviderFault(event.message.errorMessage, { provider: config.provider, model: config.model }) : null;
    providerFault = classified?.code === 'account_quota_exceeded' ? classified : null;
    if (providerFault || store.session(group, role)?.provider_fault) store.updateSession(group, role, launch, { provider_fault: providerFault });
    const content = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const state = parseCurrentState(content);
    if (state) { store.updateSession(group, role, launch, { current_state: state, state_at: new Date().toISOString() }); context.ui.setStatus('pi-team', state); }
  });
  pi.on('session_shutdown', async () => { stopped = true; if (timer) clearInterval(timer); store.settle(group, role, launch, false); store.close(); });
}
