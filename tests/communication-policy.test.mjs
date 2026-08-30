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
  makeEnvelope,
  parseEnvelope,
} from "../.pi/communication/policy.mjs";
import { createRoleRuntimePolicy } from "../.pi/communication/runtime-policy.mjs";

const REPO = process.cwd();
const ACTIVE_ROLE_NAMES = ["researcher", "executor", "reviewer"];
const EXPECTED_SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);
const SAFE_INTERCOM_ACTIONS = new Set(["list", "list-cwd", "status", "pending"]);

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
  return {
    toolName: "intercom",
    input: { action, to: recipient, message },
  };
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
  // (1) Researcher -> reviewer must be denied before context.
  const deniedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "researcher" },
          message: { id: "11111111-1111-4111-8111-111111111111" },
          bodyText: "agent-team/v1\nid: 11111111-1111-4111-8111-111111111111\ncorrelation_id: 11111111-1111-4111-8111-111111111111\nkind: request\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ",
        },
      },
    ],
  };
  const deniedCtx = { messages: deniedInbound.messages };
  const deniedResult = await reviewerPolicy.onContext(deniedInbound, deniedCtx);
  assert.ok(deniedResult, "context hook must return a result for denied researcher -> reviewer inbound");
  const deniedTypes = (deniedResult.messages ?? []).map((m) => m.customType);
  assert.equal(deniedTypes.includes("intercom_message"), false, "researcher -> reviewer inbound must be filtered before context");
  // (2) Executor -> reviewer must be accepted: onContext returns undefined when no message is filtered.
  const acceptedInbound = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "executor" },
          message: { id: "22222222-2222-4222-8222-222222222222" },
          bodyText: "agent-team/v1\nid: 22222222-2222-4222-8222-222222222222\ncorrelation_id: 22222222-2222-4222-8222-222222222222\nkind: progress\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ",
        },
      },
    ],
  };
  const acceptedCtx = { messages: acceptedInbound.messages };
  const acceptedResult = await reviewerPolicy.onContext(acceptedInbound, acceptedCtx);
  assert.equal(acceptedResult, undefined, "executor -> reviewer inbound must be accepted (no filtering); onContext returns undefined when no message is removed");
});

test("denied inbound reviewer<-researcher must not create a pending reply-store reservation; allowed executor->reviewer must be accepted", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const reviewerPolicy = createRoleRuntimePolicy("reviewer", { auditDir, replyStoreDir });

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
  const acceptedEnvelope = [
    "agent-team/v1",
    `id: ${acceptedId}`,
    `correlation_id: ${acceptedId}`,
    "kind: progress",
    "body_encoding: base64url",
    "references: {}",
    "subject: hi",
    "body: YQ",
  ].join("\n");
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
  assert.equal(acceptedResult, undefined, "executor -> reviewer inbound must be accepted; onContext returns undefined when no message is filtered");
  // No reply-store file is required for an accepted inbound; the reservation
  // contract is enforced by read() at the next inbound. Either way, accepting
  // must not have written a file in this single-message scenario because
  // `replyStore.write()` is the only place that persists a record on accept.
  const acceptedPath = join(acceptedReply, "reviewer", `${acceptedId}.json`);
  const acceptedExists = await stat(acceptedPath).then(() => true, () => false);
  assert.equal(acceptedExists, false, `accepted executor -> reviewer inbound must not persist a reply-store file from onContext alone; ${acceptedPath}`);
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
    ["~/.pi/agent/npm/node_modules/pi-intercom/index.ts", "~/.pi/agent/npm/node_modules/pi-web-access/index.ts", "../communication/extensions/researcher.ts", "../communication/extensions/report-to-lead.ts", "../communication/extensions/blackboard-update.ts"],
    "researcher must explicitly load shared transport, shared web access, and project policy extensions",
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
      ["~/.pi/agent/npm/node_modules/pi-intercom/index.ts", `../communication/extensions/${role}.ts`, "../communication/extensions/report-to-lead.ts", "../communication/extensions/blackboard-update.ts"],
      `${role} must load shared intercom and only its own project policy extensions`,
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
    "report_to_lead",
    "source_check",
    "web_search",
    "write",
  ]);
  assert.equal([...RESEARCHER_CAPABILITIES].length, 12, "RESEARCHER_CAPABILITIES must contain exactly 12 capabilities matching team-contract RESEARCHER_TOOLS");
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

test("Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall", async (t) => {
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

test("Issue #3 N2: RESEARCH_REQUEST with bash capability is refused at onToolCall", async (t) => {
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

test("Issue #3 N3: architectural RESEARCH_REQUEST is refused at onToolCall", async (t) => {
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

test("Issue #3 N12 + N13: existing peer ACL still refuses Executor→Lead and Reviewer→Researcher", async (t) => {
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
    const body = JSON.stringify(makeResearchResultBody({ task_id: "ISSUE-001", request_id: requestId }));
    const envelope = makeEnvelope({ id: requestId, correlationId: requestId, kind: "progress", subject: "RESEARCH_RESULT cross-task", body });
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
  const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
  // Body "a" is not JSON, so the research gate must pass through.
  const envelope = "agent-team/v1\nid: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\ncorrelation_id: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\nkind: progress\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ";
  const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-003--reviewer--abc", envelope));
  assert.equal(result, undefined, "non-research message must not be blocked by the body gate");
});
