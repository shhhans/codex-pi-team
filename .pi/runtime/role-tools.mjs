// The model supplies intent; identity and submission receipts come from runtime.
import { onboardingState, submitOnboarding } from './group-onboarding.mjs';
export class RoleTools {
  constructor(store, group, role, launch) {
    Object.assign(this, { store, group, role, launch });
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
        this.store.present(this.group, this.role, this.launch);
        value = this.store.read(this.group, this.role);
        value.lifecycle = onboardingState(this.store, this.group, this.role);
        value.work = [...(value.lifecycle?.work || []), ...value.work];
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
        const selected = input.work_id == null ? state.work.find(w =>
          w.kind === input.kind || w.kind.startsWith(`${input.kind}-`) ||
          input.kind === 'resolution' && /^(blocked|revision)-/.test(w.kind)) : this.store.db.prepare('SELECT * FROM work WHERE id=? AND task_id=? AND owner=?').get(input.work_id, actor.task_id, this.role);
        if (input.work_id != null && (!selected || !(selected.kind === input.kind || selected.kind.startsWith(`${input.kind}-`) || input.kind === 'resolution' && /^(blocked|revision)-/.test(selected.kind)))) { const e = Error('work_id is not owned by this task/role or does not match the submission kind'); e.code = 'WRONG_WORK'; throw e; }
        const round = input.round ?? (selected?.kind.match(/^(?:documentation|documentation_review)-(\d+)-/)?.[1] ? Number(selected.kind.split('-')[1]) : selected?.kind.match(/-(\d+)$/)?.[1] ? Number(selected.kind.match(/-(\d+)$/)[1]) : undefined);
        const commit = input.commit ?? (input.kind === 'code_review' ? state.task?.delivery?.commit : undefined);
        value = this.store.submit(actor, { ...input, round, commit });
        this.rejection = null;
        return { ok: true, receipt: { task_id: actor.task_id, work_id: selected?.id, kind: input.kind, round: value.round, commit: value.commit, replay: !!value.replay }, artifact: value.path, work: this.store.read(this.group, this.role).work };
      } else throw Error('Unknown team tool');
      return { ok: true, ...value };
    } catch (e) {
      const failure = { ok: false, code: e.code || 'REQUEST_REJECTED', message: e.message, next_action: e.next_action || 'read_current_work' };
      if (name !== 'team_read') this.rejection = { ...failure, tool: name, work_id: input.work_id ?? null };
      return failure;
    }
  }
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
