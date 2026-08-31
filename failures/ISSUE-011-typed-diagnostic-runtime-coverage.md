# ISSUE-011 — typed-diagnostic runtime paths are untested despite documentation claims

Severity: medium (test-coverage gap; the Issue #11 implementation adds
`classifyDeliveryFailure` and `parseSameTaskTeamPeer` runtime closures and
two new typed diagnostic branches (`peer_wrong_role`, `stale-session`),
but the regression suite asserts only the `peer_wrong_task` typed
diagnostic via the runtime path. The other two runtime branches are
unreachable from the test suite because the runtime's hardcoded
`client.send` stub always returns `delivered: true`. The Lead-owned
verification artifact describes the runtime paths as "PASS" with
explicit code snippets that the tests do not actually exercise.)

## Summary

The Executor slice adds three typed diagnostic branches to
`runtime-policy.mjs` `classifyDeliveryFailure` (lines 189-233):

1. Cross-task rediscovery → `peer_wrong_task` typed diagnostic
2. Cross-role rediscovery → `peer_wrong_role` typed diagnostic
3. Same-task stale session → `stale-session:role=…:task_id=…:launch_id=…:retry=list-cwd`
   typed diagnostic

The regression suite (`tests/communication-policy.test.mjs`, Issue #11
tests) only exercises the first branch via the runtime path:

- `Issue #11 N1` sends to `pi-team--ISSUE-010--researcher--old-launch`.
  `authorizePeer("executor", target)` returns `false` (target is not in
  the bounded set), `sendWithPolicy` returns `{ delivered: false,
  policy: "refused" }`, and `classifyDeliveryFailure` reaches the
  cross-task branch with `sameTaskTarget = { taskId: "issue-010",
  role: "researcher", mismatchedTask: true }`. The audit row's
  `reason` carries `peer_wrong_task:…` and the agent-facing reason
  carries "cross-task peer rediscovery: …; call intercom list-cwd …".
  N1 PASSES and validates the cross-task runtime path.

The other two branches are **not** exercised by any test:

- `Issue #11 N2` is named "cross-role peer rediscovery is refused with
  peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)"
  but the test body sends a NON-research envelope to
  `pi-team--ISSUE-011--reviewer--abc` (executor→reviewer is in the
  bounded peer set) and asserts `result === undefined`
  ("executor->reviewer same-task non-research send must pass"). The
  `peer_wrong_role` typed diagnostic branch in
  `classifyDeliveryFailure` (lines 207-216) is never reached because
  the target role is in-bounded. The test name advertises coverage
  the body does not deliver.

- `Issue #11 P3` and `Issue #11 P3 (typed diagnostic via custom runtime)`
  both claim to exercise the runtime's stale-session diagnostic, but
  the test bodies only call `classifyClientResult({...})` directly on
  unit inputs. The runtime's `onToolCall` path includes
  `if (result.delivered !== true)` which contains the
  `classifyDeliveryFailure(...)` call that returns the
  `stale-session` typed diagnostic. The runtime's hardcoded client
  mock (`client: { send: async () => ({ delivered: true, policy:
  "preflight" }) }`) makes the `result.delivered !== true` branch
  unreachable from any test. The `classifyClientResult` unit tests
  do not exercise the runtime's diagnostic branch — they exercise the
  classifier on raw `{ delivered: false, reason }` shapes. A future
  regression that swaps the order of the cross-task / cross-role /
  stale-session checks in `classifyDeliveryFailure` (or that breaks
  the regex `/no-such-session|disconnected|not-delivered/i`) would
  not be caught by any test.

## Evidence

