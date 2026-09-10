import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  LEAD_WAKE_STATES, ROLE_STATES, TASK_STATUSES, contractDescription, decodeCursor,
  encodeCursor, ensureAbsolutePath, ensureDescription, ensureLine, ensureRole, ensureTaskId,
  ensureTaskStatus, validateAgentEvent, validateAgentIdentity, validateTaskRecord, wakeupFromEvent,
} from "./runtime-schema.mjs";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const MAX_WATCH_MS = 55_000;

export function resolveGitCommonDir(projectRoot = process.cwd()) {
  const root = ensureAbsolutePath(projectRoot, "project_root");
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cannot resolve Git common directory: ${(result.stderr || "").trim()}`);
  let common = (result.stdout || "").trim();
  if (!isAbsolute(common)) common = resolve(root, common);
  if (!existsSync(common) || !statSync(common).isDirectory()) throw new Error(`Git common directory is not a directory: ${common}`);
  return realpathSync(common);
}

export function stateRoot(projectRoot = process.cwd()) { return join(resolveGitCommonDir(projectRoot), "pi-team-runtime", "v1"); }
export async function ensureStore(projectRoot = process.cwd()) {
  const root = stateRoot(projectRoot);
  for (const dir of ["tasks", "events", "audit", "checkpoints", "locks"]) await mkdir(join(root, dir), { recursive: true });
  return root;
}
const taskPath = (root, id) => join(root, "tasks", `${ensureTaskId(id)}.json`);
const eventPath = (root, id, role) => join(root, "events", `${ensureTaskId(id)}-${ensureRole(role)}.jsonl`);
const auditPath = (root, id) => join(root, "audit", `${ensureTaskId(id)}.jsonl`);
const lockPath = (root, name) => join(root, "locks", `${name}.lock`);
const now = () => new Date().toISOString();

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
async function withLock(path, fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try { await mkdir(path); break; }
    catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw new Error(`runtime lock timeout: ${path}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, LOCK_RETRY_MS));
    }
  }
  try { await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, at: now() }), "utf8"); return await fn(); }
  finally { await rm(path, { recursive: true, force: true }); }
}
async function loadTask(root, taskId) {
  try { const task = await readJson(taskPath(root, taskId)); return validateTaskRecord(task); }
  catch (error) { if (error.code === "ENOENT") throw new Error(`unknown runtime task: ${taskId}`); throw error; }
}
async function readLines(path) {
  const text = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
async function roleEvents(root, taskId, role) { return readLines(eventPath(root, taskId, role)); }
async function allEventItems(root) {
  const entries = await readdir(join(root, "events"), { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    for (const event of await readLines(join(root, "events", entry.name))) items.push({ key: entry.name, event });
  }
  return items.sort((a, b) => a.event.observed_at.localeCompare(b.event.observed_at) || a.key.localeCompare(b.key) || a.event.sequence - b.event.sequence);
}
async function appendAuditUnlocked(root, taskId, input) {
  const record = { version: 1, audit_id: randomUUID(), task_id: ensureTaskId(taskId), recorded_at: now(), ...input };
  await appendFile(auditPath(root, taskId), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}
async function audits(root, taskId) { return readLines(auditPath(root, taskId)); }
function isAcked(ackRecords, id) { return ackRecords.some((record) => record.kind === "wakeup_ack" && record.wakeup_id === id); }

export async function createTask(projectRoot, input) {
  if (input === undefined) { input = projectRoot; projectRoot = process.cwd(); }
  const root = await ensureStore(projectRoot); const taskId = ensureTaskId(input?.task_id);
  const path = taskPath(root, taskId);
  return withLock(lockPath(root, `task-${taskId}`), async () => {
    if (existsSync(path)) throw new Error(`task already exists: ${taskId}`);
    const task = { version: 1, task_id: taskId, name: ensureLine(input.name, "name", 240, true), description: contractDescription(input), status: "active", outcome: "pending", created_at: now(), updated_at: now(), revisions: [], sessions: {}, metadata: {} };
    if (input.branch !== undefined) task.branch = ensureLine(input.branch, "branch", 240, true);
    if (input.worktree !== undefined) task.worktree = ensureAbsolutePath(input.worktree, "worktree");
    if (input.scope_id !== undefined) task.scope_id = ensureLine(input.scope_id, "scope_id", 240, true);
    validateTaskRecord(task); await writeJsonAtomic(path, task); return task;
  });
}

export async function readTask(projectRoot, taskId) {
  if (taskId === undefined) { taskId = projectRoot; projectRoot = process.cwd(); }
  return loadTask(await ensureStore(projectRoot), taskId);
}
export async function transitionTask(projectRoot, taskId, status, patch = {}) {
  if (typeof projectRoot === "string" && typeof taskId === "object") { patch = taskId; status = projectRoot; taskId = undefined; projectRoot = process.cwd(); }
  const root = await ensureStore(projectRoot); ensureTaskStatus(status);
  return withLock(lockPath(root, `task-${taskId}`), async () => {
    const task = await loadTask(root, taskId); const allowed = { active: ["accepted", "incomplete", "archived"], accepted: ["archived"], incomplete: ["archived"], archived: [] };
    if (status !== task.status && !allowed[task.status].includes(status)) throw new Error(`invalid task transition: ${task.status} -> ${status}`);
    Object.assign(task, patch, { status, updated_at: now() }); validateTaskRecord(task); await writeJsonAtomic(taskPath(root, taskId), task); await appendAuditUnlocked(root, taskId, { kind: "task_transition", from: task.status, to: status }); return task;
  });
}
export async function registerSession(projectRoot, identity, session = {}) {
  const root = await ensureStore(projectRoot); const id = validateAgentIdentity(identity);
  return withLock(lockPath(root, `task-${id.task_id}`), async () => {
    const task = await loadTask(root, id.task_id); if (task.status !== "active") throw new Error("cannot register session on inactive task");
    const record = { version: 1, ...id, session_id: ensureLine(session.session_id || id.session_id || `${id.task_id}:${id.role}`, "session_id", 240, true), registered_at: now(), ...session };
    task.sessions[id.role] = record; task.updated_at = now(); await writeJsonAtomic(taskPath(root, id.task_id), task); return record;
  });
}

export async function appendAgentEvent(projectRoot, identity, input) {
  const root = await ensureStore(projectRoot); const id = validateAgentIdentity(identity);
  return withLock(lockPath(root, `event-${id.task_id}-${id.role}`), async () => {
    const task = await loadTask(root, id.task_id); if (task.status !== "active") throw new Error("task is not active");
    const events = await roleEvents(root, id.task_id, id.role); const previous = events.at(-1) || null;
    const event = validateAgentEvent(id, input, events.length + 1); if (previous && previous.sequence !== events.length) throw new Error("event sequence is not contiguous");
    await appendFile(eventPath(root, id.task_id, id.role), `${JSON.stringify(event)}\n`, "utf8");
    await appendAuditUnlocked(root, id.task_id, { kind: "agent_event", role: id.role, sequence: event.sequence, state: event.state });
    return { event, task };
  });
}

export async function appendAudit(projectRoot, taskId, input) {
  const root = await ensureStore(projectRoot); await loadTask(root, taskId);
  return withLock(lockPath(root, `audit-${taskId}`), () => appendAuditUnlocked(root, taskId, input));
}
export async function listWakeups(projectRoot, taskId, options = {}) {
  const root = await ensureStore(projectRoot); const task = await loadTask(root, taskId); const records = await audits(root, taskId);
  const result = [];
  for (const role of Object.keys(ROLE_STATES)) for (const event of await roleEvents(root, taskId, role)) {
    const wakeup = wakeupFromEvent(event); if (wakeup && (!options.pending || !isAcked(records, wakeup.id))) result.push({ ...wakeup, status: isAcked(records, wakeup.id) ? "acked" : "pending" });
  }
  return result.filter((item) => options.includeArchived || task.status !== "archived").sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export async function ackWakeup(projectRoot, taskId, wakeupId, identity = {}) {
  const root = await ensureStore(projectRoot); await loadTask(root, taskId); ensureLine(wakeupId, "wakeup_id", 400, true);
  return withLock(lockPath(root, `audit-${taskId}`), () => appendAuditUnlocked(root, taskId, { kind: "wakeup_ack", wakeup_id: wakeupId, role: identity.role, agent_id: identity.agent_id }));
}

export async function writeCheckpoint(projectRoot, taskId, role, checkpoint) {
  const root = await ensureStore(projectRoot); ensureTaskId(taskId); ensureRole(role); const id = ensureLine(checkpoint?.checkpoint_id || `${Date.now()}-${randomUUID()}`, "checkpoint_id", 240, true);
  const path = join(root, "checkpoints", taskId, role, `${id}.json`); const record = { version: 1, checkpoint_id: id, task_id: taskId, role, written_at: now(), ...checkpoint }; await writeJsonAtomic(path, record); return { path, record };
}

export async function snapshot(projectRoot = process.cwd(), includeArchived = false, cursor) {
  const root = await ensureStore(projectRoot); const entries = await readdir(join(root, "tasks"), { withFileTypes: true }); const items = await allEventItems(root); const byTask = new Map();
  for (const { event } of items) { const roles = byTask.get(event.task_id) || {}; const previous = roles[event.role]; if (!previous || event.sequence > previous.sequence) roles[event.role] = event; byTask.set(event.task_id, roles); }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue; const task = await readJson(join(root, "tasks", entry.name)); if (!includeArchived && task.status === "archived") continue; if (!TASK_STATUSES.includes(task.status)) continue;
    tasks.push({ ...task, agents: Object.entries(byTask.get(task.task_id) || {}).map(([role, event]) => ({ role, ...event })) });
  }
  tasks.sort((a, b) => a.task_id.localeCompare(b.task_id)); const seen = decodeCursor(cursor); const changes = items.filter(({ key, event }) => event.sequence > Number(seen[key] || 0)).filter(({ event }) => LEAD_WAKE_STATES.includes(event.state) && tasks.some((task) => task.task_id === event.task_id)).map(({ event }) => event);
  const files = { ...seen }; for (const { key, event } of items) files[key] = Math.max(Number(files[key] || 0), event.sequence);
  return { version: 1, state_root: root, tasks, changes, cursor: encodeCursor(files) };
}
export async function watch(projectRoot, cursor, timeoutMs = 0) {
  const deadline = Date.now() + Math.min(Math.max(Number(timeoutMs) || 0, 0), MAX_WATCH_MS); let result = await snapshot(projectRoot, false, cursor);
  while (!result.changes.length && Date.now() < deadline) { await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(100, deadline - Date.now()))); result = await snapshot(projectRoot, false, cursor); }
  return { ...result, timed_out: !result.changes.length };
}

export async function migrateRuntime(projectRoot = process.cwd(), { apply = false, backup = true } = {}) {
  const root = await ensureStore(projectRoot); const common = resolveGitCommonDir(projectRoot); const oldTaskRoot = join(common, "pi-team", "v1"); const oldBoardRoot = join(common, "harness-blackboard", "v1");
  const candidates = [];
  if (existsSync(oldTaskRoot)) for (const entry of await readdir(oldTaskRoot, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.includes("-runtime")) candidates.push({ source: "pi-team", path: join(oldTaskRoot, entry.name) });
  const report = { root, apply, tasks: [], skipped: [], conflicts: [], backups: [] };
  for (const candidate of candidates) {
    let legacy; try { legacy = await readJson(candidate.path); } catch { report.conflicts.push({ path: candidate.path, reason: "invalid json" }); continue; }
    const taskId = legacy.task_id || candidate.path.split(sep).at(-1).replace(/\.json$/, "");
    if (!["active", "pending"].includes(legacy.outcome || legacy.execution_status || legacy.status)) { report.skipped.push({ task_id: taskId, reason: "not active" }); continue; }
    const target = taskPath(root, taskId); if (existsSync(target)) { const current = await readJson(target); if (JSON.stringify(current) !== JSON.stringify(legacy)) report.conflicts.push({ task_id: taskId, reason: "target exists with different data" }); else report.skipped.push({ task_id: taskId, reason: "already migrated" }); continue; }
    report.tasks.push({ task_id: taskId, source: candidate.path });
    if (apply) {
      const task = { version: 1, task_id: taskId, name: legacy.name || taskId, description: legacy.description || legacy.objective || taskId, status: "active", outcome: "pending", created_at: legacy.created_at || now(), updated_at: now(), revisions: legacy.revisions || [], sessions: legacy.sessions || {}, metadata: { migrated_from: candidate.path }, ...legacy };
      task.status = "active"; delete task.execution_status; validateTaskRecord(task); await writeJsonAtomic(target, task);
      if (existsSync(oldBoardRoot)) for (const role of Object.keys(ROLE_STATES)) { const source = join(oldBoardRoot, `${taskId}-${role}.jsonl`); if (existsSync(source)) await writeFile(eventPath(root, taskId, role), await readFile(source)); }
    }
  }
  if (apply && backup && report.tasks.length && report.conflicts.length === 0) {
    const backupRoot = join(common, `pi-team-runtime-backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`); await mkdir(backupRoot, { recursive: true });
    for (const source of [oldTaskRoot, oldBoardRoot]) if (existsSync(source)) { const destination = join(backupRoot, source === oldTaskRoot ? "pi-team-v1" : "harness-blackboard-v1"); await rename(source, destination); report.backups.push(destination); }
  }
  if (report.conflicts.length) throw Object.assign(new Error("runtime migration conflicts detected"), { report });
  return report;
}

export const __paths = Object.freeze({ taskPath, eventPath, auditPath });
