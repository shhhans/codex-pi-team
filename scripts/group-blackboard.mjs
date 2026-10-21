import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { GroupStore, ROLES } from '../.pi/runtime/group-store.mjs';
import { definitionInventory } from '../.pi/runtime/group-definitions.mjs';
import { sharedRoleVersion } from '../.pi/runtime/group-onboarding.mjs';
import { observeProcesses } from '../.pi/runtime/process-observation.mjs';

function roleView(role, session, observations) {
  if (!session) return { role, model: null, process: { status: 'not_started', reason: '尚无角色会话记录' }, recent_activity: null, fault: null };
  const observed = observations.get(session.pid);
  let process = { status: 'unknown', reason: observed?.reason || '无法核实进程身份' };
  if (observed?.status === 'stopped') process = { status: 'stopped', reason: observed.reason || '记录的进程已退出' };
  else if (observed?.status === 'running' && session.process_start_stamp && observed.stamp) process = observed.stamp === session.process_start_stamp ? { status: 'running', reason: '进程身份已核实' } : { status: 'stopped', reason: '原角色进程已退出，进程编号已被复用' };
  else if (observed?.status === 'running' && !session.process_start_stamp) process.reason = '旧会话缺少进程身份记录，无法确认是否仍在运行';
  return { role, model: session.config?.provider && session.config?.model ? { provider: session.config.provider, id: session.config.model } : null,
    process, recent_activity: typeof session.current_state === 'string' && session.current_state.trim() ? { text: session.current_state, at: session.state_at || null } : null, fault: session.fault || null };
}

export function blackboardSnapshot(store, options = {}) {
  const rows = new Map(store.list().map(g => [g.group_id, g]));
  const sessions = new Map([...rows.keys()].map(id => [id, store.sessions(id)]));
  let observations;
  try { observations = (options.observeProcesses || observeProcesses)([...sessions.values()].flat().map(session => session.pid)); }
  catch { observations = new Map(); }
  const roleVersion = sharedRoleVersion(fileURLToPath(new URL('../', import.meta.url)));
  const lifecycleQuery = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_lifecycle'").get() ? store.db.prepare('SELECT data FROM group_lifecycle WHERE group_id=?') : null;
  return { observed_at: new Date().toISOString(), groups: definitionInventory(store).map(entry => {
    if (!entry.registered) return entry;
    const d = entry.definition, g = rows.get(d.id);
    const currentSessions = sessions.get(d.id) || [], record = g ? lifecycleQuery?.get(d.id) : null;
    const lifecycle = record ? { ...JSON.parse(record.data), work: [] } : null;
    const roles = ROLES.map(role => roleView(role, currentSessions.find(session => session.role === role), observations));
    return { group_id: d.id, name: d.name, registered: true, archived: d.archived, description: d.description, runtime: g || null, lifecycle,
      roles, role_configuration_current: lifecycle ? lifecycle.role_version === roleVersion : null,
      task: g?.active_task ? store.task(g.active_task) : null,
      sessions: currentSessions.map(s => ({ role: s.role, live: roles.find(r => r.role === s.role).process.status === 'running', busy: s.busy, current_state: s.current_state, state_at: s.state_at, fault: s.fault })) };
  }), legacy_pending: store.legacyPending() };
}

const html = readFileSync(new URL('./group-blackboard.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('./group-blackboard-client.mjs', import.meta.url), 'utf8');

export function startBlackboard(store, port = 0) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (req.url === '/api/groups') {
      try {
        const body = JSON.stringify(blackboardSnapshot(store));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body);
      } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: error.message })); }
    } else if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
    else if (req.url === '/client.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(client); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(port, '127.0.0.1'); return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new GroupStore(process.argv[2] || process.env.PI_TEAM_PROJECT_ROOT);
  const server = startBlackboard(store, Number(process.argv[3] || 0));
  server.on('listening', () => { const url = `http://127.0.0.1:${server.address().port}`; if (process.send) process.send({ url, pid: process.pid }); else console.log(url); });
  const close = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
