import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

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

async function existingSequence(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  let maximum = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    maximum = Math.max(maximum, Number(event.sequence) || 0);
  }
  return maximum;
}

export async function appendRoleEvent(stateRoot, event) {
  const file = join(stateRoot, `${event.task_id}-${event.role}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  return withLock(`${file}.lock`, async () => {
    const sequence = (await existingSequence(file)) + 1;
    const record = { ...event, version: 1, sequence, at: new Date().toISOString() };
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
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
