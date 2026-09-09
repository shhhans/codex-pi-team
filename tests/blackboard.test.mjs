import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  acceptTask,
  acknowledgeLeadWakeup,
  appendAgentEvent,
  archiveTask,
  closeIncompleteTask,
  createTask,
  listLeadWakeups,
  publishTask,
  registerLead,
  recordLeadWakeupDelivery,
  reconcileTask,
  resolveGitCommonDir,
  snapshot,
  stateRoot,
  updateTask,
  unregisterLead,
  watch,
} from "../plugins/agent-blackboard/server/blackboard-core.mjs";
import { createLeadWakeupRequest, dispatchLeadWakeups } from "../plugins/agent-blackboard/server/lead-wakeup-adapter.mjs";

const REPO = process.cwd();

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "agent-blackboard-test-"));
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "blackboard-test@example.invalid"]);
  git(repo, ["config", "user.name", "Blackboard Test"]);
  await writeFile(join(repo, "README.md"), "blackboard test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "--quiet", "-m", "initial"]);
  git(repo, ["branch", "blackboard-worktree"]);
  const worktree = join(root, "worktree");
  git(repo, ["worktree", "add", "--quiet", worktree, "blackboard-worktree"]);
  return { root, repo, worktree };
}

async function removeRepo({ root, repo, worktree }) {
  spawnSync("git", ["-C", repo, "worktree", "remove", "--force", worktree], { encoding: "utf8" });
  await rm(root, { recursive: true, force: true });
}

test("blackboard uses one common-dir root across worktrees and preserves Lead metadata revisions", async () => {
  const fixture = await makeRepo();
  try {
    assert.equal(stateRoot(fixture.repo), stateRoot(fixture.worktree));
    assert.equal(resolveGitCommonDir(fixture.repo), resolveGitCommonDir(fixture.worktree));
    const task = await createTask(fixture.repo, { task_id: "BB-001", name: "Initial scope", description: "Initial description" });
    assert.equal(task.status, "active");
    await assert.rejects(createTask(fixture.worktree, { task_id: "BB-001", name: "duplicate", description: "duplicate" }), /already exists/);
    const updated = await updateTask(fixture.worktree, "BB-001", { name: "Current scope", description: "Current description" });
    assert.equal(updated.name, "Current scope");
    assert.equal(updated.description, "Current description");
    assert.deepEqual(updated.revisions.map(({ field, old, new: next }) => ({ field, old, new: next })), [
      { field: "name", old: "Initial scope", new: "Current scope" },
      { field: "description", old: "Initial description", new: "Current description" },
    ]);
    const beforeEvents = await snapshot(fixture.repo);
    const metadataOnly = await watch(fixture.worktree, beforeEvents.cursor, 0);
    assert.deepEqual(metadataOnly.events, [], "Lead metadata changes must not create Agent activity reminders");
    assert.equal(git(fixture.repo, ["status", "--porcelain"]), "", "blackboard state must not pollute the main worktree");
    assert.equal(git(fixture.worktree, ["status", "--porcelain"]), "", "blackboard state must not pollute a task worktree");
  } finally {
    await removeRepo(fixture);
  }
});

test("formal publication creates or aligns only an active Lead-owned task", async () => {
  const fixture = await makeRepo();
  try {
    const created = await publishTask(fixture.repo, { task_id: "BB-005", name: "Initial task", description: "Initial scope" });
    assert.equal(created.action, "created");
    const updated = await publishTask(fixture.worktree, { task_id: "BB-005", name: "Aligned task", description: "Aligned scope" });
    assert.equal(updated.action, "updated");
    assert.deepEqual(updated.task.revisions.map(({ field }) => field), ["name", "description"]);
    await acceptTask(fixture.repo, "BB-005");
    await assert.rejects(
      publishTask(fixture.repo, { task_id: "BB-005", name: "Too late", description: "Must not reopen" }),
      /only an active task can be republished/,
    );
    await archiveTask(fixture.repo, "BB-005");
  } finally {
    await removeRepo(fixture);
  }
});

