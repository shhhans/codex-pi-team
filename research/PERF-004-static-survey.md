# PERF-004 — Static Survey of Pi Team Launcher, Role Config, Communication Extensions, State Storage (Integrated Branch)

- Lead task ID: **PERF-004**
- Research delegation: **RESEARCH-004**
- Worktree surveyed: `D:\Coding\Harness\Pi-team-PERF-004` (integrate/pi-team-flow-lifecycle)
- Survey target: `D:\Coding\Harness\Pi-team-INTEGRATE-FLOW-003\pi-team.cmd` and its compressed bootstrap / integrated lifecycle
- Survey method: **only** read-only file inspection (`read`, `grep`, `find`, `ls`) of the integrated branch worktree. No code, configuration, test, or spec changes. No system commands. No `web_search`.
- Date of survey: capture-time only; **no live measurements were collected** in this delegation (see "未采集到的实时数值").

## Question (verbatim)

"只读取集成分支任务 worktree 中的 Pi Team 启动器、角色配置、通信扩展和状态存储实现，回答一个 bounded 静态问题：列出最多 6 个最可能造成 CPU、内存、进程/线程、I/O、日志或磁盘资源浪费的机制。每个机制给出精确文件路径/函数或文档段落、影响的资源类型、这是直接事实还是推断、一个 Lead 后续可采集的指标，以及至少一个负向或对照场景。"

## Headline Answer

Across the integrated launcher (`scripts/pi-team.ps1`), role configs (`.pi/agents/{researcher,executor,reviewer}.md`), communication extensions (`.pi/communication/**`) and Agent Blackboard state storage (`plugins/agent-blackboard/server/blackboard-core.mjs` + `cli` + `mcp`), the six most likely resource-waste mechanisms are:

1. **Per-role multi-process shell fan-out on every `start`/`research`/`resume`** — heaviest process and memory cost per role.
2. **Synchronous `Wait-RoleReady` 100 ms busy-poll in PowerShell for up to 60 s** — burns parent CPU and repeatedly re-reads the runtime JSON.
3. **Re-reading and re-parsing the entire `.jsonl` event file on every event just to compute the next sequence** — O(n) per append, O(n²) over a session, in both `role-events.mjs` and `blackboard-core.mjs`.
4. **`blackboard_watch` / `snapshot` re-read and JSON-parse every event file in the state root on every call** — quadratic under UI polling at ≤ 100 ms intervals.
5. **Gzip + Base64 + UTF-16LE `EncodedCommand` round-trip for a small JSON role payload** — extra PowerShell process + compression CPU + buffer memory per role launch.
6. **`taskkill /T /F` force-tree-kill on launch failure** — over-broad process termination, no graceful cleanup, leaves state files un-cleaned.

All six are visible in source without instrumentation; each is paired below with the Lead-collectable runtime metric and a negative / contrast scenario the integrated branch could compare against.

---

## Mechanism 1 — Per-role multi-process shell fan-out (`start` launches ≥ 5 Windows processes per role)

**Where (file / function / paragraph):**
- `D:/Coding/Harness/Pi-team-PERF-004/scripts/pi-team.ps1` — `Start-RoleProcess` (the `wt.exe` is invoked with a PowerShell `-EncodedCommand` that itself invokes `pi.cmd`, which is a wrapper around the Node-based Pi agent).
- Same file — `Launch-Role`, `RoleArguments`, `Start-Task` (Executor + Reviewer are launched sequentially after `Wait-RoleReady`).
- `pi-team.cmd` is a 4-line shim around `scripts/pi-team.ps1`.

**Per-role process tree (per `Start-RoleProcess` invocation):**
1. `wt.exe` (Windows Terminal host pane).
2. Outer `powershell.exe` running `pi-team.ps1`.
3. Inner `powershell.exe` decoding the Base64 UTF-16 `EncodedCommand`.
4. `pi.cmd` → `node.exe` (Pi agent host).
5. Plus the intercom / blackboard / `pi-web-access` Node sub-extension processes and the Agent Blackboard MCP server (`blackboard-mcp.mjs`) registered separately by `Setup-Codex`.

`Start-Task` runs `Launch-Role` for Executor then for Reviewer sequentially, so an immediate `start <task>` is at minimum **2 outer / 2 inner PowerShell + 2 `pi.cmd` + 2 Node agent hosts**, plus the MCP server already running for Lead.

**Resource type:** process / thread count, memory (PowerShell + Node cold-start working set).

**Fact vs. inference:** *Direct fact* — the call chain `Start-Task → Launch-Role → Start-RoleProcess → Start-Process wt.exe` is in the script. The exact additional Node/MCP children are an *inference* about the standard Pi agent + Agent Blackboard MCP behavior; only process-level sanity, not identity, can be claimed here.

