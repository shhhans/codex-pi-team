import readline from "node:readline";
import { readFile } from "node:fs/promises";
import {
  acceptTask,
  archiveTask,
  createTask,
  renderSnapshotHtml,
  snapshot,
  updateTask,
  watch,
} from "./blackboard-core.mjs";

const tools = [
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
    name: "blackboard_archive_task",
    description: "Archive an accepted task without deleting its events or revisions.",
    inputSchema: { type: "object", required: ["project_root", "task_id"], properties: { project_root: { type: "string" }, task_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "blackboard_snapshot",
    description: "Read current task lanes and latest Agent activity.",
    _meta: { "ui/resourceUri": "ui://agent-blackboard/blackboard.html" },
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, include_archived: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "blackboard_watch",
    description: "Wait up to 55 seconds for new Agent events and return an updated cursor and task snapshot.",
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, cursor: { type: "string" }, timeout_ms: { type: "integer", minimum: 0, maximum: 55000 }, include_archived: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "blackboard_render",
    description: "Render the current Agent Blackboard task lanes as inline/PiP-compatible HTML.",
    inputSchema: { type: "object", required: ["project_root"], properties: { project_root: { type: "string" }, include_archived: { type: "boolean" } }, additionalProperties: false },
  },
];
const uiResource = { uri: "ui://agent-blackboard/blackboard.html", name: "Agent Blackboard", description: "Task-lane Agent Blackboard UI", mimeType: "text/html;profile=mcp-app" };

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

async function callTool(name, args = {}) {
  const projectRoot = args.project_root;
  if (name === "blackboard_create_task") return createTask(projectRoot, args);
  if (name === "blackboard_update_task") return updateTask(projectRoot, args.task_id, args);
  if (name === "blackboard_accept_task") return acceptTask(projectRoot, args.task_id);
  if (name === "blackboard_archive_task") return archiveTask(projectRoot, args.task_id);
  if (name === "blackboard_snapshot") return snapshot(projectRoot, Boolean(args.include_archived));
  if (name === "blackboard_watch") return watch(projectRoot, args.cursor, args.timeout_ms ?? 55000, Boolean(args.include_archived));
  if (name === "blackboard_render") return renderSnapshotHtml(await snapshot(projectRoot, Boolean(args.include_archived)));
  throw new Error(`unknown tool: ${name}`);
}

async function handle(message) {
  if (message.method === "initialize") {
    return { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "agent-blackboard", version: "0.1.0" } } };
  }
  if (message.method === "notifications/initialized") return null;
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
  return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } };
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const response = await handle(JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`);
  }
});
