# COMPRESSION-001 — C-004 behavioral coverage absent; "valid TypeScript" test is vacuous; artifact name conflicts with contract

**Task:** COMPRESSION-001
**Finding:** `c004-behavioral-coverage-and-artifact-name-mismatch`
**Severity:** Medium
**Status:** Open (REVIEW_FAIL)

## Summary

Three related problems block a clean C-004 review:

1. The Reviewer's contract-mandated artifact `tests/automatic-compression.test.mjs`
   does not exist (the Executor created `tests/compression.test.mjs` instead,
   and modified `tests/team-contract.test.mjs` to assert an exact tests/
   directory listing that excludes the contract artifact name). Per the
   contract `REVIEW-COMPRESSION-001` delegation,
   `artifact_path: "tests/automatic-compression.test.mjs"` is the Reviewer-owned
   artifact; the Executor's `compression.test.mjs` is a different file that the
   deterministic contract test now locks in with `assert.deepEqual` on the
   directory listing. Adding the required artifact therefore breaks the
   deterministic suite.

2. The Executor's `tests/compression.test.mjs` header claims "The extension
   itself is tested via a fake Pi runtime", but the file contains **no
   behavioral test** of the extension's event handlers — only unit tests of the
   config loader (`team-runtime.mjs`) and checkpoint writer (`checkpoint.mjs`)
   plus static text checks. C-004 requires tests that PROVE threshold-compact
   fires once, retry is capped, resource cap stops safely, the checkpoint is
   credential-free, and plain resume does not reuse a constrained session. None
   of those behaviors is exercised behaviorally in the Executor's file.

3. The `compression extension file is valid TypeScript` test is vacuous: it
   parses the `.ts` file with the PowerShell language parser, and because
   `[ref]$err` requires `$err` to pre-exist (it does not), real TypeScript
   errors are never surfaced. Empirically, a deliberately invalid `.ts` file
   also produces "OK" from the same check. It is not a TypeScript compile and
   cannot fail on type errors.

## Reproduction

- `git status` on the worktree: `tests/automatic-compression.test.mjs` absent;
  `tests/compression.test.mjs` present and referenced by
  `tests/team-contract.test.mjs` (exact-list assertion) and
  `tests/run-tests.ps1`.
- The "valid TypeScript" check returns OK for both `compression.ts` and a
  deliberately broken `.ts` file (verified with a throwaway probe).
- `tests/automatic-compression.test.mjs` (added by Reviewer for C-004) runs
  and exposes two FAILING behaviors — the real defects captured in the two
  companion failure artifacts.

## Expected vs observed

- **Expected (contract):** Reviewer artifact `tests/automatic-compression.test.mjs`
  exists; deterministic tests do not lock in a conflicting test-file name; the
  extension's behaviors are actually exercised (fake Pi); any TypeScript check
  is a real type check.
- **Observed:** wrong test-file name is locked into the deterministic suite;
  no behavioral extension coverage; a vacuous PowerShell-parser check stands in
  for TypeScript validation.

## Criteria violated

- **C-004** (reviewer): the behavioral proofs required by the done criteria are
  not present in the Executor's tests and the contract artifact name is not
  honored.

## Fix direction

- Use the contract artifact name `tests/automatic-compression.test.mjs` for the
  Reviewer-owned C-004 test file (the Reviewer has added it), and update
  `tests/team-contract.test.mjs` / `tests/run-tests.ps1` to include both files
  consistently.
- Add real behavioral coverage of the extension event handlers (the Reviewer's
  `tests/automatic-compression.test.mjs` provides this via a fake Pi runtime).
- Replace or remove the vacuous PowerShell-parser "TypeScript" check with a real
  `tsc`/`tsx` type check, or drop it if a real TS toolchain is unavailable.

## Evidence

- `tests/automatic-compression.test.mjs` (Reviewer artifact, 2 of 4 behaviors
  currently failing due to the production defects).
- `tests/team-contract.test.mjs` lines ~870-886 (exact tests-directory listing).
- Probe showing the PowerShell parser returns OK for an invalid `.ts` file.
