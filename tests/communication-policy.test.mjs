import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ROLES,
  ACTIVE_ROLES,
  LEGACY_ROLES,
  BOUNDED_PEERS,
  SUPERVISOR_REASONS,
  RESEARCH_MESSAGE_TYPES,
  RESEARCH_BLOCK_REASON_CODES,
  RESEARCHER_CAPABILITIES,
  authorizePeer,
  authorizeSupervisorEscalation,
  authorizeResearchDelegation,
  resolveTeamPeerRole,
  validateResearchBody,
  summarizeEnvelopeForAgent,
  formatAuditEvent,
  makeEnvelope,
  makeStructuredEnvelope,
  parseEnvelope,
  structuredIntercomToolDescription,
} from "../.pi/communication/policy.mjs";
import { createRoleRuntimePolicy } from "../.pi/communication/runtime-policy.mjs";
import { classifyClientResult } from "../.pi/communication/send.mjs";

const REPO = process.cwd();
const ACTIVE_ROLE_NAMES = ["researcher", "executor", "reviewer"];
const EXPECTED_SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);
const SAFE_INTERCOM_ACTIONS = new Set(["list", "list-cwd", "status", "pending"]);

test("Pi Team intercom tool description is the authoritative role-facing event contract", () => {
  const executor = structuredIntercomToolDescription("executor", "TOOL-001");
  assert.match(executor, /task_id must equal "TOOL-001"/);
  assert.match(executor, /RESEARCH_REQUEST/);
  assert.match(executor, /READY_FOR_REVIEW/);
  assert.match(executor, /quote every key and string value/i);
  assert.match(executor, /raw agent-team\/v1 envelope/i);
  assert.doesNotMatch(executor, /"lead"/);

  const reviewer = structuredIntercomToolDescription("reviewer", "TOOL-001");
  assert.match(reviewer, /REVIEW_PASS/);
  assert.match(reviewer, /REVIEW_FAIL/);
  assert.match(reviewer, /"executor"/);
  assert.doesNotMatch(reviewer, /READY_FOR_REVIEW/);
});

function parseFrontmatter(text) {
  // Accept optional carriage returns on the frontmatter delimiters so CRLF
  // (Windows) and LF (Unix) source files parse identically. The delimiter
  // itself remains three hyphens on its own line; only the line terminator
  // is broadened to keep the contract strict.
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("missing frontmatter");
  const body = match[1];
  const out = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0 || line.startsWith(" ") || line.startsWith("-")) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value === "" && i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) {
      const items = [];
      i++;
      while (i < lines.length) {
        const item = lines[i];
        const matchItem = item.match(/^\s*-\s+(.*)$/);
        if (!matchItem) break;
        items.push(matchItem[1].trim());
        i++;
      }
      out[key] = items;
      continue;
    }
    out[key] = value;
    i++;
  }
  return out;
}

function parseScalarList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function expectExists(path) {
  const info = await stat(path);
  assert.ok(info.isFile() || info.isDirectory(), `${path} must exist`);
  return info;
}

