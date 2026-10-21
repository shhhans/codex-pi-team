import { GroupStore } from '../../.pi/runtime/group-store.mjs';
import { execute } from '../../scripts/pi-team-v2.mjs';
import { createGroup, updateGroup, adoptGroup, syncGroup } from '../../.pi/runtime/group-service.mjs';
import { scheduleOnboarding } from '../../scripts/group-init-runner.mjs';
import { registeredGroups } from '../../.pi/runtime/group-onboarding.mjs';
import { createIntegrationSnapshot, inspectIntegrationSnapshot, bindIntegrationVerification, finalizeIntegrationSnapshot } from '../../.pi/runtime/integration-snapshot.mjs';

const definitions = [
  ['team_groups', 'Read registered configuration and runtime state independently of Blackboard.', ['project_root'], {}],
  ['team_service_recover', 'Recover a service operation lock only after its recorded process owner is proven absent.', ['project_root'], {}],
  ['team_group_create', 'Register a persistent responsibility group and automatically run finite real-model onboarding.', ['project_root', 'group_id', 'description', 'worktree', 'base_ref'], { description: { type: 'string' }, name: { type: 'string' }, worktree: { type: 'string' }, base_ref: { type: 'string' } }],
  ['team_group_update', 'Change desired group responsibilities; reinitialize fresh sessions after safe task closure.', ['project_root', 'group_id', 'description'], { description: { type: 'string' }, name: { type: 'string' } }],
  ['team_group_init', 'Explicitly retry finite onboarding after inspecting a fault.', ['project_root', 'group_id'], {}],
  ['team_group_adopt', 'Explicitly generate a definition for an idle pre-definition v2 group and run fresh onboarding; preserve its history.', ['project_root', 'group_id', 'description', 'base_ref'], { description: { type: 'string' }, base_ref: { type: 'string' }, name: { type: 'string' } }],
  ['team_group_sync', 'Synchronize an idle clean group worktree from the committed Lead baseline.', ['project_root', 'group_id'], {}],
  ['team_send', 'Send a durable message to a group Coordinator.', ['project_root', 'group_id', 'body'], { body: { type: 'string' } }],
  ['team_inbox', 'Read Coordinator reports after a message cursor.', ['project_root', 'group_id'], { cursor: { type: 'integer' } }],
  ['team_wait', 'Wait up to 55 seconds for new Coordinator reports.', ['project_root', 'group_id'], { cursor: { type: 'integer' }, timeout_ms: { type: 'integer' } }],
  ['team_inspect', 'Inspect task evidence without acceptance.', ['project_root', 'task_id'], {}],
  ['team_accept', 'Record Lead acceptance of the reviewed delivery.', ['project_root', 'task_id', 'rationale'], { rationale: { type: 'string' } }],
  ['team_finalize', 'Integrate a Lead-accepted task; preserve group sessions/worktree.', ['project_root', 'task_id'], {}],
  ['team_integration_create', 'Build an immutable joint candidate from exact reviewed deliveries of distinct groups.', ['project_root', 'integration_id', 'task_ids', 'verification_group_id', 'worktree'], { integration_id: { type: 'string' }, task_ids: { type: 'array', minItems: 2, items: { type: 'string' } }, verification_group_id: { type: 'string' }, worktree: { type: 'string' } }],
  ['team_integration_inspect', 'Inspect the recorded joint candidate and its verification identity.', ['project_root', 'integration_id'], { integration_id: { type: 'string' } }],
  ['team_integration_bind', 'Bind a pending independent evaluation task to the exact candidate before its first delivery.', ['project_root', 'integration_id', 'verification_task_id'], { integration_id: { type: 'string' }, verification_task_id: { type: 'string' } }],
  ['team_integration_finalize', 'Integrate a jointly reviewed candidate after exact independent verification and mandatory tests.', ['project_root', 'integration_id', 'verification_task_id'], { integration_id: { type: 'string' }, verification_task_id: { type: 'string' } }],
];
export const tools = definitions.map(([name, description, required, extra]) => ({ name, description, inputSchema: { type: 'object', properties: { project_root: { type: 'string' }, group_id: { type: 'string' }, task_id: { type: 'string' }, ...extra }, required, additionalProperties: false } }));
export async function call(name, args) {
  const store = new GroupStore(args.project_root);
  try {
    switch (name) {
      case 'team_groups': return registeredGroups(store);
      case 'team_service_recover': return execute(store, 'service-recover', []);
      case 'team_group_create': { const created = createGroup(store, args); return { ...created, initialization: scheduleOnboarding(store, args.group_id) }; }
      case 'team_group_update': { const updated = updateGroup(store, args.group_id, args); return { ...updated, initialization: updated.status === 'pending' ? scheduleOnboarding(store, args.group_id) : null }; }
      case 'team_group_init': return execute(store, 'group-init', [args.group_id]);
      case 'team_group_adopt': { const state = adoptGroup(store, args.group_id, args); return { ...state, initialization: scheduleOnboarding(store, args.group_id) }; }
      case 'team_group_sync': return syncGroup(store, args.group_id);
      case 'team_send': return store.send({ group_id: args.group_id, role: 'lead' }, { to: 'coordinator', body: args.body });
      case 'team_inbox': return store.inbox(args.group_id, 'lead', args.cursor || 0);
      case 'team_wait': return execute(store, 'wait', [args.group_id, String(args.cursor || 0), String(args.timeout_ms ?? 55000)]);
      case 'team_inspect': return execute(store, 'inspect', [args.task_id]);
      case 'team_accept': return store.accept(args.task_id, args.rationale);
      case 'team_finalize': return execute(store, 'finalize', [args.task_id]);
      case 'team_integration_create': return createIntegrationSnapshot(store, args);
      case 'team_integration_inspect': return inspectIntegrationSnapshot(store, args.integration_id);
      case 'team_integration_bind': return bindIntegrationVerification(store, args.integration_id, args.verification_task_id);
      case 'team_integration_finalize': return finalizeIntegrationSnapshot(store, args.integration_id, { verification_task_id: args.verification_task_id });
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
