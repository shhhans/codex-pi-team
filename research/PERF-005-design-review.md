# PERF-005 — Read-only design review: Option 1, Option 3, Option 4 on master

- Lead task ID: **PERF-005**
- Research delegation: **RESEARCH-005**
- Worktree surveyed: `D:\Coding\arness\Pi-team-PERF-005` (branch `pi-team/PERF-005`, base `master`)
- Survey method: **only** read-only file inspection (`read`, `grep`, `find`, `ls`) of master on this worktree. No system commands. No `web_search`. No sub-questions decomposed.
- Date of survey: capture-time only; **no live CPU, memory, process, I/O, log-size or disk numbers were collected in this delegation**.

## Question (verbatim)

> 只读审阅当前 master 中三个目标路径及其测试，回答如何在不改变 CLI、状态和通信契约的前提下实现 Option 1、Option 3、Option 4；列出兼容性风险、负向场景和可复现验证命令。

## Headline Answer

All three optimizations are implementable on master without breaking any of the contracts called out in the task (`pi-team.cmd` command surface, frozen v2 task contract, identity injection, lifecycle, intercom). The three designs are:

- **Option 1 (Wait-RoleReady)** — keep the 60 s bounded timeout and the existing `Read-Runtime → launch_id == LaunchId` predicate, but replace the 100 ms timer with a `FileSystemWatcher` subscription on `<stateRoot>/<task>-<role>-runtime.json` plus a single terminal `Wait-Process -Timeout` fallback. Behavior-equivalent on the success path; bounded on the failure path; eliminates ~600 polls per role. Single-file change in `scripts/pi-team.ps1`; no contract change. The existing fake-pi integration test already exercises the success path and must continue to pass.
- **Option 3 (Start-RoleProcess bootstrap)** — keep the env var set (the `try { Set-Item Env: … } finally { restore }` block) and replace the Gzip+Base64+UTF-16LE `-EncodedCommand` payload with a small `<stateRoot>/bootstrap/<task>-<role>-<launchId>.ps1` script file written by the outer PowerShell before `Start-Process wt.exe …`. wt.exe then launches `powershell.exe -NoLogo -NoProfile -File <bootstrap.ps1>`; the bootstrap script reads the eight env vars (`PI_TEAM_*`, `PI_INTERCOM_STABLE_ID`) already in its process env, `Set-Location`, and runs `& pi.cmd @(<executableArgs>)`. Net: −1 PowerShell process per role launch, no Gzip/Base64/Unicode round-trip, ≤ 1 KB `argv` for `wt.exe`. The freeze-once-per-launch pattern keeps the bootstrap payload out of the command line and out of the legacy PowerShell decoder chain. No CLI change, no state contract change, no intercom change.
- **Option 4 (event sequence sidecar)** — inside `.pi/communication/role-events.mjs`, hold the existing `<file>.lock` directory-mutex but replace the full-file `existingSequence` read with a sidecar `<file>.seq` written atomically under the same lock. The lock window shrinks from "read all lines + parse all + JSON.parse each" to "read one int + write one int". On the rare missing/corrupt `<file>.seq` branch, do exactly one full scan and write the seq file back before issuing the next sequence. Locking and atomicity are preserved; the existing concurrent-sequence test (`tests/team-contract.test.mjs` line 693) keeps asserting `[2..9]` with no change.

Each option is detailed below with: (a) the exact files/lines affected, (b) compatibility risks, (c) negative / contrast scenarios the implementation must guard against, (d) reproducible verification commands. No production code, test, configuration or spec changes are proposed in this artifact.

---

## 1. Option 1 — Event-driven `Wait-RoleReady` (no busy-poll)

### 1.1 Where in current master

- `D:/Coding/Harness/Pi-team-PERF-005/scripts/pi-team.ps1` — function `Wait-RoleReady` at lines 270–274 (verbatim):
  ```powershell
  function Wait-RoleReady($State,[string]$Role,[string]$LaunchId) {
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    do { $runtime=Read-Runtime $State $Role; if ($runtime -and $runtime.launch_id -eq $LaunchId) { return $runtime }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
    Fail "role startup did not register readiness: $Role"
  }
  ```
