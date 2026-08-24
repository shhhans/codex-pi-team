# BOOTSTRAP-SELF-004A — reviewer<-executor accepted path is not exercised

Severity: medium (test-coverage gap; named contract is asserted but only one direction is exercised)

## Summary

`tests/communication-policy.test.mjs` contains a test named:

```
test("reviewer inbound reviewer<-researcher is denied before context; reviewer<-executor is accepted", async () => { ... })
```

The name advertises two assertions:

1. `reviewer <- researcher` is denied before context.
2. `reviewer <- executor` is accepted.

The test body only constructs and exercises the first case (researcher as sender).
The second case (executor as sender) is not constructed, not passed through the
reviewer's `onContext` hook, and not asserted. As written, the test passes for
the "denied" branch alone; the positive inbound assertion exists only in the
test's name.

## Evidence

```js
// tests/communication-policy.test.mjs (existing)
test("reviewer inbound reviewer<-researcher is denied before context; reviewer<-executor is accepted", async () => {
  const reviewerPolicy = createRoleRuntimePolicy("reviewer", { auditDir: join(REPO, ".tmp-audit-reviewer-inbound") });
  const inboundEvent = {
    messages: [
      {
        role: "custom",
        customType: "intercom_message",
        details: {
          from: { name: "researcher" },                 // only sender under test
          message: { id: "11111111-1111-4111-8111-111111111111" },
          bodyText: "agent-team/v1\nid: 11111111-1111-4111-8111-111111111111\ncorrelation_id: 11111111-1111-4111-8111-111111111111\nkind: request\nbody_encoding: base64url\nreferences: {}\nsubject: hi\nbody: YQ",
        },
      },
    ],
  };
  const contextResult = await reviewerPolicy.onContext(inboundEvent, ctx);
  assert.ok(contextResult, "context hook must return a result for denied researcher -> reviewer inbound");
  const customTypes = (contextResult.messages ?? []).map((m) => m.customType);
  assert.equal(customTypes.includes("intercom_message"), false, "researcher -> reviewer inbound must be filtered before context");
  // No executor -> reviewer inbound is constructed or asserted.
});
```

`BOUNDED_PEERS` in `.pi/communication/policy.mjs` allows `reviewer <- executor`; this
is enforced by `authorizePeer("executor", "reviewer") === true` and by the
`PolicyReceiver.receive({ sender: "executor", text })` check inside the
runtime policy. The contract exists in the production code but is not
exercised by the test that names it.

## Reproduction (current state, before fix)

```
$ node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs
# ...
ok 10 - reviewer inbound reviewer<-researcher is denied before context; reviewer<-executor is accepted
# 24 pass, 0 fail
```

The test name is "ok" but only because the half of the contract under that
name is satisfied. The positive inbound path is silently unverified.

## Expected behaviour

The test must construct an executor->reviewer inbound with a distinct UUID
and a valid envelope, pass it through the reviewer's `onContext` hook, and
assert that the result is `undefined` (i.e., no message was filtered, the
inbound reached the model context) or, equivalently, assert that the inbound
message remains in the kept messages list.

## Resolution

The Reviewer adds the positive assertion directly to the same test. The test
remains a single test (the contract is symmetric for the reviewer: deny
researcher, accept executor) and the test name remains unchanged.

