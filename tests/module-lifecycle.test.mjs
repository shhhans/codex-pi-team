import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createModule, markCompacted, readPersistentSession, registerPersistentSession, saveRoleSummary } from "../.pi/runtime/module-store.mjs";

async function fixture() { const repo = await mkdtemp(join(tmpdir(), "module-life-")); execFileSync("git", ["init", "-q", repo]); execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]); execFileSync("git", ["-C", repo, "config", "user.name", "Test"]); const session = join(repo, "outside-worktree-session.jsonl"); await writeFile(session, "session\n"); const body = { module: { id: "LIFE-1", name: "Life" }, data_flow: { input: { from: "caller", to: "service" } }, public_interfaces: { run: { input: { type: "string" }, output: { type: "string" } } } }; await createModule(repo, { module_id: "LIFE-1", name: "Life", contract: body }); return { repo, session }; }

test("persistent session recovery requires the original session file and retains configuration", async () => { const { repo, session } = await fixture(); try { await registerPersistentSession(repo, "LIFE-1", "executor", { session_id: "executor-session", session_path: session, provider: "provider-a", model: "model-a" }); const recovered = await readPersistentSession(repo, "LIFE-1", "executor"); assert.equal(recovered.session_path, session); assert.equal(recovered.provider, "provider-a"); await rm(session); await assert.rejects(() => readPersistentSession(repo, "LIFE-1", "executor"), /session file is missing/); } finally { await rm(repo, { recursive: true, force: true }); } });

test("summary must exist before compact completion is recorded", async () => { const { repo } = await fixture(); try { await assert.rejects(() => markCompacted(repo, "LIFE-1", "validator"), /summary must be saved/); const summary = await saveRoleSummary(repo, "LIFE-1", "validator", "Tests cover success and typed failures; performance remains unmeasured."); assert.equal(summary.compacted_at, null); const compacted = await markCompacted(repo, "LIFE-1", "validator"); assert.ok(compacted.compacted_at); } finally { await rm(repo, { recursive: true, force: true }); } });