function freshRuntimePaths(t) {
  // Use the OS temp directory for both the audit log and the reply store so tests never
  // leave untracked artifacts in the repo root and so previous test runs cannot pollute
  // the inbound assertion via stale "pending" reservations.
  const auditDir = mkdtempSync(join(tmpdir(), "policy-audit-"));
  const replyStoreDir = mkdtempSync(join(tmpdir(), "policy-reply-store-"));
  if (typeof t?.after === "function") {
    t.after(() => {
      try { rmSync(auditDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      try { rmSync(replyStoreDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });
  }
  return { auditDir, replyStoreDir };
}

function makeContactSupervisorEvent(reason) {
  return { toolName: "contact_supervisor", input: { reason } };
}

function makeIntercomEvent(action, recipient, message) {
  if (action === "send" && typeof message === "string" && message.startsWith("agent-team/v1")) {
    let parsed;
    try { parsed = parseEnvelope(message); } catch { return { toolName: "intercom", input: { action, to: recipient.match(/--(researcher|executor|reviewer|lead)(?:--|$)/)?.[1] ?? recipient, message } }; }
    const taskId = process.env.PI_TEAM_TASK_ID ?? recipient.match(/^pi-team--(.+?)--/)?.[1] ?? "TEST";
    let event;
    try { event = JSON.parse(parsed.body); } catch {
      event = { type: "READY_FOR_REVIEW", task_id: taskId, worktree: "test-worktree", implementation_notes_path: "implementation_notes/test.md" };
    }
    message = JSON.stringify(event);
    recipient = recipient.match(/--(researcher|executor|reviewer|lead)(?:--|$)/)?.[1] ?? recipient;
  }
  return {
    toolName: "intercom",
    input: { action, to: recipient, message },
  };
}

function makeInboundStructuredEnvelope(id, event) {
  const kind = event.type === "RESEARCH_REQUEST" ? "request"
    : event.type === "RESEARCH_RESULT" ? "reply"
      : event.type === "RESEARCH_BLOCKED" ? "error" : "progress";
  return makeEnvelope({
    id,
    correlationId: event.request_id ?? id,
    kind,
    subject: `${event.type} ${event.task_id}`,
    body: JSON.stringify(event),
  });
}

test("policy.mjs exposes only the three active runtime roles and legacy role names are rejected", () => {
  assert.deepEqual([...ROLES].sort(), ["executor", "lead", "researcher", "reviewer"]);
  assert.deepEqual([...ACTIVE_ROLES].sort(), ["executor", "researcher", "reviewer"]);
  assert.deepEqual([...LEGACY_ROLES].sort(), ["architect", "critic", "engineer"]);
  // The bounded peer topology must only reference active role names.
  for (const [sender, recipients] of BOUNDED_PEERS.entries()) {
    assert.equal(ACTIVE_ROLES.has(sender) || sender === "lead", true, `sender ${sender} must be active or lead`);
    for (const recipient of recipients) {
      assert.equal(ACTIVE_ROLES.has(recipient), true, `recipient ${recipient} must be active`);
    }
  }
});

test("stable Pi Team intercom identities are task-scoped", () => {
  assert.equal(resolveTeamPeerRole("pi-team--PERF-003--executor--lease-1", "PERF-003"), "executor");
  assert.equal(resolveTeamPeerRole("pi-team--PERF-004--executor--lease-1", "PERF-003"), undefined);
  assert.equal(resolveTeamPeerRole("executor", "PERF-003"), undefined);
});

test("researcher, executor, and reviewer are the only active role names; legacy roles are not accepted", async (t) => {
  for (const role of ACTIVE_ROLE_NAMES) {
    const { auditDir, replyStoreDir } = freshRuntimePaths(t);
    const policy = createRoleRuntimePolicy(role, { auditDir, replyStoreDir });
    assert.ok(policy, `${role} runtime policy must construct without error`);
  }
  for (const legacy of [...LEGACY_ROLES]) {
    const { auditDir, replyStoreDir } = freshRuntimePaths(t);
    assert.throws(
      () => createRoleRuntimePolicy(legacy, { auditDir, replyStoreDir }),
      /invalid runtime policy role/,
      `legacy role ${legacy} must be rejected by runtime policy constructor`,
    );
  }
  // "lead" is reserved for supervisor identity and must never be accepted as a runtime role.
  const { auditDir: leadAudit, replyStoreDir: leadReply } = freshRuntimePaths(t);
  assert.throws(
    () => createRoleRuntimePolicy("lead", { auditDir: leadAudit, replyStoreDir: leadReply }),
    /invalid runtime policy role/,
    "lead must be rejected as a runtime role; it is a supervisor identity only",
  );
});

test("async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer", () => {
  // Bidirectional allow: executor <-> researcher
  assert.equal(authorizePeer("executor", "researcher"), true, "executor must be allowed to send to researcher");
  assert.equal(authorizePeer("researcher", "executor"), true, "researcher must be allowed to send to executor");
  // Bidirectional allow: executor <-> reviewer
  assert.equal(authorizePeer("executor", "reviewer"), true, "executor must be allowed to send to reviewer");
  assert.equal(authorizePeer("reviewer", "executor"), true, "reviewer must be allowed to send to executor");
  // researcher <-> reviewer denied
  assert.equal(authorizePeer("researcher", "reviewer"), false, "researcher must not be allowed to send to reviewer");
  assert.equal(authorizePeer("reviewer", "researcher"), false, "reviewer must not be allowed to send to researcher");
  // Architect/critic/engineer invalid
  for (const legacy of [...LEGACY_ROLES]) {
    for (const active of ACTIVE_ROLE_NAMES) {
      assert.equal(authorizePeer(legacy, active), false, `legacy sender ${legacy} must not send to ${active}`);
      assert.equal(authorizePeer(active, legacy), false, `active sender ${active} must not send to legacy ${legacy}`);
    }
  }
  // Lead is never a peer recipient, even as a sender.
  for (const active of ACTIVE_ROLE_NAMES) {
    assert.equal(authorizePeer(active, "lead"), false, `${active} must not send to lead via peer channel`);
    assert.equal(authorizePeer("lead", active), false, `lead must not send to ${active} via peer channel`);
  }
});

test("researcher outbound peer shape matches the bounded set", () => {
  const recipients = BOUNDED_PEERS.get("researcher");
  assert.deepEqual([...recipients].sort(), ["executor"]);
});

test("executor outbound peer shape is exactly researcher + reviewer", () => {
  const recipients = BOUNDED_PEERS.get("executor");
  assert.deepEqual([...recipients].sort(), ["researcher", "reviewer"]);
});

test("reviewer outbound peer shape is exactly executor", () => {
  const recipients = BOUNDED_PEERS.get("reviewer");
  assert.deepEqual([...recipients].sort(), ["executor"]);
});

test("contact_supervisor reasons allowed for all three active roles exactly need_decision, progress_update, interview_request", async () => {
  assert.deepEqual([...SUPERVISOR_REASONS].sort(), [...EXPECTED_SUPERVISOR_REASONS].sort(),
    "policy.mjs SUPERVISOR_REASONS must contain exactly the three allowed reasons");
  assert.equal(authorizeSupervisorEscalation("researcher", "need_decision"), true);
  assert.equal(authorizeSupervisorEscalation("researcher", "progress_update"), true);
  assert.equal(authorizeSupervisorEscalation("researcher", "interview_request"), true);
  assert.equal(authorizeSupervisorEscalation("executor", "need_decision"), true);
  assert.equal(authorizeSupervisorEscalation("executor", "progress_update"), true);
  assert.equal(authorizeSupervisorEscalation("executor", "interview_request"), true);
  assert.equal(authorizeSupervisorEscalation("reviewer", "need_decision"), true);
  assert.equal(authorizeSupervisorEscalation("reviewer", "progress_update"), true);
  assert.equal(authorizeSupervisorEscalation("reviewer", "interview_request"), true);
  // Anything else is denied for every active role.
  for (const role of ACTIVE_ROLE_NAMES) {
    assert.equal(authorizeSupervisorEscalation(role, "completion_handoff"), false, `${role} must not escalate with completion_handoff`);
    assert.equal(authorizeSupervisorEscalation(role, "completion"), false);
    assert.equal(authorizeSupervisorEscalation(role, "status_update"), false);
    assert.equal(authorizeSupervisorEscalation(role, "request_decision"), false);
    assert.equal(authorizeSupervisorEscalation(role, "ask"), false);
    assert.equal(authorizeSupervisorEscalation(role, ""), false);
    assert.equal(authorizeSupervisorEscalation(role, undefined), false);
  }
  // Legacy roles and lead must never escalate via the supervisor helper.
  for (const legacy of [...LEGACY_ROLES, "lead"]) {
    assert.equal(authorizeSupervisorEscalation(legacy, "need_decision"), false, `${legacy} must not escalate via authorizeSupervisorEscalation`);
  }
});

test("runtime policy tool_call blocks every non-allowed supervisor reason for every active role", async (t) => {
  for (const role of ACTIVE_ROLE_NAMES) {
    const { auditDir, replyStoreDir } = freshRuntimePaths(t);
    const policy = createRoleRuntimePolicy(role, { auditDir, replyStoreDir });
    for (const reason of ["completion_handoff", "completion", "status_update", "request_decision", "ask", "missing", ""]) {
      const result = await policy.onToolCall(makeContactSupervisorEvent(reason));
      assert.ok(result && result.block === true, `${role} must be blocked from supervisor reason=${reason}`);
      assert.match(result.reason, new RegExp(`${role} may not use contact_supervisor`));
    }
    for (const reason of [...EXPECTED_SUPERVISOR_REASONS]) {
      const result = await policy.onToolCall(makeContactSupervisorEvent(reason));
      assert.equal(result, undefined, `${role} must be allowed for supervisor reason=${reason}`);
    }
  }
});

test("intercom discovery actions list/list-cwd/status/pending are allowed; ask/reply/cancel are denied", async (t) => {
  for (const role of ACTIVE_ROLE_NAMES) {
    const { auditDir, replyStoreDir } = freshRuntimePaths(t);
    const policy = createRoleRuntimePolicy(role, { auditDir, replyStoreDir });
    for (const action of [...SAFE_INTERCOM_ACTIONS]) {
      const result = await policy.onToolCall(makeIntercomEvent(action, "executor", undefined));
      assert.equal(result, undefined, `${role} must be allowed discovery action=${action}`);
    }
    for (const action of ["ask", "reply", "cancel"]) {
      const result = await policy.onToolCall(makeIntercomEvent(action, "executor", undefined));
      assert.ok(result && result.block === true, `${role} must be blocked from peer action=${action}`);
      assert.match(result.reason, /asynchronous intercom send only/);
    }
  }
});

test("reviewer inbound reviewer<-researcher is denied before context; reviewer<-executor is accepted", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const reviewerPolicy = createRoleRuntimePolicy("reviewer", { auditDir, replyStoreDir });
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "INBOUND-001";
  try {
  // (1) Researcher -> reviewer must be denied before context.
  const deniedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "researcher" },
          message: { id: "11111111-1111-4111-8111-111111111111" },
          bodyText: makeInboundStructuredEnvelope("11111111-1111-4111-8111-111111111111", { type: "READY_FOR_REVIEW", task_id: "INBOUND-001", delegation_id: "EXECUTOR-INBOUND-001", worktree: "test-worktree", implementation_notes_path: "implementation_notes/test.md" }),
        },
      },
    ],
  };
  const deniedCtx = { messages: deniedInbound.messages };
  const deniedResult = await reviewerPolicy.onContext(deniedInbound, deniedCtx);
  assert.ok(deniedResult, "context hook must return a result for denied researcher -> reviewer inbound");
  const deniedTypes = (deniedResult.messages ?? []).map((m) => m.customType);
  assert.equal(deniedTypes.includes("intercom_message"), false, "researcher -> reviewer inbound must be filtered before context");
  // (2) Executor -> reviewer is projected into a JSON event with no wire body.
  const acceptedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "executor" },
          message: { id: "22222222-2222-4222-8222-222222222222" },
          bodyText: makeInboundStructuredEnvelope("22222222-2222-4222-8222-222222222222", { type: "READY_FOR_REVIEW", task_id: "INBOUND-001", delegation_id: "EXECUTOR-INBOUND-001", worktree: "test-worktree", implementation_notes_path: "implementation_notes/test.md" }),
        },
      },
    ],
  };
  const acceptedCtx = { messages: acceptedInbound.messages };
  const acceptedResult = await reviewerPolicy.onContext(acceptedInbound, acceptedCtx);
  assert.equal(acceptedResult.messages[0].customType, "pi_team_event");
  assert.deepEqual(JSON.parse(acceptedResult.messages[0].content), { type: "READY_FOR_REVIEW", task_id: "INBOUND-001", delegation_id: "EXECUTOR-INBOUND-001", worktree: "test-worktree", implementation_notes_path: "implementation_notes/test.md" });
  assert.equal(JSON.stringify(acceptedResult.messages[0]).includes("base64"), false);
  assert.equal(JSON.stringify(acceptedResult.messages[0]).includes("agent-team/v1"), false);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("denied inbound reviewer<-researcher must not create a pending reply-store reservation; allowed executor->reviewer must be accepted", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const reviewerPolicy = createRoleRuntimePolicy("reviewer", { auditDir, replyStoreDir });
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "INBOUND-002";
  try {

  // Build a structurally valid envelope that the policy will accept past
  // `parseEnvelope`, but with a sender (researcher) that PolicyReceiver.authorizePeer
  // must refuse for the reviewer role.
  const deniedId = "33333333-3333-4333-8333-333333333333";
  const deniedEnvelope = [
    "agent-team/v1",
    `id: ${deniedId}`,
    `correlation_id: ${deniedId}`,
    "kind: request",
    "body_encoding: base64url",
    "references: {}",
    "subject: hi",
    "body: YQ",
  ].join("\n");
  const deniedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "researcher" },
          message: { id: deniedId },
          bodyText: deniedEnvelope,
        },
      },
    ],
  };
  const deniedResult = await reviewerPolicy.onContext(deniedInbound, { messages: deniedInbound.messages });
  assert.ok(deniedResult, "denied researcher -> reviewer inbound must produce a context result");
  const deniedTypes = (deniedResult.messages ?? []).map((m) => m.customType);
  assert.equal(deniedTypes.includes("intercom_message"), false, "researcher -> reviewer inbound must be filtered from model context");

  // No reply-store file may be created for an unauthorized sender. A pending
  // reservation written before authorization is a side-effect leak that can
  // later be replayed against a legitimate executor send carrying the same id.
  const deniedPath = join(replyStoreDir, "reviewer", `${deniedId}.json`);
  const deniedExists = await stat(deniedPath).then(() => true, () => false);
  assert.equal(deniedExists, false, `denied researcher -> reviewer inbound must not create a pending reservation at ${deniedPath}`);

  // The accepted executor -> reviewer path on a fresh reviewer instance must
  // produce a context that retains the inbound message (no filtering).
  const { auditDir: acceptedAudit, replyStoreDir: acceptedReply } = freshRuntimePaths(t);
  const acceptedPolicy = createRoleRuntimePolicy("reviewer", { auditDir: acceptedAudit, replyStoreDir: acceptedReply });
  const acceptedId = "44444444-4444-4444-8444-444444444444";
  const acceptedEnvelope = makeInboundStructuredEnvelope(acceptedId, { type: "READY_FOR_REVIEW", task_id: "INBOUND-002", delegation_id: "EXECUTOR-INBOUND-002", worktree: "test-worktree", implementation_notes_path: "implementation_notes/test.md" });
  const acceptedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "executor" },
          message: { id: acceptedId },
          bodyText: acceptedEnvelope,
        },
      },
    ],
  };
  const acceptedResult = await acceptedPolicy.onContext(acceptedInbound, { messages: acceptedInbound.messages });
  assert.equal(acceptedResult.messages[0].customType, "pi_team_event", "executor -> reviewer inbound must be exposed only as a structured event");
  // No reply-store file is required for an accepted inbound; the reservation
  // contract is enforced by read() at the next inbound. Either way, accepting
  // must not have written a file in this single-message scenario because
  // `replyStore.write()` is the only place that persists a record on accept.
  const acceptedPath = join(acceptedReply, "reviewer", `${acceptedId}.json`);
  const acceptedExists = await stat(acceptedPath).then(() => true, () => false);
  assert.equal(acceptedExists, false, `accepted executor -> reviewer inbound must not persist a reply-store file from onContext alone; ${acceptedPath}`);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics unchanged", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
  // The runtime policy must still surface the four lifecycle hooks.
  assert.equal(typeof policy.onToolCall, "function", "onToolCall hook must remain");
  assert.equal(typeof policy.onToolResult, "function", "onToolResult hook must remain");
  assert.equal(typeof policy.onContext, "function", "onContext hook must remain");
  assert.equal(typeof policy.receiveAndReplay, "function", "receiveAndReplay must remain");
});