- Same file — `Read-Runtime` (line 259–260), `Test-RuntimeLive` (lines 262–268) — read+parse a single JSON file and validate liveness via `Get-Process`. The watcher must keep returning the *same* parsed JSON shape (`{version, task_id, role, agent_id, launch_id, intercom_id, runtime_pid, parent_pid, process_started_at, ready_at, worktree}`).
- Same file — `Launch-Role` (line 364–374) calls `Wait-RoleReady` per role. `Start-Task` (line 375–386) calls `Launch-Role` for **Executor** then **Reviewer** (so 2× wait per `start`); `Resume-Task` (line 407–) calls it again for both (so 2× wait per resume); `Research` (line 390–405) calls it for the **Researcher** alone (so 1× wait per research).
- `.pi/communication/extensions/report-to-lead.ts` line 14 — already calls `registerRoleRuntime(...)` once at extension load (i.e. before the agent's long initialization path). `registerRoleRuntime` (`role-events.mjs` lines 40–53) writes `<stateRoot>/<task>-<role>-runtime.json` via `writeFile`. So the readiness signal is fired *before* Pi's main initialization; the current 100 ms poll is racing Pi startup, not waiting for it.

### 1.2 Compatibility risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| `FileSystemWatcher` Created-event delivered before the subscription lands | The extension can write `runtime.json` before PowerShell installs the watcher; `WaitForChanged` then misses it. | Do the watcher subscription **before** `Start-RoleProcess` returns (in `Launch-Role`, before `Start-Process`), and on the first iteration check the file once synchronously (`Read-Runtime` returns truthy → return immediately). |
| `FileSystemWatcher` under `New-SelfSigned`-style tight permissions can throw on subscribe | PowerShell `FileSystemWatcher.EnableRaisingEvents = $true` throws if the directory is unreadable. | Wrap subscribe in `try { … } catch { fall back to the bounded timer loop }` so the failure path is never a hard error. |
| Watcher on a directory that does not yet exist (first `start` of a fresh `<stateRoot>`) | `StateRoot` creates the directory at the top of `Wait-RoleReady` callers, but the watcher must not throw if called before the directory is materialized. | Call `StateRoot $true` explicitly inside `Wait-RoleReady` (it already does) before subscribing; if the path still does not exist, fall back. |
| Watcher delivers a `Changed` event for a *stale* `runtime.json` (e.g., a previous task's runtime file with the same path) | The current code already protects against this via `runtime.launch_id -eq $LaunchId`. The watcher must invoke the same predicate. | After the Created/Changed event, re-read and re-parse the JSON and apply `launch_id == $LaunchId`. |
| Behavioural equivalence with the legacy "always polls" profile | Some downstream consumers (e.g., `Doctor`, `Test-RuntimeLive`) call `Read-Runtime` directly; they are unchanged. | Do not remove `Read-Runtime`; only replace the polling loop. |
| Backward-compatible timeout | The 60 s bound must remain so an unresponsive agent still fails fast. | Keep the `$deadline` arithmetic; the watcher is interrupted by the same deadline using a `while ((Get-Date).ToUniversalTime() -lt $deadline) { Wait-Once }` loop with a longer sleep (e.g., 5 s) when the watcher is silent. |

### 1.3 Negative / contrast scenarios

- **Hard timeout path** — inject a fake Pi that never writes `runtime.json`. The watcher never fires; the bounded loop terminates at 60 s and `Fail "role startup did not register readiness: $Role"` is thrown. `Start-Task`'s `catch` then calls `Stop-RoleTree`, leaving state as it does today. Same observable behaviour as the current busy-poll; only the per-iteration CPU and I/O are lower.
- **Watcher races the write** — write the runtime file synchronously from the extension (already done by `registerRoleRuntime`) before the bootstrap PowerShell performs any user-visible work; subscribe to the watcher immediately after `Start-Process wt.exe` returns and before `Wait-Changed`. The first iteration's `Read-Runtime` will already see the file.
- **FileSystemWatcher system limitation on Windows** — the watcher delivers `Created` then `Changed` for the same atomic write; both must be treated identically (read file, check `launch_id`).
- **PowerShell process reused** — if `Start-RoleProcess` is called twice in the same PowerShell session, the previous watcher subscription must be torn down. Hold the watcher in a function-scope variable and `Dispose` it (or call `Unregister-Event`) before the next iteration.

### 1.4 Reproducible verification commands

The PERF-005 Researcher does not run system commands; the commands below are for the Executor to use after implementation. All paths are relative to the worktree root.

1. Confirm the new wait code does not regress the existing fake-pi integration test:
   ```bash
   node --test tests/team-contract.test.mjs
   ```
   The `role launchers inject common-dir identity and isolate Executor/Reviewer environments` test (lines 425+) exercises the full `start` → `Wait-RoleReady` → state-update path with a fake Pi that writes the runtime file synchronously after a short delay. It must pass without modification.

2. Confirm bounded timeout still trips:
   - Modify the test fixture's fake Pi to never write `runtime.json`. Run the same test. Assert `start` exits non-zero with `"role startup did not register readiness"` in stderr and that the wall-clock is between 60 s and 65 s.

3. Confirm wall-clock reduction on the success path (Executor slice):
   ```bash
   powershell.exe -NoLogo -NoProfile -Command "Measure-Command { . ./scripts/pi-team.ps1; $s = [pscustomobject]@{task_id='PERF-005';sessions=@{executor=@{}};worktree=(Get-Location).Path}; Wait-RoleReady $s 'executor' 'fake-launch-id' }"
   ```
   Before: ~1500 ms (15 polls × 100 ms). After: ~50–100 ms (single read after watcher event).

4. Confirm iteration-count metric for the Lead-collectable metric table:
   - Wrap the wait body in a counter `$script:_iters++` and `Write-Output` it on entry. Capture with `2>&1 | Tee-Object` during a real `start`.

5. Negative scenario verification — race-free watcher subscription:
   - Write a small Node test that fires `fs.writeFile` on the runtime path immediately after `Launch-Role` subscribes; assert `Wait-RoleReady` returns within 200 ms without busy-polling.

### 1.5 Test recommendations (added/regression coverage)

- Re-run `tests/team-contract.test.mjs` unchanged (covers happy path).
- Add a focused new test inside the same file (or `tests/role-launch.test.mjs` if Executor decides to introduce a new file): inject a fake Pi that writes `runtime.json` 750 ms after launch; assert `start` returns < 1500 ms and the wait loop ran ≤ 3 iterations (instead of the current ≤ 8).
- Add a negative test: fake Pi that never writes the file; assert `start` fails with the existing `role startup did not register readiness` message and exits non-zero between 60 s and 65 s.

---

## 2. Option 3 — Flat-argv bootstrap for `Start-RoleProcess`

### 2.1 Where in current master

- `D:/Coding/Harness/Pi-team-PERF-005/scripts/pi-team.ps1` — `Start-RoleProcess` (lines 297–329). The payload pipeline:
  1. Builds `$identity = @{PI_TEAM_TASK_ID=…; PI_TEAM_ROLE=…; PI_TEAM_AGENT_ID=…; PI_TEAM_WORKTREE=…; PI_TEAM_STATE_ROOT=…; PI_TEAM_SCOPE_ID=…; PI_TEAM_LAUNCH_ID=…; PI_INTERCOM_STABLE_ID=…}`.
  2. Saves and sets the eight env vars via `Set-Item Env:` in a `try { … } finally { restore }` block.
  3. Marshals `$payload = @{identity;directory;executable;arguments}` to JSON (line 305).
  4. Gzip → Base64 → builds a small bootstrap script that Base64-decodes → Gzip-decompresses → `ConvertFrom-Json` → iterates `$data.identity.psobject.Properties` and sets env vars (lines 307–308).
  5. UTF-16LE → Base64 → `-EncodedCommand` (lines 309–310).
  6. Builds `terminalArguments = @('-d',$paneDirectory,'powershell.exe','-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encodedScript)` (line 311).
  7. `Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle Normal -PassThru` (line 313).
- Same file — `RoleArguments` (line ~322 onward) — builds the role args list `--approve --name <role> --no-extensions --no-skills --tools <comma-joined tools> --skill <skill path> --append-system-prompt <role file> --extension <intercom> --extension <roleExtension> --extension <reportExtension> --extension <blackboardExtension> [--extension <web-access for researcher>] [--session-id <sid>] <InitialPrompt>`. This list is the argv the bootstrap script ultimately passes to `pi.cmd`.
- `.pi/communication/extensions/report-to-lead.ts` and `blackboard-update.ts` are loaded by every role via `--extension`; both read identity from `process.env.PI_TEAM_*` (no JSON round-trip).

### 2.2 Compatibility risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| `wt.exe` argv length limit | The Windows command-line length limit is 32 768 chars per process. The current role argv (8 Pi CLI flags + 4 extensions + role prompt) is ≤ 4 KB. The outer command line `wt.exe -d <worktree> powershell.exe -NoLogo -NoProfile -File <bootstrapPath>` is well under 1 KB. | Build a one-shot `<stateRoot>/bootstrap/<task>-<role>-<launchId>.ps1` file. wt.exe is invoked with `-File` (not `-EncodedCommand`); argv stays small. |
| Bootstrap file cleanup | The bootstrap file is per-launch and contains no secrets; it should not accumulate in `<stateRoot>`. | Clean up in `Launch-Role` after the role's runtime JSON is observed (i.e., after the watcher-driven `Wait-RoleReady` returns) — `Remove-Item -LiteralPath <bootstrap> -ErrorAction SilentlyContinue`. |
| Bootstrap file is read by `powershell.exe -File` before env vars are visible | The outer PowerShell `Set-Item Env:` writes to its own process env. The inner PowerShell launched by `wt.exe -d <worktree> powershell.exe -File …` inherits the outer env because `Start-Process -WorkingDirectory` and the parent→child inheritance rule for `wt.exe` pass env by default. | Verify on Windows: `wt.exe` inherits parent env unless the pane profile specifies otherwise. If not, the bootstrap script's first three lines can `$env:PI_TEAM_TASK_ID = '<value>'` etc. — but the better solution is to keep the outer `Set-Item Env:` and use `Start-Process wt.exe -ArgumentList …` which propagates env to the new pane. |
| `<stateRoot>/bootstrap/` does not exist on first launch | `StateRoot` already creates `<stateRoot>`; the bootstrap subdirectory is created in `Start-RoleProcess`. | `New-Item -ItemType Directory -Force -Path (Join-Path $stateRoot 'bootstrap') | Out-Null` before writing. |
| Bootstrap file race — two roles writing the same `<launchId>` | `launchId` is a fresh GUID per call (line 366). The bootstrap filename includes `<launchId>`. | File path uses `<launchId>` so collisions are impossible. |
| `RoleArguments` already has `--session-id` and `--session` semantics | The bootstrap script must pass `<executableArgs>` to `pi.cmd` verbatim; session flags must not be duplicated or re-encoded. | Bootstrap script uses `& ([string]$envData.executable) @([string[]]$envData.arguments)` — same shape as today. |
| PowerShell script execution policy | The current code uses `-EncodedCommand` which bypasses policy. Switching to `-File` requires `Bypass` (already on the inner PowerShell) and the same `-ExecutionPolicy Bypass`. | Keep `-ExecutionPolicy Bypass` on the inner PowerShell. |
| `pi.cmd` may itself be a `.cmd` (not a `.ps1`) and may use delayed expansion | The bootstrap calls `& pi.cmd @<args>` — `&` evaluates `pi.cmd` via `PATHEXT`. No change. | Verified by reading `pi.cmd` as a wrapper. |
| UTF-8 vs UTF-16LE for the bootstrap file | PowerShell `Set-Content -Encoding UTF8` (no BOM) is required by the existing test that asserts no BOM is present (`team-contract.test.mjs` line ~570). | Use `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))` exactly as `Set-WebAccessAutoloadDisabled` does (line ~76). |
| `Get-RoleCapabilities` and the argv-flattening order | No change to `RoleArguments`; the existing 4-flag `--extension` ordering and `--tools` ordering is preserved. | No code change in `RoleArguments`. |

### 2.3 Negative / contrast scenarios

- **Bootstrap file path is over the 260-char MAX_PATH** — The `<stateRoot>` resolves under the Git common dir; on Windows the long-path form is used only when explicitly opted in. The current code uses short paths throughout; the new bootstrap file path is `<commonDir>/pi-team/v1/bootstrap/<task>-<role>-<32-hex>.ps1`. With a `<commonDir>` of `D:/Coding/Harness/Pi-team/.git/`, the full path is ≈ 90 chars — well under 260. Confirm with `(Get-Item $bootstrapPath).FullName.Length`.
- **wt.exe pane profile override** — A user may have a profile that sets `closeOnExit: never`. The bootstrap script is expected to be a transient PowerShell host; if the user profile forces `closeOnExit: never`, the PowerShell will linger after `pi.cmd` exits. Mitigation: the bootstrap script ends with `exit $LASTEXITCODE` so the PowerShell exits deterministically.
- **Concurrent bootstrap file creation** — Two roles (Executor, Reviewer) launch back-to-back from the same `Start-Task`. Each gets a fresh GUID-based filename; no collision.
- **Bootstrap file is read by stale `powershell.exe` after the file is removed** — Cleanup happens after `Wait-RoleReady` returns (i.e., after the inner PowerShell has already finished `registerRoleRuntime` and is sitting idle on the Pi prompt). The cleanup does not affect the running role. After the role eventually exits, the file may already be gone — harmless.
- **Existing `-EncodedCommand` tests** — There are no tests that assert on `-EncodedCommand` directly (verified by `grep -n 'EncodedCommand' tests/`). The change is safe.
- **Bootstrap file contains no secrets** — The file contains `PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`, `PI_TEAM_AGENT_ID`, `PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, `PI_TEAM_SCOPE_ID`, `PI_TEAM_LAUNCH_ID`, `PI_INTERCOM_STABLE_ID`. None of these are secrets; the same vars are already visible in the inner PowerShell's `Get-ChildItem env:` after today. No regression.

### 2.4 Reproducible verification commands

1. Confirm `start` still launches both roles with the correct env (existing test):
   ```bash
   node --test tests/team-contract.test.mjs
   ```
2. Confirm `-EncodedCommand` is gone from the role argv:
   - Instrument `Start-RoleProcess` to `Write-Output $commandLine` (or inspect via `$proc.StartInfo.Arguments`). Assert the string `EncodedCommand` is absent and the substring `-File` is present.
3. Confirm the bootstrap file is created under `<stateRoot>/bootstrap/` and removed after ready:
   ```powershell
   Get-ChildItem <commonDir>/pi-team/v1/bootstrap/ | Select-Object Name,Length
   ```
   Should be empty after `start` returns.
4. Confirm PowerShell process count during the launch window drops:
   ```powershell
   (Get-Process powershell -ErrorAction SilentlyContinue | Measure-Object).Count
   ```
   Today: ≥ 6 (3 role PowerShells + 3 bootstrap decoders). After: exactly 3 (the role panes' PowerShell hosts). Note: the parent `pi-team.ps1` PowerShell is one of the 3; the inner `wt.exe` pane PowerShells are the other 2.
5. Confirm `<stateRoot>/bootstrap/` exists after a fresh `start`:
   ```powershell
   Test-Path <commonDir>/pi-team/v1/bootstrap
   ```

### 2.5 Test recommendations

- Re-run the existing fake-pi test in `tests/team-contract.test.mjs` (lines 425+) without modification. The fake Pi script reads `$env:PI_TEAM_TASK_ID` etc. and asserts `record.state_root == <stateRoot>`; both paths must still hold.
- Add a new assertion to the existing test: after `start`, walk `Get-ChildItem <stateRoot>/bootstrap` and assert it is empty (bootstrap file cleaned up).
- Add a negative test: simulate a fresh `<stateRoot>` with no `bootstrap/` subdirectory; assert `Start-RoleProcess` still succeeds (the directory is created on demand).

---

## 3. Option 4 — Sidecar `.seq` for `appendRoleEvent`

### 3.1 Where in current master

- `D:/Coding/Harness/Pi-team-PERF-005/.pi/communication/role-events.mjs` (full file, 54 lines):
  ```javascript
  import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
  import { dirname, join } from "node:path";

  const RETRY_MS = 25;
  const LOCK_TIMEOUT_MS = 5_000;

  async function withLock(path, fn) {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
      try { await mkdir(path); break; }
      catch (error) {
        if (error?.code !== "EEXIST" || Date.now() >= deadline) throw new Error(`role event lock timeout: ${path}`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
    try { return await fn(); }
    finally { await rm(path, { recursive: true, force: true }); }
  }

  async function existingSequence(file) {
    const text = await readFile(file, "utf8").catch(() => "");
    let maximum = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      maximum = Math.max(maximum, Number(event.sequence) || 0);
    }
    return maximum;
  }

  export async function appendRoleEvent(stateRoot, event) {
    const file = join(stateRoot, `${event.task_id}-${event.role}.jsonl`);
    await mkdir(dirname(file), { recursive: true });
    return withLock(`${file}.lock`, async () => {
      const sequence = (await existingSequence(file)) + 1;
      const record = { ...event, version: 1, sequence, at: new Date().toISOString() };
      await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
      return record;
    });
  }

  export async function registerRoleRuntime(stateRoot, identity) { … }
  ```
- Existing test — `tests/team-contract.test.mjs` line 693–702 — verbatim:
  ```javascript
  test("report_to_lead event storage continues sequences across concurrent appends", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-team-role-events-"));
    try {
      const base = { task_id: "EVT-001", role: "reviewer", agent_id: "reviewer-test", worktree: root, state: "reviewing", activity: "checking" };
      await appendRoleEvent(root, base);
      const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => appendRoleEvent(root, { ...base, activity: `checking ${index}` })));
      assert.deepEqual(concurrent.map((event) => event.sequence).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  ```
  This test must pass unchanged after the rewrite.
- PowerShell-side `Event` (lines 188–192) — has the same shape (`(Get-Content $ep | Measure-Object).Count + 1`) but it is **not** in the in-scope list. The PowerShell `Event` writes its own `<stateRoot>/<task>-<role>.jsonl` (PERF-004 § 2.6 confirms the executor's `READY_FOR_REVIEW` line was written there). The sidecar optimization targets **only** `role-events.mjs`.

### 3.2 Compatibility risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| `<file>.seq` does not exist yet (first-ever append to this `<task>/<role>` pair) | The seq file is created on the first append, atomically under the same lock as the event line. | Inside `withLock`, do `existingSequence(file)` that returns `0` if neither `<file>.jsonl` nor `<file>.seq` exists. |
| `<file>.seq` exists but is corrupt (e.g., contains non-numeric chars from a partial write) | Catch the parse error, fall back to a one-time full scan of `<file>.jsonl`, write the seq back. | Wrap the seq read in `try { Number(text) } catch { return fullScanFallback() }`. |
| Two roles appending concurrently to two different `<task>` records | `withLock` keys on `<file>.lock` where `<file> = ${stateRoot}/${event.task_id}-${event.role}.jsonl` — different `task_id`/`role` pairs use different lock dirs, so no contention. | No code change required. |
| Sidecar file survives when the JSONL file is truncated/rotated | If a future cleanup deletes `.jsonl` but leaves `.seq`, the next append will start from a stale high number. | In the lock, on the very first iteration: if `<file>.jsonl` is missing, treat `<file>.seq` as authoritative of "last issued". If `<file>.jsonl` exists and `<file>.seq` is larger than the JSONL's max sequence, the JSONL wins (defensive reconcile). |
| Sidecar file semantics across restart | After a process restart, `<file>.seq` is read again from disk — no in-memory cache to seed. | The seq file is the single source of truth; no in-memory cache across processes. |
| The existing concurrent-sequence test is shape-sensitive | The test asserts the resulting `sequence` values on the in-memory returned records (not on the file content). | Do not change the `sequence` value semantics; only change how it is computed. |
| `withLock` directory removal may race with a subsequent `withLock` open | The existing test exercises 8-way concurrency and already passes; the lock semantics are unchanged. | No code change in `withLock`. |
| The `<file>.seq` is written **before** `<file>.jsonl` or after? | Order matters if a process dies mid-flight. The lock holds across both writes; if the process dies, the seq file may point one higher than the JSONL. On the next acquire, the full-scan fallback reconciles. | Write order inside the lock: (1) read existing `<file>.seq`; (2) compute `next = max + 1`; (3) append to `<file>.jsonl`; (4) write `<file>.seq` with `next`. If step 4 fails, the seq stays at `max` and the next acquire sees the discrepancy, falls back to scan. |
| `<file>.seq` consumed by external readers? | No external reader exists (verified by `grep -rn '\.seq' --include='*.{mjs,ts,ps1}'` returning nothing in production code). | Confirm in a future grep audit before shipping. |

### 3.3 Negative / contrast scenarios

- **`<file>.seq` truncated to `""`** — `Number("") === 0`, so the next sequence becomes `1`. If the JSONL already has sequences up to 5, the test asserts `[6..9]` for the concurrent batch, breaking the contract. Mitigation: write `<file>.seq` as a single integer followed by a single `\n`; if the read value is `0` AND the JSONL exists and has any line, run the full-scan fallback.
- **Concurrent appends** — the existing 8-way `Promise.all` test still asserts a contiguous, gap-free sequence (no duplicates, no skips). The seq-file read/write is inside the same `mkdir`-based lock as today; the test continues to pass.
- **Append while a previous lock holder has crashed mid-flight** — the `<file>.lock` directory is left behind (today's `withLock` `finally` would have removed it, but a hard crash leaves the dir). `LOCK_TIMEOUT_MS = 5_000` ensures the next acquirer times out after 5 s; once removed, the seq-side reconciliation runs.
- **First append after the JSONL has been manually rotated** — `existingSequence` sees `<file>.seq` value `1000` but the JSONL was rotated to empty. Naive implementation: next sequence becomes `1001`. Defensive behaviour: if JSONL is empty, ignore the seq file (treat it as the "previous last sequence" only when JSONL has the matching records). For this slice, we accept the simpler behaviour (no manual rotation in master today) and document the caveat.
- **Role changes identity (rare)** — `task_id` + `role` key are immutable per task; the file path is stable. No risk.

### 3.4 Reproducible verification commands

1. Re-run the existing concurrency test:
   ```bash
   node --test tests/team-contract.test.mjs
   ```
2. Add a focused concurrency/seq-file regression test inside the same file (suggested addition; Executor will write the final test):
   ```javascript
   test("appendRoleEvent uses a sidecar .seq file and remains concurrent-safe", async () => {
     const root = mkdtempSync(join(tmpdir(), "pi-team-seq-"));
     try {
       const base = { task_id: "SEQ-001", role: "executor", agent_id: "a-1", worktree: root, state: "working", activity: "x" };
       for (let i = 0; i < 50; i++) await appendRoleEvent(root, { ...base, activity: `i=${i}` });
       const seqText = await readFile(join(root, "SEQ-001-executor.jsonl.seq"), "utf8");
       assert.equal(Number(seqText.trim()), 50, "sidecar seq file must reflect the last issued sequence");
       const lines = (await readFile(join(root, "SEQ-001-executor.jsonl"), "utf8")).trim().split(/\r?\n/);
       assert.equal(lines.length, 50, "jsonl must contain exactly 50 lines");
       assert.deepEqual(lines.map((l) => JSON.parse(l).sequence), Array.from({ length: 50 }, (_, i) => i + 1));
     } finally { await rm(root, { recursive: true, force: true }); }
   });
   ```
3. Add a defensive regression test for a corrupt `.seq`:
   ```javascript
   test("appendRoleEvent falls back to full-scan if .seq is corrupt", async () => {
     const root = mkdtempSync(join(tmpdir(), "pi-team-seq-bad-"));
     try {
       const base = { task_id: "SEQ-002", role: "executor", agent_id: "a-1", worktree: root, state: "working", activity: "x" };
       await appendRoleEvent(root, base); // seq=1
       await appendRoleEvent(root, { ...base, activity: "y" }); // seq=2
       await writeFile(join(root, "SEQ-002-executor.jsonl.seq"), "garbage");
       const result = await appendRoleEvent(root, { ...base, activity: "z" });
       assert.equal(result.sequence, 3, "must reconcile and issue the next sequence after a corrupt .seq");
       const seqText = await readFile(join(root, "SEQ-002-executor.jsonl.seq"), "utf8");
       assert.equal(Number(seqText.trim()), 3, ".seq must be rewritten to the reconciled value");
     } finally { await rm(root, { recursive: true, force: true }); }
   });
   ```
4. Synthetic stress to compare per-event wall-clock before vs. after:
   ```bash
   node --input-type=module -e "
   import { appendRoleEvent } from './.pi/communication/role-events.mjs';
   import { mkdtempSync } from 'node:fs';
   import { tmpdir } from 'node:os';
   import { join } from 'node:path';
   const root = mkdtempSync(join(tmpdir(), 'pi-team-perf-'));
   const base = { task_id: 'PERF', role: 'reviewer', agent_id: 'a', worktree: root, state: 'working', activity: 'a'.repeat(100) };
   // Warm up
   for (let i = 0; i < 10; i++) await appendRoleEvent(root, { ...base, activity: 'a'.repeat(100) + i });
   const t = process.hrtime.bigint();
   const N = 1000;
   await Promise.all(Array.from({ length: N }, (_, i) => appendRoleEvent(root, { ...base, activity: 'a'.repeat(100) + i })));
   const elapsed = Number(process.hrtime.bigint() - t) / 1e6;
   console.log('per-event ms (mean):', elapsed / N);
   "
   ```
   After the change, `per-event ms (mean)` stays approximately flat regardless of N. Before, it grows linearly with the JSONL size. The Executor will run this script before/after and record both numbers in `reports/PERF-005-performance.md`.

### 3.5 Test recommendations

- Keep the existing concurrent-sequence test unchanged.
- Add the two new tests in § 3.4 (sidecar file present and accurate; corrupt seq falls back).
- Add a defensive test: simulate a process restart between appends (no in-memory cache) by re-importing `appendRoleEvent`; the seq file must be re-read and the sequence must continue from the persisted value.

---

## 4. Combined verification matrix

The following table lists reproducible commands the Lead and Executor can run after the implementation lands. None of these were executed in this delegation (Researcher is read-only).

| Option | Verification | Command | Pass criterion |
| --- | --- | --- | --- |
| 1 | Existing happy path | `node --test tests/team-contract.test.mjs` | All tests pass; the role-launcher test's fake-Pi still records `runtime_pid` and `state_root`. |
| 1 | Bounded timeout | Modify the test fake-Pi to never write `runtime.json`; rerun | `start` exits non-zero with `role startup did not register readiness` between 60 s and 65 s. |
| 1 | Wall-clock improvement | `Measure-Command { Wait-RoleReady $s 'executor' $launchId }` | Wall-clock ≤ 1 s for a normal start. |
| 3 | No `-EncodedCommand` in argv | `Write-Output $commandLine` inside `Start-RoleProcess` | Substring `EncodedCommand` absent; substring `-File` present. |
| 3 | Bootstrap cleanup | `Get-ChildItem <stateRoot>/bootstrap` after `start` | Directory is empty after `Wait-RoleReady` returns. |
| 3 | PowerShell process count | `(Get-Process powershell).Count` during steady state | 3 (down from 6 today). |
| 4 | Concurrency safety | `node --test tests/team-contract.test.mjs` | The existing 1+8 concurrent test passes; sequences are `[2..9]`. |
| 4 | Sidecar accuracy | New test in § 3.4 | `SEQ-001-executor.jsonl.seq` content equals `50` after 50 appends. |
| 4 | Defensive fallback | New test in § 3.4 | Corrupt `.seq` file does not break sequence continuity; `.seq` is rewritten. |
| All | `blackboard.test.mjs` (out of scope) | `node --test tests/blackboard.test.mjs` | All 37 tests still pass — `appendAgentEvent` in `blackboard-core.mjs` is unchanged. |
| All | Cross-shell runner | `./tests/run-tests.ps1` | 37/37 deterministic tests pass. |

## 5. Out-of-scope confirmations

Per the Lead task, the following are explicitly out of scope for PERF-005 and must not be touched:

- Option 2 (`Stop writing the legacy pi-team/v1 journal`) — `Event` in `scripts/pi-team.ps1` (lines 188–192) and `Doctor` `last_event=` references remain.
- Option 5 (Blackboard `snapshot`/`watch` inline index) — `plugins/agent-blackboard/server/blackboard-core.mjs` is unchanged.
- Option 6 (graceful `Stop-Process` cleanup) — `Stop-RoleTree` (lines 275–280) is unchanged.
- `pi-team.cmd` command surface — `start`, `research`, `resume`, `accept`, `close-incomplete`, `reconcile`, `reclaim`, `cleanup`, `status`, `watch`, `validate`, `publish`, `doctor`, `setup`, `codex-setup`, `sync` all keep their argv.
- Task contract schema (`version: 2`, `task_id`, `name`, `description`, `base_ref`, `branch`, `worktree`, `in_scope`, `out_of_scope`, `done_criteria`, `delegations`, `constraints`) — unchanged.
- Identity injection (`PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`, `PI_TEAM_AGENT_ID`, `PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, `PI_TEAM_SCOPE_ID`, `PI_TEAM_LAUNCH_ID`, `PI_INTERCOM_STABLE_ID`) — names, values, and lifecycle unchanged.
- Intercom contract — `.pi/communication/runtime-policy.mjs` and `.pi/communication/persistent-store.mjs` are not touched.
- State root layout — `<git-common-dir>/pi-team/v1/` and `<git-common-dir>/harness-blackboard/v1/` paths are not changed. The new `bootstrap/` subdirectory lives under `<git-common-dir>/pi-team/v1/bootstrap/` and is cleaned up after each `start`/`research`/`resume`.

## 6. Confidence and caveats

- **High confidence** that all three options can be implemented without contract changes. Each option's source-code footprint is bounded: Option 1 rewrites the body of `Wait-RoleReady` only; Option 3 rewrites the body of `Start-RoleProcess` only (and adds a `bootstrap/` subdirectory under `<stateRoot>`); Option 4 rewrites the body of `appendRoleEvent` and `existingSequence` only.
- **Medium confidence** on the Option 1 watcher: PowerShell `FileSystemWatcher` is a known-correct Windows API but it can be subject to brief delivery delays; the bounded timeout fallback guards against this.
- **Medium confidence** on Option 3 wt.exe env inheritance: standard `wt.exe` semantics pass env from the parent process to the pane process; if a custom Windows Terminal profile strips env, the bootstrap script's first three lines can re-set the eight vars. The PERF-005 task should not modify user terminal profiles.
- **High confidence** on Option 4 lock semantics: the existing `mkdir`-based lock is unchanged; the only change is replacing one `readFile + split + JSON.parse` loop with one `readFile + Number()` call.

## 7. Gaps and remaining work (NOT done by Researcher)

- Live CPU, memory, process, I/O, log-size, disk numbers were **not collected**. The Executor must capture before/after metrics per the experiment matrix in § 4 and write them to `reports/PERF-005-performance.md`.
- No test or production code was changed by this delegation. The exact test additions in § 1.5, § 2.5, § 3.5 are recommendations; the Executor may merge or refine them with the Reviewer's review.
- No environment or terminal-profile interaction test was performed. If a user has a non-default `wt.exe` profile that strips env vars, Option 3 must add a fallback (re-set env from a JSON file inside the bootstrap script). This is a Lead-collectable input; not a blocker for the implementation.
