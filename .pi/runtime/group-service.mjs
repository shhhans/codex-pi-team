import { ROLES, git, alive, identifier, integrationMetadata } from './group-store.mjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ServiceManager } from './service-manager.mjs';
import { writeDefinition, readDefinition, committedDefinition, syncGroupBaseline } from './group-definitions.mjs';
import { beginOnboarding, assertOnboarded, sharedRoleVersion, sharedRoleVersionFromSource, onboardingState, recordProviderModelMigration } from './group-onboarding.mjs';
import { scheduleOnboarding } from '../../scripts/group-init-runner.mjs';
import { assertProviderResumeAllowed } from './provider-fault.mjs';
import { observeProcesses } from './process-observation.mjs';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function assertNoLegacyConflict(store, group, branch = null) {
  const root = join(store.common, 'pi-team', 'v1');
  if (!existsSync(root)) return;
  for (const name of readdirSync(root).filter(x => x.endsWith('.json') && !x.endsWith('-runtime.json'))) {
    let old; try { old = JSON.parse(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')); } catch { continue; }
    if (!(old.task_id && (old.outcome === 'pending' || (!old.outcome && !['cleaned', 'reclaimed'].includes(old.status))))) continue;
    const oldGroup = old.group_id || old.module_id;
    const oldPath = old.worktree || old.worktree_path || old.checkout_path;
    const samePath = typeof oldPath === 'string' && isAbsolute(oldPath) && resolve(oldPath).toLowerCase() === resolve(group.worktree).toLowerCase();
    if (oldGroup?.toLowerCase() === group.group_id.toLowerCase() || samePath || branch && old.branch?.toLowerCase() === branch.toLowerCase()) {
      throw Error(`unresolved legacy task ${old.task_id} conflicts with group ${group.group_id}; inspect and close it in the v1 checkout before using this group`);
    }
  }
}
export function roleConfig(root = sourceRoot) { return JSON.parse(readFileSync(join(root, '.pi/roles.json'), 'utf8')); }
function stableValue(value) { return Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value; }
function stableJson(value) { return JSON.stringify(stableValue(value)); }
function withoutProviderModel(config) { const { provider, model, ...rest } = config || {}; return rest; }
function sourceRolesObject(raw, label) {
  let roles; try { roles = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw Error(`${label} must be valid roles.json content`); }
  if (!roles || Array.isArray(roles) || typeof roles !== 'object' || ROLES.some(role => !roles[role]) || Object.keys(roles).some(role => !ROLES.includes(role))) throw Error(`${label} must define exactly coordinator, executor and validator`);
  return roles;
}
/**
 * Migrate only provider/model fields for a ready group's persisted role sessions.
 * `priorRolesSource` must contain the exact prior roles.json bytes. Existing
 * tasks, session IDs, conversation paths, receipts and the definition epoch are
 * preserved. Stopped sessions can be resumed under the current roles.json.
 */
export function migrateProviderModel(store, groupId, { priorRolesSource, sourceRoot: root = sourceRoot, observe = observeProcesses } = {}) {
  return store.operation(`group:${groupId}`, () => {
    if (typeof priorRolesSource !== 'string' || !priorRolesSource) throw Error('exact prior roles.json content is required for migration provenance');
    const group = store.group(groupId), lifecycle = onboardingState(store, groupId, 'lead');
    if (group.archived || group.desired_definition) throw Error('provider/model migration requires a non-archived group with no pending definition');
    if (!lifecycle || lifecycle.status !== 'ready') throw Error('provider/model migration requires completed onboarding and stopped initialization');
    const prior = sourceRolesObject(priorRolesSource, 'prior roles source');
    const currentRaw = readFileSync(join(root, '.pi/roles.json'), 'utf8'), current = sourceRolesObject(currentRaw, 'current roles source');
    const priorVersion = sharedRoleVersionFromSource(root, priorRolesSource);
    if (priorVersion !== lifecycle.role_version) throw Error('prior roles source does not reconstruct the recorded role version; prompt or skill provenance is not verifiable');
    assertOnboarded(store, groupId, priorVersion);
    const sessions = store.sessions(groupId);
    if (sessions.length !== ROLES.length || ROLES.some(role => !sessions.some(session => session.role === role))) throw Error('migration requires one persisted session for each role');
    const changes = [], processEvidence = [];
    for (const role of ROLES) {
      const old = prior[role], next = current[role], session = sessions.find(item => item.role === role);
      if (!old || !next || !session.config || stableJson(session.config) !== stableJson(old)) throw Error(`persisted ${role} configuration does not match the supplied prior roles source`);
      if (![old.provider, old.model, next.provider, next.model].every(value => typeof value === 'string' && value.trim())) throw Error(`provider and model must be nonempty strings for ${role}`);
      if (stableJson(withoutProviderModel(old)) !== stableJson(withoutProviderModel(next))) throw Error(`migration may change only provider and model; ${role} tools or role configuration changed`);
      if (old.provider === next.provider && old.model === next.model) continue;
      changes.push({ role, from: { provider: old.provider, model: old.model }, to: { provider: next.provider, model: next.model } });
    }
    if (!changes.length) throw Error('current roles.json does not change any provider/model');
    const observation = observe(sessions.map(session => session.pid));
    for (const session of sessions) {
      if (!Number.isInteger(session.pid) || session.pid < 1) throw Error(`process identity is missing for ${session.role}; inspect the registration before migration`);
      const actual = observation.get(session.pid);
      if (!actual || actual.status === 'unknown') throw Error(`process identity is unknown for ${session.role}; inspect it before migration`);
      if (actual.status === 'running') {
        if (!session.process_start_stamp || !actual.stamp) throw Error(`process identity cannot be verified for ${session.role}; inspect it before migration`);
        if (actual.stamp === session.process_start_stamp) throw Error(`role process is still running for ${session.role}; stop it before migration`);
        processEvidence.push({ role: session.role, pid: session.pid, recorded_process_start_stamp: session.process_start_stamp, observed_process_start_stamp: actual.stamp, result: 'pid_reused_unrelated_process_preserved' });
      } else if (actual.status === 'stopped') processEvidence.push({ role: session.role, pid: session.pid, process_start_stamp: session.process_start_stamp || null, result: 'recorded_process_stopped' });
      else throw Error(`process state is not safe to migrate for ${session.role}`);
    }
    const nextVersion = sharedRoleVersion(root), at = new Date().toISOString(), migrationId = randomUUID();
    const receipt = { id: migrationId, kind: 'provider_model_migration', group_id: groupId, at, prior_role_version: lifecycle.role_version, role_version: nextVersion, prior_roles_source: priorRolesSource, target_roles_source: currentRaw, prior_sessions: sessions, changes, process_evidence: processEvidence, definition_epoch: lifecycle.epoch, active_task: group.active_task || null };
    store.tx(() => {
      const latest = onboardingState(store, groupId, 'lead');
      if (latest?.role_version !== lifecycle.role_version || latest?.status !== 'ready') throw Error('group lifecycle changed during provider/model migration');
      for (const role of ROLES) {
        const next = current[role], session = store.session(groupId, role);
        session.config = next;
        // A PID may now belong to an unrelated process. Never let alive(pid)
        // reuse the stale registration on group-resume.
        session.pid = null; session.launcher_pid = null; session.launcher_owned = false;
        session.fault = null; session.provider_fault = null; session.model_migration_id = migrationId;
        store.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(JSON.stringify(session), groupId, role);
      }
      recordProviderModelMigration(store, groupId, { expected_role_version: lifecycle.role_version, role_version: nextVersion, migration: { id: migrationId, at, changes } });
      store.db.exec('CREATE TABLE IF NOT EXISTS provider_model_migrations (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, data TEXT NOT NULL)');
      store.db.prepare('INSERT INTO provider_model_migrations VALUES (?,?,?)').run(migrationId, groupId, JSON.stringify(receipt));
      for (const role of ROLES) store.notice(groupId, role, { type: 'provider_model_migrated', migration_id: migrationId, detail: 'Provider/model changed. Existing assignments, conversation history and receipts are preserved; continue current assigned work.' });
    });
    return receipt;
  });
}
function definitionForGroup(store, groupId) {
  const definition = readDefinition(store, groupId);
  try {
    const group = store.group(groupId);
    if (resolve(group.worktree).toLowerCase() !== definition.worktree.toLowerCase()) throw Error('registered group worktree is immutable; group.md worktree does not match the runtime binding');
  } catch (error) { if (!error.message.startsWith('unknown group:')) throw error; }
  return definition;
}
export function createGroup(store, input) {
  identifier(input.group_id);
  if (store.list().some(group => group.group_id.toLowerCase() === input.group_id.toLowerCase())) throw Error('group registration conflict: runtime group id already exists');
  if (!isAbsolute(input.worktree || '')) throw Error('group worktree must be an absolute path');
  if (typeof input.description !== 'string' || !input.description.trim()) throw Error('group description is required');
  const definitionPath = join(store.projectRoot, 'groups', input.group_id, 'group.md');
  if (existsSync(definitionPath)) throw Error('group registration conflict: groups/<id>/group.md already exists');
  const branch = `codex/group-${input.group_id}-idle`;
  const base = input.base_ref || 'develop';
  git(store.projectRoot, 'show-ref', '--verify', `refs/heads/${base}`);
  const path = resolve(input.worktree);
  if (existsSync(path)) {
    if (git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir') !== store.common || git(path, 'branch', '--show-current') !== branch || git(path, 'status', '--porcelain')) throw Error('existing path is not this clean group idle worktree');
  } else git(store.projectRoot, 'worktree', 'add', '-b', branch, path, base);
  try {
    const definition = writeDefinition(store, { ...input, worktree: path, base_ref: base });
    const group = store.createGroup({ ...input, name: definition.name, worktree: path, idle_branch: branch });
    const onboarding = beginOnboarding(store, input.group_id, { role_version: sharedRoleVersion(sourceRoot) });
    return { group, onboarding };
  } catch (error) {
    // Keep any created branch/worktree for inspection; never erase Lead data.
    throw error;
  }
}
export function syncGroup(store, groupId) {
  const g = store.group(groupId), definition = definitionForGroup(store, groupId);
  committedDefinition(store, groupId);
  if (git(store.projectRoot, 'branch', '--show-current') !== definition.base_ref) throw Error(`switch the clean Lead checkout to configured base_ref ${definition.base_ref} before syncing`);
  assertNoLegacyConflict(store, g, g.idle_branch); return syncGroupBaseline(store, groupId);
}
export function adoptGroup(store, groupId, input) {
  return store.operation(`group:${groupId}`, () => {
    const g = store.group(groupId);
    if (g.active_task) throw Error('finish or explicitly close the existing task before adopting a legacy v2 registration');
    if (existsSync(join(store.projectRoot, 'groups', groupId, 'group.md'))) throw Error('definition already exists; use group-update or group-init');
    if (typeof input.description !== 'string' || !input.description.trim() || typeof input.base_ref !== 'string' || !input.base_ref.trim()) throw Error('adoption requires Lead-written description and base_ref');
    git(store.projectRoot, 'show-ref', '--verify', `refs/heads/${input.base_ref}`);
    if (git(g.worktree, 'branch', '--show-current') !== g.idle_branch || git(g.worktree, 'status', '--porcelain')) throw Error('adoption requires the preserved clean idle group worktree');
    quiesceGroup(store, groupId);
    writeDefinition(store, { ...input, group_id: groupId, name: input.name || g.name, worktree: g.worktree });
    return beginOnboarding(store, groupId, { role_version: sharedRoleVersion(sourceRoot) });
  });
}
export function reconcileRegistration(store, groupId, options = {}) {
  let definition = readDefinition(store, groupId);
  try { return { group: store.group(groupId), onboarding: updateGroup(store, groupId, {}, options) }; }
  catch (error) { if (!error.message.startsWith('unknown group:')) throw error; }
  const branch = `codex/group-${groupId}-idle`;
  if (!existsSync(definition.worktree) || git(definition.worktree, 'branch', '--show-current') !== branch || git(definition.worktree, 'status', '--porcelain')) throw Error('registered group worktree must exist on its clean idle branch');
  const group = store.createGroup({ group_id: groupId, name: definition.name, worktree: definition.worktree, idle_branch: branch });
  return { group, onboarding: beginOnboarding(store, groupId, { role_version: sharedRoleVersion(options.sourceRoot || sourceRoot) }) };
}
function quiesceGroup(store, groupId) {
  new ServiceManager(store).stopGroup(groupId);
  if (store.sessions(groupId).some(session => alive(session.pid))) stopGroup(store, groupId, true);
  const deadline = Date.now() + 10000;
  while (store.sessions(groupId).some(session => alive(session.pid)) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  if (store.sessions(groupId).some(session => alive(session.pid))) throw Error('role processes have not quiesced; retry after they exit');
}
export function updateGroup(store, groupId, patch = {}, options = {}) {
  return store.operation(`group:${groupId}`, () => {
    const current = definitionForGroup(store, groupId);
    if (patch.archived === true && store.group(groupId).active_task) throw Error('finish or explicitly close the active task before archiving the group');
    const next = { group_id: groupId, name: patch.name ?? current.name, description: patch.description ?? current.description, worktree: current.worktree, base_ref: patch.base_ref ?? current.base_ref, archived: patch.archived ?? current.archived };
    const version = sharedRoleVersion(options.sourceRoot || sourceRoot);
    const oldLifecycle = onboardingState(store, groupId, 'lead');
    if (next.name === current.name && next.description === current.description && next.worktree === current.worktree && next.base_ref === current.base_ref && next.archived === current.archived && oldLifecycle?.role_version === version && oldLifecycle.definition_hash === current.definition_hash) return oldLifecycle;
    writeDefinition(store, next, { replace: true });
    const g = store.group(groupId);
    if (g.name !== next.name || g.archived !== next.archived) { g.name = next.name; g.archived = next.archived; store.put('groups', groupId, g); }
    if (next.description === current.description && onboardingState(store, groupId, 'lead')?.role_version === version && onboardingState(store, groupId, 'lead')?.definition_hash === current.definition_hash) { if (next.archived) quiesceGroup(store, groupId); return onboardingState(store, groupId, 'lead'); }
    if (g.active_task) return beginOnboarding(store, groupId, { role_version: version });
    quiesceGroup(store, groupId);
    return beginOnboarding(store, groupId, { role_version: version });
  });
}
export function applyDesiredGroup(store, groupId, options = {}) {
  const g = store.group(groupId);
  if (g.active_task || !g.desired_definition) return onboardingState(store, groupId, 'lead');
  quiesceGroup(store, groupId);
  return beginOnboarding(store, groupId, { role_version: sharedRoleVersion(options.sourceRoot || sourceRoot) });
}
export function startTask(store, group, input) { return store.operation(`group:${group}`, () => startTaskUnlocked(store, group, input)); }
function startTaskUnlocked(store, group, input) {
  const roleVersion = sharedRoleVersion(sourceRoot); assertOnboarded(store, group, roleVersion); const definition = definitionForGroup(store, group); committedDefinition(store, group); const g = store.group(group); assertNoLegacyConflict(store, g); store.assertIdle(group);
  input = { ...input, base_ref: input.base_ref || definition.base_ref };
  if (input.base_ref !== definition.base_ref) throw Error(`task base_ref must match registered group base_ref ${definition.base_ref}`);
  if (git(store.projectRoot, 'status', '--porcelain') || git(store.projectRoot, 'branch', '--show-current') !== input.base_ref) throw Error('task start requires a clean committed Lead checkout on the registered base_ref');
  if (git(g.worktree, 'rev-parse', 'HEAD') !== git(store.projectRoot, 'rev-parse', 'HEAD')) throw Error('sync the clean idle group worktree to the committed Lead baseline before starting a task');
  identifier(input.task_id);
  integrationMetadata(input); // Reject malformed bindings before recording a Git transition.
  if (typeof input.objective !== 'string' || !input.objective.trim() || !Array.isArray(input.acceptance) || !input.acceptance.length || input.acceptance.some(x => typeof x !== 'string' || !x.trim())) throw Error('task requires an objective and observable acceptance results');
  if (g.archived || g.active_task) throw Error('group is not available');
  if (git(g.worktree, 'status', '--porcelain')) throw Error('group worktree is dirty');
  try { store.task(input.task_id); throw Error('task already exists'); } catch (e) { if (!e.message.startsWith('unknown task:')) throw e; }
  const branch = input.branch || `codex/${group}/${input.task_id}`;
  assertNoLegacyConflict(store, g, branch);
  git(g.worktree, 'check-ref-format', '--branch', branch);
  git(g.worktree, 'show-ref', '--verify', `refs/heads/${input.base_ref}`);
  if (g.transition && JSON.stringify(g.transition.input) !== JSON.stringify(input)) throw Error('unfinished task transition; retry the original descriptor');
  const exists = git(g.worktree, 'for-each-ref', '--format=%(refname)', `refs/heads/${branch}`).split(/\r?\n/).includes(`refs/heads/${branch}`);
  if (exists && !g.transition) throw Error('task branch already exists without a recorded transition');
  if (!g.transition) { g.transition = { input, branch, base_commit: git(g.worktree, 'rev-parse', input.base_ref) }; store.put('groups', group, g); }
  if (exists) git(g.worktree, 'switch', branch);
  else git(g.worktree, 'switch', '-c', branch, g.transition.base_commit);
  return store.startTask(group, { ...input, branch });
}
export function promptFor(group, role, startup = null) {
  const action = startup ? startup.work.length
    ? `Startup assignment: ${JSON.stringify(startup.work.map(({ id, kind }) => ({ id, kind })))}. Use team_read for the current assignment and context.`
    : startup.messages?.some(message => !message.read_at)
      ? 'Unsettled messages are available. Use team_read to handle them; if no work is assigned, reply only when necessary and end idle.'
      : 'No work is assigned to you at startup. End idle and wait for a runtime work or peer-message notification. Do not inventory files, read old tasks, or probe implementation while waiting.'
    : 'Use team_read to discover onboarding or the active task and generation.';
  return `You are the persistent ${role} of group ${group.group_id}. Group responsibility: ${group.applied_definition?.description || 'read groups/' + group.group_id + '/group.md'}. Worktree: ${group.worktree}. Read AGENTS.md and your selected private skill. ${action} Never assume an old task is still current. Prefix assistant text with [current_state: "a concrete description"]. Submit process documents through team_submit; writing a file alone does not hand off work. End each completed turn idle; the runtime wakes you for new work. Do not poll or stop the group. Native Windows command syntax applies to bash; use PowerShell examples and dedicated read/grep/find tools. Only Lead accepts and merges.`;
}
export function roleArgs(store, group, role, sessionId, root = sourceRoot) {
  const c = store.session(group.group_id, role)?.config || roleConfig(root)[role]; if (!c) throw Error('unknown role');
  const home = process.env.PI_CODING_AGENT_DIR || join(process.env.USERPROFILE || process.env.HOME, '.pi/agent');
  const web = join(home, 'npm/node_modules/pi-web-access/index.ts');
  const tools = role === 'coordinator' && !existsSync(web) ? c.tools.filter(t => !['web_search', 'fetch_content', 'get_search_content', 'source_check'].includes(t)) : c.tools;
  const persisted = store.session(group.group_id, role);
  const args = ['--approve', '--provider', c.provider, '--model', c.model, '--thinking', 'medium', '--name', `${group.group_id}:${role}`];
  if (persisted?.session_path) args.push('--session', persisted.session_path); else args.push('--session-id', sessionId);
  args.push('--no-extensions', '--no-skills', '--tools', tools.join(','), '--skill', join(root, '.pi/skills', c.skill, 'SKILL.md'), '--append-system-prompt', join(root, '.pi/agents', `${role}.md`), '--extension', join(root, '.pi/communication/extensions/group.ts'));
  if (role === 'coordinator') {
    if (existsSync(web)) args.push('--extension', web);
  }
  const startup = store.read(group.group_id, role);
  startup.work = [...(onboardingState(store, group.group_id, role)?.work || []), ...startup.work];
  const prompt = join(store.root, `${group.group_id}-${role}-prompt.txt`); writeFileSync(prompt, promptFor(group, role, startup)); args.push(`@${prompt}`); return args;
}
export async function launchGroup(store, groupId, options = {}) {
  assertOnboarded(store, groupId, sharedRoleVersion(options.sourceRoot || sourceRoot)); const g = store.group(groupId); definitionForGroup(store, groupId); assertNoLegacyConflict(store, g, g.idle_branch); if (g.archived) throw Error('group archived');
  for (const session of store.sessions(groupId)) assertProviderResumeAllowed(session, { force: options.forceProviderRetry === true });
  const result = [];
  for (const role of ROLES) {
    const old = store.session(groupId, role);
    if (old && alive(old.pid)) { if (old.fault) store.updateSession(groupId, role, old.launch_id, { fault: null }); result.push({ role, pid: old.pid, reused: true }); continue; }
    if (old?.session_path && !existsSync(old.session_path)) throw Error(`session history missing for ${role}; restore it before resume`);
    const sessionId = old?.session_id || randomUUID(), launchId = randomUUID();
    const args = roleArgs(store, g, role, sessionId, options.sourceRoot || sourceRoot);
    const env = { ...process.env, PI_TEAM_PROJECT_ROOT: store.projectRoot, PI_TEAM_GROUP_ID: groupId, PI_TEAM_ROLE: role, PI_TEAM_LAUNCH_ID: launchId, PI_TEAM_SESSION_ID: sessionId, PI_TEAM_SOURCE_ROOT: options.sourceRoot || sourceRoot, PI_TEAM_ROLE_CONFIG: JSON.stringify(old?.config || roleConfig(options.sourceRoot || sourceRoot)[role]) };
    let child;
    if (options.headless) {
      const startup = store.read(groupId, role);
      const descriptor = join(store.root, `${groupId}-${role}-${launchId}-rpc.json`);
      const promptFile = args.at(-1).slice(1);
      writeFileSync(descriptor, JSON.stringify({ env: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('PI_TEAM_'))), cwd: g.worktree, args: args.slice(0, -1), prompt: startup.work.length || startup.messages.some(message => !message.read_at) ? readFileSync(promptFile, 'utf8') : null, log: join(store.root, `${groupId}-${role}-${launchId}-rpc.jsonl`) }));
      child = spawn(process.execPath, [join(options.sourceRoot || sourceRoot, 'scripts/group-role-runner.mjs'), descriptor], { env, cwd: g.worktree, detached: true, windowsHide: true, stdio: 'ignore' });
    } else {
      // wt may forward into an existing process, so transmit identity inside its child bootstrap.
      const payload = Buffer.from(JSON.stringify({ env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PI_TEAM_'))), cwd: g.worktree, exe: process.env.PI_CMD || 'pi.cmd', args })).toString('base64');
      const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;foreach($p in $d.env.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'Process')};Set-Location -LiteralPath $d.cwd;& $d.exe @($d.args)`;
      child = spawn(process.env.WT_CMD || 'wt.exe', ['-d', g.worktree, 'powershell.exe', '-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, cwd: g.worktree, windowsHide: false, stdio: 'ignore' });
    }
    let error; child.once('error', e => { error = e; }); child.unref();
    const deadline = Date.now() + (options.timeout || 30000);
    while (Date.now() < deadline && !error) { const s = store.session(groupId, role); if (s?.launch_id === launchId && alive(s.pid)) { store.updateSession(groupId, role, launchId, { launcher_pid: child.pid, launcher_owned: Boolean(options.headless) }); result.push({ role, pid: s.pid, session_id: s.session_id }); break; } await new Promise(r => setTimeout(r, 100)); }
    if (error || !result.some(x => x.role === role)) throw Error(`role failed readiness: ${role}: ${error?.message || 'timeout; existing ready roles retained for group-resume'}`);
  }
  return result;
}
export function stopGroup(store, group, force = false) {
  if (!force) store.assertIdle(group);
  new ServiceManager(store).stopGroup(group);
  for (const s of store.sessions(group)) if (alive(s.pid)) {
    if (process.platform === 'win32') {
      if (!s.started_at) throw Error('process identity lacks start time; inspect before reclaim');
      const started = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(s.pid)}).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8', windowsHide: true }).trim();
      if (Math.abs(Date.parse(started) - Date.parse(s.started_at)) > 2000) throw Error('PID was reused; refusing to kill unrelated process');
      execFileSync('taskkill.exe', ['/PID', String(s.pid), '/T', '/F'], { windowsHide: true });
      if (s.launcher_owned && s.launcher_pid) execFileSync('powershell.exe', ['-NoProfile', '-Command', `Wait-Process -Id ${Number(s.launcher_pid)} -Timeout 5 -ErrorAction SilentlyContinue; exit 0`], { windowsHide: true });
    } else process.kill(s.pid, 'SIGTERM');
  }
  return { stopped: group };
}
export function finalize(store, taskId, options = {}) {
  const t = store.task(taskId);
  const result = store.operation('integration', () => store.operation(`group:${t.group_id}`, () => {
    try { return finalizeUnlocked(store, taskId, options); }
    catch (error) { const current = store.task(taskId); current.finalization = { ...current.finalization, last_error: error.message, failed_at: new Date().toISOString() }; store.put('tasks', taskId, current); throw error; }
  }));
  if (store.group(t.group_id).desired_definition) {
    const state = applyDesiredGroup(store, t.group_id);
    if (state?.status === 'pending') result.initialization = (options.scheduleOnboarding || scheduleOnboarding)(store, t.group_id);
  }
  return result;
}
function finalizeUnlocked(store, taskId, options = {}) {
  const t = store.task(taskId), g = store.group(t.group_id); store.assertIdle(g.group_id);
  if (t.finalization?.complete) return t.finalization;
  if (!['accepted', 'incomplete'].includes(t.outcome)) throw Error('Lead acceptance or explicit incomplete closure required');
  new ServiceManager(store).stopGroup(g.group_id);
  const target = t.base_ref;
  if (t.outcome === 'accepted') {
    if (t.finalization?.merged && (git(store.projectRoot, 'rev-parse', 'HEAD') !== t.finalization.commit || git(store.projectRoot, 'status', '--porcelain') || git(store.projectRoot, 'branch', '--show-current') !== target)) throw Error('integrated target changed; inspect before retrying finalization');
    if (!t.finalization?.merged) {
      store.assertDelivery(g, t);
      if (git(store.projectRoot, 'branch', '--show-current') !== target || git(store.projectRoot, 'status', '--porcelain')) throw Error('Lead must finalize from clean target branch');
      // Commit only process evidence after acceptance; production content stays the reviewed delivery.
      if (git(g.worktree, 'diff', '--cached', '--name-only')) throw Error('finalization requires an empty index');
      git(g.worktree, 'add', '--', `groups/${g.group_id}/tasks/${taskId}`);
      if (git(g.worktree, 'diff', '--cached', '--name-only')) git(g.worktree, 'commit', '-m', `docs: retain ${taskId} process evidence`);
      // Lead may commit desired group definitions while a task is running.
      // Other target changes require a new reviewed delivery before merging.
      const targetChanges = git(store.projectRoot, 'diff', t.base_commit, 'HEAD', '--name-only').split(/\r?\n/).filter(Boolean);
      if (targetChanges.some(path => !/^groups\/[^/]+\/group\.md$/.test(path) && !isCompletedTaskEvidence(store, path, t.group_id, taskId))) throw Error('target implementation changed since task baseline; rebase and re-review before integration');
      git(store.projectRoot, 'merge', '--no-edit', t.branch);
      const finalSnapshot = t.documentation?.commit || t.delivery.commit;
      const mergedChanges = git(store.projectRoot, 'diff', finalSnapshot, 'HEAD', '--name-only', '--', '.', ':(exclude)groups/**').trim();
      if (mergedChanges) throw Error('integrated implementation differs from reviewed code and documentation');
      t.finalization = { merged: true, commit: git(store.projectRoot, 'rev-parse', 'HEAD') }; store.put('tasks', taskId, t);
    }
    if (!t.finalization.tested) {
      if (!options.skipTests) {
        const spec = JSON.parse(readFileSync(join(store.projectRoot, '.pi/project.json'), 'utf8')).integration;
        if (!spec || typeof spec.executable !== 'string' || !Array.isArray(spec.args) || spec.args.some(x => typeof x !== 'string')) throw Error('configure .pi/project.json integration executable and args');
        execFileSync(spec.executable === 'node' ? process.execPath : spec.executable, spec.args, { cwd: store.projectRoot, stdio: 'pipe', windowsHide: true, shell: false });
      }
      t.finalization.tested = !options.skipTests; t.finalization.independently_verified = Boolean(options.skipTests); store.put('tasks', taskId, t);
    }
  } else if (git(g.worktree, 'status', '--porcelain')) throw Error('incomplete task evidence must be committed or explicitly preserved before detach');
  git(g.worktree, 'switch', g.idle_branch);
  git(g.worktree, 'merge', '--ff-only', target);
  store.tx(() => { g.active_task = null; g.generation += 1; store.put('groups', g.group_id, g); t.finalization = { ...t.finalization, complete: true, last_error: null, branch_preserved: true }; store.put('tasks', taskId, t); });
  return t.finalization;
}

function isCompletedTaskEvidence(store, path, currentGroupId, currentTaskId) {
  const match = /^groups\/([^/]+)\/tasks\/([^/]+)\/(.+)$/.exec(path);
  if (!match) return false;
  const [, groupId, taskId] = match;
  if (groupId === currentGroupId) return false;
  if (match[3].split('/').some(part => !part || part === '.' || part === '..')) return false;
  if (taskId === currentTaskId) return false;
  const row = store.db.prepare('SELECT data FROM tasks WHERE id=?').get(taskId);
  if (!row) return false;
  const task = JSON.parse(row.data);
  if (task.task_id !== taskId || task.group_id !== groupId || task.outcome !== 'accepted' || !task.finalization?.complete || !task.finalization.commit) return false;
  try {
    const completedBlob = git(store.projectRoot, 'rev-parse', `${task.finalization.commit}:${path}`);
    const targetBlob = git(store.projectRoot, 'rev-parse', `HEAD:${path}`);
    return completedBlob === targetBlob;
  } catch { return false; }
}