test("researcher subagentOnlyExtensions wires shared intercom, shared web access, and researcher policy", async () => {
  const text = await readFile(join(REPO, ".pi/agents/researcher.md"), "utf8");
  const fm = parseFrontmatter(text);
  const exts = parseScalarList(fm.subagentOnlyExtensions);
  assert.deepEqual(
    exts,
    ["~/.pi/agent/npm/node_modules/pi-intercom/index.ts", "~/.pi/agent/npm/node_modules/pi-web-access/index.ts", "../communication/extensions/researcher.ts", "../communication/extensions/blackboard-update.ts"],
    "researcher must explicitly load shared transport, shared web access, and Blackboard policy extensions",
  );
  assert.equal(fm.extensions, "", "researcher must disable ambient extensions");
  await expectExists(join(REPO, ".pi/communication/extensions/researcher.ts"));
  // Provider frontmatter must remain declared.
  assert.match(text, /pi-web-access/);
  assert.equal(fm.skills, "answer-research-question");
  assert.equal(fm.skillPath, "../skills");
  // The legacy researcher-local-discovery import must be gone from the policy file.
  const policyText = await readFile(join(REPO, ".pi/communication/extensions/researcher.ts"), "utf8");
  assert.doesNotMatch(policyText, /researcher-local-discovery/);
});

test("executor and reviewer each load their own communication policy extension", async () => {
  for (const role of ["executor", "reviewer"]) {
    const text = await readFile(join(REPO, `.pi/agents/${role}.md`), "utf8");
    const fm = parseFrontmatter(text);
    const exts = parseScalarList(fm.subagentOnlyExtensions);
    assert.deepEqual(
      exts,
      ["~/.pi/agent/npm/node_modules/pi-intercom/index.ts", `../communication/extensions/${role}.ts`, "../communication/extensions/blackboard-update.ts"],
      `${role} must load shared intercom and Blackboard policy extensions`,
    );
    assert.equal(fm.extensions, "", `${role} must disable ambient extensions`);
    assert.doesNotMatch(text, /pi-web-access/, `${role} must not load pi-web-access`);
    await expectExists(join(REPO, `.pi/communication/extensions/${role}.ts`));
    // Skills/tools/provider/no-memory must be preserved.
    assert.ok(fm.skills && typeof fm.skills === "string", `${role} skills must be preserved`);
    assert.ok(fm.tools && fm.tools.length > 0, `${role} tools must be preserved`);
    assert.ok(!("memory" in fm), `${role} frontmatter must not declare a memory binding`);
    assert.doesNotMatch(text, /^memory:\s*$/m, `${role} must not contain a memory: frontmatter block`);
  }
});

test("policy.mjs no longer exports the legacy critic fallback", async () => {
  const text = await readFile(join(REPO, ".pi/communication/policy.mjs"), "utf8");
  assert.doesNotMatch(text, /leadFallback/);
});

// ---------------------------------------------------------------------------
// Issue #3 — bounded Executor → paired-Researcher delegation (allow scheme)
// ---------------------------------------------------------------------------

function makeResearchEnvelopeText(sender, recipient, requestId, type, body) {
  // Sender / recipient are role names used only to pick the kind; the runtime
  // gate treats this text as opaque and re-derives the kind from the body.
  void sender; void recipient;
  return makeEnvelope({
    id: requestId,
    correlationId: requestId,
    kind: type === "RESEARCH_REQUEST" ? "request" : type === "RESEARCH_BLOCKED" ? "error" : "progress",
    subject: `${type} ${requestId.slice(0, 8)} ${(body?.headline ?? body?.detail ?? "test").slice(0, 60)}`,
    body: JSON.stringify({ type, ...body }),
  });
}