**Lead-collectable metric (post-hoc):**
- Count of distinct `powershell.exe` / `pi.cmd` / `node.exe` processes alive under one session-id at `Wait-RoleReady` return time.
- Private working set (PSS) totals of PowerShell hosts immediately after `start`.
- Wall-clock from `Start-RoleProcess` invocation to `launcher_pid` known — bottlenecked on PowerShell startup × chain depth.

**Negative / contrast scenario:** A single Node-driven launcher that `child_process.spawn`s the Pi agent with `process.env` + `execArgv`, dropping the `wt.exe` / outer PowerShell / inner PowerShell / `pi.cmd` shell chain, would keep one Node parent + one Node child per role and avoid four extra Windows processes per role.

---

## Mechanism 2 — `Wait-RoleReady` synchronous 100 ms busy-poll in PowerShell (up to 60 s)

**Where:** `D:/Coding/Harness/Pi-team-PERF-004/scripts/pi-team.ps1`, function `Wait-RoleReady` at the line:

```
function Wait-RoleReady($State,[string]$Role,[string]$LaunchId) {
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do { $runtime=Read-Runtime $State $Role; if ($runtime -and $runtime.launch_id -eq $LaunchId) { return $runtime }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
  Fail "role startup did not register readiness: $Role"
}
```

`Start-Task` calls `Wait-RoleReady` for Executor **and** again for Reviewer, so each `start` pays up to 120 s of repeated `Read-Runtime` → file read → JSON parse → sleep cycles in PowerShell.

**Resource type:** CPU and I/O on the controlling PowerShell process; the read of `<task>-<role>-runtime.json` repeats every 100 ms.

**Fact vs. inference:** *Direct fact* — the loop body, the 100 ms sleep, the 60 s deadline, and the call from `Start-Task` are all visible.

**Lead-collectable metric:**
- Number of iterations the loop runs (`(ready_at_ms - start_ms) / 100`) per role.
- Average CPU% of `powershell.exe` holding the parent shell during the wait window.
- Count of redundant `<task>-<role>-runtime.json` file reads (each PowerShell `Get-Content` call is a fresh read).

**Negative / contrast scenario:** A subscription to `registerRoleRuntime` in `.pi/communication/extensions/report-to-lead.ts` (which already writes the runtime file via `fs.writeFile`) could be paired with a `FileSystemWatcher` in PowerShell or a Node-based `Wait-RoleReady` that waits on an event-driven signal — eliminating the 100 ms timer entirely and dropping parent CPU to ~0 during the wait.

---

## Mechanism 3 — Re-reading the entire `.jsonl` and re-parsing every line just to compute `sequence = max + 1`

**Where (file / function):**
- `D:/Coding/Harness/Pi-team-PERF-004/.pi/communication/role-events.mjs`, `existingSequence`:

```
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
```
… called inside the locked region of `appendRoleEvent`.

- `D:/Coding/Harness/Pi-team-PERF-004/plugins/agent-blackboard/server/blackboard-core.mjs`, `appendAgentEvent`:
```
return withLock(`${path}.lock`, async () => {
  const existing = await parseEventFile(root, `${taskId}-${role}.jsonl`);
  const sequence = existing.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0) + 1;
  ...
```
`parseEventFile` reads the file and `JSON.parse`s every line. The lock is held for the duration of that read+parse.

**Resource type:** I/O (full file read) + CPU (`JSON.parse` per line) + memory (entire file held as a string and parsed into an array); the longer a role runs, the worse the per-event cost.

**Fact vs. inference:** *Direct fact* — both functions and the locked invocation are visible. The O(n) → O(n²) worst-case character is *inference* from Big-O reasoning on the visible code path.

**Lead-collectable metric:**
- Bytes read per `appendRoleEvent` / `appendAgentEvent` (one-shot, easy with `perf_hooks` or a wrapper stat).
- Mean / p95 wall-clock per event vs. event count.
- Wall-clock growth curve over a long-lived Researcher session.

**Negative / contrast scenario:** A sidecar `<file>.seq` whose value is the last issued sequence and updated under the same lock turns each append into O(1) at the cost of one extra filesystem write. Alternatively, an in-process monotonically-increasing counter survives process restarts by re-deriving from the seq file once at boot.

---

## Mechanism 4 — `snapshot` and `watch` re-read every `.jsonl` from disk and JSON-parse every line on each call

