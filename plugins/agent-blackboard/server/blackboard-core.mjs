import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const ROLE_STATES = Object.freeze({
  researcher: new Set(["working", "waiting", "blocked", "completed"]),
  executor: new Set(["working", "waiting", "blocked", "ready_for_review"]),
  reviewer: new Set(["working", "waiting", "blocked", "reviewing", "changes_requested", "ready_for_acceptance"]),
});
export const TASK_STATUSES = new Set(["active", "accepted", "incomplete", "archived"]);
export const LEAD_WAKE_STATES = new Set(["blocked", "changes_requested", "ready_for_review", "ready_for_acceptance", "completed"]);
const MAX_WATCH_MS = 55_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

function fail(message) {
  throw new Error(message);
}

function ensureTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) {
    fail("invalid task_id");
  }
  return taskId;
}

function ensureRole(role) {
  if (!Object.hasOwn(ROLE_STATES, role)) fail(`invalid role: ${role}`);
  return role;
}

function ensureLineField(value, field, max, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && value.length === 0) || value.length > max || /[\r\n]/.test(value)) {
    fail(`${field} must be a single line of at most ${max} characters`);
  }
  return value;
}

function ensureDescription(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 20_000) fail("description must be non-empty and at most 20000 characters");
  return value;
}

function ensureAbsolutePath(value, field) {
  if (typeof value !== "string" || !isAbsolute(value)) fail(`${field} must be an absolute path`);
  return resolve(value);
}

function ensureHostId(value) {
  return ensureLineField(value, "host_id", 240, true);
}

function ensureThreadId(value) {
  return ensureLineField(value, "thread_id", 240, true);
}

function wakeupId(taskId, role, sequence) {
  return `${taskId}:${role}:${sequence}`;
}

function makeLeadWakeup(event) {
  const wakeup = {
    id: wakeupId(event.task_id, event.role, event.sequence),
    version: 1,
    task_id: event.task_id,
    role: event.role,
    sequence: event.sequence,
    state: event.state,
    activity: event.activity,
    created_at: event.observed_at,
    status: "pending",
    attempts: 0,
  };
  if (event.blocker !== undefined) wakeup.blocker = event.blocker;
  if (event.next !== undefined) wakeup.next = event.next;
  return wakeup;
}

function ensureWakeupStore(task) {
  if (!Array.isArray(task.lead_wakeups)) task.lead_wakeups = [];
  return task.lead_wakeups;
}

async function reconcileWakeupStore(root, task) {
  const wakeups = ensureWakeupStore(task);
  const known = new Set(wakeups.map((item) => item.id));
  let changed = false;
  for (const role of Object.keys(ROLE_STATES)) {
    for (const event of await parseEventFile(root, `${task.task_id}-${role}.jsonl`)) {
      if (!LEAD_WAKE_STATES.has(event.state)) continue;
      const id = wakeupId(task.task_id, role, event.sequence);
      if (known.has(id)) continue;
      wakeups.push(makeLeadWakeup(event));
      known.add(id);
      changed = true;
    }
  }
  if (changed) wakeups.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return changed;
}

function isoNow() {
  return new Date().toISOString();
}

function gitExecutable() {
  return process.platform === "win32" ? "git.exe" : "git";
}