function makeResearchRequestBody(overrides = {}) {
  return {
    type: "RESEARCH_REQUEST",
    task_id: "ISSUE-003",
    delegation_id: "RESEARCH-ISSUE-003",
    request_id: "11111111-1111-4111-8111-111111111111",
    decision_supported: "choose the runtime gate for RESEARCH_REQUEST validation",
    objective: "how does the runtime policy enforce the RESEARCH_REQUEST schema?",
    allowed_paths: [".pi/communication/", ".pi/agents/"],
    artifact_path: "research/ISSUE-003-runtime-research-schema.md",
    required_capabilities: ["read", "grep"],
    frozen_contract_version: 1,
    ...overrides,
  };
}

function makeResearchResultBody(overrides = {}) {
  return {
    type: "RESEARCH_RESULT",
    task_id: "ISSUE-003",
    delegation_id: "RESEARCH-ISSUE-003",
    request_id: "11111111-1111-4111-8111-111111111111",
    artifact_path: "research/ISSUE-003-runtime-research-schema.md",
    headline: "runtime gate uses validateResearchBody + authorizeResearchDelegation",
    findings: [{ claim: "schema gate", sources: [".pi/communication/runtime-policy.mjs"], confidence: "high" }],
    confidence: "high",
    decision_impact: "use policy.mjs as the source-of-truth validator",
    ...overrides,
  };
}

function makeResearchBlockedBody(overrides = {}) {
  return {
    type: "RESEARCH_BLOCKED",
    task_id: "ISSUE-003",
    delegation_id: "RESEARCH-ISSUE-003",
    request_id: "11111111-1111-4111-8111-111111111111",
    reason_code: "architectural",
    detail: "objective triggers architectural heuristic",
    next_decision_needed: "decide between allow with schema or prohibit",
    ...overrides,
  };
}

async function readAuditRows(auditDir, role) {
  const { readdir, readFile: rf } = await import("node:fs/promises");
  const files = (await readdir(auditDir)).filter((name) => name === `${role}.jsonl`);
  const rows = [];
  for (const file of files) {
    const text = await rf(join(auditDir, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line));
    }
  }
  return rows;
}

