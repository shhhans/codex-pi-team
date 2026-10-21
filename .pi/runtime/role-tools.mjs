// The model supplies intent; identity and submission receipts come from runtime.
import { onboardingState, submitOnboarding } from './group-onboarding.mjs';
import { resolve, relative } from 'node:path';
export class RoleTools {
  constructor(store, group, role, launch) {
    Object.assign(this, { store, group, role, launch });
    this.messageCursor = 0;
    this.contextKey = null;
    this.contextVersion = 0;
    this.recoverClaimedMessages = false;
    this.begin();
  }
  begin() {
    const g = this.store.group(this.group);
    this.identity = { group_id: this.group, role: this.role, launch_id: this.launch, task_id: g.active_task, generation: g.generation, definition_epoch: g.definition_epoch, lifecycle_id: onboardingState(this.store, this.group, this.role)?.operation_id };
    this.rejection = null;
  }
  actor() {
    const g = this.store.group(this.group);
    if (g.active_task !== this.identity.task_id || g.generation !== this.identity.generation || g.definition_epoch !== this.identity.definition_epoch || onboardingState(this.store, this.group, this.role)?.operation_id !== this.identity.lifecycle_id) {
      const e = Error('This turn belongs to an old task; end idle and read the new task'); e.code = 'STALE_TURN'; throw e;
    }
    return this.identity;
  }
  invoke(name, input = {}) {
    try {
      const actor = this.actor();
      let value;
      if (name === 'team_read') {
        const presented = this.store.present(this.group, this.role, this.launch);
        const raw = this.store.read(this.group, this.role);
        value = input.detail ? { ...raw, lifecycle: onboardingState(this.store, this.group, this.role) } : this.compactRead(raw, presented, input);
      } else if (name === 'team_send') {
        value = this.store.send(actor, input);
        if (this.rejection?.tool === 'team_send') this.rejection = null;
      } else if (name === 'team_submit') {
        if (input.kind === 'onboarding') {
          if (this.store.pending(this.group, this.role).length) throw Error('Read new inbox messages before acknowledging responsibilities');
          const receipt = submitOnboarding(this.store, actor, input);
          this.rejection = null;
          return { ok: true, receipt, lifecycle: onboardingState(this.store, this.group, this.role) };
        }
        const state = this.store.read(this.group, this.role);
        const matches = state.work.filter(w =>
          w.kind === input.kind || w.kind.startsWith(`${input.kind}-`) ||
          input.kind === 'resolution' && /^(blocked|revision)-/.test(w.kind));
        const selected = input.work_id == null ? (matches.length === 1 ? matches[0] : null) : this.store.db.prepare('SELECT * FROM work WHERE id=? AND task_id=? AND owner=?').get(input.work_id, actor.task_id, this.role);
        if (input.work_id == null && matches.length > 1) throw this.structured('AMBIGUOUS_WORK', 'More than one open work item matches this submission kind', { expected: matches.map(w => ({ work_id: w.id, kind: w.kind })) , current_work: this.workCards(matches, state.task) });
        if (input.work_id != null && (!selected || !(selected.kind === input.kind || selected.kind.startsWith(`${input.kind}-`) || input.kind === 'resolution' && /^(blocked|revision)-/.test(selected.kind)))) throw this.structured('WRONG_WORK', 'work_id is not owned by this task/role or does not match the submission kind', { expected: { task_id: actor.task_id, owner: this.role, kind: input.kind }, current_work: this.workCards(state.work, state.task) });
        const expectedPath = selected ? this.artifactPath(selected.kind, actor.task_id) : null;
        const expectedRound = selected ? this.workRound(selected.kind) : undefined;
        const explicitPath = input.path && relative(this.store.group(this.group).worktree, resolve(this.store.group(this.group).worktree, input.path)).replaceAll('\\', '/');
        if (explicitPath && expectedPath && explicitPath !== expectedPath) throw this.structured('WORK_PATH_CONFLICT', `Work ${selected.id} requires artifact path ${expectedPath}`, { expected: { work_id: selected.id, path: expectedPath, round: expectedRound }, current_work: this.workCards(state.work, state.task) });
        if (input.round != null && expectedRound != null && input.round !== expectedRound) throw this.structured('WORK_ROUND_CONFLICT', `Work ${selected.id} requires round ${expectedRound}`, { expected: { work_id: selected.id, path: expectedPath, round: expectedRound }, current_work: this.workCards(state.work, state.task) });
        const round = input.round ?? expectedRound;
        const commit = input.commit ?? (input.kind === 'code_review' ? state.task?.delivery?.commit : undefined);
        value = this.store.submit(actor, { ...input, work_id: selected?.id, path: input.path ?? expectedPath, round, commit });
        this.rejection = null;
        return { ok: true, receipt: { task_id: actor.task_id, work_id: selected?.id, kind: input.kind, round: value.round, commit: value.commit, replay: !!value.replay }, artifact: value.path, work: this.store.read(this.group, this.role).work };
      } else throw Error('Unknown team tool');
      return { ok: true, ...value };
    } catch (e) {
      const failure = { ok: false, code: e.code || 'REQUEST_REJECTED', message: e.message, next_action: e.next_action || 'read_current_work', ...(e.expected ? { expected: e.expected } : {}), ...(e.current_work ? { current_work: e.current_work } : {}) };
      if (name !== 'team_read') this.rejection = { ...failure, tool: name, work_id: input.work_id ?? null };
      return failure;
    }
  }
  structured(code, message, extra) { return Object.assign(Error(message), { code, ...extra }); }
  workRound(kind) { return kind.match(/^(?:documentation|documentation_review)-(\d+)-/) ? Number(kind.split('-')[1]) : kind.match(/-(\d+)$/) ? Number(kind.match(/-(\d+)$/)[1]) : undefined; }
  workRevision(kind) { return kind.match(/^documentation(?:_review)?-\d+-(\d+)$/)?.[1] ? Number(kind.match(/^documentation(?:_review)?-\d+-(\d+)$/)[1]) : undefined; }
  artifactPath(kind, taskId) {
    const round = this.workRound(kind), prefix = `groups/${this.group}/tasks/${taskId}/`;
    const base = kind.replace(/-\d+(?:-\d+)?$/, ''), revision = this.workRevision(kind) ?? (['documentation', 'documentation_review'].includes(base) && taskId ? this.store.task(taskId).docs_revision || 1 : 1);
    const names = { task: 'task.md', plan: 'plan.md', plan_review: 'plan-review.md', implementation: 'implementation.md', delivery: 'delivery.md', code_review: round == null ? null : `code-review-${String(round).padStart(2, '0')}.md`, documentation: round == null ? null : `documentation-${round}-${revision}.md`, documentation_review: round == null ? null : `documentation-review-${round}-${revision}.md`, resolution: round == null ? null : `decision-${round}.md`, blocked: round == null ? null : `decision-${round}.md`, revision: round == null ? null : `decision-${round}.md` };
    return names[base] ? prefix + names[base] : null;
  }
  workCards(work, task) {
    return work.map(w => ({ id: w.id, kind: w.kind, owner: w.owner, status: w.status, artifact_path: this.artifactPath(w.kind, task?.task_id), round: this.workRound(w.kind), ...(w.kind.startsWith('code_review-') && task?.delivery?.commit ? { commit: task.delivery.commit } : {}) }));
  }
  compactRead(raw, presented, input) {
    const lifecycle = onboardingState(this.store, this.group, this.role);
    const task = raw.task && { task_id: raw.task.task_id, generation: raw.task.generation, objective: raw.task.objective, acceptance: raw.task.acceptance, documentation_paths: raw.task.documentation_paths, documentation_checklist: raw.task.documentation_checklist, base_ref: raw.task.base_ref, integration_id: raw.task.integration_id, verification_snapshot: raw.task.verification_snapshot, round: raw.task.round, delivery: raw.task.delivery, review: raw.task.review, documentation: raw.task.documentation, docs_revision: raw.task.docs_revision, outcome: raw.task.outcome, finalization: raw.task.finalization };
    const group = { group_id: raw.group.group_id, name: raw.group.name, description: raw.group.applied_definition?.description || raw.group.description, worktree: raw.group.worktree, generation: raw.group.generation, definition_epoch: raw.group.definition_epoch };
    const work = [...(lifecycle?.work || []), ...raw.work];
    const onboardingActive = lifecycle?.status === 'pending';
    const claimed = new Set(this.store.session(this.group, this.role)?.claim || []);
    const recoverClaimed = this.recoverClaimedMessages;
    const inbox = this.store.inbox(this.group, this.role).filter(m => !m.read_at && m.id > (raw.group.message_epoch_start || 0) && (m.id > this.messageCursor || !m.presented_at || recoverClaimed && claimed.has(m.id)) && (!m.data.task_id || m.data.task_id === raw.group.active_task) && (onboardingActive || !['onboarding', 'onboarding_ack', 'onboarding_recovery', 'work'].includes(m.data.type)));
    const messages = inbox.map(({ id, data, presented_at }) => ({ id, data, presented_at }));
    if (messages.length) this.messageCursor = Math.max(this.messageCursor, ...messages.map(m => m.id));
    this.recoverClaimedMessages = false;
    const contract = { group, task: task && { task_id: task.task_id, objective: task.objective, acceptance: task.acceptance, documentation_paths: task.documentation_paths, documentation_checklist: task.documentation_checklist, base_ref: task.base_ref, integration_id: task.integration_id, verification_snapshot: task.verification_snapshot } };
    const key = JSON.stringify([raw.group.definition_epoch, raw.group.generation, task?.task_id, contract]);
    const changed = this.contextKey !== key;
    const include = input.refresh_context || changed;
    if (changed) this.contextVersion++;
    this.contextKey = key;
    const taskVersion = raw.task && JSON.stringify({ generation: raw.task.generation, round: raw.task.round, delivery: raw.task.delivery?.commit, review: raw.task.review, documentation: raw.task.documentation, docs_revision: raw.task.docs_revision, outcome: raw.task.outcome });
    const result = { ok: true, group, work: this.workCards(work, raw.task), task: task && { ...task, objective: undefined, acceptance: undefined, documentation_paths: undefined, documentation_checklist: undefined, base_ref: undefined }, messages, lifecycle: lifecycle && { operation_id: lifecycle.operation_id, status: lifecycle.status, epoch: lifecycle.epoch, ...(onboardingActive ? { receipts: lifecycle.receipts } : {}), work: lifecycle.work }, context_ref: `${raw.group.group_id}:${raw.group.generation}:${raw.group.definition_epoch}:${task?.task_id || 'idle'}:${this.contextVersion}`, task_version: taskVersion, work_version: work.map(w => w.id).join(','), message_version: messages.at(-1)?.id ?? this.messageCursor };
    if (include) result.context = contract;
    else result.context_changed = false;
    return result;
  }
  invalidateReadContext() { this.contextKey = null; this.recoverClaimedMessages = true; }
  finish() {
    const g = this.store.group(this.group);
    if (g.active_task !== this.identity.task_id || g.generation !== this.identity.generation || g.definition_epoch !== this.identity.definition_epoch) return;
    const lifecycle = onboardingState(this.store, this.group, this.role);
    if (lifecycle?.work.length) this.store.tx(() => {
      const key = `${lifecycle.operation_id}:${this.role}:unfinished_onboarding`;
      if (this.store.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND json_extract(data,'$.alert_key')=?").get(this.group, key)) return;
      this.store.notice(this.group, this.role === 'coordinator' ? 'lead' : 'coordinator', { type: 'unfinished_work', alert_key: key, lifecycle_id: lifecycle.operation_id, definition_epoch: lifecycle.epoch, role: this.role, work: lifecycle.work, rejection: this.rejection, detail: 'Onboarding turn settled without a real acknowledgement receipt. Prose or printed tool syntax is not a tool call. Ask the owner through team_send to use the actual team_read/team_submit onboarding tools; do not synthesize its ACK.' });
    });
    this.store.alertUnfinished(this.group, this.role, this.launch, this.rejection);
  }
}
