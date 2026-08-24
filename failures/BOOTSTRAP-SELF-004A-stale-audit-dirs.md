# BOOTSTRAP-SELF-004A — `tests/` leak untracked `.tmp-audit-*` directories into the repository root

Severity: medium (test-hygiene violation; pollutes `git status` and `git diff --check` outputs)

## Summary

`tests/communication-policy.test.mjs` passes `auditDir` to
`createRoleRuntimePolicy` as `join(REPO, ".tmp-audit-<role>")`. The runtime
policy writes JSONL audit records into that directory whenever the audit
hook is exercised, but the test never cleans up the directory. Each test
run leaves behind one or more untracked `.tmp-audit-<role>-<case>/`
directories at the project root, which show up in `git status` as
untracked files and are not covered by `.gitignore`.

## Evidence

After a single run of `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs`, the project root contains:

```
?? .tmp-audit-executor-intercom/
?? .tmp-audit-executor-supervisor/
?? .tmp-audit-researcher-intercom/
?? .tmp-audit-researcher-supervisor/
?? .tmp-audit-reviewer-inbound/
?? .tmp-audit-reviewer-intercom/
?? .tmp-audit-reviewer-supervisor/
```

Each directory contains a JSONL file:

```
.tmp-audit-executor-supervisor/executor.jsonl
.tmp-audit-researcher-supervisor/researcher.jsonl
.tmp-audit-reviewer-supervisor/reviewer.jsonl
```

`.gitignore` covers `.tmp-real-role/` and `.tmp-role-audit*/` but does **not**
cover `.tmp-audit-*`. The leftover directories appear in plain `git status`
output and persist across test runs.

Source of the leak (excerpt):

```js
// tests/communication-policy.test.mjs
test("researcher, executor, and reviewer are the only active role names; legacy roles are not accepted", async () => {
  for (const role of ACTIVE_ROLE_NAMES) {
    const policy = createRoleRuntimePolicy(role, { auditDir: join(REPO, `.tmp-audit-${role}`) }); // writes auditDir/<role>.jsonl
    ...
  }
  ...
});
```

The runtime policy constructs `appendPolicyAudit(role, ..., auditDir)` which
calls `mkdir(auditDir, { recursive: true })` and `appendFile(...)` on each
audit event. The test never removes the directory.

## Reproduction (current state, before fix)

```
$ rm -rf .tmp-audit-*
$ node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs
# 24 pass
$ git status --short | grep tmp-audit
?? .tmp-audit-executor-intercom/
?? .tmp-audit-executor-supervisor/
?? .tmp-audit-researcher-intercom/
?? .tmp-audit-researcher-supervisor/
?? .tmp-audit-reviewer-inbound/
?? .tmp-audit-reviewer-intercom/
?? .tmp-audit-reviewer-supervisor/
```

## Expected behaviour

Tests must not leave untracked artifacts in the repository root. Either:

- the test must use the OS temp directory (`os.tmpdir()` / `mkdtempSync`) so
  the artifact is created outside the repository; or
- the test must clean the artifact directory in a `finally` (or `t.after`)
  block so the directory is removed even on test failure.

The Reviewer edits the test to use `os.tmpdir()` plus a `t.after` cleanup
hook for each audit-creating test, which guarantees the audit dir is
removed after every test regardless of pass/fail.

## Resolution

See the test edits applied by the Reviewer to
`tests/communication-policy.test.mjs`. The legacy `.tmp-role-audit*`
entries are already covered by `.gitignore` and are out of scope.

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
- Denied-path evidence (researcher → reviewer filtered, no reply-store side effect): file `.pi/communication/policy.mjs` line(s) 18-20:
```
export function authorizePeer(sender, recipient) {
  return BOUNDED_PEERS.get(sender)?.has(recipient) === true;
}
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
file `.pi/communication/runtime-policy.mjs` line(s) 137-155:
```
          const authorization = receiver.receive({ sender, text });
          if (!authorization.accepted) {
            accepted = false;
          } else {
            // Authorized: look up any prior completed reply for replay only.
            // No "pending" reservation is written on accept; duplicates within
            // the window are deduped by PolicyReceiver's in-memory DedupStore.
            const previous = parsed ? await replyStore.read(normalized, parsed.id) : undefined;
            if (previous?.status === "completed") {
              kept.push({ ...message, customType: "intercom_replay", details: { ...message.details, bodyText: `REPLAY-OF:${parsed.id}\n${previous.reply}` } });
              changed = true;
              continue;
            }
            accepted = true;
          }
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
- `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs` → 25/25 pass.
- `ls -d .tmp-* 2>/dev/null` returns exit 2 (no `.tmp-*` directories present) at the repository root.
- `ls -A | grep -E '^\.tmp'` returns empty.
- Verdict: PASS.