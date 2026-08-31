# ISSUE-011 — Reviewer C-003 Report (paired with EXECUTOR-ISSUE-011)

- Task ID: **ISSUE-011**
- Delegation: **REVIEW-ISSUE-011**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
- Branch: `pi-team/ISSUE-011-intercom-envelope-recovery` (base ref `develop`)
- Reviewer: paired Reviewer `pi-team--ISSUE-011--reviewer`
- Paired Executor: `pi-team--ISSUE-011--executor`
- Reviewer handoff: `READY_FOR_REVIEW` envelope (correlation
  `12ed5ecc-1d53-4aa1-afd5-d8e7d512228e`, subject "READY_FOR_REVIEW
  Issue #11 intercom envelope redaction + stale-session recovery")
- Re-review handoff: `FIX_READY` envelope (correlation
  `c5d7f068-916c-46bf-97eb-7736b63ca51d`, subject "FIX_READY
  Issue #11 typed-diagnostic runtime coverage gap (3 findings
  addressed)")
- Frozen contract: identical at
  `plans/ISSUE-011-task.md` and
  `D:\Coding\Harness\Pi-team\.git\pi-team\v1\contracts\ISSUE-011.md`
- Final review state: **READY_FOR_ACCEPTANCE**

## Review scope (C-003)

Per the frozen contract, this review independently verifies:

1. transport / agent-facing 分层 (Base64 envelope hidden from
   agent-facing audit / diagnostics; agent-facing summary fields present)
2. stale-session recovery does not bypass ACL (same-task only; never
   cross-task or cross-role)
3. wire envelope compatibility preserved (no change to
   `agent-team/v1` header, `body_encoding: base64url`, canonical
   round-trip check, kind set, UUID v4, `references` JSON)
4. log redaction contract (structured fields only; never the base64
   body or envelope text)
5. permission boundaries preserved (no change to `BOUNDED_PEERS`,
   `KINDS`, `SUPERVISOR_REASONS`, `authorizePeer`,
   `validateResearchBody`, `authorizeResearchDelegation`,
   `resolvePeerRole`, `resolveTeamPeerRole`)
6. negative tests (cross-task, cross-role, malformed envelope,
   unauthorized inbound, malformed envelope body leak, denied
   inbound body leak)

## Reproduction of Executor validation

```
cd D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery
powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1
```

Result (after Executor `FIX_READY`):

```
✔ ... (all pre-existing tests, 16 communication-policy + 20 team-contract + 6 blackboard)
✔ Issue #3 policy constants export the bounded research envelope surface
✔ Issue #3 validateResearchBody accepts a well-formed RESEARCH_REQUEST, RESEARCH_RESULT, RESEARCH_BLOCKED
✔ Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall
... (all 21 Issue #3 cases)
✔ Issue #11 P1: summarizeEnvelopeForAgent returns structured fields without the base64 body line
✔ Issue #11 P2: formatAuditEvent writes a redacted audit row whose JSON never carries the base64 body
✔ Issue #11 N1: cross-task peer rediscovery is refused with peer_wrong_task typed diagnostic
✔ Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)
✔ Issue #11 P3: same-task stale-session diagnostic is surfaced when sendWithPolicy reports delivered=false with stale sentinel
✔ Issue #11 P3 (typed diagnostic via custom runtime): stale-session surfaces peer_unreachable reason
✔ Issue #11 N3: malformed envelope refusal path does not expose the base64 body in the audit row or the agent reason
✔ Issue #11 N5: accepted inbound carries redacted envelope fields and never carries the base64 body in the audit row
✔ Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body
✔ Issue #11 control: classifyClientResult exposes delivered/stale-session/delivery-failed kinds and never throws on undefined input
✔ Issue #11 control: appendPolicyAudit (via runtime onToolCall) strips the envelope field and never serializes the base64 body
✔ Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic
✔ Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint
✔ ... (all team-contract + blackboard cases)

ℹ tests 76
ℹ pass 76
ℹ fail 0
ℹ duration_ms ≈ 34000
```

All 76 tests pass; 0 fail. The Executor-side count claim of 76/76
matches the run-tests.ps1 output.

### Per-file test counts (audit)

| File | Count | Breakdown |
| --- | --- | --- |
| `tests/communication-policy.test.mjs` | 50 | 16 pre-existing + 21 Issue #3 + 13 Issue #11 |
| `tests/team-contract.test.mjs` | 20 | unchanged |
| `tests/blackboard.test.mjs` | 6 | unchanged |
| **Total** | **76** | matches `tests/run-tests.ps1` output |

After the Executor `FIX_READY`, the implementation_notes
(`implementation_notes/ISSUE-011.md` §"Validation performed") was
updated to report "49 tests (16 pre-existing + 21 Issue #3 + 12
Issue #11)" and the verification report
(`reports/ISSUE-011-verification.md` §"Test counts") was updated to
report "49 tests (16 pre-existing + 21 Issue #3 + 12 Issue #11)".

Actual count is **50** tests in `tests/communication-policy.test.mjs`
(13 Issue #11 tests, not 12). The Executor added 2 new tests in the
`FIX_READY` (N2 runtime path + P3 runtime path) but the breakdown
counts were not updated to reflect that. This is a documentation
inaccuracy of 1 test in the Issue #11 subgroup and 1 in the total
of communication-policy.test.mjs. The total 76/76 is correct in the
runner output. See §"Findings →"Finding 4" (LOW)".

## Verification of the 3 CHANGES_REQUESTED findings

### Finding 1 (MEDIUM) — typed-diagnostic runtime coverage gap

The Executor chose option (1) — add two new runtime-path tests +
extend `createRoleRuntimePolicy` with an optional `client` hook.

#### Production-code change (`runtime-policy.mjs`)

`createRoleRuntimePolicy` signature now accepts an optional `client`
parameter (caller-injectable; default preserves the previous
`delivered: true` preflight stub):

```js
export function createRoleRuntimePolicy(role, { auditDir, peerSessions = [], replyStoreDir, lifecycleRoot, runId, planVersion, memoryPath, artifactDir, client } = {}) {
  // ...
  // Issue #11 — caller-injected client hook for the runtime policy. The hook
  // must implement `{ send: async (recipient, options) => ({ delivered,
  // reason?, ... }) }`; the runtime policy never inspects the hook's
  // implementation, only its return shape (same as the npm `pi-intercom`
  // extension's `client.send`). The default hook returns `{ delivered: true,
  // policy: "preflight" }` so production callers see the existing behavior
  // unchanged; tests can override the hook to drive the
  // `classifyDeliveryFailure` paths (peer_wrong_role, peer_wrong_task,
  // stale-session) and assert the audit row + agent-facing reason shapes.
  const sendClient = client ?? { send: async () => ({ delivered: true, policy: "preflight" }) };
```

Reviewer verdict: the change is additive and minimal. The default
`sendClient` is identical to the previous hardcoded client mock (both
return `{ delivered: true, policy: "preflight" }`), so production
behavior is byte-identical. The wire envelope is unchanged, the
bounded peer ACL is unchanged, and the canonical base64url check is
unchanged.

#### New test #1 (N2 runtime path)

`tests/communication-policy.test.mjs` line 1176:

```js
test("Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic", async (t) => {
  // ...
  const policy = createRoleRuntimePolicy("executor", { auditDir, replyStoreDir });
  const envelope = makeFakeIntercomEnvelope({ subject: "executor->lead" });
  const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--lead--abc", envelope));
  assert.ok(result && result.block === true, "executor->lead rediscovery must be blocked");
  assert.match(result.reason, /sender's bounded peer set does not include lead/);
  assert.match(result.reason, /call intercom list-cwd/);
  const rows = await readAuditRows(auditDir, "executor");
  const refused = rows.find((row) => row.direction === "outbound" && row.outcome === "refused" && row.reason?.includes("peer_wrong_role"));
  assert.ok(refused, "audit row must carry the peer_wrong_role typed diagnostic");
  assert.match(refused.reason, /peer_wrong_role:sender=executor/);
  assert.match(refused.reason, /role=lead/);
  assert.equal(refused.recipient, "lead", "audit row recipient must carry the resolved role");
  assert.equal(refused.bodySummary, undefined);
  assert.equal(refused.bodyFingerprint, undefined);
  assert.equal(refused.kind, undefined);
});
```

Trace through the runtime path:
1. `target = "pi-team--ISSUE-011--lead--abc"`
2. `resolveTeamPeerRole("pi-team--ISSUE-011--lead--abc", "ISSUE-011")` → `"lead"` (the prefix matches and "lead" is in ROLES)
3. `recipient = "lead"`
4. `authorizePeer("executor", "pi-team--ISSUE-011--lead--abc")` → `false` (executor's bounded set is `{researcher, reviewer}`; "pi-team--ISSUE-011--lead--abc" is a string, not a role)
5. `sendWithPolicy` returns `{ delivered: false, policy: "refused", reason: "unauthorized-peer" }`
6. `parseSameTaskTeamPeer("pi-team--ISSUE-011--lead--abc", "ISSUE-011")` returns `{ taskId: "issue-011", taskIdOriginal: "ISSUE-011", role: "lead", launchId: "abc", mismatchedTask: false }`
7. `isStaleSession = false` (no stale-session sentinel in result.reason)
8. `classifyDeliveryFailure({ sender: "executor", target: "pi-team--ISSUE-011--lead--abc", sameTaskTarget: {...}, isStaleSession: false })`:
   - Cross-task branch: taskId matches, no fire
   - Wrong-role branch: `BOUNDED_PEERS.get("executor") = {researcher, reviewer}`; `"lead" not in set` → returns `{ reason: "peer_wrong_role:sender=executor:role=lead", agentReason: "...", auditRecipient: "lead" }`
9. The runtime writes a refused audit row with `reason: "peer_wrong_role:sender=executor:role=lead"` and `recipient: "lead"`.
10. The agent-facing block reason is the `agentReason` text including "call intercom list-cwd".

The test asserts all of these. **PASS** in the runner output.

This is a real integration-level exercise of the runtime's
`peer_wrong_role` typed diagnostic path. The previous `Issue #11 N2`
test only verified the allowed executor→reviewer same-task path and
the new `Issue #11 N2 (runtime path)` test now drives the cross-role
branch via the runtime.

#### New test #2 (P3 runtime path)

`tests/communication-policy.test.mjs` line 1214:

```js
test("Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint", async (t) => {
  // ...
  const policy = createRoleRuntimePolicy("executor", {
    auditDir,
    replyStoreDir,
    client: { send: async () => ({ delivered: false, reason: "no-such-session" }) },
  });
  const envelope = makeFakeIntercomEnvelope({ subject: "stale session" });
  const result = await policy.onToolCall(makeIntercomEvent("send", "pi-team--ISSUE-011--researcher--stale-launch-A", envelope));
  assert.ok(result && result.block === true, "stale session must be blocked at the runtime path");
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
  assert.equal(refused.bodySummary, undefined);
  assert.equal(refused.bodyFingerprint, undefined);
  assert.equal(refused.kind, undefined);
});
```

Trace through the runtime path:
1. `target = "pi-team--ISSUE-011--researcher--stale-launch-A"`
2. `resolveTeamPeerRole(target, "ISSUE-011")` → `"researcher"` (prefix matches, role in ROLES)
3. `recipient = "researcher"`
4. `authorizePeer("executor", "researcher")` → `true` (in bounded set)
5. `sendWithPolicy` is invoked using the **injected `client`** that returns `{ delivered: false, reason: "no-such-session" }`
6. `sendWithPolicy` calls `classifyClientResult({ delivered: false, reason: "no-such-session" })` → `{ kind: "stale-session", reason: "no-such-session" }` (matches sentinel)
7. `sendWithPolicy` returns `{ delivered: false, policy: "stale-session", reason: "no-such-session" }`
8. `parseSameTaskTeamPeer(target, "ISSUE-011")` returns `{ taskId: "issue-011", role: "researcher", launchId: "stale-launch-A", mismatchedTask: false }`
9. `isStaleSession = true` (result.policy === "stale-session")
10. `classifyDeliveryFailure({ sender: "executor", sameTaskTarget: {...}, isStaleSession: true })`:
    - Cross-task branch: no fire (taskId matches)
    - Wrong-role branch: `BOUNDED_PEERS.get("executor").has("researcher")` → true; no fire
    - Stale-session branch: `isStaleSession === true` → returns `{ reason: "stale-session:role=researcher:task_id=ISSUE-011:launch_id=stale-launch-A:retry=list-cwd", agentReason: "...", auditRecipient: "researcher" }`
11. The runtime writes a refused audit row with `reason: "stale-session:role=researcher:task_id=ISSUE-011:launch_id=stale-launch-A:retry=list-cwd"` and `recipient: "researcher"`.
12. The agent-facing block reason is the `agentReason` text including "call intercom list-cwd".

The test asserts all of these. **PASS** in the runner output.

This is a real integration-level exercise of the runtime's
`stale-session` typed diagnostic path. The previous `Issue #11 P3`
and `Issue #11 P3 (typed diagnostic via custom runtime)` tests only
verified the unit-level `classifyClientResult` helper; the new
`Issue #11 P3 (runtime path)` test now drives the runtime's
stale-session branch via the injected `client` hook.

**Verdict on Finding 1**: **RESOLVED**. The runtime's
`peer_wrong_role` and `stale-session` typed-diagnostic branches are
now exercised at the integration level. The `client` hook extension
to `createRoleRuntimePolicy` is minimal and additive (default behavior
byte-identical to previous); the wire envelope, bounded peer ACL,
canonical base64url check, Issue #3 body gate, and lifecycle
`markStale` / restart contract are all preserved.

### Finding 2 (LOW) — implementation_notes per-file test counts are inaccurate

#### Status

**PARTIALLY RESOLVED**. The Executor updated the "Validation
performed" section of `implementation_notes/ISSUE-011.md` to report
"49 tests (16 pre-existing + 21 Issue #3 + 12 Issue #11)" and the
"Test counts" section of `reports/ISSUE-011-verification.md` to
report the same.

The 74/74 → 76/76 total was correctly updated in both files. The
per-file breakdown was updated. **However**, the new breakdown is
**off by 1** in the Issue #11 subgroup: the Executor claims 12 Issue
#11 tests but actual count is 13. The total of 50 tests in
`tests/communication-policy.test.mjs` (vs claimed 49) reflects this.

Concretely:

- `tests/communication-policy.test.mjs`: 50 actual (16 + 21 + 13), claimed 49
- `tests/team-contract.test.mjs`: 20 actual, claimed 20 ✓
- `tests/blackboard.test.mjs`: 6 actual, claimed 6 ✓
- Total: 76 actual, claimed 76 ✓

The discrepancy is purely a count in the documentation; the actual
tests pass and the runner reports 76/76.

Additionally, two stale references in the verification report's
"Control scenarios" section were not updated:

- C2: claims "23 `tests/team-contract.test.mjs` tests continue to pass" (actual: 20)
- C3: claims "All 7 `tests/blackboard.test.mjs` tests continue to pass" (actual: 6)

These are documentation inaccuracies that don't affect test outcomes
or contract compliance. The Lead can choose to amend these in a
follow-up doc-only commit if desired; they are not blocking
acceptance.

#### §"Files changed" entry in implementation_notes

The `tests/communication-policy.test.mjs` row in the §"Files
changed" table still says "Added 11 new test cases: P1, P2, N1, N2,
P3, P3-typed, N3, N5, N6, control x2". This list is missing the 2
new runtime-path tests added in the FIX_READY (N2 runtime path + P3
runtime path). The list was correct for the original READY_FOR_REVIEW
slice but is now incomplete.

The C-002 evidence row in §"Mapping to Issue #11 done criteria"
also lists "(P1, P2, P3, N1, N2, N3, N5, N6 + 2 controls)" which
has the same incompleteness.

#### Verdict on Finding 2

**PARTIALLY RESOLVED** — main counts updated but with a -1
inaccuracy; minor stale references in two control-scenario rows of
the verification report; the §"Files changed" and C-002 evidence
list in implementation_notes do not reference the 2 new
runtime-path tests.

Severity remains LOW (documentation only; no production-code impact).
Not blocking acceptance.

### Finding 3 (LOW) — dead statement in N2 test

#### Status

**RESOLVED**. The dead `process.env.PI_TEAM_ALLOWED_DELEGATIONS;`
expression-statement at `tests/communication-policy.test.mjs:910` has
been removed.

Reviewer verdict: the line no longer exists in the test file
(verified via `Select-String -Pattern "PI_TEAM_ALLOWED_DELEGATIONS"`
returns no matches).

## Findings after re-review

After the Executor `FIX_READY`, the following minor documentation
findings remain:

### Finding 4 (LOW) — Documentation count drift

#### Description

The per-file test counts in
`implementation_notes/ISSUE-011.md` §"Validation performed" and
`reports/ISSUE-011-verification.md` §"Test counts" both claim
"`tests/communication-policy.test.mjs`: 49 tests (16 pre-existing +
21 Issue #3 + 12 Issue #11)" but the actual count is 50 (13 Issue
#11 tests). The Executor added 2 tests in the FIX_READY but only
counted +1.

#### Evidence

`tests/communication-policy.test.mjs` (verified via
`Select-String -Pattern "^test\("`):

- 16 pre-existing (Issue #11 not referenced)
- 21 Issue #3 (Issue #3 prefix)
- 13 Issue #11 (P1, P2, N1, N2, P3, P3-typed, N3, N5, N6, control
  classifyClientResult, control appendPolicyAudit, N2 runtime path,
  P3 runtime path)
- Total: 50

The 74/74 → 76/76 total claim is correct; the per-file breakdown is
off by 1.

#### Impact

Documentation-only; no production-code impact. The total 76/76 in
the runner output is the authoritative count.

#### Recommended remediation (optional, post-acceptance)

Either: (a) amend the §"Validation performed" and §"Test counts"
sections to read "50 tests (16 pre-existing + 21 Issue #3 + 13
Issue #11)" — a one-line correction; or (b) defer to a Lead-owned
doc-cleanup follow-up.

### Finding 5 (LOW) — Stale references in verification report

#### Description

`reports/ISSUE-011-verification.md` §"Control scenarios" rows C2 and
C3 retain pre-FIX_READY test counts:

- C2: "The pre-existing 23 `tests/team-contract.test.mjs` tests continue to pass"
- C3: "All 7 `tests/blackboard.test.mjs` tests continue to pass"

Actual counts: 20 and 6.

#### Impact

Documentation-only; the test runner shows the correct counts.

#### Recommended remediation (optional, post-acceptance)

Amend C2 and C3 to read "20 tests" and "6 tests" respectively. Or
defer to a Lead-owned doc-cleanup follow-up.

### Finding 6 (LOW) — §"Files changed" list incomplete

#### Description

`implementation_notes/ISSUE-011.md` §"Files changed" lists "Added 11
new test cases: P1, P2, N1, N2, P3, P3-typed, N3, N5, N6, control
x2" — this list is missing the 2 runtime-path tests added in the
FIX_READY.

The C-002 evidence row in §"Mapping to Issue #11 done criteria" also
lists "(P1, P2, P3, N1, N2, N3, N5, N6 + 2 controls)" — same
incompleteness.

#### Impact

Documentation-only; the actual test names appear in the runner
output.

#### Recommended remediation (optional, post-acceptance)

Amend the list to include the runtime-path tests, or defer to a
Lead-owned doc-cleanup follow-up.

## Scope verification (after FIX_READY)

| Change | In-scope per contract? | Reviewer verdict |
| --- | --- | --- |
| `.pi/communication/policy.mjs` adds `summarizeEnvelopeForAgent` + `formatAuditEvent` (122+ lines) | YES | OK |
| `.pi/communication/runtime-policy.mjs` adds `classifyDeliveryFailure` + `parseSameTaskTeamPeer` and an optional `client` hook (185+ lines) | YES | OK |
| `.pi/communication/send.mjs` adds `classifyClientResult` (36+ lines) | YES | OK |
| `.pi/agents/{executor,researcher,reviewer}.md` step additions | YES | OK |
| `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md` mirrors | YES | OK |
| `.pi/communication/README.md` adds "Audit surface" + "Stale-session recovery" sections | YES | OK |
| `tests/communication-policy.test.mjs` adds 13 Issue #11 test cases + 1 pre-existing test setup fix (was 11 in the original READY_FOR_REVIEW; +2 added in FIX_READY) | YES | OK |
| New `plans/ISSUE-011-decision.md` (122 lines) | YES | OK |
| New `implementation_notes/ISSUE-011.md` (updated for the FIX_READY) | YES | OK |
| New `reports/ISSUE-011-verification.md` (updated for the FIX_READY) | YES | OK |
| New `research/ISSUE-011-intercom-envelope-recovery.md` (289 lines) | YES | OK |
| New `failures/ISSUE-011-typed-diagnostic-runtime-coverage.md` (Reviewer's failure artifact from the first review) | YES (per `AGENTS.md` §pi-intercom — Reviewer may create failure artifacts) | OK |
| Updated `reports/ISSUE-011-review.md` (this file) | YES | OK |
| **No change** to `agent-team/v1` wire envelope (header, `body_encoding`, canonical round-trip, kind set, UUID v4, `references` JSON) | REQUIRED | OK |
| **No change** to `BOUNDED_PEERS`, `KINDS`, `SUPERVISOR_REASONS`, `makeEnvelope`, `parseEnvelope`, `resolvePeerRole`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, `LeadAudit`, `MessageQueue`, `RunRegistry`, `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `validateResearchBody`, `authorizeResearchDelegation` | REQUIRED | OK |
| **No change** to `scripts/pi-team.ps1`, `plugins/agent-blackboard/`, public CLI verbs, role memory files, lifecycle `markStale`/restart contract | REQUIRED | OK |

All changes are in-scope. No unrelated edits detected.

## Wire compatibility (Issue #11 out-of-scope #2)

| Surface | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| `makeEnvelope` header `"agent-team/v1"` | unchanged | unchanged at `policy.mjs:71` | OK |
| `body_encoding: base64url` line | unchanged | unchanged at `policy.mjs:75` | OK |
| Canonical base64url round-trip check at `policy.mjs:97-99` | unchanged | unchanged | OK |
| `KINDS = new Set(["request", "reply", "error", "progress"])` | unchanged | unchanged at `policy.mjs:24` | OK |
| UUID v4 requirement on `id` / `correlation_id` | unchanged | unchanged at `policy.mjs:13, 86` | OK |
| `references` JSON shape | unchanged | unchanged at `policy.mjs:76` | OK |
| 21 Issue #3 tests that assert wire shape | PASS | PASS | OK |

The wire envelope is byte-identical to develop. The new `client`
hook in `runtime-policy.mjs` is an OPTIONAL parameter; production
callers continue to use the default preflight stub, so production
behavior is unchanged.

## Audit row redaction (Issue #11 §3)

| Path | Expected | Observed (test name) | Verdict |
| --- | --- | --- | --- |
| Allowed outbound audit row | structured fields; NO base64 body | `Issue #11 P2`, `Issue #11 N2`, `Issue #11 control: appendPolicyAudit` | OK |
| Allowed inbound audit row | same structured fields | `Issue #11 N5` | OK |
| Refused outbound audit row | NO envelope-derived fields | `Issue #11 N1`, `Issue #11 N3`, `Issue #11 N2 (runtime path)`, `Issue #11 P3 (runtime path)` | OK |
| Refused inbound audit row | NO inbound body text | `Issue #11 N6` | OK |
| `formatAuditEvent` strips `envelope` source field | yes | `Issue #11 P2`, `Issue #11 control: appendPolicyAudit` | OK |
| Refused rows never serialize envelope-derived fields | yes | `Issue #11 N2 (runtime path)` (asserts `refused.bodySummary === undefined`, `refused.bodyFingerprint === undefined`, `refused.kind === undefined`) + `Issue #11 P3 (runtime path)` | OK |

The audit row redaction contract is implemented correctly and
verified by 9 of the 13 Issue #11 tests (P1, P2, N1, N2, N3, N5,
N6, control x2, N2 runtime path, P3 runtime path).

## ACL preservation (Issue #11 out-of-scope #3)

| ACL layer | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| `BOUNDED_PEERS` topology | unchanged | unchanged at `policy.mjs:4-9` | OK |
| `KINDS` | unchanged | unchanged at `policy.mjs:24` | OK |
| `authorizePeer` | unchanged | unchanged at `policy.mjs:53-55` | OK |
| `resolveTeamPeerRole` | unchanged | unchanged at `policy.mjs:124-130` | OK |
| `validateResearchBody` | unchanged | unchanged (Issue #3 tests pass) | OK |
| `authorizeResearchDelegation` | unchanged | unchanged (Issue #3 tests pass) | OK |
| Researcher→paired-Executor bound | unchanged | "researcher outbound peer shape matches the bounded set" passes | OK |
| Executor→paired-{Researcher, Reviewer} bound | unchanged | "executor outbound peer shape is exactly researcher + reviewer" passes | OK |
| Reviewer→paired-Executor bound | unchanged | "reviewer outbound peer shape is exactly executor" passes | OK |
| Cross-role send refused (Executor→Lead, Reviewer→Researcher) | unchanged | "Issue #3 N12 + N13" passes; "Issue #11 N2 (runtime path)" drives the runtime path | OK |

`classifyDeliveryFailure` only runs AFTER `authorizePeer` returns
`false`. The new `client` hook in `createRoleRuntimePolicy` does not
modify the ACL surface.

## Stale-session recovery (Issue #11 §2.3)

| Path | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| Same-task paired peer rediscoverable via `list-cwd` | yes | (code path: prefix-based ACL; runtime re-validates per send) | OK |
| Cross-task rediscovery refused with `peer_wrong_task` typed diagnostic | yes | `Issue #11 N1` (audit row carries `peer_wrong_task:role=researcher:expected_task_id=ISSUE-011:actual_task_id=ISSUE-010`; agent reason carries "cross-task peer rediscovery: …; call intercom list-cwd …") | OK |
| Cross-role rediscovery refused with `peer_wrong_role` typed diagnostic | yes | `Issue #11 N2 (runtime path)` (audit row carries `peer_wrong_role:sender=executor:role=lead`; agent reason carries "sender's bounded peer set does not include lead; call intercom list-cwd …") | OK |
| Same-task stale-session typed diagnostic with recovery hint | yes | `Issue #11 P3 (runtime path)` (audit row carries `stale-session:role=researcher:task_id=ISSUE-011:launch_id=stale-launch-A:retry=list-cwd`; agent reason carries "stale session for researcher on task ISSUE-011 (launch_id=stale-launch-A); call intercom list-cwd …") | OK |
| `STALE_SESSION_SENTINELS` conservative | yes | `Issue #11 control: classifyClientResult` verifies `"internal error"` → `delivery-failed`, `"rate limited"` → `delivery-failed` | OK |
| Runtime never silently redelivers to a different task | yes | `classifyDeliveryFailure` checks task prefix first, then role, then stale-session — typed diagnostic on each branch | OK |

All three typed-diagnostic branches are now exercised at the
integration level via the runtime path.

## Lead observation boundary (Issue #11 §4)

| Surface | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| `direction` field present | yes | yes (all 11 new tests check) | OK |
| `action` field present | yes | yes | OK |
| `recipient` field carries the resolved role | yes | yes (N2 (runtime path) asserts `refused.recipient === "lead"`; P3 (runtime path) asserts `refused.recipient === "researcher"`) | OK |
| `outcome` field present | yes | yes | OK |
| `reason` field machine-greppable | yes | yes (N2 (runtime path): `peer_wrong_role:sender=executor:role=lead`; P3 (runtime path): `stale-session:role=researcher:task_id=ISSUE-011:launch_id=stale-launch-A:retry=list-cwd`) | OK |
| `envelope` source field stripped | yes | yes (`Issue #11 P2`, `Issue #11 control: appendPolicyAudit`) | OK |
| Refused rows carry NO envelope-derived fields | yes | yes (verified by N2 (runtime path) + P3 (runtime path) + N1 + N3 + N6) | OK |

The Lead observation boundary is preserved. Lead retrospection can
still read `direction`, `action`, `recipient`, `outcome`, `reason`,
`messageId`, `correlationId`, `trace` from every row; new fields
(`kind`, `subject`, `references`, `body_summary`, `body_fingerprint`,
`body_length`) are additive on allowed rows and absent on refused
rows.

## Role prompt / skill coverage

The four typed-failure format strings in the agent prompts
(`stale-session:role=<r>:task_id=<t>:launch_id=<old>:retry=list-cwd`,
`peer_wrong_role:sender=<s>:role=<r>`,
`peer_wrong_task:role=<r>:expected_task_id=<e>:actual_task_id=<a>`)
match the runtime's `classifyDeliveryFailure` output exactly,
verified by both unit-level and runtime-path tests.

## Verdict

**READY_FOR_ACCEPTANCE** — the Issue #11 implementation is
functionally correct and contract-compliant after the paired
Executor's `FIX_READY`.

Summary of evidence:

| Acceptance criterion | Status |
| --- | --- |
| Wire envelope byte-identical (21 Issue #3 tests pass; `makeEnvelope` / `parseEnvelope` / `KINDS` / `BOUNDED_PEERS` unchanged) | MET |
| Audit row redaction works (9 of 13 Issue #11 tests verify; `formatAuditEvent` strips `envelope` field; refused rows carry no envelope-derived fields) | MET |
| ACL preserved (`BOUNDED_PEERS` topology unchanged; `authorizePeer` + `authorizeResearchDelegation` unchanged; `classifyDeliveryFailure` gates typed diagnostics on existing ACL) | MET |
| Lead observation boundary preserved (`direction` / `action` / `recipient` / `outcome` / `reason` / `messageId` / `correlationId` / `trace` intact) | MET |
| Stale-session recovery typed diagnostics (all 3 runtime branches — `peer_wrong_task`, `peer_wrong_role`, `stale-session` — exercised at integration level) | MET |
| Role prompts and skills mirror the runtime contract | MET |
| Scope unchanged (all 11 unstaged modifications + 6 untracked artifacts in `in_scope`; no out-of-scope changes) | MET |
| 74/74 → 76/76 pass after `FIX_READY` | MET |
| Per-file test counts corrected (main counts updated; +1 inaccuracy in Issue #11 subgroup remains — LOW doc-only) | PARTIAL (LOW) |

The 3 LOW documentation findings (per-file count drift, stale C2/C3
references, incomplete §"Files changed" list) do not affect the
contract compliance and can be addressed in a Lead-owned doc-cleanup
follow-up if desired. They are not blocking acceptance.

## Acceptance path

Lead may now:

1. Reproduce the validation: `powershell -ExecutionPolicy Bypass
   -File tests/run-tests.ps1` → 76/76 pass.
2. Inspect the diff: `git diff --stat develop..HEAD` shows the 11
   modified files + 4 new files (the 3 Lead-owned artifacts and the
   Reviewer failure artifact) + the untracked Reviewer report.
3. Confirm wire compatibility: 21 Issue #3 tests pass;
   `makeEnvelope` / `parseEnvelope` / `KINDS` / `BOUNDED_PEERS`
   unchanged.
4. Confirm runtime-path coverage: `Issue #11 N2 (runtime path)` and
   `Issue #11 P3 (runtime path)` exercise the runtime's
   `peer_wrong_role` and `stale-session` typed-diagnostic branches.
5. Optionally correct the LOW documentation drifts (Findings 4–6)
   in a doc-only commit; or defer to a Lead-owned follow-up.

After Lead acceptance and `accept <task-id> <acceptance-file>`,
the persistent Executor + Reviewer pair can be reclaimed, the
worktree cleaned up, and the Blackboard task archived.

End of C-003 review report.