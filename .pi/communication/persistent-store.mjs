import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const WINDOW_MS = 60 * 60 * 1000;

function safeName(value) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("invalid logical UUID");
  return value;
}

export class PersistentReplyStore {
  constructor(directory, windowMs = WINDOW_MS) { this.directory = directory; this.windowMs = windowMs; }
  path(recipient, id) { return join(this.directory, recipient, `${safeName(id)}.json`); }
  async read(recipient, id, now = Date.now()) {
    try {
      const record = JSON.parse(await readFile(this.path(recipient, id), "utf8"));
      const timestamp = record.status === "pending" ? record.acceptedAt : record.completedAt;
      if (record.recipient !== recipient || record.id !== id || !Number.isFinite(timestamp) || now - timestamp >= this.windowMs) return undefined;
      return record;
    } catch { return undefined; }
  }
  async reserve(recipient, id, now = Date.now()) {
    const existing = await this.read(recipient, id, now);
    if (existing) return { created: false, record: existing };
    const path = this.path(recipient, id);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}-${now}`;
    await writeFile(temp, JSON.stringify({ id, recipient, status: "pending", acceptedAt: now }), "utf8");
    await rename(temp, path);
    return { created: true, record: { id, recipient, status: "pending", acceptedAt: now } };
  }
  async write(recipient, id, reply, now = Date.now()) {
    const path = this.path(recipient, id);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}-${now}`;
    await writeFile(temp, JSON.stringify({ id, recipient, status: "completed", completedAt: now, reply }), "utf8");
    await rename(temp, path);
    return { id, recipient, completedAt: now, reply };
  }
  async purge(now = Date.now()) {
    // Retention cleanup is intentionally best-effort; correctness is enforced by read().
    return now;
  }
}