test("Lead can close incomplete work and explicitly reconcile legacy outcomes without erasing archive state", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-006", name: "Incomplete", description: "Needs a missing criterion record" });
    const incomplete = await closeIncompleteTask(fixture.repo, "BB-006", {
      reason: "Research evidence was not produced.",
      next_step: "Collect the missing research evidence.",
      missing_done_criteria: ["C-003"],
    });
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.outcome, "incomplete");
    await archiveTask(fixture.repo, "BB-006");
    const accepted = await reconcileTask(fixture.repo, "BB-006", { outcome: "accepted" });
    assert.equal(accepted.status, "archived", "reconciliation must preserve archival execution state");
    assert.equal(accepted.outcome, "accepted");
    const corrected = await reconcileTask(fixture.repo, "BB-006", {
      outcome: "incomplete",
      reason: "Historical completion was not supported by the retained evidence.",
      next_step: "Review the retained evidence manually.",
      missing_done_criteria: ["C-003"],
    });
    assert.equal(corrected.status, "archived");
    assert.equal(corrected.outcome, "incomplete");
    assert.deepEqual(corrected.missing_done_criteria, ["C-003"]);
  } finally {
    await removeRepo(fixture);
  }
});

test("agent events are role-scoped, append-only, validated, and cursor-watchable", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-002", name: "Event task", description: "Observe activity" });
    const identity = { task_id: "BB-002", role: "executor", agent_id: "executor-001", worktree: fixture.worktree };
    const first = await appendAgentEvent(fixture.worktree, identity, { state: "working", activity: "starting", role: "spoofed", sequence: 999, worktree: "spoofed" });
    assert.equal(first.event.sequence, 1);
    assert.equal(first.event.role, "executor");
    assert.equal(first.event.agent_id, "executor-001");
    assert.equal(first.event.worktree, fixture.worktree);
    assert.equal(Object.hasOwn(first.event, "observed_at"), true);
    assert.equal(Object.hasOwn(first.event, "role"), true);
    assert.equal(Object.hasOwn(first.event, "sequence"), true);
    assert.equal(first.event.sequence, 1, "agent-provided sequence must be ignored");
    await appendAgentEvent(fixture.repo, { ...identity, role: "reviewer", agent_id: "reviewer-001" }, { state: "reviewing", activity: "checking" });
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => appendAgentEvent(fixture.repo, identity, { state: "working", activity: `phase ${index}` })));
    assert.deepEqual(concurrent.map(({ event }) => event.sequence).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 2));
    await assert.rejects(appendAgentEvent(fixture.repo, identity, { state: "reviewing", activity: "invalid executor state" }), /not allowed/);
    await assert.rejects(appendAgentEvent(fixture.repo, identity, { state: "ready_for_acceptance", activity: "reviewer-only state" }), /not allowed/);
    await assert.rejects(appendAgentEvent(fixture.repo, identity, { state: "working", activity: "two\nlines" }), /single line/);
    const current = await snapshot(fixture.repo);
    assert.equal(current.tasks[0].agents.find((agent) => agent.role === "executor").sequence, 13);
    const nextEvent = await appendAgentEvent(fixture.repo, identity, { state: "ready_for_review", activity: "slice ready", next: "wait for review" });
    const changed = await watch(fixture.repo, current.cursor, 250);
    assert.equal(changed.timed_out, false);
    assert.equal(changed.events.length, 1);
    assert.equal(changed.events[0].sequence, nextEvent.event.sequence);
    assert.equal(changed.events[0].task.name, "Event task");
    const noDuplicate = await watch(fixture.repo, changed.cursor, 0);
    assert.deepEqual(noDuplicate.events, []);
    await acceptTask(fixture.repo, "BB-002");
    await assert.rejects(appendAgentEvent(fixture.repo, identity, { state: "working", activity: "after acceptance" }), /not active/);
    await archiveTask(fixture.repo, "BB-002");
    assert.equal((await snapshot(fixture.repo)).tasks.length, 0);
    assert.equal((await snapshot(fixture.repo, true)).tasks[0].status, "archived");
  } finally {
    await removeRepo(fixture);
  }
});

test("v3 incomplete closure requires only a reason and next step", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-007", name: "Incomplete v3", description: "Needs a next step" });
    const incomplete = await closeIncompleteTask(fixture.repo, "BB-007", {
      reason: "The current evidence is insufficient.",
      next_step: "Run inspect again after the missing test is added.",
    });
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.outcome, "incomplete");
    assert.equal(incomplete.next_step, "Run inspect again after the missing test is added.");
    assert.equal(Object.hasOwn(incomplete, "missing_done_criteria"), false);
  } finally {
    await removeRepo(fixture);
  }
});

