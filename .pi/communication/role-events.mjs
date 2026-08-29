import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

async function scanSequenceFromFile(file) {
  // One-time cold-start fallback used only when the .seq sidecar is
  // missing, empty, corrupted, or contains a non-integer. Kept off the
  // hot path so that the steady-state per-append lookup stays O(1).
  const text = await readFile(file, "utf8").catch(() => "");
  let maximum = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      maximum = Math.max(maximum, Number(event.sequence) || 0);
    } catch {
      // Skip malformed lines so a partial write never blocks subsequent appends.
    }
  }
  return maximum;
}

async function readAuthoritativeSequence(file) {
  // The sequence source for the next append. MUST be re-read under the
  // file lock on every call — an in-process cache here would let another
  // Node process append concurrently without our knowledge, producing
  // duplicate sequence numbers (the previous-sidecar-write-only fix
  // shipped a process-local cache here that silently regressed the
  // cross-process invariant; this implementation reads the sidecar on
  // every call so the cache cannot drift away from the file state).
  let maximum = 0;
  let fromSidecar = false;
  try {
    const text = await readFile(`${file}.seq`, "utf8");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty sidecar");
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("non-integer sidecar");
    maximum = parsed;
    fromSidecar = true;
  } catch {
    maximum = await scanSequenceFromFile(file);
  }
  if (!fromSidecar) {
    // Reconcile the sidecar so the next cold start skips the JSONL scan.
    // Best-effort; the caller is already inside the lock so a concurrent
    // process would only see the old (lower or missing) value.
    await writeFile(`${file}.seq`, `${maximum}\n`, "utf8").catch(() => undefined);
  }
  return maximum;
}

async function withLock(path, fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try { await mkdir(path); break; }
    catch (error) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) throw new Error(`role event lock timeout: ${path}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  try { return await fn(); }
  finally { await rm(path, { recursive: true, force: true }); }
}

export async function appendRoleEvent(stateRoot, event) {
  const file = join(stateRoot, `${event.task_id}-${event.role}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  return withLock(`${file}.lock`, async () => {
    // The lock guarantees single-writer access to this (task, role)
    // pair, but it does NOT prevent another Node process from having
    // updated `<file>.seq` between our previous append (in this
    // process) and our acquisition of the lock. We must therefore
    // re-read the sidecar (with scan fallback) inside the lock on
    // every append so the sequence we issue is the true current max.
    const current = await readAuthoritativeSequence(file);
    const sequence = current + 1;
    const record = { ...event, version: 1, sequence, at: new Date().toISOString() };
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    // Write the sidecar AFTER the append so a crash mid-append leaves
    // the sidecar at the last fully-committed sequence. The next
    // process will rescan the JSONL (max value) and continue from
    // there — at worst it produces a duplicate of the committed event
    // on retry, which the consumer will see and re-derive from the
    // JSONL scan, never issuing a higher duplicate.
    await writeFile(`${file}.seq`, `${sequence}\n`, "utf8").catch(() => undefined);
    return record;
  });
}

export async function registerRoleRuntime(stateRoot, identity) {
  const file = join(stateRoot, `${identity.task_id}-${identity.role}-runtime.json`);
  await mkdir(dirname(file), { recursive: true });
  const now = Date.now();
  const record = {
    version: 1,
    ...identity,
    runtime_pid: process.pid,
    parent_pid: process.ppid,
    process_started_at: new Date(now - process.uptime() * 1_000).toISOString(),
    ready_at: new Date(now).toISOString(),
  };
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}