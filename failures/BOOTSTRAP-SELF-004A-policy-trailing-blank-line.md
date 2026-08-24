# BOOTSTRAP-SELF-004A — `.pi/communication/policy.mjs` ends with an extra blank line at EOF

Severity: low (lint-style; `git diff --check` flags it)

## Summary

`.pi/communication/policy.mjs` ends with two blank lines after the final
closing brace of the `shouldMirror` export. Native `git diff --check` reports
the issue, which means the file fails common lint pipelines that rely on
`git diff --check` to catch trailing whitespace and stray blank lines.

This is a production-code issue. The Reviewer does not edit production code.
The artifact records the finding so the next Executor cycle can fix it.

## Evidence

```
$ git diff --check .pi/communication/policy.mjs
.pi/communication/policy.mjs:154: new blank line at EOF.
```

```
$ wc -l .pi/communication/policy.mjs
155 .pi/communication/policy.mjs

$ tail -3 .pi/communication/policy.mjs | cat -A
  return changesDownstream || materialRisk || invalidatesAssumption || !cosmeticOnly;$
}$
$
$
```

The final three bytes are `} \n \n \n`: one trailing newline for the
function body, plus two blank lines and a final newline. `git diff --check`
flags line 154 (the first trailing blank line).

## Reproduction

From the repository root with the BOOTSTRAP-SELF-004A changes applied:

```
$ git diff --check
.pi/communication/policy.mjs:154: new blank line at EOF.
```

## Expected behaviour

A single trailing newline after the last `}` is the POSIX text-file
convention. The file should end with:

```
  return changesDownstream || materialRisk || invalidatesAssumption || !cosmeticOnly;
}
```

(no extra blank line).

## Resolution

Requires a production-code edit. The Reviewer does not edit production
code. Pass this artifact to the next Executor cycle so a one-line fix
trims the trailing blank line.

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
- Repository-root `.tmp-*` directory listing (verbatim, proving none exist):
```
$ find /mnt/d/Coding/Harness/Pi-team-bootstrap -maxdepth 1 -name '.tmp*'
(empty result; no .tmp-* directories present at the repository root)
$ ls -A /mnt/d/Coding/Harness/Pi-team-bootstrap/ | grep -E '^\.tmp'
(empty result)
```
Verifier: reviewer

## RESOLVED — 2026-08-24 (cycle 3 re-verification)
- `wc -l .pi/communication/policy.mjs` reports 153 lines; `tail -3 | cat -A` shows `}\n` at EOF (no trailing blank line).
- `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs` → 25/25 pass.
- No `.tmp-*` directories at the repository root.
- Verdict: PASS.