**Where:**
- `D:/Coding/Harness/Pi-team-PERF-004/plugins/agent-blackboard/server/blackboard-core.mjs`:
  - `allEvents(root)` → `readdir` over the entire state root, then for each `.jsonl` `parseEventFile` (full read + `JSON.parse` per line).
  - `snapshot(projectRoot)` calls `allEvents(root)` for every snapshot.
  - `watch(projectRoot, cursor, timeoutMs = 55_000)` polls `allEvents(root)` inside a `while (true)` loop with a `setTimeout` of `Math.min(100, deadline - now)`, exiting only when `fresh.length > 0` or `Math.abs(...)` < timeout, after the MCP server returned.
- `D:/Coding/Harness/Pi-team-PERF-004/plugins/agent-blackboard/server/blackboard-mcp.mjs` exposes `blackboard_watch` (≤ 55 s wait) and `blackboard_snapshot` to the UI; the UI typically polls them at fractions of a second.

**Resource type:** I/O (file-by-file read), CPU (line-by-line `JSON.parse` + sort + cursor re-serialization), memory (full event array). The cost grows with every task ever started in the harness's Git common directory (`harness-blackboard/v1`).

**Fact vs. inference:** *Direct fact* — `allEvents`, `snapshot`, `watch`, the 100 ms inner `setTimeout`, and the exposed MCP tool names are all visible. The UI polling at sub-second cadence is *inference* from the `MAX_WATCH_MS = 55_000` and the 100 ms loop step; Lead should confirm by examining the UI client.

**Lead-collectable metric:**
- Wall-clock per `snapshot` and per `watch` iteration.
- Number of `.jsonl` files in state root × average file size.
- Heap delta of the MCP server process across one watch iteration.
- Number of `tools/call` requests per minute for `blackboard_snapshot` / `blackboard_watch` per Lead session.

**Negative / contrast scenario:** A "latest-event" cache keyed by `(task_id, role)` and indexed by `(mtime, sequence)` plus a `chokidar` / `fs.watch` on the state root would let `watch` resolve in O(dirty entries) instead of O(events). Even a transient `latestByTask` memoization inside a single MCP server lifetime would cover the steady-state polling cost.

---

## Mechanism 5 — Gzip + Base64 + UTF-16LE `EncodedCommand` round-trip for a small JSON role payload

**Where:** `D:/Coding/Harness/Pi-team-PERF-004/scripts/pi-team.ps1`, function `Start-RoleProcess` (the payload preparation block):

