import { ROLES, git, alive, identifier } from './group-store.mjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function roleConfig(root = sourceRoot) { return JSON.parse(readFileSync(join(root, '.pi/roles.json'), 'utf8')); }
export function createGroup(store, input) {
  store.assertCutover();
  identifier(input.group_id);
  if (!isAbsolute(input.worktree || '')) throw Error('group worktree must be an absolute path');
  const branch = `codex/group-${input.group_id}-idle`;
  const base = input.base_ref || 'develop';
  git(store.projectRoot, 'show-ref', '--verify', `refs/heads/${base}`);
  const path = resolve(input.worktree);
  if (existsSync(path)) {
    if (git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir') !== store.common || git(path, 'branch', '--show-current') !== branch || git(path, 'status', '--porcelain')) throw Error('existing path is not this clean group idle worktree');
  } else git(store.projectRoot, 'worktree', 'add', '-b', branch, path, base);
  return store.createGroup({ ...input, worktree: path, idle_branch: branch });
}
export function startTask(store, group, input) { return store.operation(`group:${group}`, () => startTaskUnlocked(store, group, input)); }
function startTaskUnlocked(store, group, input) {
  store.assertCutover(); const g = store.group(group); store.assertIdle(group);
  identifier(input.task_id);
  if (typeof input.objective !== 'string' || !input.objective.trim() || !Array.isArray(input.acceptance) || !input.acceptance.length || input.acceptance.some(x => typeof x !== 'string' || !x.trim())) throw Error('task requires an objective and observable acceptance results');
  if (g.archived || g.active_task) throw Error('group is not available');
  if (git(g.worktree, 'status', '--porcelain')) throw Error('group worktree is dirty');
  try { store.task(input.task_id); throw Error('task already exists'); } catch (e) { if (!e.message.startsWith('unknown task:')) throw e; }
  const branch = input.branch || `codex/${group}/${input.task_id}`;
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
export function promptFor(group, role) {
  return `You are the persistent ${role} of group ${group.group_id}. Worktree: ${group.worktree}. Read AGENTS.md and your selected private skill. Use team_read to discover the active task and generation. Never assume an old task is still current. Prefix assistant text with [current_state: "a concrete description"]. Submit process documents through team_submit; writing a file alone does not hand off work. End each completed turn idle; the runtime wakes you for new work. Do not poll or stop the group. Native Windows command syntax applies to bash; use PowerShell examples and dedicated read/grep/find tools. Only Lead accepts and merges.`;
}
export function roleArgs(store, group, role, sessionId, root = sourceRoot) {
  const c = store.session(group.group_id, role)?.config || roleConfig(root)[role]; if (!c) throw Error('unknown role');
  const home = process.env.PI_CODING_AGENT_DIR || join(process.env.USERPROFILE || process.env.HOME, '.pi/agent');
  const web = join(home, 'npm/node_modules/pi-web-access/index.ts');
  const tools = role === 'coordinator' && !existsSync(web) ? c.tools.filter(t => !['web_search', 'fetch_content', 'get_search_content', 'source_check'].includes(t)) : c.tools;
  const args = ['--approve', '--provider', c.provider, '--model', c.model, '--thinking', 'medium', '--name', `${group.group_id}:${role}`, '--session-id', sessionId, '--no-extensions', '--no-skills', '--tools', tools.join(','), '--skill', join(root, '.pi/skills', c.skill, 'SKILL.md'), '--append-system-prompt', join(root, '.pi/agents', `${role}.md`), '--extension', join(root, '.pi/communication/extensions/group.ts')];
  if (role === 'coordinator') {
    if (existsSync(web)) args.push('--extension', web);
  }
  const prompt = join(store.root, `${group.group_id}-${role}-prompt.txt`); writeFileSync(prompt, promptFor(group, role)); args.push(`@${prompt}`); return args;
}
export async function launchGroup(store, groupId, options = {}) {
  store.assertCutover(); const g = store.group(groupId); if (g.archived) throw Error('group archived');
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
      const payload = Buffer.from(JSON.stringify({ env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PI_TEAM_'))), cwd: g.worktree, exe: process.env.PI_CMD || 'pi.cmd', args })).toString('base64');
      const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;foreach($p in $d.env.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'Process')};Set-Location -LiteralPath $d.cwd;& $d.exe @($d.args);exit $LASTEXITCODE`;
      child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, cwd: g.worktree, windowsHide: true, stdio: 'ignore' });
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
  return store.operation('integration', () => store.operation(`group:${t.group_id}`, () => {
    try { return finalizeUnlocked(store, taskId, options); }
    catch (error) { const current = store.task(taskId); current.finalization = { ...current.finalization, last_error: error.message, failed_at: new Date().toISOString() }; store.put('tasks', taskId, current); throw error; }
  }));
}
function finalizeUnlocked(store, taskId, options = {}) {
  const t = store.task(taskId), g = store.group(t.group_id); store.assertIdle(g.group_id);
  if (t.finalization?.complete) return t.finalization;
  if (!['accepted', 'incomplete'].includes(t.outcome)) throw Error('Lead acceptance or explicit incomplete closure required');
  const target = t.base_ref;
  if (t.outcome === 'accepted') {
    if (t.finalization?.merged && (git(store.projectRoot, 'rev-parse', 'HEAD') !== t.finalization.commit || git(store.projectRoot, 'status', '--porcelain') || git(store.projectRoot, 'branch', '--show-current') !== target)) throw Error('integrated target changed; inspect before retrying finalization');
    if (!t.finalization?.merged) {
      store.assertDelivery(g, t);
      if (git(store.projectRoot, 'branch', '--show-current') !== target || git(store.projectRoot, 'status', '--porcelain')) throw Error('Lead must finalize from clean target branch');
      // Commit only process evidence after acceptance; production content stays the reviewed delivery.
      git(g.worktree, 'add', '--', `groups/${g.group_id}`);
      if (git(g.worktree, 'diff', '--cached', '--name-only')) git(g.worktree, 'commit', '-m', `docs: retain ${taskId} process evidence`);
      git(store.projectRoot, 'merge', '--no-edit', t.branch);
      t.finalization = { merged: true, commit: git(store.projectRoot, 'rev-parse', 'HEAD') }; store.put('tasks', taskId, t);
    }
    if (!t.finalization.tested) {
      if (!options.skipTests) execFileSync(process.execPath, [join(store.projectRoot, 'tests/run-tests.mjs')], { cwd: store.projectRoot, stdio: 'pipe', windowsHide: true });
      t.finalization.tested = true; store.put('tasks', taskId, t);
    }
  } else if (git(g.worktree, 'status', '--porcelain')) throw Error('incomplete task evidence must be committed or explicitly preserved before detach');
  git(g.worktree, 'switch', g.idle_branch);
  git(g.worktree, 'merge', '--ff-only', target);
  store.tx(() => { g.active_task = null; g.generation += 1; store.put('groups', g.group_id, g); t.finalization = { ...t.finalization, complete: true, last_error: null, branch_preserved: true }; store.put('tasks', taskId, t); });
  return t.finalization;
}