test("snapshot exposes active critical changes with a caller-owned cursor", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-SNAPSHOT-001", name: "Incremental task", description: "Heartbeat baseline" });
    const executor = { task_id: "BB-SNAPSHOT-001", role: "executor", agent_id: "executor-snapshot", worktree: fixture.worktree };
    const researcher = { task_id: "BB-SNAPSHOT-001", role: "researcher", agent_id: "researcher-snapshot", worktree: fixture.worktree };
    const reviewer = { task_id: "BB-SNAPSHOT-001", role: "reviewer", agent_id: "reviewer-snapshot", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, executor, { state: "working", activity: "starting" });
    await appendAgentEvent(fixture.repo, researcher, { state: "waiting", activity: "waiting for scope" });
    await appendAgentEvent(fixture.repo, reviewer, { state: "reviewing", activity: "checking" });
    const ready = await appendAgentEvent(fixture.repo, executor, { state: "ready_for_review", activity: "slice ready" });
    const accepted = await appendAgentEvent(fixture.repo, reviewer, { state: "ready_for_acceptance", activity: "review ready" });
    const completed = await appendAgentEvent(fixture.repo, researcher, { state: "completed", activity: "research complete" });

    const initial = await snapshot(fixture.repo);
    assert.equal(typeof initial.cursor, "string");
    assert.deepEqual(new Set(initial.changes.map((event) => event.state)), new Set(["ready_for_review", "ready_for_acceptance", "completed"]));
    assert.equal(initial.changes.find((event) => event.state === "ready_for_review").sequence, ready.event.sequence);
    assert.equal(initial.changes.find((event) => event.state === "ready_for_acceptance").sequence, accepted.event.sequence);
    assert.equal(initial.changes.find((event) => event.state === "completed").sequence, completed.event.sequence);
    assert.equal(initial.changes[0].task.task_id, "BB-SNAPSHOT-001");

    const unchanged = await snapshot(fixture.repo, false, initial.cursor);
    assert.deepEqual(unchanged.changes, []);
    assert.equal(unchanged.tasks[0].task_id, "BB-SNAPSHOT-001");

    await appendAgentEvent(fixture.repo, executor, { state: "working", activity: "post-baseline work" });
    await appendAgentEvent(fixture.repo, researcher, { state: "blocked", activity: "research blocked", blocker: "missing input" });
    await appendAgentEvent(fixture.repo, reviewer, { state: "changes_requested", activity: "fix required" });
    await appendAgentEvent(fixture.repo, executor, { state: "ready_for_review", activity: "updated slice" });
    const changed = await snapshot(fixture.repo, false, initial.cursor);
    assert.deepEqual(new Set(changed.changes.map((event) => event.state)), new Set(["blocked", "changes_requested", "ready_for_review"]));
    assert.equal(changed.changes.every((event) => event.task.status === "active"), true);
    assert.equal(changed.tasks[0].agents.find((agent) => agent.role === "executor").sequence, 4);

    const retried = await snapshot(fixture.repo, false, initial.cursor);
    assert.deepEqual(retried.changes.map(({ task, ...event }) => event), changed.changes.map(({ task, ...event }) => event));
    await assert.rejects(snapshot(fixture.repo, false, "not-a-valid-cursor"), /invalid blackboard cursor/);
    await assert.rejects(snapshot(fixture.repo, false, Buffer.from(JSON.stringify({ version: 1 }), "utf8").toString("base64url")), /invalid blackboard cursor/);

    await acceptTask(fixture.repo, "BB-SNAPSHOT-001");
    await archiveTask(fixture.repo, "BB-SNAPSHOT-001");
    assert.deepEqual((await snapshot(fixture.repo, false, initial.cursor)).changes, []);
    assert.deepEqual((await snapshot(fixture.repo, true, initial.cursor)).changes, []);
    assert.equal((await snapshot(fixture.repo, true)).tasks[0].status, "archived");
  } finally {
    await removeRepo(fixture);
  }
});

