import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import {
  ROLE_CHECKPOINTS,
  createLifecycleGate,
  validateAgentUpdate,
  readPreviousEvent,
  __testing__ as protocolTesting,
} from "../.pi/communication/blackboard-protocol.mjs";
import {
  appendAgentEvent,
  createTask,
  listLeadWakeups,
  registerLead,
  stateRoot,
} from "../plugins/agent-blackboard/server/blackboard-core.mjs";

const REPO = process.cwd();

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "blackboard-protocol-test-"));
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "protocol-test@example.invalid"]);
  git(repo, ["config", "user.name", "Protocol Test"]);
  await writeFile(join(repo, "README.md"), "blackboard protocol test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "--quiet", "-m", "initial"]);
  git(repo, ["branch", "blackboard-worktree"]);
  const worktree = join(root, "worktree");
  git(repo, ["worktree", "add", "--quiet", worktree, "blackboard-worktree"]);
  return { root, repo, worktree };
}

async function removeRepo(fixture) {
  await rm(fixture.root, { recursive: true, force: true });
}

test("lifecycle checkpoints classify every role state into one phase", () => {
  for (const [role, map] of Object.entries(ROLE_CHECKPOINTS)) {
    for (const [name, states] of Object.entries(map)) {
      assert.ok(Array.isArray(states) && states.length > 0, `${role} ${name} must have at least one state`);
      for (const state of states) {
        const checkpoint = map[name].includes(state) ? name : null;
        assert.ok(checkpoint, `${role}.${name} must contain ${state}`);
      }
    }
  }
  assert.deepEqual(ROLE_CHECKPOINTS.executor.handoff, ["ready_for_review"]);
  assert.deepEqual(ROLE_CHECKPOINTS.reviewer.handoff.sort(), ["changes_requested", "ready_for_acceptance"].sort());
  assert.deepEqual(ROLE_CHECKPOINTS.researcher.handoff, ["completed"]);
});

test("validateAgentUpdate refuses placeholder activity and short facts", () => {
  for (const [role, workingState] of [["researcher", "working"], ["executor", "working"], ["reviewer", "reviewing"]]) {
    for (const placeholder of ["ok", "done", "still working", "no update", "..."]) {
      assert.throws(
        () => validateAgentUpdate(role, null, { state: workingState, activity: placeholder, next: "continue implementation" }),
        /(heartbeat|at least 8 characters)/,
        `${role} must reject placeholder activity "${placeholder}"`,
      );
    }
  }
  assert.throws(
    () => validateAgentUpdate("executor", null, { state: "working", activity: "x", next: "ship it" }),
    /activity must be at least 8 characters/,
  );
  assert.throws(
    () => validateAgentUpdate("executor", null, { state: "working", activity: "starting slice now", next: "go" }),
    /next must be 4-500 characters/,
  );
});

test("validateAgentUpdate requires blocker for blocked and changes_requested", () => {
  assert.throws(
    () => validateAgentUpdate("executor", null, { state: "blocked", activity: "downstream API failing" }),
    /requires a non-empty blocker/,
  );
  assert.throws(
    () => validateAgentUpdate("reviewer", null, { state: "changes_requested", activity: "missing test for X" }),
    /requires a non-empty blocker/,
  );
  const accepted = validateAgentUpdate("executor", null, { state: "blocked", activity: "downstream API failing", blocker: "Service returns 500 for /events", next: "raise service ticket" });
  assert.equal(accepted.checkpoint, "blocked");
});

test("validateAgentUpdate requires next for every non-terminal state except the handoff set", () => {
  const needsNext = [
    ["executor", "working", "starting slice"],
    ["executor", "waiting", "awaiting review feedback"],
    ["reviewer", "reviewing", "scanning diff for scope"],
    ["researcher", "working", "reading ADR 0005"],
  ];
  for (const [role, state, activity] of needsNext) {
    assert.throws(
      () => validateAgentUpdate(role, null, { state, activity, next: undefined }),
      /requires a non-empty next action/,
      `${role} ${state} must require next`,
    );
  }
  const exempt = [
    ["researcher", "completed"],
    ["reviewer", "ready_for_acceptance"],
    ["executor", "ready_for_review"],
    ["reviewer", "changes_requested"],
  ];
  for (const [role, state] of exempt) {
    const input = { state, activity: "triage finished and accepted" };
    if (state === "changes_requested") input.blocker = "test for blocker field is missing";
    const accepted = validateAgentUpdate(role, null, input);
    assert.equal(accepted.state, state);
  }
});

