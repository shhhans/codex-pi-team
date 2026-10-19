import { GroupStore, git, alive } from '../.pi/runtime/group-store.mjs';
import { createGroup, startTask, launchGroup, stopGroup, finalize, sourceRoot, roleConfig } from '../.pi/runtime/group-service.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const readInput = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
function invokeWindows(executable, args) {
  const payload = Buffer.from(JSON.stringify({ executable, args })).toString('base64');
  const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;& $d.executable @($d.args);exit $LASTEXITCODE`;
  return execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
}
export async function execute(store, command, args) {
  const [a, b] = args;
  switch (command) {
    case 'inventory': return { groups: store.list(), legacy_pending: store.legacyPending() };
    case 'setup': return { installed: invokeWindows(process.env.PI_CMD || 'pi.cmd', ['install', 'npm:pi-web-access@0.24.2']), note: 'Pi core/credentials are managed by Pi. Ambient extensions and skills stay disabled for group sessions.' };
    case 'group-create': return createGroup(store, readInput(a));
    case 'group-start': case 'group-resume': return launchGroup(store, a);
    case 'group-stop': return stopGroup(store, a, b === '--force');
    case 'group-archive': { const g = store.group(a); if (g.active_task) throw Error('finish active task first'); stopGroup(store, a); g.archived = true; return store.put('groups', a, g); }
    case 'start': return startTask(store, a, readInput(b));
    case 'status': return a ? store.read(a, 'coordinator') : store.list();
    case 'inspect': { const t = store.task(a), g = store.group(t.group_id); return { task: t, group: g, work: store.db.prepare('SELECT * FROM work WHERE task_id=?').all(a), artifacts: store.db.prepare('SELECT data FROM artifacts WHERE task_id=?').all(a).map(r => { const { content, ...metadata } = JSON.parse(r.data); return metadata; }), diff: git(g.worktree, 'diff', t.base_commit, '--stat'), dirty: git(g.worktree, 'status', '--porcelain'), sessions: store.sessions(g.group_id).map(s => ({ ...s, live: alive(s.pid) })) }; }
    case 'send': return store.send({ group_id: a, role: 'lead' }, { ...readInput(b), to: 'coordinator' });
    case 'inbox': return store.inbox(a, 'lead', Number(b || 0));
    case 'wait': {
      const deadline = Date.now() + Math.min(55000, Math.max(0, Number(args[2] ?? 55000)));
      do { const items = store.inbox(a, 'lead', Number(b || 0)); if (items.length) return items; await new Promise(r => setTimeout(r, 200)); } while (Date.now() < deadline);
      return [];
    }
    case 'accept': return store.accept(a, readInput(b).rationale);
    case 'request-changes': return store.requestChanges(a, readInput(b).reason);
    case 'close-incomplete': return store.cancel(a, readInput(b).reason);
    case 'finalize': return finalize(store, a);
    case 'doctor': return { node: process.version, sqlite: true, roles: roleConfig(), legacy_pending: store.legacyPending(), pi: execFileSync('where.exe', ['pi.cmd'], { encoding: 'utf8', windowsHide: true }).trim(), pi_version: invokeWindows(process.env.PI_CMD || 'pi.cmd', ['--version']).trim(), web_access: existsSync(join(process.env.USERPROFILE, '.pi/agent/npm/node_modules/pi-web-access/index.ts')) };
    case 'codex-setup': {
      store.assertCutover();
      invokeWindows('codex.cmd', ['mcp', 'add', 'pi-team', '--', process.execPath, join(sourceRoot, 'plugins/pi-team/server.mjs')]);
      let retired = false;
      try { invokeWindows('codex.cmd', ['mcp', 'remove', 'agent-blackboard']); retired = true; } catch { /* May have been supplied by a plugin rather than a standalone entry. */ }
      return { registered: 'pi-team', retired_standalone_blackboard: retired, note: 'Disable any separately installed Blackboard plugin connection during cutover.' };
    }
    default: throw Error(`Unknown v2 command: ${command}. Use group-create <json>, group-start <group>, start <group> <task-json>, send/inbox/wait, inspect/accept/finalize <task>, group-stop/resume/archive, inventory, doctor, codex-setup. Old task commands are retired after cutover.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let store;
  try { store = new GroupStore(process.env.PI_TEAM_PROJECT_ROOT || sourceRoot); const result = await execute(store, process.argv[2], process.argv.slice(3)); console.log(JSON.stringify(result, null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { store?.close(); }
}