export function resolveGitCommonDir(projectRoot = process.cwd()) {
  const root = ensureAbsolutePath(projectRoot, "project_root");
  const result = spawnSync(gitExecutable(), ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (result.status !== 0) fail(`cannot resolve Git common directory: ${(result.stderr || "").trim()}`);
  let common = (result.stdout || "").trim();
  if (!common) fail("Git common directory was empty");
  if (!isAbsolute(common)) common = resolve(root, common);
  if (!existsSync(common) || !statSync(common).isDirectory()) fail(`Git common directory is not a directory: ${common}`);
  return realpathSync(common);
}

export function stateRoot(projectRoot = process.cwd()) {
  return join(resolveGitCommonDir(projectRoot), "harness-blackboard", "v1");
}

async function ensureStateRoot(projectRoot) {
  const root = stateRoot(projectRoot);
  await mkdir(root, { recursive: true });
  const info = await stat(root);
  if (!info.isDirectory()) fail(`blackboard state root is not a directory: ${root}`);
  return root;
}

function taskPath(root, taskId) {
  return join(root, `${ensureTaskId(taskId)}.json`);
}

function eventPath(root, taskId, role) {
  return join(root, `${ensureTaskId(taskId)}-${ensureRole(role)}.jsonl`);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { fail(`cannot read blackboard state ${path}: ${error.message}`); }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function withLock(path, fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(path);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) fail(`blackboard lock timeout: ${path}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, LOCK_RETRY_MS));
    }
  }
  try {
    await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, at: isoNow() }), "utf8");
    return await fn();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

async function loadTask(root, taskId) {
  const path = taskPath(root, taskId);
  if (!existsSync(path)) fail(`unknown blackboard task: ${taskId}`);
  const task = await readJson(path);
  if (task.task_id !== taskId || !TASK_STATUSES.has(task.status)) fail(`invalid blackboard task state: ${taskId}`);
  return task;
}

function taskSummary(task, latest = {}) {
  return {
    task_id: task.task_id,
    name: task.name,
    description: task.description,
    status: task.status,
    outcome: task.outcome || (task.status === "accepted" ? "accepted" : task.status === "incomplete" ? "incomplete" : undefined),
    created_at: task.created_at,
    updated_at: task.updated_at,
    revisions: task.revisions || [],
    lead_binding: task.lead_binding || null,
    lead_wakeup_pending: Array.isArray(task.lead_wakeups) ? task.lead_wakeups.filter((item) => item.status !== "acked").length : 0,
    agents: Object.entries(latest).map(([role, event]) => ({ role, ...(event || {}) })),
  };
}

async function parseEventFile(root, name) {
  const path = join(root, name);
  const text = await readFile(path, "utf8").catch(() => "");
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch (error) { fail(`invalid blackboard event ${path}: ${error.message}`); }
  }
  return events;
}

async function allEvents(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const events = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const fileEvents = await parseEventFile(root, entry.name);
    const key = entry.name.replaceAll(sep, "/");
    for (const event of fileEvents) events.push({ key, event });
  }
  events.sort((a, b) => a.event.observed_at.localeCompare(b.event.observed_at) || a.key.localeCompare(b.key) || a.event.sequence - b.event.sequence);
  return events;
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return {};
  if (typeof cursor === "object") {
    if (Array.isArray(cursor) || cursor.version !== 1 || !cursor.files || typeof cursor.files !== "object" || Array.isArray(cursor.files)) fail("invalid blackboard cursor");
    return cursor.files;
  }
  if (typeof cursor !== "string") fail("invalid blackboard cursor");
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const decoded = JSON.parse(json);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || decoded.version !== 1 || !decoded.files || typeof decoded.files !== "object" || Array.isArray(decoded.files)) fail("invalid blackboard cursor");
    return decoded.files;
  } catch { fail("invalid blackboard cursor"); }
}

function encodeCursor(files) {
  return Buffer.from(JSON.stringify({ version: 1, files }), "utf8").toString("base64url");
}

function eventsAfter(events, cursor) {
  const seen = decodeCursor(cursor);
  return events.filter(({ key, event }) => Number(event.sequence) > Number(seen[key] || 0));
}

function cursorFor(events, previous) {
  const files = { ...decodeCursor(previous) };
  for (const { key, event } of events) files[key] = Math.max(Number(files[key] || 0), Number(event.sequence));
  return encodeCursor(files);
}

async function latestByTask(root, events) {
  const latest = new Map();
  for (const item of events) {
    const byRole = latest.get(item.event.task_id) || {};
    const previous = byRole[item.event.role];
    if (!previous || item.event.sequence > previous.sequence || item.event.observed_at > previous.observed_at) byRole[item.event.role] = item.event;
    latest.set(item.event.task_id, byRole);
  }
  return latest;
}

function changeTask(task) {
  return task ? { task_id: task.task_id, name: task.name, description: task.description, status: task.status } : null;
}

function snapshotChanges(eventItems, latest, tasks, cursor) {
  const activeTasks = new Map(tasks.filter((task) => task.status === "active").map((task) => [task.task_id, task]));
  const candidates = cursor
    ? eventsAfter(eventItems, cursor).map(({ event }) => event)
    : [...activeTasks.keys()].flatMap((taskId) => Object.values(latest.get(taskId) || {}));
  return candidates
    .filter((event) => activeTasks.has(event.task_id) && LEAD_WAKE_STATES.has(event.state))
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.task_id.localeCompare(b.task_id) || a.role.localeCompare(b.role) || a.sequence - b.sequence)
    .map((event) => ({ ...event, task: changeTask(activeTasks.get(event.task_id)) }));
}

async function taskFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.includes(".tmp")).map((entry) => entry.name);
}

export async function snapshot(projectRoot = process.cwd(), includeArchived = false, cursor) {
  const root = await ensureStateRoot(projectRoot);
  const eventItems = await allEvents(root);
  const latest = await latestByTask(root, eventItems);
  const tasks = [];
  for (const file of await taskFiles(root)) {
    const task = await readJson(join(root, file));
    if (!TASK_STATUSES.has(task.status) || (!includeArchived && task.status === "archived")) continue;
    tasks.push(taskSummary(task, latest.get(task.task_id) || {}));
  }
  tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
  return { version: 1, state_root: root, tasks, changes: snapshotChanges(eventItems, latest, tasks, cursor), cursor: cursorFor(eventItems, cursor) };
}

export async function createTask(projectRoot, input) {
  const root = await ensureStateRoot(projectRoot);
  const taskId = ensureTaskId(input?.task_id);
  const name = ensureLineField(input?.name, "name", 240, true);
  const description = ensureDescription(input?.description);
  const path = taskPath(root, taskId);
  if (existsSync(path)) fail(`task already exists: ${taskId}`);
  const now = isoNow();
  const task = { version: 1, task_id: taskId, name, description, status: "active", created_at: now, updated_at: now, revisions: [], lead_binding: null, lead_wakeups: [] };
  await writeJsonAtomic(path, task);
  return task;
}

export async function publishTask(projectRoot, input) {
  const root = await ensureStateRoot(projectRoot);
  const taskId = ensureTaskId(input?.task_id);
  const name = ensureLineField(input?.name, "name", 240, true);
  const description = ensureDescription(input?.description);
  const path = taskPath(root, taskId);
  return withLock(`${path}.lock`, async () => {
    if (!existsSync(path)) {
      const now = isoNow();
      const task = { version: 1, task_id: taskId, name, description, status: "active", created_at: now, updated_at: now, revisions: [], lead_binding: null, lead_wakeups: [] };
      await writeJsonAtomic(path, task);
      return { action: "created", task };
    }
    const task = await loadTask(root, taskId);
    if (task.status !== "active") fail(`only an active task can be republished: ${taskId}`);
    const changedAt = isoNow();
    task.revisions = [...(task.revisions || [])];
    if (name !== task.name) task.revisions.push({ field: "name", old: task.name, new: name, at: changedAt });
    if (description !== task.description) task.revisions.push({ field: "description", old: task.description, new: description, at: changedAt });
    task.name = name;
    task.description = description;
    task.updated_at = changedAt;
    await writeJsonAtomic(path, task);
    return { action: "updated", task };
  });
}

export async function updateTask(projectRoot, taskId, input) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status === "archived") fail("archived task cannot be updated");
    const hasName = input?.name !== undefined;
    const hasDescription = input?.description !== undefined;
    if (!hasName && !hasDescription) fail("name or description is required");
    const nextName = hasName ? ensureLineField(input.name, "name", 240, true) : task.name;
    const nextDescription = hasDescription ? ensureDescription(input.description) : task.description;
    const changedAt = isoNow();
    task.revisions = [...(task.revisions || [])];
    if (hasName && nextName !== task.name) task.revisions.push({ field: "name", old: task.name, new: nextName, at: changedAt });
    if (hasDescription && nextDescription !== task.description) task.revisions.push({ field: "description", old: task.description, new: nextDescription, at: changedAt });
    task.name = nextName;
    task.description = nextDescription;
    task.updated_at = changedAt;
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function acceptTask(projectRoot, taskId) {
  const root = await ensureStateRoot(projectRoot);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "active") fail("only active tasks can be accepted");
    task.status = "accepted";
    task.outcome = "accepted";
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function closeIncompleteTask(projectRoot, taskId, input) {
  const root = await ensureStateRoot(projectRoot);
  const reason = ensureDescription(input?.reason);
  const missing = Array.isArray(input?.missing_done_criteria) && input.missing_done_criteria.length
    ? input.missing_done_criteria.map((item) => ensureLineField(item, "missing_done_criteria", 500, true))
    : fail("missing_done_criteria is required");
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "active") fail("only active tasks can be closed incomplete");
    task.status = "incomplete";
    task.outcome = "incomplete";
    task.incomplete_reason = reason;
    task.missing_done_criteria = missing;
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function reconcileIncompleteTask(projectRoot, taskId, input) {
  const root = await ensureStateRoot(projectRoot);
  const reason = ensureDescription(input?.reason);
  const missing = Array.isArray(input?.missing_done_criteria) && input.missing_done_criteria.length
    ? input.missing_done_criteria.map((item) => ensureLineField(item, "missing_done_criteria", 500, true))
    : fail("missing_done_criteria is required");
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "accepted" && task.status !== "archived") fail("only accepted or archived tasks can be reconciled incomplete");
    task.outcome = "incomplete";
    task.incomplete_reason = reason;
    task.missing_done_criteria = missing;
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function reconcileTask(projectRoot, taskId, input) {
  const root = await ensureStateRoot(projectRoot);
  const outcome = input?.outcome;
  if (outcome !== "accepted" && outcome !== "incomplete") fail("reconcile outcome must be accepted or incomplete");
  const reason = outcome === "incomplete" ? ensureDescription(input?.reason) : undefined;
  const missing = outcome === "incomplete"
    ? (Array.isArray(input?.missing_done_criteria) && input.missing_done_criteria.length
      ? input.missing_done_criteria.map((item) => ensureLineField(item, "missing_done_criteria", 500, true))
      : fail("missing_done_criteria is required"))
    : undefined;
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    task.outcome = outcome;
    task.status = task.status === "archived" ? "archived" : outcome;
    if (outcome === "incomplete") {
      task.incomplete_reason = reason;
      task.missing_done_criteria = missing;
    } else {
      delete task.incomplete_reason;
      delete task.missing_done_criteria;
    }
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function archiveTask(projectRoot, taskId) {
  const root = await ensureStateRoot(projectRoot);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "accepted" && task.status !== "incomplete") fail("only accepted or incomplete tasks can be archived");
    task.outcome = task.outcome || task.status;
    task.status = "archived";
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return task;
  });
}

export async function registerLead(projectRoot, taskId, input) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  const threadId = ensureThreadId(input?.thread_id);
  const hostId = ensureHostId(input?.host_id);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "active") fail("only an active task can register a Lead");
    const existing = task.lead_binding;
    if (existing && (existing.thread_id !== threadId || existing.host_id !== hostId)) {
      fail(`task already has a different Lead binding: ${taskId}`);
    }
    task.lead_binding = { thread_id: threadId, host_id: hostId, registered_at: existing?.registered_at || isoNow() };
    task.updated_at = isoNow();
    await reconcileWakeupStore(root, task);
    ensureWakeupStore(task);
    await writeJsonAtomic(taskPath(root, taskId), task);
    return { task_id: taskId, binding: task.lead_binding, pending: task.lead_wakeups.filter((item) => item.status !== "acked").length };
  });
}

export async function unregisterLead(projectRoot, taskId, input = {}) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  const threadId = input.thread_id === undefined ? undefined : ensureThreadId(input.thread_id);
  const hostId = input.host_id === undefined ? undefined : ensureHostId(input.host_id);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    const existing = task.lead_binding;
    if (existing && ((threadId !== undefined && existing.thread_id !== threadId) || (hostId !== undefined && existing.host_id !== hostId))) {
      fail(`Lead binding does not match task: ${taskId}`);
    }
    task.lead_binding = null;
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return { task_id: taskId, binding: null };
  });
}

export async function listLeadWakeups(projectRoot, taskId) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    const changed = await reconcileWakeupStore(root, task);
    if (changed) {
      task.updated_at = isoNow();
      await writeJsonAtomic(taskPath(root, taskId), task);
    }
    return {
      task_id: taskId,
      status: task.status,
      binding: task.lead_binding || null,
      wakeups: ensureWakeupStore(task).filter((item) => item.status !== "acked"),
    };
  });
}

export async function recordLeadWakeupDelivery(projectRoot, taskId, wakeupId, input) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  const id = ensureLineField(wakeupId, "wakeup_id", 400, true);
  const delivered = input?.delivered === true;
  const deliveryId = input?.delivery_id === undefined ? undefined : ensureLineField(input.delivery_id, "delivery_id", 240);
  const error = input?.error === undefined ? undefined : ensureLineField(input.error, "error", 500);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    const wakeup = ensureWakeupStore(task).find((item) => item.id === id);
    if (!wakeup) fail(`unknown Lead wakeup: ${id}`);
    wakeup.attempts = Number(wakeup.attempts || 0) + 1;
    wakeup.last_attempt_at = isoNow();
    wakeup.status = delivered ? "delivered" : "failed";
    if (deliveryId !== undefined) wakeup.delivery_id = deliveryId;
    if (error !== undefined) wakeup.last_error = error;
    else delete wakeup.last_error;
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return { task_id: taskId, wakeup };
  });
}

export async function acknowledgeLeadWakeup(projectRoot, taskId, wakeupId, input = {}) {
  const root = await ensureStateRoot(projectRoot);
  ensureTaskId(taskId);
  const id = ensureLineField(wakeupId, "wakeup_id", 400, true);
  const deliveryId = input.delivery_id === undefined ? undefined : ensureLineField(input.delivery_id, "delivery_id", 240);
  return withLock(`${taskPath(root, taskId)}.lock`, async () => {
    const task = await loadTask(root, taskId);
    const wakeup = ensureWakeupStore(task).find((item) => item.id === id);
    if (!wakeup) fail(`unknown Lead wakeup: ${id}`);
    if (deliveryId !== undefined && wakeup.delivery_id !== deliveryId) fail(`delivery does not match Lead wakeup: ${id}`);
    wakeup.status = "acked";
    wakeup.acked_at = isoNow();
    task.updated_at = isoNow();
    await writeJsonAtomic(taskPath(root, taskId), task);
    return { task_id: taskId, wakeup };
  });
}

export async function appendAgentEvent(projectRoot, identity, input) {
  const root = await ensureStateRoot(projectRoot);
  const taskId = ensureTaskId(identity?.task_id);
  const role = ensureRole(identity?.role);
  const agentId = ensureLineField(identity?.agent_id, "agent_id", 240, true);
  const worktree = ensureAbsolutePath(identity?.worktree, "worktree");
  if (!ROLE_STATES[role].has(input?.state)) fail(`state ${input?.state} is not allowed for role ${role}`);
  const activity = ensureLineField(input?.activity, "activity", 240, true);
  const blocker = ensureLineField(input?.blocker, "blocker", 500);
  const next = ensureLineField(input?.next, "next", 500);
  const taskFile = taskPath(root, taskId);
  return withLock(`${taskFile}.lock`, async () => {
    const task = await loadTask(root, taskId);
    if (task.status !== "active") fail(`task is not active: ${taskId}`);
    const path = eventPath(root, taskId, role);
    return withLock(`${path}.lock`, async () => {
      const existing = await parseEventFile(root, `${taskId}-${role}.jsonl`);
      const sequence = existing.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0) + 1;
      const event = { version: 1, task_id: taskId, role, agent_id: agentId, state: input.state, activity };
      if (blocker !== undefined) event.blocker = blocker;
      if (next !== undefined) event.next = next;
      event.worktree = worktree;
      event.sequence = sequence;
      event.observed_at = isoNow();
      await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
      const wakeups = ensureWakeupStore(task);
      if (LEAD_WAKE_STATES.has(event.state) && !wakeups.some((item) => item.id === wakeupId(taskId, role, sequence))) {
        wakeups.push(makeLeadWakeup(event));
        task.updated_at = event.observed_at;
        await writeJsonAtomic(taskFile, task);
      }
      return { event, task: { task_id: task.task_id, name: task.name, description: task.description, status: task.status } };
    });
  });
}

export async function watch(projectRoot, cursor, timeoutMs = MAX_WATCH_MS, includeArchived = false) {
  const waitMs = Math.min(Math.max(Number(timeoutMs) || 0, 0), MAX_WATCH_MS);
  const root = await ensureStateRoot(projectRoot);
  const deadline = Date.now() + waitMs;
  while (true) {
    const all = await allEvents(root);
    const fresh = eventsAfter(all, cursor);
    if (fresh.length) {
      const current = await snapshot(projectRoot, includeArchived);
      const byTask = new Map(current.tasks.map((task) => [task.task_id, { name: task.name, description: task.description, status: task.status }]));
      return { events: fresh.map(({ event }) => ({ ...event, task: byTask.get(event.task_id) || null })), cursor: cursorFor(all), snapshot: current, timed_out: false };
    }
    if (Date.now() >= deadline) {
      return { events: [], cursor: cursor || cursorFor(all), snapshot: await snapshot(projectRoot, includeArchived), timed_out: true };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(100, Math.max(1, deadline - Date.now()))));
  }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderSnapshotHtml(data) {
  const cards = data.tasks.map((task) => `<section class="lane"><header><code>${escapeHtml(task.task_id)}</code><strong>${escapeHtml(task.name)}</strong><span>${escapeHtml(task.status)}</span></header><p>${escapeHtml(task.description)}</p><div class="agents">${task.agents.map((agent) => `<article><b>${escapeHtml(agent.role)}</b><em>${escapeHtml(agent.state)}</em><div>${escapeHtml(agent.activity)}</div>${agent.blocker ? `<small>阻塞：${escapeHtml(agent.blocker)}</small>` : ""}${agent.next ? `<small>下一步：${escapeHtml(agent.next)}</small>` : ""}</article>`).join("") || `<i>暂无 Agent 活动</i>`}</div></section>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Agent Blackboard</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:0;padding:16px}.lane{background:#1d1d1d;border:1px solid #444;border-radius:10px;padding:12px;margin-bottom:12px}header{display:flex;gap:10px;align-items:center}header strong{font-size:16px;flex:1}header span,em{color:#8bd5ff;font-style:normal}p{color:#bbb}.agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}article{background:#292929;padding:8px;border-radius:7px}article div{margin-top:6px}small{display:block;color:#ffcf70;margin-top:5px}i{color:#888}</style>${cards || "<p>暂无 active task</p>"}`;
}