## RESOLVED — 2026-08-24
Evidence:
- `node --test tests/communication-policy.test.mjs` output (verbatim):
```
TAP version 13
ok 1 - policy.mjs exposes only the three active runtime roles and legacy role names are rejected
ok 2 - researcher, executor, and reviewer are the only active role names; legacy roles are not accepted
ok 3 - async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer
ok 4 - researcher outbound peer shape matches the bounded set
ok 5 - executor outbound peer shape is exactly researcher + reviewer
ok 6 - reviewer outbound peer shape is exactly executor
ok 7 - contact_supervisor reasons allowed for all three active roles exactly need_decision, progress_update, interview_request
ok 8 - runtime policy tool_call blocks every non-allowed supervisor reason for every active role
ok 9 - intercom discovery actions list/list-cwd/status/pending are allowed; ask/reply/cancel are denied
ok 10 - reviewer inbound reviewer<-researcher is denied before context; reviewer<-executor is accepted
ok 11 - denied inbound reviewer<-researcher must not create a pending reply-store reservation; allowed executor->reviewer must be accepted
ok 12 - runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics unchanged
ok 13 - researcher subagentOnlyExtensions wires both pi-web-access provider and researcher policy
ok 14 - executor and reviewer each load their own communication policy extension
ok 15 - policy.mjs no longer exports the legacy critic fallback
1..15
# tests 15
# pass 15
# fail 0
# duration_ms 329.732872
```
- `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` output (verbatim):
```
PowerShell command could not be invoked in this reviewer session:
the running shell is a WSL2 bash process whose binfmt_misc interop
is disabled ("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
returns "Exec format error" on direct invocation). The script under
review is the 5-line wrapper:
  $ErrorActionPreference = 'Stop'
  $tsx = Join-Path $PSScriptRoot '..\.pi\npm\node_modules\.bin\tsx.cmd'
  & $tsx --test (Join-Path $PSScriptRoot 'team-contract.test.mjs') (Join-Path $PSScriptRoot 'communication-policy.test.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
i.e., it runs `tsx --test` with both test files. The reviewer invoked
the equivalent command natively and captured its verbatim output:
$ node .pi/npm/node_modules/tsx/dist/cli.mjs --test tests/team-contract.test.mjs tests/communication-policy.test.mjs
# tests 25
# pass 25
# fail 0
# duration_ms 847.839659
```
- Denied-path evidence (researcher → reviewer filtered, no reply-store side effect): file `.pi/communication/policy.mjs` line(s) 133-141:
```
export class PolicyReceiver {
  constructor(role, dedup = new DedupStore()) { this.role = role; this.dedup = dedup; }
  receive({ sender, text, expiresAt }, sideEffect = () => {}) {
    if (!authorizePeer(sender, this.role)) return { accepted: false, reason: "unauthorized" };
    let envelope;
    try { envelope = parseEnvelope(text, { expiresAt }); } catch (error) { return { accepted: false, reason: error.message }; }
    if (!this.dedup.accept(envelope.id, this.role)) return { accepted: false, reason: "duplicate" };
    sideEffect(envelope);
    return { accepted: true, envelope };
  }
}
```
file `.pi/communication/runtime-policy.mjs` line(s) 134-141:
```
          // Authorization MUST precede every reply-store side effect
          // (read/reserve/write) so an unauthorized sender-to-recipient pair
          // never triggers a persistent lookup or creates a pending record
          // that could collide with a later legitimate send.
          const authorization = receiver.receive({ sender, text });
          if (!authorization.accepted) {
            accepted = false;
          } else {
```
- Allowed-path evidence (executor → reviewer accepted): file `.pi/communication/policy.mjs` line(s) 5-7:
```
export const BOUNDED_PEERS = new Map([
  ["researcher", new Set(["executor"])],
  ["executor", new Set(["researcher", "reviewer"])],
```
file `.pi/communication/policy.mjs` line(s) 133-141:
```
export class PolicyReceiver {
  constructor(role, dedup = new DedupStore()) { this.role = role; this.dedup = dedup; }
  receive({ sender, text, expiresAt }, sideEffect = () => {}) {
    if (!authorizePeer(sender, this.role)) return { accepted: false, reason: "unauthorized" };
    let envelope;
    try { envelope = parseEnvelope(text, { expiresAt }); } catch (error) { return { accepted: false, reason: error.message }; }
    if (!this.dedup.accept(envelope.id, this.role)) return { accepted: false, reason: "duplicate" };
    sideEffect(envelope);
    return { accepted: true, envelope };
  }
}
```
file `tests/communication-policy.test.mjs` line(s) 209-241 (the positive assertion case within test #10):
```
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
```
- Repository-root `.tmp-*` directory listing (verbatim, proving none exist):
```
$ find /mnt/d/Coding/Harness/Pi-team-bootstrap -maxdepth 1 -name '.tmp*'
(empty result; no .tmp-* directories present at the repository root)
$ ls -A /mnt/d/Coding/Harness/Pi-team-bootstrap/ | grep -E '^\.tmp'
(empty result)
```
Verifier: reviewer

## RESOLVED — 2026-08-24 (cycle 3 re-verification)
- Re-ran `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs` → 25/25 pass.
- No `.tmp-*` directories at the repository root (`ls -d .tmp-*` exit 2; `ls -A | grep -E '^\.tmp'` empty).
- Test #10 (`reviewer<-researcher denied; reviewer<-executor accepted`) passes; reviewer<-executor positive assertion remains in scope.
- Verdict: PASS.