test("validateAgentUpdate rejects repeating the previous event verbatim", () => {
  const previous = { sequence: 1, state: "working", activity: "starting slice" };
  assert.throws(
    () => validateAgentUpdate("executor", previous, { state: "working", activity: "starting slice", next: "ship it now" }),
    /repeats the previous/,
  );
  const accepted = validateAgentUpdate("executor", previous, { state: "working", activity: "mid-slice progress", next: "continue tests" });
  assert.equal(accepted.previous_sequence, 1);
});

test("validateAgentUpdate refuses non-checkpoint states per role", () => {
  assert.throws(
    () => validateAgentUpdate("executor", null, { state: "ready_for_acceptance", activity: "wrong state for executor" }),
    /not a Blackboard lifecycle checkpoint/,
  );
  assert.throws(
    () => validateAgentUpdate("researcher", null, { state: "ready_for_review", activity: "wrong state for researcher" }),
    /not a Blackboard lifecycle checkpoint/,
  );
});

test("validateAgentUpdate refuses blockers on non-blocking states", () => {
  assert.throws(
    () => validateAgentUpdate("executor", null, { state: "working", activity: "starting slice now", next: "ship it", blocker: "should not be here" }),
    /must not include a blocker/,
  );
});

test("createLifecycleGate blocks the first substantive tool call and resets on publish", () => {
  const gate = createLifecycleGate();
  const first = gate.evaluate({ toolName: "read" });
  assert.equal(first.block, true);
  assert.match(first.reason, /first substantive tool call/);
  assert.equal(gate.bypasses, 1);
  gate.markPublished();
  assert.equal(gate.published, true);
  assert.equal(gate.sinceUpdate, 0);
  const second = gate.evaluate({ toolName: "read" });
  assert.equal(second.block, false);
});

test("createLifecycleGate ignores the blackboard_update tool itself", () => {
  const gate = createLifecycleGate();
  const result = gate.evaluate({ toolName: "blackboard_update" });
  assert.equal(result.block, false);
  assert.equal(gate.sinceUpdate, 0);
  assert.equal(gate.published, false);
});

test("createLifecycleGate fires after maxToolCallsBetweenUpdates and fails open after maxBypasses", () => {
  const gate = createLifecycleGate({ maxToolCallsBetweenUpdates: 3, maxBypasses: 2 });
  gate.markPublished();
  let firstBlock = null;
  for (let i = 0; i < 3; i += 1) {
    const r = gate.evaluate({ toolName: "read" });
    if (r.block) { firstBlock = r; break; }
  }
  assert.ok(firstBlock, "the gate must block after the configured number of tool calls");
  assert.equal(gate.bypasses, 1);
  for (let i = 0; i < 3; i += 1) gate.evaluate({ toolName: "read" });
  assert.equal(gate.bypasses, 2);
  const open = gate.evaluate({ toolName: "read" });
  assert.equal(open.block, false);
  assert.equal(open.opened, true);
  const history = gate.history;
  assert.ok(history.some((entry) => entry.at === "open"));
});

test("createLifecycleGate resets consecutive bypasses after a successful publish", () => {
  const gate = createLifecycleGate({ maxToolCallsBetweenUpdates: 1, maxBypasses: 2 });
  assert.equal(gate.evaluate({ toolName: "read" }).block, true);
  assert.equal(gate.evaluate({ toolName: "read" }).block, true);
  assert.equal(gate.bypasses, 2);
  gate.markPublished();
  assert.equal(gate.bypasses, 0);
  assert.equal(gate.evaluate({ toolName: "read" }).block, true);
  assert.equal(gate.bypasses, 1);
  assert.equal(gate.evaluate({ toolName: "read" }).block, true);
  assert.equal(gate.bypasses, 2);
  assert.equal(gate.evaluate({ toolName: "read" }).opened, true);
});