test("watcher returns causally on Agent activity and stays quiet for metadata-only changes", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-003", name: "Causal task", description: "Original objective" });
    const initial = await snapshot(fixture.repo);
    const noActivity = await watch(fixture.repo, initial.cursor, 40);
    assert.equal(noActivity.timed_out, true, "without blackboard_update the watcher must only time out");
    const watching = watch(fixture.worktree, initial.cursor, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await appendAgentEvent(fixture.worktree, { task_id: "BB-003", role: "executor", agent_id: "executor-causal", worktree: fixture.worktree }, { state: "working", activity: "creating Blackboard class" });
    const first = await watching;
    assert.equal(first.timed_out, false);
    assert.equal(first.events[0].activity, "creating Blackboard class");
    assert.equal(first.events[0].task.description, "Original objective");

    const revised = await updateTask(fixture.repo, "BB-003", { description: "Updated objective" });
    assert.equal(revised.description, "Updated objective");
    const metadataOnly = await watch(fixture.repo, first.cursor, 40);
    assert.equal(metadataOnly.timed_out, true, "metadata-only changes must not wake the Agent event watcher");
    assert.equal(metadataOnly.snapshot.tasks[0].description, "Updated objective");

    await appendAgentEvent(fixture.repo, { task_id: "BB-003", role: "executor", agent_id: "executor-causal", worktree: fixture.worktree }, { state: "working", activity: "following updated objective" });
    const second = await watch(fixture.repo, initial.cursor, 500);
    assert.equal(second.events.length, 2, "watching from the old cursor must return every unread event");
    assert.equal(second.events[1].task.description, "Updated objective");
    await appendAgentEvent(fixture.repo, { task_id: "BB-003", role: "reviewer", agent_id: "reviewer-causal", worktree: fixture.worktree }, { state: "reviewing", activity: "reviewing" });
    await appendAgentEvent(fixture.repo, { task_id: "BB-003", role: "reviewer", agent_id: "reviewer-causal", worktree: fixture.worktree }, { state: "ready_for_acceptance", activity: "ready" });
    await acceptTask(fixture.repo, "BB-003");
    await archiveTask(fixture.repo, "BB-003");
  } finally {
    await removeRepo(fixture);
  }
});

test("critical Agent events enqueue a bound Lead wakeup and non-critical events stay quiet", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-WAKE-001", name: "Wake task", description: "Deliver only material reminders" });
    const binding = await registerLead(fixture.repo, "BB-WAKE-001", { thread_id: "lead-thread-001", host_id: "local" });
    assert.equal(binding.pending, 0);
    const identity = { task_id: "BB-WAKE-001", role: "executor", agent_id: "executor-wake", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, identity, { state: "working", activity: "ordinary progress" });
    await appendAgentEvent(fixture.repo, identity, { state: "waiting", activity: "waiting for review" });
    assert.deepEqual((await listLeadWakeups(fixture.repo, "BB-WAKE-001")).wakeups, []);
    const event = await appendAgentEvent(fixture.repo, identity, { state: "ready_for_review", activity: "slice ready", next: "await review" });
    const queue = await listLeadWakeups(fixture.repo, "BB-WAKE-001");
    assert.equal(queue.binding.thread_id, "lead-thread-001");
    assert.equal(queue.wakeups.length, 1);
    assert.equal(queue.wakeups[0].id, `BB-WAKE-001:executor:${event.event.sequence}`);
    const taskStatePath = join(stateRoot(fixture.repo), "BB-WAKE-001.json");
    const taskState = JSON.parse(await readFile(taskStatePath, "utf8"));
    taskState.lead_wakeups = [];
    await writeFile(taskStatePath, `${JSON.stringify(taskState)}\n`, "utf8");
    const recovered = await listLeadWakeups(fixture.repo, "BB-WAKE-001");
    assert.equal(recovered.wakeups[0].id, queue.wakeups[0].id, "event log must recover a missing wake record");
    const request = createLeadWakeupRequest(queue.binding, queue.wakeups[0]);
    assert.equal(request.thread_id, "lead-thread-001");
    assert.match(request.prompt, /task_id=BB-WAKE-001/);
    assert.match(request.prompt, /state=ready_for_review/);
    assert.doesNotMatch(request.prompt, /base64|eyJ[A-Za-z0-9]/i);
  } finally {
    await removeRepo(fixture);
  }
});

