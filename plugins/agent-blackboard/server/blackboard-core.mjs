// Thin Lead adapter. The Runtime Store owns task state, events, wakeups,
// audit records, and checkpoints; this module contains no second data model.
import { readFile } from "node:fs/promises";
import {
  ackWakeup, appendAgentEvent, appendAudit, createTask, ensureStore, listWakeups,
  migrateRuntime, readTask, registerSession, resolveGitCommonDir, snapshot, stateRoot,
  transitionTask, watch, writeCheckpoint, __paths,
} from "../../../.pi/runtime/runtime-store.mjs";
import { ROLE_STATES, TASK_STATUSES, LEAD_WAKE_STATES } from "../../../.pi/runtime/runtime-schema.mjs";

export { ROLE_STATES, TASK_STATUSES, LEAD_WAKE_STATES, resolveGitCommonDir, stateRoot, createTask, appendAgentEvent, snapshot, watch, readTask, registerSession, appendAudit, writeCheckpoint, migrateRuntime };

export async function publishTask(projectRoot, input) {
  try { return { action: "updated", task: await updateTask(projectRoot, input.task_id, input) }; }
  catch (error) { if (!/unknown runtime task/.test(error.message)) throw error; return { action: "created", task: await createTask(projectRoot, input) }; }
}
export async function updateTask(projectRoot, taskId, input) {
  const task = await readTask(projectRoot, taskId); if (task.status === "archived") throw new Error("archived task cannot be updated");
  const revisions = [...(task.revisions || [])]; const at = new Date().toISOString();
  if (input.name !== undefined && input.name !== task.name) { revisions.push({ field: "name", old: task.name, new: input.name, at }); task.name = input.name; }
  if (input.description !== undefined && input.description !== task.description) { revisions.push({ field: "description", old: task.description, new: input.description, at }); task.description = input.description; }
  return transitionTask(projectRoot, taskId, task.status, { name: task.name, description: task.description, revisions });
}
export async function acceptTask(projectRoot, taskId) { return transitionTask(projectRoot, taskId, "accepted", { outcome: "accepted", accepted_at: new Date().toISOString() }); }
export async function closeIncompleteTask(projectRoot, taskId, input) { return transitionTask(projectRoot, taskId, "incomplete", { outcome: "incomplete", incomplete_reason: input.reason, next_step: input.next_step, ...(input.missing_done_criteria?.length ? { missing_done_criteria: input.missing_done_criteria } : {}) }); }
export async function reconcileIncompleteTask(projectRoot, taskId, input) { return reconcileTask(projectRoot, taskId, { ...input, outcome: "incomplete" }); }
export async function reconcileTask(projectRoot, taskId, input) {
  const task = await readTask(projectRoot, taskId); const patch = input.outcome === "accepted" ? { outcome: "accepted" } : { outcome: "incomplete", incomplete_reason: input.reason, next_step: input.next_step, ...(input.missing_done_criteria?.length ? { missing_done_criteria: input.missing_done_criteria } : {}) };
  return transitionTask(projectRoot, taskId, task.status === "archived" ? "archived" : input.outcome, patch);
}
export async function archiveTask(projectRoot, taskId) {
  const task = await readTask(projectRoot, taskId); if (!["accepted", "incomplete", "archived"].includes(task.status)) throw new Error("only accepted or incomplete tasks can be archived");
  return transitionTask(projectRoot, taskId, "archived", { archived_at: new Date().toISOString() });
}

export async function registerLead(projectRoot, taskId, input) {
  const task = await readTask(projectRoot, taskId); if (task.status !== "active") throw new Error("only active tasks can register a Lead");
  const binding = { thread_id: input.thread_id, host_id: input.host_id, registered_at: new Date().toISOString() };
  if (task.lead_binding && (task.lead_binding.thread_id !== binding.thread_id || task.lead_binding.host_id !== binding.host_id)) throw new Error("different Lead binding already exists");
  return transitionTask(projectRoot, taskId, task.status, { lead_binding: binding });
}
export async function unregisterLead(projectRoot, taskId, input = {}) {
  const task = await readTask(projectRoot, taskId); const binding = task.lead_binding;
  if (binding && ((input.thread_id && input.thread_id !== binding.thread_id) || (input.host_id && input.host_id !== binding.host_id))) throw new Error("Lead binding does not match");
  return transitionTask(projectRoot, taskId, task.status, { lead_binding: null });
}
export async function listLeadWakeups(projectRoot, taskId) {
  const task = await readTask(projectRoot, taskId); const all = await listWakeups(projectRoot, taskId, { pending: false }); const wakeups = all.filter((item) => item.status !== "acked");
  return { task_id: taskId, name: task.name, description: task.description, binding: task.lead_binding || null, wakeups, pending: wakeups.length };
}
export async function acknowledgeLeadWakeup(projectRoot, taskId, wakeupId, input = {}) { return ackWakeup(projectRoot, taskId, wakeupId, { role: input.role || "lead", agent_id: input.delivery_id || "lead" }); }
export async function claimLeadWakeup(projectRoot, taskId, wakeupId, options = {}) {
  const queue = await listLeadWakeups(projectRoot, taskId); const wakeup = queue.wakeups.find((item) => item.id === wakeupId); if (!wakeup) return { claimed: false, reason: "not-pending" };
  const maxAttempts = options.maxAttempts ?? 3; if ((wakeup.attempts || 0) >= maxAttempts) return { claimed: false, reason: "attempt-limit", wakeup };
  await appendAudit(projectRoot, taskId, { kind: "wakeup_claim", wakeup_id: wakeupId, attempt: (wakeup.attempts || 0) + 1 }); return { claimed: true, wakeup: { ...wakeup, attempts: (wakeup.attempts || 0) + 1, status: "in_flight" } };
}
export async function recordLeadWakeupDelivery(projectRoot, taskId, wakeupId, input) { return appendAudit(projectRoot, taskId, { kind: "wakeup_delivery", wakeup_id: wakeupId, delivered: Boolean(input.delivered), error: input.error, delivery_id: input.delivery_id }); }
export async function listAgentEvents(projectRoot, taskId, options = {}) {
  const root = await ensureStore(projectRoot); const events = [];
  for (const role of Object.keys(ROLE_STATES)) { const text = await readFile(__paths.eventPath(root, taskId, role), "utf8").catch(() => ""); for (const line of text.split(/\r?\n/).filter(Boolean)) events.push(JSON.parse(line)); }
  events.sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.sequence - b.sequence); const filtered = options.before_observed_at ? events.filter((event) => event.observed_at < options.before_observed_at) : events; return options.limit ? filtered.slice(-Number(options.limit)) : filtered;
}
export async function renderSnapshotHtml(projectRoot, includeArchived = false) { const data = await snapshot(projectRoot, includeArchived); return `<pre>${String(JSON.stringify(data, null, 2)).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`; }
