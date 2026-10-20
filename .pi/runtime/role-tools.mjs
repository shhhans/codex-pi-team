// The model supplies intent; identity and submission receipts come from runtime.
export class RoleTools {
  constructor(store, group, role, launch) {
    Object.assign(this, { store, group, role, launch });
    this.begin();
  }
  begin() {
    const g = this.store.group(this.group);
    this.identity = { group_id: this.group, role: this.role, launch_id: this.launch, task_id: g.active_task, generation: g.generation };
    this.rejection = null;
  }
  actor() {
    const g = this.store.group(this.group);
    if (g.active_task !== this.identity.task_id || g.generation !== this.identity.generation) {
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
      } else if (name === 'team_send') {
        value = this.store.send(actor, input);
        if (this.rejection?.tool === 'team_send') this.rejection = null;
      } else if (name === 'team_submit') {
        const state = this.store.read(this.group, this.role);
        const selected = input.work_id == null ? state.work.find(w =>
          w.kind === input.kind || w.kind.startsWith(`${input.kind}-`) ||
          input.kind === 'resolution' && /^(blocked|revision)-/.test(w.kind)) : this.store.db.prepare('SELECT * FROM work WHERE id=? AND task_id=? AND owner=?').get(input.work_id, actor.task_id, this.role);
        if (input.work_id != null && (!selected || !(selected.kind === input.kind || selected.kind.startsWith(`${input.kind}-`) || input.kind === 'resolution' && /^(blocked|revision)-/.test(selected.kind)))) { const e = Error('work_id is not owned by this task/role or does not match the submission kind'); e.code = 'WRONG_WORK'; throw e; }
        const round = input.round ?? (selected?.kind.match(/-(\d+)$/)?.[1] ? Number(selected.kind.match(/-(\d+)$/)[1]) : undefined);
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
    if (g.active_task !== this.identity.task_id || g.generation !== this.identity.generation) return;
    this.store.alertUnfinished(this.group, this.role, this.launch, this.rejection);
  }
}