test("end-to-end: Lead observes blocked and completion states through the Agent event log", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-PROC-1", name: "Protocol task", description: "Verify Lead can observe blocked and completion states." });
    await registerLead(fixture.repo, "BB-PROC-1", { thread_id: "lead-proc", host_id: "local" });
    const executor = { task_id: "BB-PROC-1", role: "executor", agent_id: "executor-proc", worktree: fixture.worktree };
    const reviewer = { task_id: "BB-PROC-1", role: "reviewer", agent_id: "reviewer-proc", worktree: fixture.worktree };
    const researcher = { task_id: "BB-PROC-1", role: "researcher", agent_id: "researcher-proc", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, executor, { state: "working", activity: "started slice on protocol module", next: "add semantic validation" });
    await appendAgentEvent(fixture.repo, executor, { state: "blocked", activity: "downstream API failing", blocker: "Service returns 500 for /events", next: "raise service ticket" });
    await appendAgentEvent(fixture.repo, reviewer, { state: "reviewing", activity: "scanning diff for scope", next: "publish review verdict" });
    await appendAgentEvent(fixture.repo, reviewer, { state: "ready_for_acceptance", activity: "protocol module passes new tests" });
    await appendAgentEvent(fixture.repo, researcher, { state: "working", activity: "verifying prior art for protocol", next: "ship result to executor" });
    await appendAgentEvent(fixture.repo, researcher, { state: "completed", activity: "researcher handed back bounded evidence" });
    const wakeups = await listLeadWakeups(fixture.repo, "BB-PROC-1");
    const states = wakeups.wakeups.map((w) => w.state);
    assert.ok(states.includes("blocked"), "Lead must observe the executor blocked wakeup");
    assert.ok(states.includes("ready_for_acceptance"), "Lead must observe the reviewer ready_for_acceptance wakeup");
    assert.ok(states.includes("completed"), "Lead must observe the researcher completed wakeup");
  } finally {
    await removeRepo(fixture);
  }
});