test("Lead wakeup adapter delivers, records, acknowledges, and retries host failures", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-WAKE-002", name: "Adapter task", description: "Exercise host delivery" });
    await registerLead(fixture.repo, "BB-WAKE-002", { thread_id: "lead-thread-002", host_id: "local" });
    const identity = { task_id: "BB-WAKE-002", role: "reviewer", agent_id: "reviewer-wake", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, identity, { state: "changes_requested", activity: "fix required", blocker: "test failure" });

    const failed = await dispatchLeadWakeups(fixture.repo, "BB-WAKE-002", async () => ({ accepted: false, reason: "stale-thread" }));
    assert.equal(failed.delivered[0].status, "failed");
    assert.equal(failed.delivered[0].attempts, 1);

    const sent = [];
    const delivered = await dispatchLeadWakeups(fixture.repo, "BB-WAKE-002", async (request) => {
      sent.push(request);
      return { threadId: request.thread_id, delivery_id: "delivery-002" };
    });
    assert.equal(delivered.delivered[0].status, "delivered");
    assert.equal(sent.length, 1);
    assert.match(sent[0].prompt, /state=changes_requested/);
    const wakeupId = delivered.delivered[0].id;
    await assert.rejects(
      acknowledgeLeadWakeup(fixture.repo, "BB-WAKE-002", wakeupId, { delivery_id: "wrong-delivery" }),
      /delivery does not match Lead wakeup/,
    );
    await acknowledgeLeadWakeup(fixture.repo, "BB-WAKE-002", wakeupId, { delivery_id: "delivery-002" });
    assert.deepEqual((await listLeadWakeups(fixture.repo, "BB-WAKE-002")).wakeups, []);
  } finally {
    await removeRepo(fixture);
  }
});

test("Lead wakeup binding is explicit and isolated per task", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-WAKE-A", name: "Task A", description: "A" });
    await createTask(fixture.repo, { task_id: "BB-WAKE-B", name: "Task B", description: "B" });
    await registerLead(fixture.repo, "BB-WAKE-A", { thread_id: "lead-a", host_id: "local" });
    await registerLead(fixture.repo, "BB-WAKE-B", { thread_id: "lead-b", host_id: "local" });
    await assert.rejects(registerLead(fixture.repo, "BB-WAKE-A", { thread_id: "lead-other", host_id: "local" }), /different Lead binding/);
    await appendAgentEvent(fixture.repo, { task_id: "BB-WAKE-A", role: "executor", agent_id: "executor-a", worktree: fixture.worktree }, { state: "blocked", activity: "A blocked" });
    const sent = [];
    await dispatchLeadWakeups(fixture.repo, "BB-WAKE-A", async (request) => { sent.push(request); return { accepted: true }; });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].thread_id, "lead-a");
    assert.equal((await listLeadWakeups(fixture.repo, "BB-WAKE-B")).wakeups.length, 0);
    await unregisterLead(fixture.repo, "BB-WAKE-A", { thread_id: "lead-a", host_id: "local" });
    assert.equal((await listLeadWakeups(fixture.repo, "BB-WAKE-A")).binding, null);
  } finally {
    await removeRepo(fixture);
  }
});

