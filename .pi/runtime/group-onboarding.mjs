import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROLES, alive } from './group-store.mjs';
import { readDefinition, definitionInventory } from './group-definitions.mjs';

function schema(store) { store.db.exec('CREATE TABLE IF NOT EXISTS group_lifecycle (group_id TEXT PRIMARY KEY, data TEXT NOT NULL)'); }
function load(store, id) { schema(store); const row = store.db.prepare('SELECT data FROM group_lifecycle WHERE group_id=?').get(id); return row ? JSON.parse(row.data) : null; }
function save(store, state) { store.db.prepare('INSERT OR REPLACE INTO group_lifecycle VALUES (?,?)').run(state.group_id, JSON.stringify(state)); return state; }
export function sharedRoleVersion(sourceRoot) {
  const config = join(sourceRoot, '.pi/roles.json');
  return sharedRoleVersionFromSource(sourceRoot, existsSync(config) ? readFileSync(config, 'utf8') : null);
}
// Reconstruct a historical role version from the exact source bytes while
// reading the current prompt and skill files. Used only for explicit config
// migrations that must prove those instructions did not change.
export function sharedRoleVersionFromSource(sourceRoot, rolesSource) {
  const hash = createHash('sha256');
  if (rolesSource !== null) { hash.update('roles.json'); hash.update(rolesSource); }
  for (const role of ROLES) {
    const path = join(sourceRoot, '.pi/agents', `${role}.md`);
    hash.update(role); if (existsSync(path)) hash.update(readFileSync(path));
    const skill = join(sourceRoot, '.pi/skills', role === 'coordinator' ? 'coordinate-group' : role === 'executor' ? 'execute-group-task' : 'review-group-task', 'SKILL.md');
    if (existsSync(skill)) hash.update(readFileSync(skill));
  }
  return hash.digest('hex');
}
export function onboardingState(store, group, role) {
  const state = load(store, group); if (!state) return null;
  const owner = role === 'lead' ? null : role;
  return { ...state, work: !owner || state.status !== 'pending' || state.receipts[owner] || owner === 'coordinator' && (!state.receipts.executor || !state.receipts.validator) ? [] : [{ id: `${state.operation_id}:${owner}`, kind: 'onboarding', owner, definition_epoch: state.epoch }] };
}
// Called only after all old processes/commands are quiescent. No conversation is copied.
export function beginOnboarding(store, group, { role_version = null } = {}) {
  const definition = readDefinition(store, group); schema(store);
  return store.tx(() => {
    const g = store.group(group), previous = load(store, group);
    const version = role_version || previous?.role_version || null;
    const unchanged = previous && previous.status !== 'waiting_for_task' && !g.desired_definition && previous.definition_hash === definition.definition_hash && previous.role_version === version;
    if (unchanged) return previous;
    if (g.active_task) {
      g.desired_definition = definition; store.put('groups', group, g);
      const waiting = { group_id: group, operation_id: previous?.operation_id || randomUUID(), epoch: g.definition_epoch || 0, definition_hash: definition.definition_hash, role_version: version, status: 'waiting_for_task', description: definition.description, receipts: {}, desired_definition: definition, created_at: new Date().toISOString() };
      return save(store, waiting);
    }
    if (store.sessions(group).some(s => alive(s.pid))) throw Error('stop old role processes and their commands before applying a new definition');
    const epoch = (g.definition_epoch || 0) + 1;
    const sessions = store.sessions(group);
    if (sessions.length) {
      const archive = join(store.root, 'session-archive', group); mkdirSync(archive, { recursive: true });
      writeFileSync(join(archive, `${g.definition_epoch || 0}-${randomUUID()}.json`), JSON.stringify({ definition: g.applied_definition, sessions }, null, 2));
      store.db.prepare('DELETE FROM sessions WHERE group_id=?').run(group);
    }
    const state = { group_id: group, operation_id: randomUUID(), epoch, definition_hash: definition.definition_hash, role_version: version, status: 'pending', description: definition.description, receipts: {}, created_at: new Date().toISOString() };
    const lastMessage = store.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE group_id=?').get(group).id;
    Object.assign(g, { definition_epoch: epoch, message_epoch_start: Number(lastMessage), applied_definition: definition, desired_definition: null, name: definition.name, archived: definition.archived }); store.put('groups', group, g); save(store, state);
    for (const role of ['executor', 'validator']) store.notice(group, role, { type: 'onboarding', lifecycle_id: state.operation_id, definition_epoch: epoch, detail: 'Read the group description and your stable role description. Submit kind onboarding with a concise, explicit acknowledgement of your responsibilities. This is finite onboarding, not a business task.' });
    return state;
  });
}
export function submitOnboarding(store, actor, input) {
  schema(store);
  return store.tx(() => {
    const g = store.group(actor.group_id), state = load(store, actor.group_id);
    if (!state || state.epoch !== actor.definition_epoch || actor.lifecycle_id !== state.operation_id || g.definition_epoch !== state.epoch) throw Error('stale onboarding epoch');
    if (g.active_task) throw Error('onboarding cannot submit during a business task');
    const session = store.session(actor.group_id, actor.role);
    if (!session || session.launch_id !== actor.launch_id) throw Error('stale role process');
    if (!ROLES.includes(actor.role)) throw Error('invalid onboarding role');
    if (input.work_id && input.work_id !== `${state.operation_id}:${actor.role}`) throw Error('wrong onboarding work_id');
    if (typeof input.body !== 'string' || !input.body.trim()) throw Error('onboarding requires an explicit acknowledgement body');
    const old = state.receipts[actor.role];
    if (old) { if (old.body !== input.body.trim()) throw Error('onboarding acknowledgement is immutable'); return { ...old, replay: true }; }
    if (state.status !== 'pending') throw Error('onboarding is not pending');
    if (actor.role === 'coordinator' && (!state.receipts.executor || !state.receipts.validator)) throw Error('Coordinator must first receive both peer acknowledgements');
    const receipt = { kind: 'onboarding', group_id: actor.group_id, definition_epoch: state.epoch, lifecycle_id: state.operation_id, work_id: `${state.operation_id}:${actor.role}`, role: actor.role, body: input.body.trim(), session_id: session.session_id, launch_id: session.launch_id, at: new Date().toISOString() };
    state.receipts[actor.role] = receipt;
    store.notice(actor.group_id, actor.role === 'coordinator' ? 'lead' : 'coordinator', { type: 'onboarding_ack', lifecycle_id: state.operation_id, definition_epoch: state.epoch, receipt });
    if (actor.role === 'coordinator') { state.status = 'acknowledged'; state.acknowledged_at = receipt.at; }
    else if (state.receipts.executor && state.receipts.validator) store.notice(actor.group_id, 'coordinator', { type: 'onboarding', lifecycle_id: state.operation_id, definition_epoch: state.epoch, detail: 'Both peer ACKs are available. Review them and submit your own kind onboarding acknowledgement to Lead.' });
    save(store, state); return receipt;
  });
}
export function assertOnboarded(store, group, role_version = null) {
  const g = store.group(group), definition = readDefinition(store, group), state = load(store, group);
  if (resolve(g.worktree).toLowerCase() !== definition.worktree.toLowerCase()) throw Error('registered group worktree is immutable; group.md worktree does not match the runtime binding');
  if (definition.archived) throw Error('group is archived');
  if (!state || state.status !== 'ready' || state.definition_hash !== definition.definition_hash || g.definition_epoch !== state.epoch || g.desired_definition) throw Error('current group definition requires completed onboarding and stopped initialization processes');
  if (role_version && state.role_version !== role_version) throw Error('shared role instructions changed; run group-init to re-onboard the group');
  return state;
}
export function markOnboardingStopped(store, group) {
  schema(store); return store.tx(() => {
    const state = load(store, group); if (!state || state.status !== 'acknowledged') return state;
    if (store.sessions(group).some(s => alive(s.pid) || s.busy)) throw Error('onboarding roles have not stopped');
    state.status = 'ready'; state.stopped_at = new Date().toISOString(); return save(store, state);
  });
}
// Explicit provider/model migration preserves the existing definition epoch,
// receipts and session history. It is intentionally separate from onboarding:
// no role acknowledgement is fabricated or required.
export function recordProviderModelMigration(store, group, { expected_role_version, role_version, migration }) {
  schema(store);
  const state = load(store, group);
  if (!state || state.status !== 'ready' || state.role_version !== expected_role_version) throw Error('group lifecycle changed during provider/model migration');
  state.role_version = role_version;
  state.provider_model_migrations = [...(state.provider_model_migrations || []), migration];
  return save(store, state);
}
// UI reads this projection without reconciling or launching models.
export function registeredGroups(store) {
  return definitionInventory(store).map(item => {
    if (!item.registered) return item;
    let runtime = null; try { runtime = store.group(item.definition.id); } catch {}
    return { ...item, runtime, lifecycle: onboardingState(store, item.definition.id, 'lead') };
  });
}