test("Blackboard protocol does not grant task control, acceptance, or peer transport authority", async () => {
  // The protocol module is the only Blackboard-side surface the Agent
  // extension adds. It must not import any intercom, supervisor, or
  // acceptance code path; the existing ADR 0005 rule that the Blackboard
  // is observation-only is preserved as a structural property.
  const text = await readFile(join(REPO, ".pi/communication/blackboard-protocol.mjs"), "utf8");
  // Mention in a comment is fine; an import or execution path is not.
  assert.doesNotMatch(text, /from\s+["'][^"']*pi_team_intercom["']/);
  assert.doesNotMatch(text, /import\s+["'][^"']*contact_supervisor["']/);
  assert.doesNotMatch(text, /\bacceptTask\s*\(|\breconcileTask\s*\(|\barchiveTask\s*\(|\bcloseIncompleteTask\s*\(/);
  const ext = await readFile(join(REPO, ".pi/communication/extensions/blackboard-update.ts"), "utf8");
  assert.doesNotMatch(ext, /import\s+["'][^"']*pi_team_intercom["']|import\s+["'][^"']*contact_supervisor["']/);
  assert.match(ext, /blackboard-protocol\.mjs/);
});

test("role prompts document the lifecycle checkpoints and field semantics", async () => {
  for (const role of ["researcher", "executor", "reviewer"]) {
    const text = await readFile(join(REPO, ".pi/agents", `${role}.md`), "utf8");
    assert.match(text, /blackboard_update/, `${role} prompt must mention blackboard_update`);
    assert.match(text, /`blocker` is required/, `${role} prompt must require blocker for blocked`);
    assert.match(text, /`next` is required/, `${role} prompt must require next for non-terminal states`);
    assert.match(text, /20 substantive tool calls/, `${role} prompt must describe the bounded gate threshold`);
  }
});

test("role skills document the Blackboard protocol", async () => {
  const skills = [
    ["execute-delegated-task", "publish task status and request a Lead wakeup"],
    ["review-delegated-task", "enforces a Reviewer-side Blackboard protocol"],
    ["answer-research-question", "enforces a Researcher-side Blackboard protocol"],
  ];
  for (const [name, marker] of skills) {
    const text = await readFile(join(REPO, ".pi/skills", name, "SKILL.md"), "utf8");
    assert.match(text, /blocker/, `${name} skill must require blocker for blocked/changes_requested`);
    assert.match(text, new RegExp(marker), `${name} skill must mention the protocol marker`);
  }
});

test("ADR 0008 codifies the lifecycle checkpoints, field semantics, and bounded gate", async () => {
  const text = await readFile(join(REPO, "ADR/0008-agent-blackboard-update-protocol.md"), "utf8");
  assert.match(text, /Lifecycle checkpoints per role/);
  assert.match(text, /Field semantics/);
  assert.match(text, /Bounded lifecycle gate/);
  assert.match(text, /never grants task control, completion authority, or peer/);
  assert.match(text, /fails\s+\*open\*/);
});

test("readPreviousEvent returns the most recent same-role event from the Blackboard store", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-PROC-2", name: "Read-previous task", description: "Read previous event from store." });
    const identity = { task_id: "BB-PROC-2", role: "executor", agent_id: "executor-rp", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, identity, { state: "working", activity: "starting slice on protocol", next: "add semantic validation" });
    await appendAgentEvent(fixture.repo, identity, { state: "working", activity: "mid-slice progress on protocol", next: "wire extension" });
    const root = stateRoot(fixture.repo);
    const previous = await readPreviousEvent(root, "BB-PROC-2", "executor");
    assert.equal(previous.activity, "mid-slice progress on protocol");
    assert.equal(previous.sequence, 2);
  } finally {
    await removeRepo(fixture);
  }
});

test("readPreviousEvent returns the role's own previous event even when another role published a more recent event", async () => {
  const fixture = await makeRepo();
  try {
    await createTask(fixture.repo, { task_id: "BB-PROC-3", name: "Cross-role previous task", description: "Read previous same-role event across an interleaved other-role event." });
    const executor = { task_id: "BB-PROC-3", role: "executor", agent_id: "executor-xr", worktree: fixture.worktree };
    const reviewer = { task_id: "BB-PROC-3", role: "reviewer", agent_id: "reviewer-xr", worktree: fixture.worktree };
    await appendAgentEvent(fixture.repo, executor, { state: "working", activity: "executor started slice on protocol", next: "add semantic validation" });
    // A different role publishes after the executor's event; this is the
    // normal multi-role flow (e.g. Reviewer publishes reviewing/changes_requested
    // while the Executor waits for FIX_READY).
    await appendAgentEvent(fixture.repo, reviewer, { state: "reviewing", activity: "reviewer scanning diff for scope", next: "publish review verdict" });
    const root = stateRoot(fixture.repo);
    const previous = await readPreviousEvent(root, "BB-PROC-3", "executor");
    assert.ok(previous, "readPreviousEvent must still find the executor's own previous event");
    assert.equal(previous.role, "executor");
    assert.equal(previous.activity, "executor started slice on protocol");
    assert.equal(previous.sequence, 1);
  } finally {
    await removeRepo(fixture);
  }
});

test("protocol testing helpers expose the heartbeat and field requirement sets", () => {
  assert.ok(protocolTesting.ACTIVITY_HEARTBEAT_PATTERN.has("ok"));
  assert.ok(protocolTesting.ACTIVITY_HEARTBEAT_PATTERN.has("still working"));
  assert.ok(protocolTesting.BLOCKER_REQUIRED_STATES.has("blocked"));
  assert.ok(protocolTesting.BLOCKER_REQUIRED_STATES.has("changes_requested"));
  assert.ok(protocolTesting.NEXT_EXEMPT_STATES.has("completed"));
  assert.ok(protocolTesting.NEXT_EXEMPT_STATES.has("ready_for_acceptance"));
  assert.equal(protocolTesting.describeCheckpoint("executor", "ready_for_review"), "handoff");
  assert.equal(protocolTesting.describeCheckpoint("executor", "ready_for_acceptance"), null);
  assert.equal(protocolTesting.DEFAULT_LIFECYCLE_GATE.maxToolCallsBetweenUpdates, 20);
  assert.equal(protocolTesting.DEFAULT_LIFECYCLE_GATE.maxBypasses, 2);
});
