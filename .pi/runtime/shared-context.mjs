import { createHash } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');
export function currentSharedContext(store, groupId, content = false) {
  const epoch = store.group(groupId).definition_epoch;
  const row = store.db.prepare('SELECT data FROM shared_context WHERE group_id=? AND definition_epoch=? ORDER BY version DESC LIMIT 1').get(groupId, epoch);
  if (!row) return null;
  const value = JSON.parse(row.data);
  if (!content) delete value.content;
  return value;
}

export function freezeSharedContext(store, group, task, input, delivery) {
  if (input == null) return null; // Existing clients remain valid.
  if (input.mode === 'reuse') {
    const current = currentSharedContext(store, group.group_id);
    if (!current || input.version !== current.version) throw Error('shared_context reuse requires the current published version');
    return { mode: 'reuse', version: current.version, hash: current.hash, definition_epoch: group.definition_epoch };
  }
  if (input.mode !== 'update') throw Error('shared_context mode must be update or reuse');
  const content = /^## Shared knowledge\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(delivery)?.[1]?.trim();
  if (!content) throw Error('shared_context update requires a nonempty ## Shared knowledge section in delivery.md');
  if (content.length > 6000) throw Error('Shared knowledge exceeds 6000 characters; retain only reusable team knowledge');
  return { mode: 'update', content, hash: digest(content), definition_epoch: group.definition_epoch,
    source_task: task.task_id, source_round: task.round, source_path: `groups/${group.group_id}/tasks/${task.task_id}/delivery.md`,
    source_hash: digest(delivery.replaceAll('\r\n', '\n')), code_commit: task.delivery.commit, documentation_commit: task.documentation?.commit || null };
}

// Called inside the same transaction that records successful finalization.
export function publishSharedContext(store, task) {
  if (task.outcome !== 'accepted' || !task.finalization?.complete || !task.finalization?.merged || !(task.finalization.tested || task.finalization.independently_verified)) return null;
  const draft = store.artifact(task.task_id, 'delivery', task.round)?.shared_context;
  if (!draft || draft.mode !== 'update') return null;
  const prior = store.db.prepare('SELECT data FROM shared_context WHERE source_task=?').get(task.task_id);
  if (prior) return JSON.parse(prior.data);
  const version = store.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM shared_context WHERE group_id=?').get(task.group_id).version;
  const value = { ...draft, version, integration_commit: task.finalization.commit };
  delete value.mode;
  store.db.prepare('INSERT INTO shared_context VALUES (?,?,?,?,?)').run(task.group_id, version, draft.definition_epoch, task.task_id, JSON.stringify(value));
  return value;
}