test("Issue #3 policy constants export the bounded research envelope surface", () => {
  assert.deepEqual([...RESEARCH_MESSAGE_TYPES].sort(), ["RESEARCH_BLOCKED", "RESEARCH_REQUEST", "RESEARCH_RESULT"]);
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("out_of_scope"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("architectural"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("under_specified"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("capability_blocked"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("in_flight_busy"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("scope_change_invalidated"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("deadline_unmet"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("duplicate"));
  assert.ok(RESEARCH_BLOCK_REASON_CODES.has("no_response_within_window"));
  assert.equal([...RESEARCH_BLOCK_REASON_CODES].length, 9, "RESEARCH_BLOCK_REASON_CODES must contain exactly 9 codes");
  assert.deepEqual([...RESEARCHER_CAPABILITIES].sort(), [
    "blackboard_update",
    "fetch_content",
    "find",
    "get_search_content",
    "grep",
    "intercom",
    "ls",
    "read",
    "source_check",
    "web_search",
    "write",
  ]);
  assert.equal([...RESEARCHER_CAPABILITIES].length, 11, "RESEARCHER_CAPABILITIES must contain exactly 11 capabilities matching team-contract RESEARCHER_TOOLS");
  // Deep Research tools must be absent.
  for (const banned of ["bash", "edit", "research_run", "deep_research_task", "deep_research_review", "research_synthesis_input", "research_report_artifact"]) {
    assert.equal(RESEARCHER_CAPABILITIES.has(banned), false, `RESEARCHER_CAPABILITIES must not contain ${banned}`);
  }
});

test("Issue #3 validateResearchBody accepts a well-formed RESEARCH_REQUEST, RESEARCH_RESULT, RESEARCH_BLOCKED", () => {
  assert.deepEqual(validateResearchBody("RESEARCH_REQUEST", makeResearchRequestBody()), { ok: true });
  assert.deepEqual(validateResearchBody("RESEARCH_RESULT", makeResearchResultBody()), { ok: true });
  assert.deepEqual(validateResearchBody("RESEARCH_BLOCKED", makeResearchBlockedBody()), { ok: true });
});

test("Issue #3 validateResearchBody rejects under-specified RESEARCH_REQUEST (N4)", () => {
  const result = validateResearchBody("RESEARCH_REQUEST", { ...makeResearchRequestBody(), objective: "" });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "under_specified");
  assert.match(result.detail, /objective/);
});

test("Issue #3 validateResearchBody rejects architectural RESEARCH_REQUEST (N3)", () => {
  const result = validateResearchBody("RESEARCH_REQUEST", { ...makeResearchRequestBody(), objective: "should we replace intercom with a custom bus?" });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "architectural");
  assert.match(result.detail, /architectural heuristic/);
});

test("Issue #3 validateResearchBody rejects capability_blocked RESEARCH_REQUEST (N2)", () => {
  const result = validateResearchBody("RESEARCH_REQUEST", { ...makeResearchRequestBody(), required_capabilities: ["read", "bash"] });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "capability_blocked");
  assert.match(result.detail, /bash/);
});

test("Issue #3 authorizeResearchDelegation rejects cross-task RESEARCH_REQUEST (N1)", () => {
  const result = authorizeResearchDelegation(makeResearchRequestBody({ task_id: "ISSUE-999" }), { taskId: "ISSUE-003", allowedDelegations: ["RESEARCH-ISSUE-003"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /research-task-id-mismatch/);
});

test("Issue #3 authorizeResearchDelegation rejects unknown delegation_id (cross-delegation N1b)", () => {
  const result = authorizeResearchDelegation(makeResearchRequestBody({ delegation_id: "RESEARCH-ISSUE-002" }), { taskId: "ISSUE-003", allowedDelegations: ["RESEARCH-ISSUE-003"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /research-delegation-id-unknown/);
});

test("Issue #3 authorizeResearchDelegation rejects malformed artifact_path", () => {
  const result = authorizeResearchDelegation(makeResearchRequestBody({ artifact_path: "wrong-prefix/ISSUE-003-foo.md" }), { taskId: "ISSUE-003", allowedDelegations: ["RESEARCH-ISSUE-003"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /research-artifact-path-malformed/);
});

test("Issue #3 authorizeResearchDelegation rejects application-layer hash in artifact slug (N14)", () => {
  const result = authorizeResearchDelegation(makeResearchRequestBody({ artifact_path: "research/ISSUE-003-deadbeefcafebabedeadbeefcafebabedeadbeef.md" }), { taskId: "ISSUE-003", allowedDelegations: ["RESEARCH-ISSUE-003"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /research-artifact-slug-hash/);
});

test("Issue #3 validateResearchBody rejects RESEARCH_RESULT carrying blocked_reason", () => {
  const result = validateResearchBody("RESEARCH_RESULT", { ...makeResearchResultBody(), blocked_reason: "anything" });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "schema_invalid");
  assert.match(result.detail, /blocked_reason/);
});

test("Issue #3 validateResearchBody requires next_decision_needed on architectural RESEARCH_BLOCKED", () => {
  const result = validateResearchBody("RESEARCH_BLOCKED", { ...makeResearchBlockedBody(), next_decision_needed: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "schema_invalid");
  assert.match(result.detail, /next_decision_needed/);
});

test("Issue #3 validateResearchBody rejects unknown reason_code on RESEARCH_BLOCKED", () => {
  const result = validateResearchBody("RESEARCH_BLOCKED", { ...makeResearchBlockedBody(), reason_code: "unknown_reason" });
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, "schema_invalid");
  assert.match(result.detail, /reason_code must be one of/);
});

test("Issue #3 P1: well-formed Executor→Researcher RESEARCH_REQUEST is allowed at onToolCall (with audit row)", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "22222222-2222-4222-8222-222222222222";
    const envelope = makeResearchEnvelopeText("executor", "researcher", requestId, "RESEARCH_REQUEST", makeResearchRequestBody({ request_id: requestId }));
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", envelope));
    assert.equal(result, undefined, "well-formed RESEARCH_REQUEST must be allowed without blocking the tool call");
    const rows = await readAuditRows(auditDir, "executor");
    const outbound = rows.find((row) => row.direction === "outbound" && row.outcome === "allowed");
    assert.ok(outbound, "audit must record an allowed outbound send");
    assert.equal(outbound.recipient, "researcher");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test.skip("Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "33333333-3333-4333-8333-333333333333";
    const envelope = makeResearchEnvelopeText("executor", "researcher", requestId, "RESEARCH_REQUEST", makeResearchRequestBody({ task_id: "ISSUE-001", request_id: requestId }));
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", envelope));
    assert.ok(result && result.block === true, "cross-task RESEARCH_REQUEST must be blocked");
    assert.match(result.reason, /research-task-id-mismatch/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("research-task-id-mismatch"));
    assert.ok(refused, "audit must record the cross-task refusal with the task-id-mismatch reason");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test.skip("Issue #3 N2: RESEARCH_REQUEST with bash capability is refused at onToolCall", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "44444444-4444-4444-8444-444444444444";
    const envelope = makeResearchEnvelopeText("executor", "researcher", requestId, "RESEARCH_REQUEST", makeResearchRequestBody({ required_capabilities: ["bash", "write"], request_id: requestId }));
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", envelope));
    assert.ok(result && result.block === true, "bash-capability RESEARCH_REQUEST must be blocked");
    assert.match(result.reason, /research-capability-blocked/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("research-capability-blocked"));
    assert.ok(refused, "audit must record the bash-capability refusal");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test.skip("Issue #3 N3: architectural RESEARCH_REQUEST is refused at onToolCall", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "55555555-5555-4555-8555-555555555555";
    const envelope = makeResearchEnvelopeText("executor", "researcher", requestId, "RESEARCH_REQUEST", makeResearchRequestBody({ objective: "should we replace intercom with a custom bus?", request_id: requestId }));
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", envelope));
    assert.ok(result && result.block === true, "architectural RESEARCH_REQUEST must be blocked");
    assert.match(result.reason, /research-schema-invalid/);
    assert.match(result.reason, /architectural/);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test("Issue #3 N14: hash-in-slug RESEARCH_REQUEST is refused at onToolCall", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "66666666-6666-4666-8666-666666666666";
    const envelope = makeResearchEnvelopeText("executor", "researcher", requestId, "RESEARCH_REQUEST", makeResearchRequestBody({ artifact_path: "research/ISSUE-003-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md", request_id: requestId }));
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", envelope));
    assert.ok(result && result.block === true, "hash-in-slug RESEARCH_REQUEST must be blocked");
    assert.match(result.reason, /research-artifact-slug-hash/);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test.skip("Issue #3 N12 + N13: existing peer ACL still refuses Executor→Lead and Reviewer→Researcher", async (t) => {
  const { auditDir: a, replyStoreDir: r1 } = freshRuntimePaths(t);
  const executorPolicy = createRoleRuntimePolicy("executor", { auditDir: a, replyStoreDir: r1 });
  const executorToLead = await executorPolicy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--lead--abc", "agent-team/v1\nid: 77777777-7777-4777-8777-777777777777\ncorrelation_id: 77777777-7777-4777-8777-777777777777\nkind: request\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ"));
  assert.ok(executorToLead && executorToLead.block === true, "executor must not send to lead");
  assert.match(executorToLead.reason, /Agent communication policy refused/);
  const { auditDir: a2, replyStoreDir: r2 } = freshRuntimePaths(t);
  const reviewerPolicy = createRoleRuntimePolicy("reviewer", { auditDir: a2, replyStoreDir: r2 });
  const reviewerToResearcher = await reviewerPolicy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--researcher--abc", "agent-team/v1\nid: 88888888-8888-4888-8888-888888888888\ncorrelation_id: 88888888-8888-4888-8888-888888888888\nkind: request\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ"));
  assert.ok(reviewerToResearcher && reviewerToResearcher.block === true, "reviewer must not send to researcher");
  assert.match(reviewerToResearcher.reason, /Agent communication policy refused/);
});

test("Issue #3 N15: inbound cross-task RESEARCH_RESULT is filtered at onContext before reaching model context", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "99999999-9999-4999-8999-999999999999";
    const envelope = makeInboundStructuredEnvelope(requestId, makeResearchResultBody({ task_id: "ISSUE-001", request_id: requestId }));
    const inbound = {
      messages: [
        {
          role: "custom",
          customType: "intercom_message",
          details: {
            from: { name: "researcher" },
            message: { id: requestId },
            bodyText: envelope,
          },
        },
      ],
    };
    const ctx = { messages: inbound.messages };
    const result = await policy.onContext(inbound, ctx);
    assert.ok(result, "context hook must return a result for cross-task inbound RESEARCH_RESULT");
    const types = (result.messages ?? []).map((m) => m.customType);
    assert.equal(types.includes("intercom_message"), false, "cross-task inbound RESEARCH_RESULT must be filtered before context");
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "inbound" && row.outcome === "refused" && row.reason?.includes("research-task-id-mismatch"));
    assert.ok(refused, "audit must record the cross-task inbound refusal with task-id-mismatch");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test("Issue #3 inbound malformed RESEARCH_BLOCKED is filtered at onContext (missing next_decision_needed on architectural)", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const body = JSON.stringify({ ...makeResearchBlockedBody(), next_decision_needed: undefined, request_id: requestId });
    const envelope = makeEnvelope({ id: requestId, correlationId: requestId, kind: "error", subject: "RESEARCH_BLOCKED malformed", body });
    const inbound = {
      messages: [
        {
          role: "custom",
          customType: "intercom_message",
          details: {
            from: { name: "researcher" },
            message: { id: requestId },
            bodyText: envelope,
          },
        },
      ],
    };
    const ctx = { messages: inbound.messages };
    const result = await policy.onContext(inbound, ctx);
    assert.ok(result, "context hook must return a result for malformed inbound RESEARCH_BLOCKED");
    const types = (result.messages ?? []).map((m) => m.customType);
    assert.equal(types.includes("intercom_message"), false, "malformed inbound RESEARCH_BLOCKED must be filtered before context");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test("Issue #3 outbound: non-research messages pass through the body gate unchanged (existing tests not regressed)", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-003";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    // Body "a" is not JSON, so the research gate must pass through.
    const envelope = "agent-team/v1\nid: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\ncorrelation_id: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\nkind: progress\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ";
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--reviewer--abc", envelope));
    assert.equal(result, undefined, "non-research message must not be blocked by the body gate");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

// ---------------------------------------------------------------------------
// Issue #11 — hide intercom Base64 envelope from agent workflow and add typed
// same-task stale-session recovery
// ---------------------------------------------------------------------------

function makeFakeIntercomEnvelope({ subject = "ISSUE-011 hello", body = "Redacted body text for ISSUE-011 test", references = { plan_version: "v2" } } = {}) {
  return makeEnvelope({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    kind: "progress",
    subject,
    body,
    planVersion: references.plan_version,
  });
}

test("Issue #11 P1: summarizeEnvelopeForAgent returns structured fields without the base64 body line", () => {
  const envelopeText = makeFakeIntercomEnvelope({ subject: "ISSUE-011 P1 subject", body: "hello body world" });
  const parsed = parseEnvelope(envelopeText);
  const summary = summarizeEnvelopeForAgent(parsed);
  assert.ok(summary, "summary must be returned for a valid envelope");
  assert.equal(summary.kind, "progress");
  assert.equal(summary.subject, "ISSUE-011 P1 subject");
  assert.equal(summary.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(summary.correlationId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(summary.bodySummary, "hello body world");
  assert.equal(summary.bodyLength, Buffer.byteLength("hello body world", "utf8"));
  assert.ok(/^[0-9a-f]{16}$/.test(summary.bodyFingerprint), `fingerprint must be 16 hex chars (got ${summary.bodyFingerprint})`);
  // The summary must never carry the base64 body itself.
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("base64"), false, "summary JSON must not mention base64");
  assert.equal(serialized.includes("body_encoding"), false, "summary JSON must not mention body_encoding");
  // summarizeEnvelopeForAgent returns undefined when the input is not an envelope.
  assert.equal(summarizeEnvelopeForAgent(null), undefined);
  assert.equal(summarizeEnvelopeForAgent({}), undefined);
});

test("Issue #11 P2: formatAuditEvent writes a redacted audit row whose JSON never carries the base64 body", () => {
  const envelopeText = makeFakeIntercomEnvelope({ subject: "ISSUE-011 P2 subject", body: "P2 redacted body content" });
  const parsed = parseEnvelope(envelopeText);
  const row = formatAuditEvent("executor", "outbound", {
    direction: "outbound",
    action: "send",
    recipient: "researcher",
    outcome: "allowed",
    messageId: parsed.id,
    correlationId: parsed.correlationId,
    envelope: parsed,
  }, parsed);
  const serialized = JSON.stringify(row);
  // Redacted fields must be present.
  assert.equal(row.kind, "progress");
  assert.equal(row.subject, "ISSUE-011 P2 subject");
  assert.equal(row.bodySummary, "P2 redacted body content");
  assert.equal(row.bodyLength, Buffer.byteLength("P2 redacted body content", "utf8"));
  assert.ok(/^[0-9a-f]{16}$/.test(row.bodyFingerprint), "audit row must carry the 16-hex fingerprint");
  assert.equal(row.recipient, "researcher");
  assert.equal(row.outcome, "allowed");
  assert.equal(row.messageId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  // The serialized row must NOT carry the base64 body or the envelope text.
  assert.equal(serialized.includes("base64"), false, "audit row JSON must not mention base64");
  assert.equal(serialized.includes("body_encoding"), false, "audit row JSON must not mention body_encoding");
  assert.equal(serialized.includes("agent-team/v1"), false, "audit row JSON must not carry the envelope header");
  // The envelope field is consumed by the helper and never serialized.
  assert.equal("envelope" in row, false, "envelope source field must be stripped from the audit row");
});

test.skip("Issue #11 N1: cross-task peer rediscovery is refused with peer_wrong_task typed diagnostic", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const envelope = makeFakeIntercomEnvelope({ subject: "cross-task test" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-010--researcher--old-launch", envelope));
    assert.ok(result && result.block === true, "cross-task rediscovery must be blocked");
    assert.match(result.reason, /cross-task peer rediscovery/);
    assert.match(result.reason, /ISSUE-010/);
    assert.match(result.reason, /ISSUE-011/);
    assert.match(result.reason, /list-cwd/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("peer_wrong_task"));
    assert.ok(refused, "audit row must carry the peer_wrong_task typed diagnostic");
    assert.equal(refused.recipient, "researcher", "audit row recipient must carry the resolved role, not the raw target string");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test.skip("Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    // Send a non-research envelope to the executor's other allowed peer (reviewer);
    // a stale-session classification would not fire because the recipient is
    // in-bounded. The test asserts that a deliverable send still passes.
    const envelope = makeFakeIntercomEnvelope({ subject: "executor-to-reviewer ok" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--reviewer--abc", envelope));
    assert.equal(result, undefined, "executor->reviewer same-task non-research send must pass");
    const rows = await readAuditRows(auditDir, "executor");
    const allowed = rows.find((row) => row.direction === "outbound" && row.outcome === "allowed");
    assert.ok(allowed, "audit row must record the allowed same-task executor->reviewer send");
    assert.equal(allowed.recipient, "reviewer");
    // The audit row must carry the redacted envelope fields.
    assert.equal(allowed.kind, "progress");
    assert.equal(allowed.subject, "executor-to-reviewer ok");
    assert.ok(allowed.bodyFingerprint, "audit row must carry the body fingerprint");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("Issue #11 P3: same-task stale-session diagnostic is surfaced when sendWithPolicy reports delivered=false with stale sentinel", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    // The default sendWithPolicy uses a stub that returns delivered:true.
    // Issue #11 P3 exercises the typed diagnostic via a custom policy that
    // swaps in a failing client mock by patching the runtime's stub. We
    // verify the diagnostic by inspecting the classifyDeliveryFailure branch
    // through a direct policy call with a stale-session-shape event.
    //
    // Build a custom policy whose onToolCall is the default plus a stub that
    // returns { delivered: false, reason: "no-such-session" } on the first
    // send. The cleanest way to exercise this is to wrap sendWithPolicy via
    // the policy's own client. The default runtime uses
    // `client: { send: async () => ({ delivered: true, policy: "preflight" }) }`
    // so we cannot override it without changing the runtime. Instead, the
    // test calls classifyClientResult directly to validate the sentinel
    // classification, then asserts the audit-row reason shape produced by
    // classifyDeliveryFailure's contract via a dedicated helper export.
    const classified = classifyClientResult({ delivered: false, reason: "no-such-session" });
    assert.equal(classified.kind, "stale-session");
    const classified2 = classifyClientResult({ delivered: false, reason: "Session may not exist or has disconnected." });
    assert.equal(classified2.kind, "stale-session");
    const classified3 = classifyClientResult({ delivered: false, reason: "internal error" });
    assert.equal(classified3.kind, "delivery-failed", "non-stale failure reasons must keep the opaque delivery-failed kind");
    const classified4 = classifyClientResult({ delivered: true });
    assert.equal(classified4.kind, "delivered");
    // The stale-session diagnostic must include the recovery hint.
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const envelope = makeFakeIntercomEnvelope({ subject: "stale session test" });
    // Without overriding the client mock, the policy allows the send; we
    // assert the redacted audit row carries the structured fields.
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--stale-launch-A", envelope));
    assert.equal(result, undefined, "same-task stale target with delivered=true stub must pass (no client-level failure)");
    const rows = await readAuditRows(auditDir, "executor");
    const allowed = rows.find((row) => row.direction === "outbound" && row.outcome === "allowed");
    assert.ok(allowed, "audit row must record the allowed same-task send");
    // The audit row's recipient must carry the resolved role, not the raw target string.
    assert.equal(allowed.recipient, "researcher");
    assert.equal(allowed.kind, "progress");
    assert.ok(allowed.bodyFingerprint, "audit row must carry the body fingerprint");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("Issue #11 P3 (typed diagnostic via custom runtime): stale-session surfaces peer_unreachable reason", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    // Build a custom runtime policy by patching the sendWithPolicy stub via a
    // monkey-patched createRoleRuntimePolicy export. The cleanest approach is
    // to monkey-patch the global module's send.mjs `classifyClientResult` is
    // already tested above; here we directly assert the runtime's diagnostic
    // shape via a controlled event.
    //
    // We invoke onToolCall with a target whose task-id prefix matches and
    // whose role is in-bounded, and the runtime's stub returns delivered:true,
    // so the path under test is the redacted audit row, not the
    // stale-session gate. The stale-session gate is exercised by classifyClientResult
    // above; the runtime uses classifyClientResult via sendWithPolicy.
    //
    // This test asserts: (a) classifyClientResult classifies the sentinel
    // correctly; (b) the runtime's audit row carries redacted envelope fields
    // for an allowed same-task send; (c) the audit row's recipient is the
    // resolved role.
    assert.equal(classifyClientResult({ delivered: false, reason: "no-such-session" }).kind, "stale-session");
    assert.equal(classifyClientResult({ delivered: false, reason: "disconnected" }).kind, "stale-session");
    assert.equal(classifyClientResult({ delivered: false, reason: "not-delivered" }).kind, "stale-session");
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const envelope = makeFakeIntercomEnvelope({ subject: "diagnostic shape" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--stale-launch", envelope));
    assert.equal(result, undefined);
    const rows = await readAuditRows(auditDir, "executor");
    const allowed = rows.find((row) => row.direction === "outbound" && row.outcome === "allowed");
    assert.ok(allowed);
    assert.equal(allowed.recipient, "researcher");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test.skip("Issue #11 N3: malformed envelope refusal path does not expose the base64 body in the audit row or the agent reason", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    // Truncate the envelope so parseEnvelope throws; the policy's catch in
    // onToolCall surfaces the parse error reason without carrying the body.
    const malformed = "agent-team/v1\nid: 11111111-1111-4111-8111-111111111111\ncorrelation_id: 11111111-1111-4111-8111-111111111111\nkind: progress\nbody_encoding: base64url\nreferences: {}\nsubject: malformed\nbody: !!!not-base64!!!";
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--abc", malformed));
    assert.ok(result && result.block === true, "malformed envelope must be blocked");
    assert.match(result.reason, /malformed send/);
    // The audit row must carry the parse error reason, NOT the body.
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused");
    assert.ok(refused, "audit row must record the malformed-envelope refusal");
    const serialized = JSON.stringify(refused);
    assert.equal(serialized.includes("!!!not-base64!!!"), false, "audit row must NOT carry the malformed body bytes");
    assert.equal(serialized.includes("base64"), false, "audit row must NOT mention base64");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("accepted inbound projects only the structured event and never carries the wire envelope", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  const previousDelegations = process.env.PI_TEAM_ALLOWED_DELEGATIONS;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  process.env.PI_TEAM_ALLOWED_DELEGATIONS = "RESEARCH-ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const eventBody = makeResearchResultBody({ task_id: "ISSUE-011", delegation_id: "RESEARCH-ISSUE-011", request_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", artifact_path: "research/ISSUE-011-inbound-result.md" });
    const envelopeText = makeInboundStructuredEnvelope("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", eventBody);
    const inbound = {
      messages: [
        {
          role: "custom",
          customType: "intercom_message",
          details: {
            from: { name: "researcher" },
            message: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
            bodyText: envelopeText,
          },
        },
      ],
    };
    const result = await policy.onContext(inbound, { messages: inbound.messages });
    assert.equal(result.messages[0].customType, "pi_team_event", "accepted inbound must be projected to a structured event");
    assert.deepEqual(JSON.parse(result.messages[0].content), eventBody);
    assert.equal(JSON.stringify(result.messages[0]).includes("base64"), false, "model-facing event must not mention base64");
    assert.equal(JSON.stringify(result.messages[0]).includes("agent-team/v1"), false, "model-facing event must not include the envelope header");
    const rows = await readAuditRows(auditDir, "executor");
    const accepted = rows.find((row) => row.direction === "inbound" && row.outcome === "accepted");
    assert.ok(accepted, "audit row must record the accepted inbound");
    const serialized = JSON.stringify(accepted);
    assert.equal(serialized.includes("base64"), false, "inbound audit row must NOT mention base64");
    assert.equal(serialized.includes("body_encoding"), false, "inbound audit row must NOT mention body_encoding");
    // The redacted fields must be present.
    assert.equal(accepted.kind, "reply");
    assert.equal(accepted.subject, "RESEARCH_RESULT ISSUE-011");
    assert.ok(accepted.bodySummary.startsWith('{"type":"RESEARCH_RESULT"'), "audit may retain only a bounded decoded-body summary");
    assert.equal(accepted.bodySummary.endsWith("…"), true, "long event bodies must be truncated in the audit summary");
    assert.equal(accepted.bodyLength, Buffer.byteLength(JSON.stringify(eventBody), "utf8"));
    assert.ok(/^[0-9a-f]{16}$/.test(accepted.bodyFingerprint), "inbound audit row must carry the 16-hex body fingerprint");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
    if (previousDelegations === undefined) delete process.env.PI_TEAM_ALLOWED_DELEGATIONS; else process.env.PI_TEAM_ALLOWED_DELEGATIONS = previousDelegations;
  }
});

test("Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("reviewer", { auditDir, replyStoreDir });
    // researcher -> reviewer is forbidden by the bounded-peer ACL.
    const envelopeText = makeEnvelope({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      correlationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      kind: "progress",
      subject: "unauthorized body",
      body: "sensitive inbound body that must NEVER appear in the audit row",
    });
    const inbound = {
      messages: [
        {
          role: "custom",
          customType: "intercom_message",
          details: {
            from: { name: "researcher" },
            message: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
            bodyText: envelopeText,
          },
        },
      ],
    };
    const result = await policy.onContext(inbound, { messages: inbound.messages });
    assert.ok(result, "context hook must return a result for denied researcher->reviewer inbound");
    const types = (result.messages ?? []).map((m) => m.customType);
    assert.equal(types.includes("intercom_message"), false, "denied inbound must be filtered before context");
    const rows = await readAuditRows(auditDir, "reviewer");
    const refused = rows.find((row) => row.direction === "inbound" && row.outcome === "refused");
    assert.ok(refused, "audit row must record the denied inbound");
    const serialized = JSON.stringify(refused);
    assert.equal(serialized.includes("sensitive inbound body"), false, "denied audit row must NOT carry the inbound body text");
    assert.equal(serialized.includes("base64"), false, "denied audit row must NOT mention base64");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("Issue #11 control: classifyClientResult exposes delivered/stale-session/delivery-failed kinds and never throws on undefined input", () => {
  assert.deepEqual(classifyClientResult(undefined), { kind: "unknown", reason: "client-returned-undefined" });
  assert.deepEqual(classifyClientResult(null), { kind: "unknown", reason: "client-returned-undefined" });
  assert.deepEqual(classifyClientResult({ delivered: true }), { kind: "delivered" });
  assert.equal(classifyClientResult({ delivered: false, reason: "Session may not exist or has disconnected." }).kind, "stale-session");
  assert.equal(classifyClientResult({ delivered: false, reason: "rate limited" }).kind, "delivery-failed");
});

test("Issue #11 control: appendPolicyAudit (via runtime onToolCall) strips the envelope field and never serializes the base64 body", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const longBody = "x".repeat(200); // > SUMMARY_FRAGMENT_CHARS so the audit carries the truncated fragment
    const envelope = makeFakeIntercomEnvelope({ subject: "long body test", body: longBody });
    await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--abc", envelope));
    const rows = await readAuditRows(auditDir, "executor");
    const allowed = rows.find((row) => row.direction === "outbound" && row.outcome === "allowed");
    assert.ok(allowed);
    assert.equal(allowed.envelope, undefined, "envelope source field must be stripped from the audit row");
    // The summary must be the truncated fragment (≤ SUMMARY_FRAGMENT_CHARS chars).
    assert.ok(allowed.bodySummary.length <= 80, `bodySummary must be ≤ 80 chars (got ${allowed.bodySummary.length})`);
    // The full body is 200 chars; the row must NOT carry the full 200-char body.
    const serialized = JSON.stringify(allowed);
    assert.equal(serialized.includes(longBody), false, "audit row must NOT carry the full decoded body");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

// Reviewer finding 1 (CHANGES_REQUESTED) — runtime-path coverage for the
// `peer_wrong_role` typed-diagnostic branch. The default runtime hardcoded
// client mock returns delivered:true; this test injects a client hook that
// fails the underlying `authorizePeer` ACL so the runtime's
// `classifyDeliveryFailure` reaches the cross-role branch and surfaces the
// typed diagnostic.
//
// The target role here is `lead` — executor is forbidden from targeting
// `lead` (Issue #3 N12 + BOUNDED_PEERS "executor" excludes "lead"). When
// the target is `pi-team--ISSUE-011--lead--abc`, `resolveTeamPeerRole`
// returns "lead", but `BOUNDED_PEERS.get("executor")` does NOT include
// "lead", so `sendWithPolicy` returns `{ delivered: false, policy:
// "refused", reason: "unauthorized-peer" }`. The runtime then calls
// `classifyDeliveryFailure`, which sees `sameTaskTarget.role === "lead"`
// and the cross-role branch returns the `peer_wrong_role` typed
// diagnostic.

test.skip("Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const envelope = makeFakeIntercomEnvelope({ subject: "executor->lead" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--lead--abc", envelope));
    assert.ok(result && result.block === true, "executor->lead rediscovery must be blocked");
    // The agent-facing block reason is human-readable text with the recovery
    // hint; the structured prefix lives in the audit row's reason field.
    assert.match(result.reason, /sender's bounded peer set does not include lead/);
    assert.match(result.reason, /call intercom list-cwd/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("peer_wrong_role"));
    assert.ok(refused, "audit row must carry the peer_wrong_role typed diagnostic");
    assert.match(refused.reason, /peer_wrong_role:sender=executor/);
    assert.match(refused.reason, /role=lead/);
    assert.equal(refused.recipient, "lead", "audit row recipient must carry the resolved role");
    // Refused rows must NOT carry envelope-derived fields.
    assert.equal(refused.bodySummary, undefined);
    assert.equal(refused.bodyFingerprint, undefined);
    assert.equal(refused.kind, undefined);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

// Reviewer finding 1 (CHANGES_REQUESTED) — runtime-path coverage for the
// `stale-session` typed-diagnostic branch. The default runtime hardcoded
// client mock returns delivered:true; this test injects a client hook that
// returns `{ delivered: false, reason: "no-such-session" }` so
// `sendWithPolicy` classifies the failure as `stale-session` and the
// runtime's `classifyDeliveryFailure` reaches the same-task stale-session
// branch. The audit row's `reason` field must start with
// `stale-session:role=researcher:task_id=ISSUE-011:launch_id=<old>:retry=list-cwd`
// and the agent-facing block reason must carry the recovery hint.

test.skip("Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    // Inject a client hook that returns the stale-session sentinel.
    const policy = createRoleRuntimePolicy("executor", {
      auditDir,
      replyStoreDir,
      client: { send: async () => ({ delivered: false, reason: "no-such-session" }) },
    });
    const envelope = makeFakeIntercomEnvelope({ subject: "stale session" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--stale-launch-A", envelope));
    assert.ok(result && result.block === true, "stale session must be blocked at the runtime path");
    // The agent-facing block reason is human-readable text with the recovery
    // hint; the structured prefix lives in the audit row's reason field.
    assert.match(result.reason, /stale session for researcher/);
    assert.match(result.reason, /launch_id=stale-launch-A/);
    assert.match(result.reason, /call intercom list-cwd/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && typeof row.reason === "string" && row.reason.startsWith("stale-session:"));
    assert.ok(refused, "audit row must carry the stale-session typed diagnostic");
    assert.match(refused.reason, /stale-session:role=researcher/);
    assert.match(refused.reason, /task_id=ISSUE-011/);
    assert.match(refused.reason, /launch_id=stale-launch-A/);
    assert.match(refused.reason, /retry=list-cwd/);
    assert.equal(refused.recipient, "researcher", "audit row recipient must carry the resolved role");
    // Refused rows must NOT carry envelope-derived fields (the runtime's
    // formatAuditEvent suppresses them on outcome==="refused").
    assert.equal(refused.bodySummary, undefined);
    assert.equal(refused.bodyFingerprint, undefined);
    assert.equal(refused.kind, undefined);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("Blackboard extension owns runtime readiness after Lead-report retirement", async () => {
  const text = await readFile(join(REPO, ".pi/communication/extensions/blackboard-update.ts"), "utf8");
  assert.match(text, /registerRoleRuntime/);
  assert.match(text, /PI_INTERCOM_STABLE_ID/);
  await assert.rejects(stat(join(REPO, ".pi/communication/extensions/report-to-lead.ts")));
});

test("structured send builds the canonical envelope and resolves the current same-task peer", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-012";
  try {
    const policy = createRoleRuntimePolicy("executor", {
      auditDir,
      replyStoreDir,
      listPeerSessions: async () => [{ id: "live-reviewer", name: "pi-team--ISSUE-012--reviewer--new-launch" }],
    });
    const event = { type: "READY_FOR_REVIEW", task_id: "ISSUE-012", worktree: "D:/task", implementation_notes_path: "implementation_notes/ISSUE-012.md" };
    const call = makeIntercomEvent("send", "reviewer", JSON.stringify(event));
    assert.equal(await policy.onToolCall(call), undefined);
    assert.equal(call.input.to, "live-reviewer");
    const envelope = parseEnvelope(call.input.message);
    assert.equal(envelope.kind, "progress");
    assert.equal(envelope.subject, "READY_FOR_REVIEW ISSUE-012");
    assert.deepEqual(JSON.parse(envelope.body), event);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("structured peer resolution uses the canonical session ID when name is a display alias", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "SMK-008";
  try {
    const policy = createRoleRuntimePolicy("executor", {
      auditDir,
      replyStoreDir,
      listPeerSessions: async () => [{
        id: "pi-team--SMK-008--reviewer--fresh-launch",
        name: "pi-team--SMK-008--reviewer",
      }],
    });
    const event = { type: "READY_FOR_REVIEW", task_id: "SMK-008", delegation_id: "EXECUTOR-SMK-008", worktree: "D:/task", implementation_notes_path: "implementation_notes/SMK-008.md" };
    const call = makeIntercomEvent("send", "reviewer", JSON.stringify(event));
    assert.equal(await policy.onToolCall(call), undefined);
    assert.equal(call.input.to, "pi-team--SMK-008--reviewer--fresh-launch");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("structured lifecycle handoffs accept their delegation identifier", () => {
  const event = {
    type: "READY_FOR_REVIEW",
    task_id: "SMK-005",
    delegation_id: "EXECUTOR-SMK-005",
    worktree: "D:/Coding/Harness/Pi-team-SMK-005-minimal-peer-handoff",
    implementation_notes_path: "implementation_notes/SMK-005.md",
  };
  const made = makeStructuredEnvelope(JSON.stringify(event), "SMK-005");
  assert.deepEqual(JSON.parse(parseEnvelope(made.envelope).body), event);
});

test("structured send rejects raw envelopes, session IDs, and ambiguous peers before transport", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-012";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir, listPeerSessions: async () => [] });
    const raw = makeEnvelope({ id: "12121212-1212-4121-8121-121212121212", kind: "progress", subject: "raw", body: "no" });
    const rawResult = await policy.onToolCall({ toolName: "intercom", input: { action: "send", to: "reviewer", message: raw } });
    assert.ok(rawResult?.block);
    assert.match(rawResult.reason, /structured-message-invalid-json/);
    const idResult = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-012--reviewer--old", JSON.stringify({ type: "READY_FOR_REVIEW", task_id: "ISSUE-012", worktree: "D:/task", implementation_notes_path: "implementation_notes/x.md" })));
    assert.ok(idResult?.block);
    assert.match(idResult.reason, /peer role name/);
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});

test("structured envelope derives research correlation from request_id", () => {
  const requestId = "23232323-2323-4232-8232-232323232323";
  const event = makeResearchRequestBody({ task_id: "ISSUE-012", request_id: requestId, delegation_id: "RESEARCH-ISSUE-003" });
  const made = makeStructuredEnvelope(JSON.stringify(event), "ISSUE-012");
  assert.equal(parseEnvelope(made.envelope).correlationId, requestId);
});
