import readline from "node:readline";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acceptTask,
  archiveTask,
  acknowledgeLeadWakeup,
  closeIncompleteTask,
  reconcileIncompleteTask,
  reconcileTask,
  createTask,
  listLeadWakeups,
  registerLead,
  renderSnapshotHtml,
  snapshot,
  unregisterLead,
  updateTask,
  watch,
  attachTask,
  contractRead,
  createModule,
  leadRule,
  listModules,
  listNotifications,
  readModule,
  recordNotificationDelivery,
  reopenContract,
} from "./blackboard-core.mjs";
import { sendLeadRequestChanges } from "../../../.pi/communication/lead-intercom.mjs";

const tools = [
  { name: "module_create", description: "Lead-only: create a persistent module and its initial structured contract.", inputSchema: { type: "object", required: ["project_root", "module_id", "name", "contract"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, name: { type: "string" }, contract: { type: "object" } }, additionalProperties: false } },
  { name: "module_read", description: "Read a module, its current contract, and frozen/ACK state.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["project_root", "module_id"], properties: { project_root: { type: "string" }, module_id: { type: "string" } }, additionalProperties: false } },
  { name: "module_attach_task", description: "Attach the one active task permitted for a module.", inputSchema: { type: "object", required: ["project_root", "module_id", "task_id"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, task_id: { type: "string" } }, additionalProperties: false } },
  { name: "contract_read", description: "Read the current structured contract or a stable field path.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["project_root", "module_id"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, field: { type: "string" } }, additionalProperties: false } },
  { name: "contract_lead_ruling", description: "Record a Lead ruling after the negotiation cap or ambiguity; ACKs are cleared.", inputSchema: { type: "object", required: ["project_root", "module_id", "ruling"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, ruling: { type: "string" } }, additionalProperties: false } },
  { name: "contract_reopen", description: "Lead-only: explicitly reopen a frozen contract for a requirement change.", inputSchema: { type: "object", required: ["project_root", "module_id", "reason"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, reason: { type: "string" } }, additionalProperties: false } },
  { name: "module_notifications", description: "Read reliable role-notification records and delivery state.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["project_root", "module_id"], properties: { project_root: { type: "string" }, module_id: { type: "string" } }, additionalProperties: false } },
  { name: "module_record_delivery", description: "Dispatcher-only: record an idempotent role-notification delivery result.", inputSchema: { type: "object", required: ["project_root", "module_id", "notification_id", "delivered"], properties: { project_root: { type: "string" }, module_id: { type: "string" }, notification_id: { type: "string" }, delivered: { type: "boolean" }, receipt: { type: "string" }, error: { type: "string" } }, additionalProperties: false } },
  {
    name: "pi_team_lead_request_changes",
    description: "Lead-only: send a validated LEAD_REQUEST_CHANGES event to the unique current same-task Executor and return delivery plus Executor confirmation status.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "delegation_id", "rejected_criteria", "rejected_evidence", "required_correction", "next_artifact"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, delegation_id: { type: "string" }, rejected_criteria: { type: "array", items: { type: "string" }, minItems: 1 }, rejected_evidence: { type: "string" }, required_correction: { type: "string" }, next_artifact: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 30000 } }, additionalProperties: false },
  },
  {
    name: "blackboard_create_task",
    description: "Create an active Lead-owned task in the Git common-dir Agent Blackboard.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "name", "description"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, name: { type: "string" }, description: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_update_task",
    description: "Update the Lead-owned task name and/or description while preserving revisions.",
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, name: { type: "string" }, description: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_accept_task",
    description: "Mark an active task accepted after Lead acceptance.",
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_close_incomplete_task",
    description: "Close an active Lead-owned task as incomplete while preserving its missing completion criteria.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "reason", "missing_done_criteria"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, reason: { type: "string" }, missing_done_criteria: { type: "array", items: { type: "string" }, minItems: 1 } }, additionalProperties: false },
  },
  {
    name: "blackboard_reconcile_incomplete_task",
    description: "Correct an accepted or archived legacy task to an incomplete outcome with an explicit reason.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "reason", "missing_done_criteria"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, reason: { type: "string" }, missing_done_criteria: { type: "array", items: { type: "string" }, minItems: 1 } }, additionalProperties: false },
  },
  {
    name: "blackboard_reconcile_task",
    description: "Explicitly reconcile a legacy task to an accepted or incomplete outcome without inferring history.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "outcome"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, outcome: { type: "string", enum: ["accepted", "incomplete"] }, reason: { type: "string" }, missing_done_criteria: { type: "array", items: { type: "string" }, minItems: 1 } }, additionalProperties: false },
  },
  {
    name: "blackboard_archive_task",
    description: "Archive an accepted or incomplete task without deleting its events or revisions.",
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_register_lead",
    description: "Register the Lead Codex thread that receives critical Agent wakeups for an active task.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "thread_id", "host_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, thread_id: { type: "string" }, host_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_unregister_lead",
    description: "Remove the Lead thread binding for a task while preserving wakeup history.",
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, thread_id: { type: "string" }, host_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_list_lead_wakeups",
    description: "Read structured, unacknowledged Lead wakeups for a registered task.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_ack_lead_wakeup",
    description: "Acknowledge a Lead wakeup after the host confirms it created the Lead turn.",
    inputSchema: { type: "object", required: ["project_root", "task_id", "wakeup_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" }, wakeup_id: { type: "string" }, delivery_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_snapshot",
    description: "Read current task lanes and latest Agent activity.",
    _meta: { "ui/resourceUri": "ui://agent-blackboard/blackboard.html" },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, include_archived: { type: "boolean" }, cursor: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_watch",
    description: "Wait up to 55 seconds for new Agent events and return an updated cursor and task snapshot.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, cursor: { type: "string" }, timeout_ms: { type: "integer", minimum: 0, maximum: 55000 }, include_archived: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "blackboard_render",
    description: "Render the current Agent Blackboard task lanes as inline/PiP-compatible HTML.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, include_archived: { type: "boolean" } }, additionalProperties: false },
  },
];
const uiResource = { uri: "ui://agent-blackboard/blackboard.html", name: "Agent Blackboard", description: "Task-lane Agent Blackboard UI", mimeType: "text/html;profile=mcp-app" };
const latestProtocolVersion = "2025-06-18";
const supportedProtocolVersions = new Set([latestProtocolVersion, "2024-11-05"]);

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

async function callTool(name, args = {}) {
  const projectRoot = args.project_root;
  if (name === "module_create") return createModule(projectRoot, args);
  if (name === "module_read") return readModule(projectRoot, args.module_id);
  if (name === "module_attach_task") return attachTask(projectRoot, args.module_id, args.task_id);
  if (name === "contract_read") return contractRead(projectRoot, args.module_id, args.field);
  if (name === "contract_lead_ruling") return leadRule(projectRoot, args.module_id, args.ruling);
  if (name === "contract_reopen") return reopenContract(projectRoot, args.module_id, args.reason);
  if (name === "module_notifications") return listNotifications(projectRoot, args.module_id);
  if (name === "module_record_delivery") return recordNotificationDelivery(projectRoot, args.module_id, args.notification_id, args);
  if (name === "pi_team_lead_request_changes") return sendLeadRequestChanges({ ...args, projectRoot, auditDir: join(projectRoot, ".pi", "communication", "audit"), timeoutMs: args.timeout_ms });
  if (name === "blackboard_create_task") return createTask(projectRoot, args);
  if (name === "blackboard_update_task") return updateTask(projectRoot, args.task_id, args);
  if (name === "blackboard_accept_task") return acceptTask(projectRoot, args.task_id);
  if (name === "blackboard_close_incomplete_task") return closeIncompleteTask(projectRoot, args.task_id, args);
  if (name === "blackboard_reconcile_incomplete_task") return reconcileIncompleteTask(projectRoot, args.task_id, args);
  if (name === "blackboard_reconcile_task") return reconcileTask(projectRoot, args.task_id, args);
  if (name === "blackboard_archive_task") return archiveTask(projectRoot, args.task_id);
  if (name === "blackboard_register_lead") return registerLead(projectRoot, args.task_id, args);
  if (name === "blackboard_unregister_lead") return unregisterLead(projectRoot, args.task_id, args);
  if (name === "blackboard_list_lead_wakeups") return listLeadWakeups(projectRoot, args.task_id);
  if (name === "blackboard_ack_lead_wakeup") return acknowledgeLeadWakeup(projectRoot, args.task_id, args.wakeup_id, args);
  if (name === "blackboard_snapshot") return { ...(await snapshot(projectRoot, Boolean(args.include_archived), args.cursor)), modules: await listModules(projectRoot) };
  if (name === "blackboard_watch") return watch(projectRoot, args.cursor, args.timeout_ms ?? 55000, Boolean(args.include_archived));
  if (name === "blackboard_render") return renderSnapshotHtml(await snapshot(projectRoot, Boolean(args.include_archived)));
  throw new Error(`unknown tool: ${name}`);
}

async function handle(message) {
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = supportedProtocolVersions.has(requested) ? requested : latestProtocolVersion;
    return { jsonrpc: "2.0", id: message.id, result: {
      protocolVersion,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      serverInfo: { name: "agent-blackboard", version: "0.1.0" },
      instructions: "Use Agent Blackboard as a Lead-owned observability plane with wakeup reminders. For periodic heartbeat checks, use blackboard_snapshot with its caller-owned cursor and inspect changes. Wakeups are not authorization or completion proof.",
    } };
  }
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return { jsonrpc: "2.0", id: message.id, result: {} };
  if (message.method === "tools/list") return { jsonrpc: "2.0", id: message.id, result: { tools } };
  if (message.method === "resources/list") return { jsonrpc: "2.0", id: message.id, result: { resources: [uiResource] } };
  if (message.method === "resources/read") {
    if (message.params?.uri !== uiResource.uri) return { jsonrpc: "2.0", id: message.id, error: { code: -32002, message: "unknown UI resource" } };
    const text = await readFile(new URL("../apps/blackboard.html", import.meta.url), "utf8");
    return { jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: uiResource.uri, mimeType: uiResource.mimeType, text }] } };
  }
  if (message.method === "tools/call") {
    try { return { jsonrpc: "2.0", id: message.id, result: result(await callTool(message.params?.name, message.params?.arguments || {})) }; }
    catch (error) { return { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: error.message }] } }; }
  }
  if (message.id === undefined) return null;
  return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } };
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const response = await handle(JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`);
  }
}
