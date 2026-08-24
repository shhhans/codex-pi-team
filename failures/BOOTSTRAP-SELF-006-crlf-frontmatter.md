# BOOTSTRAP-SELF-006 — CRLF frontmatter parser failure on Windows checkout

## Lead task ID
`BOOTSTRAP-SELF-006`

## Finding ID
`crlf-frontmatter`

## Status
RESOLVED (tests: 25/25 pass after the cross-platform parser fix described below).

## Failure description

On a Windows checkout, all role prompt files under `.pi/agents/` and all skill
files under `.pi/skills/*/SKILL.md` are stored with **CRLF line terminators**
(verified with `file`):

```
.pi/agents/researcher.md:    ASCII text, with very long lines (329), with CRLF line terminators
.pi/agents/executor.md:      ASCII text, with very long lines (319), with CRLF line terminators
.pi/agents/reviewer.md:      ASCII text, with very long lines (344), with CRLF line terminators
.pi/skills/answer-research-question/SKILL.md:   Unicode text, UTF-8, with CRLF line terminators
.pi/skills/execute-delegated-task/SKILL.md:     Unicode text, UTF-8, with CRLF line terminators
.pi/skills/review-delegated-task/SKILL.md:      Unicode text, UTF-8, with CRLF line terminators
```

The shared `parseFrontmatter` helper in both top-level test files matches the
frontmatter delimiters with a **LF-only** regex:

```js
// tests/team-contract.test.mjs:17  and  tests/communication-policy.test.mjs:26 (before fix)
const match = text.match(/^---\n([\s\S]*?)\n---/);
```

Because every CRLF source file starts the first line as `---<CR>` followed by
`\n`, the `^---\n` pattern requires `---` followed by a bare `\n`, which does
not occur. `parseFrontmatter` therefore throws `Error: missing frontmatter` for
every role file and every skill file, and **7 of 25 tests fail**.

The rest of `parseFrontmatter` is already CRLF-safe — the body lines are split
with `body.split(/\r?\n/)` — so the failure is localized to the delimiter regex.

## Reproduction

```
$ file .pi/agents/*.md .pi/skills/*/SKILL.md
.pi/agents/executor.md:    ASCII text, with CRLF line terminators
.pi/agents/researcher.md:  ASCII text, with CRLF line terminators
.pi/agents/reviewer.md:    ASCII text, with CRLF line terminators
.pi/skills/answer-research-question/SKILL.md:    Unicode text, UTF-8, with CRLF line terminators
.pi/skills/execute-delegated-task/SKILL.md:      Unicode text, UTF-8, with CRLF line terminators
.pi/skills/review-delegated-task/SKILL.md:       Unicode text, UTF-8, with CRLF line terminators

$ node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs
# tests 25
# pass 18
# fail 7
not ok 13 - researcher subagentOnlyExtensions wires both pi-web-access provider and researcher policy
not ok 14 - executor and reviewer each load their own communication policy extension
not ok 17 - three skills exist with SKILL.md and agents/openai.yaml
not ok 18 - active role definitions exist with valid frontmatter and required tools
not ok 19 - researcher provider is installed pi-web-access and has no Deep Research tools
not ok 20 - executor has required implementation tools and the delegated-task skill
not ok 21 - reviewer has bash/edit/write, the review-delegated-task skill, and never edits production code
# error: 'missing frontmatter'  (parseFrontmatter)
```

Every failure is the same root cause: `parseFrontmatter` cannot locate the
opening `---` followed by a bare `\n` because CRLF files emit `---<CR><LF>`.

## Regression fix

Added `\r?` to the frontmatter-delimiter regex in both test files so the
delimiter accepts either a bare LF or a CRLF line terminator. The three-hyphen
delimiter itself is unchanged; only the line terminator is broadened, which
preserves the contract strictness.

### Diff (10 added / 2 removed across both test files)

```diff
diff --git a/tests/team-contract.test.mjs b/tests/team-contract.test.mjs
@@ -13,7 +13,11 @@ const ACTIVE_ROLES = ["researcher", "executor", "reviewer"];
 const LEGACY_ROLES = ["architect", "critic", "engineer"];

 function parseFrontmatter(text) {
-  const match = text.match(/^---\n([\s\S]*?)\n---/);
+  // Accept optional carriage returns on the frontmatter delimiters so CRLF
+  // (Windows) and LF (Unix) source files parse identically. The delimiter
+  // itself remains three hyphens on its own line; only the line terminator
+  // is broadened to keep the contract strict.
+  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
   if (!match) throw new Error("missing frontmatter");
   const body = match[1];
   const out = {};

diff --git a/tests/communication-policy.test.mjs b/tests/communication-policy.test.mjs
@@ -22,7 +22,11 @@ const EXPECTED_SUPERVISOR_REASONS = new Set(["need_decision", "progress_update",
 const SAFE_INTERCOM_ACTIONS = new Set(["list", "list-cwd", "status", "pending"]);

 function parseFrontmatter(text) {
-  const match = text.match(/^---\n([\s\S]*?)\n---/);
+  // Accept optional carriage returns on the frontmatter delimiters so CRLF
+  // (Windows) and LF (Unix) source files parse identically. The delimiter
+  // itself remains three hyphens on its own line; only the line terminator
+  // is broadened to keep the contract strict.
+  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
   if (!match) throw new Error("missing frontmatter");
   const body = match[1];
   const out = {};
```

### Scope

- `tests/team-contract.test.mjs` — 5 added, 1 removed (regex + comment).
- `tests/communication-policy.test.mjs` — 5 added, 1 removed (regex + comment).
- No production code touched.
- No role prompts touched (`.pi/agents/*.md` unchanged on disk).
- No skills touched (`.pi/skills/*/SKILL.md` unchanged on disk).
- No root architecture docs touched (`AGENTS.md`, `goal.md`, `project_state.md`,
  `architect.md`, `ADR/0001-minimal-development-loop.md` all unchanged).
- The CRLF role/skill files themselves are intentionally NOT rewritten to LF;
  per Lead instruction the fix is in the test parser, not in source content.

### LF regression check

Independently verified that LF-only files still parse with the broadened regex:

```
LF sample:   ---\nname: lf-test\n---\n    => match OK
CRLF sample: ---\r\nname: crlf-test\r\n---\r\n => match OK
```

The `body.split(/\r?\n/)` line tokenizer already handled CRLF body content, so
no further code changes were needed.

## Exact test result after the fix

```
$ node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs
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
ok 16 - exactly three active agents and no other role files in .pi/agents
ok 17 - three skills exist with SKILL.md and agents/openai.yaml
ok 18 - active role definitions exist with valid frontmatter and required tools
ok 19 - researcher provider is installed pi-web-access and has no Deep Research tools
ok 20 - executor has required implementation tools and the delegated-task skill
ok 21 - reviewer has bash/edit/write, the review-delegated-task skill, and never edits production code
ok 22 - active role memory files are absent and the executor runtime directory is removed
ok 23 - artifact roots exist at the project root with exact contracts
ok 24 - legacy role material is preserved under .pi/legacy/
ok 25 - tests directory contains the deterministic contract and communication-policy tests
# tests 25
# pass 25
# fail 0
```

Result: **25/25 pass** (was 18/25 before the fix).

## Verdict

PASS — the regression fix is minimal, scoped to tests only, preserves
delimiter strictness, and resolves all 7 previously-failing tests to green on
this CRLF checkout. Reviewer stopped; no commit, no further edits.
