// Dynamic authority only. Versioned contracts and work details are injected as durable context messages.
export function turnContext(state, lifecycle, role) {
  const g = state.group, t = state.task;
  return {
    group_id: g.group_id, role, worktree: g.worktree,
    generation: g.generation, definition_epoch: g.definition_epoch,
    task: t ? { task_id: t.task_id, outcome: t.outcome, round: t.round,
      delivery_commit: t.delivery?.commit || null,
      documentation_commit: t.documentation?.commit || null,
      integration_id: t.integration_id || null,
      verification_snapshot: t.verification_snapshot || null } : null,
    work: [...(lifecycle?.work || []), ...state.work].map(({ id, kind, owner }) => ({ id, kind, owner })),
    onboarding: lifecycle ? { operation_id: lifecycle.operation_id, status: lifecycle.status, epoch: lifecycle.epoch } : null,
    context_action: 'Use injected runtime context for work paths, messages and the versioned contract. Use team_read for missing context or recovery; after compaction use refresh_context:true.',
  };
}