`tests/communication-policy.test.mjs:907-931` (Issue #11 N2):

```js
test("Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)", async (t) => {
  // ...
  const envelope = makeFakeIntercomEnvelope({ subject: "executor-to-reviewer ok" });
  const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--reviewer--abc", envelope));
  assert.equal(result, undefined, "executor->reviewer same-task non-research send must pass");
  // ...asserts allowed row, not refused peer_wrong_role row
});
```

The test name advertises refusal with `peer_wrong_role`; the body
asserts the send passes. The target `pi-team--ISSUE-011--reviewer--abc`
resolves to `reviewer`, which IS in `BOUNDED_PEERS.get("executor")`
(`new Set(["researcher", "reviewer"])`), so `authorizePeer` returns
`true`, the client stub returns `delivered: true`, and the runtime
records an allowed row. The `peer_wrong_role` branch in
`classifyDeliveryFailure` (runtime-policy.mjs:207-216) is never
reached. To exercise it, the test must send to a target whose
`resolveTeamPeerRole` returns a role that is NOT in the sender's
bounded peer set — e.g. `pi-team--ISSUE-011--lead--abc` (executor
cannot target lead).

`tests/communication-policy.test.mjs:933-1015` (Issue #11 P3 and
P3-typed): both tests call `classifyClientResult(...)` directly on raw
shapes, then assert an allowed same-task send. The runtime's stale
session branch (`runtime-policy.mjs:142-153`) is gated on
`result.delivered !== true`, which never holds in tests because
`onToolCall` hardcodes
`client: { send: async () => ({ delivered: true, policy: "preflight" }) }`.
The `classifyDeliveryFailure` stale-session branch (lines 218-227) is
not exercised.

## Discrepancy with the verification report

`reports/ISSUE-011-verification.md` claims:

| Scenario | Status | Evidence |
| --- | --- | --- |
| P3 — same-task stale-session diagnostic is surfaced when sendWithPolicy reports delivered=false with stale sentinel | PASS | "Issue #11 P3" + "Issue #11 P3 (typed diagnostic via custom runtime)" |
| N2 — cross-role peer rediscovery refused with peer_wrong_role typed diagnostic | PASS | "Issue #11 N2" — but the test asserts the opposite direction |

`plans/ISSUE-011-decision.md` claims:

> **P3 / same-task stale-session diagnostic**: `onToolCall` with a
> `client.send` mock returning `{ delivered: false }` and a valid
> same-task paired-peer target produces a refusal whose reason starts
> with `stale-session:role=researcher:task_id=ISSUE-011:launch_id=...:retry=list-cwd`.
>
> **N2 / cross-role rediscovery refused**: helper call whose target
> resolves to a wrong-role session returns `peer_wrong_role`; existing
> ACL (`BOUNDED_PEERS`) still gates the `authorizePeer` call.

Neither claim matches what the corresponding tests do.

`implementation_notes/ISSUE-011.md` repeats the same claims (P3 +
"Issue #11 control" + "N2").

The READY_FOR_REVIEW envelope's `evidence_paths` lists `P1, P2, N1,
N2, P3, N3, N5, N6` — but no evidence path exercises the runtime
stale-session branch or the runtime cross-role branch.

## Reproduction

1. `cd D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
2. `git status` (working tree has unstaged modifications and 4 untracked
   files: implementation_notes, decision, verification, research)
3. `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1`
4. Observe `tests 74 / pass 74 / fail 0` — total counts are correct,
   per-file counts in `implementation_notes` and `verification` are
   off by 1 (47→48 communication-policy, 23→20 team-contract,
   7→6 blackboard; total 77 claimed vs 74 actual, but the runner is
   authoritative)
5. Inspect `tests/communication-policy.test.mjs:907-931` (N2) and
   `:933-1015` (P3, P3-typed) — see the gap described above

## Expected vs observed

- Expected: each typed diagnostic branch (`peer_wrong_role`,
  `stale-session`, `peer_wrong_task`) has at least one runtime-path
  test that drives `onToolCall` through the corresponding
  `classifyDeliveryFailure` branch and asserts the audit row's
  `reason` field and the agent-facing block reason.
- Observed: only `peer_wrong_task` is reached via the runtime path
  (N1). The other two branches are reachable only via direct unit
  calls to `classifyClientResult` or by monkey-patching the runtime's
  hardcoded client mock. The P3 test bodies even acknowledge the
  limitation in inline comments ("we cannot override it without
  changing the runtime … Instead, the test calls
  `classifyClientResult` directly …").

## Minimal remediation

The Executor can resolve this gap WITHOUT production-code changes by:

1. Either:
   - Adding one new test that drives the runtime path for
     `peer_wrong_role` (target `pi-team--ISSUE-011--lead--abc`,
     sender `executor`, asserted reason starts with
     `peer_wrong_role:sender=executor:role=lead` and the audit row
     carries the typed diagnostic), AND
   - Adding one new test that drives the runtime path for
     `stale-session` (monkey-patch the hardcoded client mock to
     return `{ delivered: false, reason: "no-such-session" }`, sender
     `executor`, target `pi-team--ISSUE-011--researcher--abc`,
     asserted reason starts with
     `stale-session:role=researcher:task_id=ISSUE-011:launch_id=abc:retry=list-cwd`
     and the audit row carries the typed diagnostic);
2. Or: amend `plans/ISSUE-011-decision.md`,
   `implementation_notes/ISSUE-011.md`,
   `reports/ISSUE-011-verification.md`, and the READY_FOR_REVIEW
   envelope's `evidence_paths` to accurately describe what the
   existing tests cover (unit-level `classifyClientResult` plus N1's
   runtime cross-task path) and explicitly note that the runtime
   `peer_wrong_role` and `stale-session` branches are not yet
   exercised at the integration level (and that future regression
   coverage is a Lead-owned follow-up).

Option 1 is preferred because the runtime code is added; the
regression contract for Issue #11's typed diagnostic surface should
include at least one integration assertion per branch.

## Suggested test shape (option 1)

For `peer_wrong_role`:

```js
test("Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
    const envelope = makeFakeIntercomEnvelope({ subject: "executor->lead" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--lead--abc", envelope));
    assert.ok(result && result.block === true, "executor->lead rediscovery must be blocked");
    assert.match(result.reason, /sender=executor/);
    assert.match(result.reason, /role=lead/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("peer_wrong_role"));
    assert.ok(refused, "audit row must carry the peer_wrong_role typed diagnostic");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});
```

For `stale-session`:

```js
test("Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint", async (t) => {
  const { auditDir, replyStoreDir } = freshRuntimePaths(t);
  const previousTaskId = process.env.PI_TEAM_TASK_ID;
  process.env.PI_TEAM_TASK_ID = "ISSUE-011";
  try {
    // Monkey-patch send.mjs's classifyClientResult to inject a stale sentinel;
    // or stub the runtime's client.send. The cleanest path is to expose a
    // client hook on createRoleRuntimePolicy (a Lead-approved production-code
    // extension) and use it here. Alternatively, intercept via
    // Module._cache manipulation in the test setup.
    const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir, client: { send: async () => ({ delivered: false, reason: "no-such-session" }) } });
    const envelope = makeFakeIntercomEnvelope({ subject: "stale session" });
    const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--stale", envelope));
    assert.ok(result && result.block === true, "stale session must be blocked");
    assert.match(result.reason, /stale-session:role=researcher/);
    assert.match(result.reason, /task_id=ISSUE-011/);
    assert.match(result.reason, /launch_id=stale/);
    assert.match(result.reason, /retry=list-cwd/);
    const rows = await readAuditRows(auditDir, "executor");
    const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.startsWith("stale-session:"));
    assert.ok(refused, "audit row must carry the stale-session typed diagnostic");
  } finally {
    if (previousTaskId === undefined) delete process.env.PI_TEAM_TASK_ID; else process.env.PI_TEAM_TASK_ID = previousTaskId;
  }
});
```

The stale-session test requires the runtime to accept a custom
`client` option (currently hardcoded inside `onToolCall`). The
Executor can either: (a) extend `createRoleRuntimePolicy` to accept a
`client` parameter (smallest production change), or (b) monkey-patch
the runtime's hardcoded client via module-cache manipulation. Option
(a) is preferred because it makes the typed-diagnostic surface
testable without breaking the wire envelope contract.

## Constraints honored

- This artifact does not request changes to the wire envelope
  (`agent-team/v1`, `body_encoding: base64url`, canonical round-trip,
  kind set, UUID v4, `references` JSON), `BOUNDED_PEERS`,
  `KINDS`, `SUPERVISOR_REASONS`, `makeEnvelope`, `parseEnvelope`,
  `resolvePeerRole`, `resolveTeamPeerRole`, `PolicyReceiver`,
  `DedupStore`, `LeadAudit`, `MessageQueue`, `RunRegistry`,
  `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`,
  `RESEARCHER_CAPABILITIES`, `validateResearchBody`,
  `authorizeResearchDelegation`.
- This artifact does not request changes to the Issue #3 research
  envelope schema or its 21 passing test cases.
- This artifact does not request changes to Lead authority, task
  contract, scope, acceptance, or reclamation surfaces.
- This artifact only requests either (1) additional test cases
  exercising the runtime typed-diagnostic paths, or (2)
  documentation correction in the three Lead-owned artifacts and the
  next READY_FOR_REVIEW envelope's `evidence_paths`.

End of failure artifact.