test("repo-local plugin exposes Lead-only tools, skills, MCP server, and inline/PiP UI", async () => {
  const plugin = join(REPO, "plugins/agent-blackboard");
  const manifest = JSON.parse(await readFile(join(plugin, ".codex-plugin/plugin.json"), "utf8"));
  const mcpConfig = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
  const appConfig = JSON.parse(await readFile(join(plugin, ".app.json"), "utf8"));
  const marketplace = JSON.parse(await readFile(join(REPO, ".agents/plugins/marketplace.json"), "utf8"));
  assert.equal(manifest.name, "agent-blackboard");
  assert.equal(mcpConfig.mcpServers["agent-blackboard"].type, "stdio");
  assert.equal(mcpConfig.mcpServers["agent-blackboard"].required, true, "MCP failure must not silently degrade to skill-only mode");
  assert.equal(mcpConfig.mcpServers["agent-blackboard"].startup_timeout_sec, 15);
  assert.equal(appConfig.apps["agent-blackboard"].id, "agent-blackboard");
  assert.equal(appConfig.apps["agent-blackboard"].category, "Productivity");
  assert.equal(marketplace.plugins[0].source.path, "./plugins/agent-blackboard");
  await readFile(join(plugin, "server/blackboard-core.mjs"), "utf8");
  assert.match(await readFile(join(plugin, "skills/blackboard-lead/SKILL.md"), "utf8"), /Only the Lead changes/);
  const piTeamLeadSkill = await readFile(join(plugin, "skills/pi-team-lead/SKILL.md"), "utf8");
  assert.match(piTeamLeadSkill, /Creating a Blackboard\s+lane does not launch Pi Team/);
  assert.match(piTeamLeadSkill, /pi-team\.cmd start/);
  assert.match(piTeamLeadSkill, /blackboard_watch/);
  assert.match(piTeamLeadSkill, /Do not use\s+WSL, Git Bash, `runs\.run`/);
  assert.match(piTeamLeadSkill, /stay\s+alive through implementation, review, fixes, and re-review/);
  for (const skill of ["blackboard-lead", "pi-team-lead"]) {
    const metadata = await readFile(join(plugin, "skills", skill, "agents/openai.yaml"), "utf8");
    assert.match(metadata, /value: "agent-blackboard"/, `${skill} must declare its MCP dependency`);
    assert.match(metadata, /transport: "stdio"/);
  }
  const appHtml = await readFile(join(plugin, "apps/blackboard.html"), "utf8");
  assert.match(appHtml, /requestDisplayMode/);
  assert.match(appHtml, /new URLSearchParams\(window\.location\.search\)/, "encoded project_root must be decoded by the URL parser");
  assert.match(appHtml, /window\.openai\?\.toolInput\?\.project_root/, "MCP App tool input must be the primary project root source");
  assert.doesNotMatch(appHtml, /location\.search\.match\(/, "UI must not forward a percent-encoded project path");
  const extension = await readFile(join(REPO, ".pi/communication/extensions/blackboard-update.ts"), "utf8");
  assert.match(extension, /name: "blackboard_update"/);
  assert.match(extension, /input\.task_id !== taskId/);
  for (const role of ["researcher", "executor", "reviewer"]) {
    assert.doesNotMatch(await readFile(join(REPO, ".pi/agents", `${role}.md`), "utf8"), /blackboard_create_task/);
  }
  const server = spawnSync(process.execPath, [join(plugin, "server/blackboard-mcp.mjs")], {
    cwd: REPO,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-test", version: "1" } } })}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/list", params: {} })}\n`,
    encoding: "utf8",
  });
  assert.equal(server.status, 0, server.stderr);
  const responses = server.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses[0].result.serverInfo.name, "agent-blackboard");
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
  assert.match(responses[0].result.instructions, /observability plane/);
  assert.deepEqual(responses[1].result, {});
  assert.deepEqual(responses[2].result.tools.map((tool) => tool.name), [
    "blackboard_create_task", "blackboard_update_task", "blackboard_accept_task", "blackboard_close_incomplete_task", "blackboard_reconcile_incomplete_task", "blackboard_reconcile_task", "blackboard_archive_task", "blackboard_register_lead", "blackboard_unregister_lead", "blackboard_list_lead_wakeups", "blackboard_ack_lead_wakeup", "blackboard_snapshot", "blackboard_watch", "blackboard_render",
  ]);
  for (const name of ["blackboard_snapshot", "blackboard_watch", "blackboard_render"]) {
    const tool = responses[2].result.tools.find((candidate) => candidate.name === name);
    assert.equal(tool.annotations.readOnlyHint, true, `${name} must be declared read-only`);
    assert.equal(tool.annotations.openWorldHint, false, `${name} must be declared closed-world`);
  }
  const snapshotTool = responses[2].result.tools.find((tool) => tool.name === "blackboard_snapshot");
  assert.equal(snapshotTool.inputSchema.properties.cursor.type, "string");
  assert.equal(responses[3].result.resources[0].uri, "ui://agent-blackboard/blackboard.html");

  const fixture = await makeRepo();
  try {
    const call = spawnSync(process.execPath, [join(plugin, "server/blackboard-mcp.mjs")], {
      cwd: REPO,
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "blackboard_create_task", arguments: { project_root: fixture.repo, task_id: "BB-004", name: "MCP task", description: "Created through MCP" } } })}\n`,
      encoding: "utf8",
    });
    assert.equal(call.status, 0, call.stderr);
    const callResponse = JSON.parse(call.stdout.trim());
    assert.equal(callResponse.result.structuredContent.task_id, "BB-004");
    assert.equal(JSON.parse(await readFile(join(stateRoot(fixture.repo), "BB-004.json"))).name, "MCP task");
  } finally {
    await removeRepo(fixture);
  }
});
