import { GroupStore } from '../../.pi/runtime/group-store.mjs';
import { execute } from '../../scripts/pi-team-v2.mjs';

const definitions = [
  ['team_send', 'Send a durable message to a group Coordinator.', ['project_root', 'group_id', 'body'], { body: { type: 'string' } }],
  ['team_inbox', 'Read Coordinator reports after a message cursor.', ['project_root', 'group_id'], { cursor: { type: 'integer' } }],
  ['team_wait', 'Wait up to 55 seconds for new Coordinator reports.', ['project_root', 'group_id'], { cursor: { type: 'integer' }, timeout_ms: { type: 'integer' } }],
  ['team_inspect', 'Inspect task evidence without acceptance.', ['project_root', 'task_id'], {}],
  ['team_accept', 'Record Lead acceptance of the reviewed delivery.', ['project_root', 'task_id', 'rationale'], { rationale: { type: 'string' } }],
  ['team_finalize', 'Integrate a Lead-accepted task; preserve group sessions/worktree.', ['project_root', 'task_id'], {}],
];
export const tools = definitions.map(([name, description, required, extra]) => ({ name, description, inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, group_id: { type: 'string' }, task_id: { type: 'string' }, ...extra }, required, additionalProperties: false } }));
export async function call(name, args) {
  const store = new GroupStore(args.project_root);
  try {
    switch (name) {
      case 'team_send': return store.send({ group_id: args.group_id, role: 'lead' }, { to: 'coordinator', body: args.body });
      case 'team_inbox': return store.inbox(args.group_id, 'lead', args.cursor || 0);
      case 'team_wait': return execute(store, 'wait', [args.group_id, String(args.cursor || 0), String(args.timeout_ms ?? 55000)]);
      case 'team_inspect': return execute(store, 'inspect', [args.task_id]);
      case 'team_accept': return store.accept(args.task_id, args.rationale);
      case 'team_finalize': return execute(store, 'finalize', [args.task_id]);
      default: throw Error('unknown tool');
    }
  } finally { store.close(); }
}
export async function rpc(request) {
  if (request.id === undefined) return null;
  try {
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'pi-team', version: '2.0.0' } };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') { try { result = { content: [{ type: 'text', text: JSON.stringify(await call(request.params.name, request.params.arguments || {})) }] }; } catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; } }
    else return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } };
    return { jsonrpc: '2.0', id: request.id, result };
  } catch (e) { return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: e.message } }; }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/plugins/pi-team/server.mjs')) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk; let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1);
      if (!line.trim()) continue;
    void (async () => { let response; try { response = await rpc(JSON.parse(line)); } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; } if (response) process.stdout.write(`${JSON.stringify(response)}\n`); })();
    }
  });
}