```
$payload = [ordered]@{identity=$identity;directory=$paneDirectory;executable=$roleExecutable;arguments=@($roleArguments)} | ConvertTo-Json -Compress -Depth 5
$payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
$payloadStream = New-Object IO.MemoryStream
$gzip = New-Object IO.Compression.GzipStream($payloadStream,[IO.Compression.CompressionMode]::Compress,$true)
$gzip.Write($payloadBytes,0,$payloadBytes.Length); $gzip.Dispose()
$compressedPayload = [Convert]::ToBase64String($payloadStream.ToArray()); $payloadStream.Dispose()
$bootstrap = "`$input=[Convert]::FromBase64String('$compressedPayload');`$source=...;`$gzip=...;`$reader=...;`$data=...;`$data.identity.psobject.Properties|ForEach-Object { Set-Item -Path ('Env:'+`$_.Name) -Value ([string]`$_.Value) };Set-Location -LiteralPath `$data.directory;& ([string]`$data.executable) @([string[]]`$data.arguments);exit `$LASTEXITCODE"
$encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
$terminalArguments = @('-d',$paneDirectory,'powershell.exe','-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encodedScript)
$commandLine = ($terminalArguments | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join ' '
return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle Normal -PassThru
```

The rationale appears to be avoiding Windows command-line length limits for environment variables, but the variables themselves (8 small strings ≈ 500 chars raw) fit comfortably inside `wt.exe` argument limits when set via the inherited `process.env` already populated by the outer PowerShell.

**Resource type:** CPU per launch (Gzip compress + Base64 + Base64 decode + Gzip decompress + `ConvertFrom-Json` + per-property `Set-Item Env:` round-trip), memory (memory stream + gzip buffer), and an additional `powershell.exe` instance per role (one for the bootstrap decoder). Per `start`, that is **2 extra `powershell.exe` processes × 3 roles**.

**Fact vs. inference:** *Direct fact* — the entire payload construction and decoder is visible. The claim that the Windows command-line argument array cannot carry these strings verbatim is *inference* (the script replaces a simpler approach without comment); Lead should measure if `wt.exe` actually rejected a flat argv version.

**Lead-collectable metric:**
- CPU time of the outer `powershell.exe` parent for the `start <task>` call (compress + base64 + encode).
- Working-set delta of the inner PowerShell decoder process.
- Total `powershell.exe` process count between `Start-RoleProcess` and `Wait-RoleReady` return.

**Negative / contrast scenario:** A `wt.exe` invocation that sets `PI_TEAM_TASK_ID` and other vars via the pane's inherited environment, plus a flat command line, would skip the entire compress/decompress chain and the bootstrap-decode PowerShell. Even with the same `wt.exe`, a Node-based launcher passing env via `process.env` directly to its child would avoid the round-trip and one extra PowerShell instance.

---

## Mechanism 6 — `taskkill /T /F` force-tree-kill on launch failure (no graceful cleanup)

**Where:** `D:/Coding/Harness/Pi-team-PERF-004/scripts/pi-team.ps1`, function `Stop-RoleTree`:

```
function Stop-RoleTree($Session) {
  foreach ($pid in @($Session.launcher_pid,$Session.runtime_pid) | Where-Object { $_ } | Select-Object -Unique) {
    if (-not (Get-Process -Id ([int]$pid) -ErrorAction SilentlyContinue)) { continue }
    & taskkill.exe /PID ([int]$pid) /T /F | Out-Null
  }
}
```

`Start-Task` invokes `Stop-RoleTree $state.sessions.executor; Stop-RoleTree $state.sessions.reviewer` in its `catch` block, so any single failure mid-launch (e.g., `Wait-RoleReady` timeout, thrown exception during `appendRoleEvent`) trips the tree-kill. The state files `<task>.json`, `<task>-<role>-runtime.json`, `<task>-<role>.jsonl`, and the worktree themselves are left untouched.

**Resource type:** process / thread (force kill of unrelated grandchildren via `/T`), disk (state files and any partial outputs remain), I/O (no compensating cleanup).

**Fact vs. inference:** *Direct fact* — `Stop-RoleTree` is exactly `taskkill /T /F`. *Inference* that other children the agent may have spawned will be wiped; only post-hoc inspection would confirm exactly which PIDs are gone.

**Lead-collectable metric:**
- Count of `taskkill` invocations per failed `start` / `research` / `resume`.
- Time-to-cleanup after a deliberate failure injection.
- Whether `<task>.json` is eventually removed or reaches `pi-team.cmd cleanup` after a `taskkill` case.
- Zombie child processes (e.g., orphaned `node.exe` after a force-kill of `wt.exe`).

**Negative / contrast scenario:** A `Stop-Process -Id $pid` (graceful) plus a final probe of `<task>-<role>-runtime.json` and explicit `git worktree remove --force` + state-file prune would avoid killing the entire `wt.exe` subtree, would not orphan unrelated grandchildren, and would keep the worktree / state dir in a consistent state for the next `start`.

---

## Was this survey enough? What it explicitly did NOT measure

This delegation is a **bounded static survey**. The artifacts prove presence of each mechanism in source; **no live CPU, memory, process, I/O, log-size, or disk-size numbers were captured in this delegation**. Specifically, the following runtime values were **NOT collected** and would be needed by Lead to decide which of the six mechanisms to fix first:

- Process tree depth and PSS for a live `start` (Mechanism 1).
- Iteration count and CPU% of `Wait-RoleReady` for a live start (Mechanism 2).
- Bytes read per `appendRoleEvent` / `appendAgentEvent` and per-event wall-clock vs. event count (Mechanism 3).
- Wall-clock of `snapshot` and `watch` against a state root that contains N tasks (Mechanism 4).
- CPU and working-set of the encoder + decoder PowerShells (Mechanism 5).
- Number of orphaned PIDs and leftover state files after a deliberate mid-launch failure (Mechanism 6).

A follow-up delegation can attach to the same task ID with a measurement-only mandate, without re-reading these files.

## Confidence and caveats

- Confidence: high that all six mechanisms exist in the code paths leading from `pi-team.cmd start`, `pi-team.cmd research`, and `pi-team.cmd resume`; medium on the "extra Process" counts because exact identity depends on the Pi agent's runtime, which is not loaded by this static survey.
- The integrated lifecycle paths studied are: `start` (Task 1 of `pi-team.cmd`), `research`, `resume`, `accept`, `close-incomplete`, `reconcile`, `reclaim`, and the implied steady-state tool calls into `report_to_lead` and `blackboard_update`. Other paths (`setup`, `codex-setup`, `doctor`, `status`, `validate`, `sync`, `cleanup`) were inspected but did not surface additional dominant waste mechanisms.
- This survey does not include PERF-003 run data and does not propose immediate code, configuration, test, or spec changes.
