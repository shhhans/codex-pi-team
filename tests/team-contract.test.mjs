import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { appendAgentEvent } from "../plugins/agent-blackboard/server/blackboard-core.mjs";
const REPO = process.cwd();
const SKILL_NAMES = ["answer-research-question", "execute-delegated-task", "review-delegated-task"];
const RESEARCHER_TOOLS = ["read", "grep", "find", "ls", "write", "web_search", "fetch_content", "get_search_content", "source_check", "pi_team_intercom", "blackboard_update"];
const EXECUTOR_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "pi_team_intercom", "blackboard_update"];
const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "pi_team_intercom", "blackboard_update"];
const DEEP_RESEARCH_TOOLS = ["research_run", "deep_research_task", "deep_research_review", "research_synthesis_input", "research_report_artifact"];
const ACTIVE_ROLES = ["researcher", "executor", "reviewer"];
const ROLE_RUNTIME = {
  researcher: { provider: "minimax-cn", model: "MiniMax-M3" },
  executor: { provider: "minimax-cn", model: "MiniMax-M3" },
  reviewer: { provider: "volcengine-ark", model: "deepseek-v4-flash" },
};
const LEGACY_ROLES = ["architect", "critic", "engineer"];
const SHARED_INTERCOM = "~/.pi/agent/npm/node_modules/pi-intercom/index.ts";
const SHARED_WEB_ACCESS = "~/.pi/agent/npm/node_modules/pi-web-access/index.ts";

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

function parseJsonText(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function expectExists(path) {
  const info = await stat(path);
  assert.ok(info.isFile() || info.isDirectory(), `${path} must exist`);
  return info;
}

test("exactly three active agents and no other role files in .pi/agents", async () => {
  const dirEntries = await readFile(join(REPO, ".pi/agents/.dummy"), "utf8").catch(() => null);
  // Enumerate via find (bounded): use a child process with a tight directory.
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(join(REPO, ".pi/agents"))).filter((name) => name.endsWith(".md")).sort();
  assert.deepEqual(files, [...ACTIVE_ROLES].sort().map((role) => `${role}.md`),
    `.pi/agents/ must contain only ${ACTIVE_ROLES.join(", ")} role files`);
  void dirEntries;
});

test("three skills exist with SKILL.md and agents/openai.yaml", async () => {
  for (const name of SKILL_NAMES) {
    const dir = join(REPO, ".pi/skills", name);
    await expectExists(join(dir, "SKILL.md"));
    await expectExists(join(dir, "agents/openai.yaml"));
    const skillText = await readFile(join(dir, "SKILL.md"), "utf8");
    const fm = parseFrontmatter(skillText);
    assert.equal(fm.name, name, `skill ${name} must declare its own name`);
    assert.ok(fm.description && fm.description.length > 0 && fm.description.length <= 1024, `${name} description must be non-empty and <= 1024 chars`);
    assert.ok(!/[<>]/.test(fm.description), `${name} description must not contain angle brackets`);
  }
});

test("active role definitions exist with valid frontmatter and required tools", async () => {
  for (const role of ACTIVE_ROLES) {
    const path = join(REPO, ".pi/agents", `${role}.md`);
    await expectExists(path);
    const text = await readFile(path, "utf8");
    const fm = parseFrontmatter(text);
    assert.equal(fm.name, role, `${role} frontmatter name must match`);
    assert.equal(fm.provider, ROLE_RUNTIME[role].provider, `${role} must declare its provider`);
    assert.equal(fm.model, ROLE_RUNTIME[role].model, `${role} must declare its model`);
    assert.doesNotMatch(text, /^\s*(?:api[_-]?key|auth[_-]?token|secret)\s*:/im, `${role} must not contain credentials`);
    assert.equal(fm.inheritProjectContext, "true", `${role} must inherit the shared AGENTS.md context`);
    assert.equal(fm.inheritSkills, "false", `${role} must set inheritSkills: false`);
    assert.equal(fm.skillPath, "../skills", `${role} must use the project-private skill path`);
    assert.equal(fm.extensions, "", `${role} must disable ambient extensions`);
    assert.match(text, /^tools:.*\bpi_team_intercom\b/m, `${role} must include the structured paired-peer tool`);
    assert.match(text, /Peer policy:/, `${role} must declare a peer policy`);
    assert.match(text, /refuse before/i, `${role} must refuse before intercom send/ask`);
    assert.match(text, /Tool failure rule:.*three consecutive times/s, `${role} must escalate a repeated tool failure`);
    assert.match(text, /do not modify a tool.*temporary helper code/is, `${role} must not self-modify a failing tool`);
    assert.doesNotMatch(text, /report_to_lead/, `${role} must use Blackboard rather than the retired Lead-report tool`);
    // Active roles must not bind persistent memory; they use role prompt + private skills only.
    assert.ok(!("memory" in fm), `${role} frontmatter must not declare a memory binding`);
    assert.doesNotMatch(text, /^memory:\s*$/m, `${role} must not contain a memory: frontmatter block`);
    assert.doesNotMatch(text, /Issue\s*#\s*\d+/i, `${role} prompt must not contain issue-specific instructions`);
    assert.doesNotMatch(text, /\b(?:ISSUE|BOOTSTRAP|PERF)-\d{3,}\b/, `${role} prompt must not contain concrete task identifiers`);
    assert.doesNotMatch(text, /[A-Za-z]:[\\/][^\r\n]*\\(?:Pi-team|Coding)/i, `${role} prompt must not contain host paths`);
  }
});

test("Lead skill requires complete tool-contract updates and live validation", async () => {
  const text = await readFile(join(REPO, "plugins/agent-blackboard/skills/pi-team-lead/SKILL.md"), "utf8");
  assert.match(text, /Tool-change completion rule/);
  assert.match(text, /registration and load order.*role allowlists.*tool\/skill documentation.*focused\s+tests/s);
  assert.match(text, /Restart every active role/);
  assert.match(text, /live smoke exercises the changed path/);
});

test("shared context and active skills remain task-agnostic", async () => {
  const paths = [
    join(REPO, "AGENTS.md"),
    ...ACTIVE_ROLES.map((role) => join(REPO, ".pi/agents", `${role}.md`)),
    ...SKILL_NAMES.map((name) => join(REPO, ".pi/skills", name, "SKILL.md")),
  ];
  for (const path of paths) {
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /Issue\s*#\s*\d+/i, `${path} must not contain a concrete issue reference`);
    assert.doesNotMatch(text, /\b(?:ISSUE|BOOTSTRAP|PERF)-\d{3,}\b/, `${path} must not contain a concrete task identifier`);
    assert.doesNotMatch(text, /[A-Za-z]:[\\/][^\r\n]*(?:Pi-team|Harness|Coding)/i, `${path} must not contain a host path`);
    assert.doesNotMatch(text, /body:\s*[A-Za-z0-9_-]{40,}/i, `${path} must not contain a raw encoded envelope`);
  }
});

test("project settings do not install per-worktree Pi packages", async () => {
  const settings = JSON.parse(await readFile(join(REPO, ".pi/settings.json"), "utf8"));
  assert.equal(Object.hasOwn(settings, "packages"), false, "project settings must not declare Pi npm packages");
});

test("researcher alone loads shared pi-web-access and has no Deep Research tools", async () => {
  const text = await readFile(join(REPO, ".pi/agents/researcher.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseScalarList(fm.tools);
  for (const required of RESEARCHER_TOOLS) {
    assert.ok(tools.includes(required), `Researcher must include tool ${required}`);
  }
  for (const banned of DEEP_RESEARCH_TOOLS) {
    assert.equal(tools.includes(banned), false, `Researcher must not include Deep Research tool ${banned}`);
  }
  const exts = parseScalarList(fm.subagentOnlyExtensions);
  assert.deepEqual(exts, [SHARED_INTERCOM, SHARED_WEB_ACCESS, "../communication/extensions/researcher.ts", "../communication/extensions/blackboard-update.ts"],
    "Researcher must load shared intercom, web access, and Blackboard policy extensions");
  assert.match(text, /answer-research-question/);
  assert.equal(fm.skills, "answer-research-question");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /research\/<task-id>-<slug>\.md/);
  assert.doesNotMatch(text, /researcher-runtime\/context-management-extension\.ts/,
    "Researcher must not reference the Deep Research runtime extension");
  for (const banned of DEEP_RESEARCH_TOOLS) {
    const toolRe = new RegExp(`\\b${banned}\\b`, "i");
    assert.equal(toolRe.test(text), false, `Researcher text must not mention ${banned}`);
  }
});

test("executor and reviewer cannot load or request web-access tools (negative control)", async () => {
  for (const role of ["executor", "reviewer"]) {
    const text = await readFile(join(REPO, ".pi/agents", `${role}.md`), "utf8");
    const fm = parseFrontmatter(text);
    const tools = parseScalarList(fm.tools);
    const exts = parseScalarList(fm.subagentOnlyExtensions);
    assert.equal(exts[0], SHARED_INTERCOM, `${role} must explicitly load shared intercom`);
    assert.equal(exts.includes(SHARED_WEB_ACCESS), false, `${role} must not load pi-web-access`);
    for (const webTool of ["web_search", "fetch_content", "get_search_content", "source_check"]) {
      assert.equal(tools.includes(webTool), false, `${role} must not request ${webTool}`);
    }
  }
});

test("executor has required implementation tools and the delegated-task skill", async () => {
  const text = await readFile(join(REPO, ".pi/agents/executor.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseScalarList(fm.tools);
  for (const required of EXECUTOR_TOOLS) {
    assert.ok(tools.includes(required), `Executor must include tool ${required}`);
  }
  assert.match(text, /execute-delegated-task/);
  assert.equal(fm.skills, "execute-delegated-task");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /Lead task ID/i);
  assert.match(text, /isolated worktree/i);
  assert.match(text, /implementation_notes\/<task-id>\.md/);
});

test("reviewer has bash/edit/write, the review-delegated-task skill, and never edits production code", async () => {
  const text = await readFile(join(REPO, ".pi/agents/reviewer.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseScalarList(fm.tools);
  for (const required of REVIEWER_TOOLS) {
    assert.ok(tools.includes(required), `Reviewer must include tool ${required}`);
  }
  assert.match(text, /review-delegated-task/);
  assert.equal(fm.skills, "review-delegated-task");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /never edit production code/i);
  assert.match(text, /failures\/<task-id>-<finding-id>\.md/);
  // Production-code prohibition must be explicit in the body, not just hinted.
  assert.match(text, /production code/);
  assert.match(text, /\bnevers?\b|prohibit|prohibited/i);
});

test("active role memory files are absent and the executor runtime directory is removed", async () => {
  // Active roles do not bind persistent memory; any leftover MEMORY.md would be stale contamination.
  for (const role of ACTIVE_ROLES) {
    await assert.rejects(stat(join(REPO, ".pi/agent-memory", role, "MEMORY.md")),
      `active role ${role} must not have an active role memory file`);
  }
  // The generated, ignored executor runtime directory must be gone (it was unsafe transient guidance).
  await assert.rejects(stat(join(REPO, ".pi/agent-memory/executor")),
    ".pi/agent-memory/executor/ must be removed; it was generated runtime, not durable memory");
  // The active .pi/agent-memory/ directory remains ignored (no role memory files present).
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(join(REPO, ".pi/agent-memory")).catch(() => []);
  const memoryFiles = entries.filter((name) => name.endsWith(".md"));
  assert.deepEqual(memoryFiles, [],
    `.pi/agent-memory/ must contain no role memory files; found ${memoryFiles.join(", ") || "(none)"}`);
});

test("artifact roots exist at the project root with exact contracts", async () => {
  const research = await stat(join(REPO, "research"));
  assert.ok(research.isDirectory(), "research/ must be a directory");
  const notes = await stat(join(REPO, "implementation_notes"));
  assert.ok(notes.isDirectory(), "implementation_notes/ must be a directory");
  const failures = await stat(join(REPO, "failures"));
  assert.ok(failures.isDirectory(), "failures/ must be a directory");

  // R2 artifact (the successful Researcher attempt) must be preserved verbatim.
  const r2Path = join(REPO, "research/BOOTSTRAP-SELF-001-R2-private-skills.md");
  await expectExists(r2Path);
  const r2Text = await readFile(r2Path, "utf8");
  assert.match(r2Text, /pi-subagents 0\.56\.0/);
  assert.match(r2Text, /\.pi\/npm\/node_modules\/pi-subagents/);

  // R1 incorrect artifact must be gone (it was untracked and would otherwise pollute).
  await assert.rejects(stat(join(REPO, "research/BOOTSTRAP-SELF-001-R1-private-skills.md")));

  // Project-level documents must exist at the repo root.
  await expectExists(join(REPO, "ADR/0001-minimal-development-loop.md"));
  await expectExists(join(REPO, "ADR/0002-lead-subagent-collaboration-protocol.md"));
  await expectExists(join(REPO, "ADR/0004-user-shared-pi-packages.md"));
  await expectExists(join(REPO, "README.md"));
  await expectExists(join(REPO, "architect.md"));
  await expectExists(join(REPO, "goal.md"));
  await expectExists(join(REPO, "project_state.md"));
});

test("ADR 0002 is the sole normative Lead-Subagent protocol and active surfaces follow it", async () => {
  const adr = await readFile(join(REPO, "ADR/0002-lead-subagent-collaboration-protocol.md"), "utf8");
  assert.match(adr, /sole normative Lead.Subagent collaboration protocol/i);
  assert.match(adr, /task ID, task name, task description, scope, constraints, and done criteria/i);
  assert.match(adr, /Architecture and product decisions belong to Lead and User/i);
  assert.match(adr, /READY_FOR_REVIEW/);
  assert.match(adr, /REVIEW_PASS/);
  assert.match(adr, /REVIEW_FAIL/);
  assert.match(adr, /FIX_READY/);
  assert.match(adr, /Only after Lead acceptance/i);
  assert.match(adr, /read-only\s+Git operations/i);
  assert.match(adr, /do not invoke WSL unless Lead explicitly authorizes it/i);

  const summaryPaths = [
    "AGENTS.md",
    "architect.md",
    "goal.md",
    "project_state.md",
    ".pi/communication/README.md",
  ];
  for (const path of summaryPaths) {
    const text = await readFile(join(REPO, path), "utf8");
    assert.match(text, /ADR\/0002-lead-subagent-collaboration-protocol\.md/,
      `${path} must defer to ADR 0002`);
  }
});

test("Executor and Reviewer use a persistent idle review-fix lifecycle without stop handoffs", async () => {
  const paths = [
    ".pi/agents/executor.md",
    ".pi/agents/reviewer.md",
    ".pi/skills/execute-delegated-task/SKILL.md",
    ".pi/skills/review-delegated-task/SKILL.md",
  ];
  for (const path of paths) {
    const text = await readFile(join(REPO, path), "utf8");
    assert.match(text, /idle|event-driven/i, `${path} must end slices idle/event-driven`);
    assert.match(text, /Lead accept|Lead acceptance/i, `${path} must retain the pair until Lead acceptance`);
    assert.doesNotMatch(text, /stop signal|Executor has stopped|after Executor stops|Reviewer enters after/i,
      `${path} must not encode the obsolete stop handoff`);
  }

  const executor = await readFile(join(REPO, ".pi/agents/executor.md"), "utf8");
  assert.match(executor, /READY_FOR_REVIEW/);
  assert.match(executor, /FIX_READY/);
  const reviewer = await readFile(join(REPO, ".pi/agents/reviewer.md"), "utf8");
  assert.match(reviewer, /REVIEW_PASS/);
  assert.match(reviewer, /REVIEW_FAIL/);
  assert.match(reviewer, /Read-only Git operations/i);
  assert.match(reviewer, /stash, reset, checkout, rebase/i);

  for (const path of [
    ".pi/agents/executor.md",
    ".pi/agents/reviewer.md",
    ".pi/agents/researcher.md",
    ".pi/skills/execute-delegated-task/SKILL.md",
    ".pi/skills/review-delegated-task/SKILL.md",
    ".pi/skills/answer-research-question/SKILL.md",
  ]) {
    const text = await readFile(join(REPO, path), "utf8");
    assert.match(text, /sole (event-)?schema contract|sole JSON event contract|exact JSON (fields|contract) from `pi_team_intercom`/i,
      `${path} must defer event field details to the registered intercom tool`);
    assert.doesNotMatch(text, /body_encoding|agent-team\/v1 envelope|base64url body/i,
      `${path} must not duplicate transport-envelope instructions`);
  }

  const roleExtension = await readFile(join(REPO, ".pi/communication/pi-policy-extension.ts"), "utf8");
  assert.match(roleExtension, /name: "pi_team_intercom"/);
  assert.match(roleExtension, /structuredIntercomToolDescription/);
  assert.match(roleExtension, /TEAM_TRANSPORT_TYPE/);
  assert.match(roleExtension, /projectInboundStructuredEnvelope/);
  assert.doesNotMatch(roleExtension, /customType:\s*"intercom_message"/);
});

test("legacy role material is preserved under .pi/legacy/", async () => {
  for (const role of LEGACY_ROLES) {
    await expectExists(join(REPO, ".pi/legacy/agents", `${role}.md`));
    await expectExists(join(REPO, ".pi/legacy/communication/extensions", `${role}.ts`));
    await expectExists(join(REPO, ".pi/legacy/agent-memory", role, "MEMORY.md"));
  }
  // Archived historical Researcher memory (deep-research lineage) and Reviewer memory
  // are preserved verbatim under the new historical buckets.
  await expectExists(join(REPO, ".pi/legacy/agent-memory/researcher-deep-research/MEMORY.md"));
  await expectExists(join(REPO, ".pi/legacy/agent-memory/reviewer/MEMORY.md"));
  // Active roles must NOT appear in legacy.
  const { readdir } = await import("node:fs/promises");
  const legacyAgents = (await readdir(join(REPO, ".pi/legacy/agents"))).map((name) => name.replace(/\.md$/, "")).sort();
  for (const role of ACTIVE_ROLES) {
    assert.equal(legacyAgents.includes(role), false, `Active role ${role} must not be in .pi/legacy/agents/`);
  }
  // Deep Research material preserved.
  await expectExists(join(REPO, ".pi/legacy/researcher-runtime/package.json")).catch(async () => {
    await expectExists(join(REPO, ".pi/legacy/deep-research/researcher-runtime/package.json"));
  });
  await expectExists(join(REPO, ".pi/legacy/deep-research/researcher-runtime/package.json"));
  await expectExists(join(REPO, ".pi/legacy/deep-research/researcher-runtime/context-management-extension.ts"));
  await expectExists(join(REPO, ".pi/legacy/research"));
  await expectExists(join(REPO, ".pi/legacy/deep-research/gptr-mcp/server.py"));
  // Excluded categories must not be copied.
  await assert.rejects(stat(join(REPO, ".pi/legacy/deep-research/researcher-runtime/node_modules")));
  await assert.rejects(stat(join(REPO, ".pi/legacy/deep-research/gptr-mcp/.venv")));
  await assert.rejects(stat(join(REPO, ".pi/legacy/deep-research/gptr-mcp/__pycache__")));
  // Provenance manifest must exist and reference paths/versions, not hashes.
  await expectExists(join(REPO, ".pi/legacy/PROVENANCE.md"));
  const prov = await readFile(join(REPO, ".pi/legacy/PROVENANCE.md"), "utf8");
  assert.match(prov, /pi-web-access`?\s+0\.24\.2|@modelcontextprotocol\/sdk`?\s+1\.30\.0/);
  assert.doesNotMatch(prov, /sha256|sha1|md5/i);
});

test("setup is isolated, pinned, idempotent, preserves settings, and doctor is read-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-team-setup-"));
  const agentDir = join(root, "agent");
  const fakePi = join(root, "fake-pi.ps1");
  const installLog = join(root, "installs.log");
  const script = join(REPO, "scripts/pi-team.ps1");
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_CMD: fakePi, FAKE_PI_LOG: installLog };
  const run = (command, extraEnv = {}) => spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, command,
  ], { cwd: REPO, env: { ...env, ...extraEnv }, encoding: "utf8" });
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ theme: "light", packages: ["npm:unrelated@1.0.0"] }, null, 2));
    await writeFile(fakePi, String.raw`param([string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
if ($Command -eq 'auth') {
  if ($Args[0] -ne 'check' -or -not ($Args -contains '--provider') -or -not ($Args -contains '--model') -or -not ($Args -contains '--no-refresh')) { Write-Error "unexpected auth check arguments: $($Args -join ' ')"; exit 4 }
  @{ok=$true; provider=$Args[$Args.IndexOf('--provider') + 1]; model=$Args[$Args.IndexOf('--model') + 1]} | ConvertTo-Json -Compress
  exit 0
}
if ($Command -ne 'install') { Write-Error "unexpected command: $Command"; exit 2 }
$Source=$Args[0]
if ($Source -notmatch '^npm:(pi-(?:subagents|intercom|web-access))@(.+)$') { Write-Error "unexpected source: $Source"; exit 3 }
$name=$Matches[1]; $version=$Matches[2]
if ($env:FAKE_PI_FAIL -eq $name) { exit 17 }
$dir=Join-Path $env:PI_CODING_AGENT_DIR "npm\node_modules\$name"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@{name=$name;version=$version} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $dir 'package.json')
$settingsPath=Join-Path $env:PI_CODING_AGENT_DIR 'settings.json'
$settings=Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
$kept=@($settings.packages | Where-Object { $s=if($_ -is [string]){$_}else{$_.source}; $s -notmatch "^npm:$name(?:@.*)?$" })
$settings.packages=@($kept)+$Source
$settings | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $settingsPath
$Source | Add-Content -Encoding UTF8 -LiteralPath $env:FAKE_PI_LOG
exit 0
`);

    const first = run("setup");
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /SETUP_OK/);
    let settingsText = await readFile(join(agentDir, "settings.json"), "utf8");
    assert.equal(settingsText.startsWith("\uFEFF"), false, "setup must write Pi-compatible UTF-8 without BOM");
    let settings = parseJsonText(settingsText);
    assert.equal(settings.theme, "light", "setup must preserve unrelated user settings");
    assert.ok(settings.packages.includes("npm:unrelated@1.0.0"), "setup must preserve unrelated packages");
    const web = settings.packages.find((entry) => typeof entry === "object" && entry.source?.startsWith("npm:pi-web-access@"));
    assert.deepEqual(web, { source: "npm:pi-web-access@0.24.2", extensions: [] });
    assert.equal((await readFile(installLog, "utf8")).trim().split(/\r?\n/).length, 3);

    const second = run("setup");
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal((await readFile(installLog, "utf8")).trim().split(/\r?\n/).length, 3, "second setup must not reinstall exact packages");

    await writeFile(join(agentDir, "npm/node_modules/pi-web-access/package.json"), JSON.stringify({ name: "pi-web-access", version: "0.0.0" }));
    const repaired = run("setup");
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
    assert.equal((await readFile(installLog, "utf8")).trim().split(/\r?\n/).length, 4, "version drift must reinstall only the changed package");

    const healthyDoctor = run("doctor");
    assert.equal(healthyDoctor.status, 0, healthyDoctor.stderr || healthyDoctor.stdout);
    assert.match(healthyDoctor.stdout, /OK shared Pi dependencies/);
    settings = parseJsonText(await readFile(join(agentDir, "settings.json"), "utf8"));
    const webIndex = settings.packages.findIndex((entry) => typeof entry === "object" && entry.source?.startsWith("npm:pi-web-access@"));
    settings.packages[webIndex] = "npm:pi-web-access@0.24.2";
    await writeFile(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2));
    const beforeDoctor = await readFile(join(agentDir, "settings.json"), "utf8");
    const unhealthyDoctor = run("doctor");
    assert.equal(unhealthyDoctor.status, 0, unhealthyDoctor.stderr || unhealthyDoctor.stdout);
    assert.match(unhealthyDoctor.stdout, /MISSING pi-web-access user autoload is not disabled/);
    assert.match(unhealthyDoctor.stdout, /FIX run pi-team\.cmd setup/);
    assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), beforeDoctor, "doctor must not modify user settings");

    await writeFile(join(agentDir, "npm/node_modules/pi-intercom/package.json"), JSON.stringify({ name: "pi-intercom", version: "0.0.0" }));
    const failed = run("setup", { FAKE_PI_FAIL: "pi-intercom" });
    assert.notEqual(failed.status, 0, "setup must propagate installer failure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role launchers inject common-dir identity and isolate Executor/Reviewer environments", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-team-runtime-"));
  const agentDir = join(root, "agent");
  const fakePi = join(root, "fake-pi.cmd");
  const fakePiScript = join(root, "fake-pi.ps1");
  const launchLog = join(root, "launches.jsonl");
  const worktree = join(root, "task-worktree");
  const questionFile = join(root, "question.md");
  const contract = join(root, "contract.md");
  const script = join(REPO, "scripts/pi-team.ps1");
  const taskId = "ENV-001";
  const scopeId = "scope-env-001";
  const executorAgentId = "executor-agent-001";
  const reviewerAgentId = "reviewer-agent-001";
  const executorSessionId = "executor-session-001";
  const reviewerSessionId = "reviewer-session-001";
  const branch = `pi-team/test-runtime-${process.pid}`;
  const commonDirResult = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(commonDirResult.status, 0, commonDirResult.stderr);
  const commonDir = commonDirResult.stdout.trim().replaceAll("/", "\\");
  const stateRoot = join(commonDir, "pi-team", "v1");
  const stateFile = join(stateRoot, `${taskId}.json`);
  const contractSnapshot = join(stateRoot, "contracts", `${taskId}.md`);
  const blackboardStateFile = join(commonDir, "harness-blackboard", "v1", `${taskId}.json`);
  const eventFiles = [join(stateRoot, `${taskId}-executor.jsonl`), join(stateRoot, `${taskId}-reviewer.jsonl`)];
  const runtimeFiles = ["executor", "reviewer", "researcher"].map((role) => join(stateRoot, `${taskId}-${role}-runtime.json`));

  const run = (command, args = [], extraEnv = {}) => spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, command, ...args,
  ], { cwd: REPO, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_CMD: fakePi, WT_CMD: fakePi, ...extraEnv }, encoding: "utf8" });

  const waitForRecords = async (count) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const text = await readFile(launchLog, "utf8").catch(() => "");
      const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line.replace(/^\uFEFF/, "")));
      if (records.length >= count) return records;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`expected ${count} fake Pi launches; log was not ready`);
  };

  try {
    await mkdir(join(agentDir, "npm/node_modules"), { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [
      "npm:pi-subagents@0.56.0",
      "npm:pi-intercom@0.11.0",
      { source: "npm:pi-web-access@0.24.2", extensions: [] },
    ] }));
    for (const [name, version] of [["pi-subagents", "0.56.0"], ["pi-intercom", "0.11.0"], ["pi-web-access", "0.24.2"]]) {
      const packageDir = join(agentDir, "npm/node_modules", name);
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, "package.json"), JSON.stringify({ name, version }));
    }
    await writeFile(fakePiScript, String.raw`param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
if ($Args.Count -gt 0 -and $Args[0] -eq 'auth') {
  if ($Args[1] -ne 'check' -or -not ($Args -contains '--provider') -or -not ($Args -contains '--model') -or -not ($Args -contains '--no-refresh')) { Write-Error "unexpected auth check arguments: $($Args -join ' ')"; exit 4 }
  @{ok=$true; provider=$Args[$Args.IndexOf('--provider') + 1]; model=$Args[$Args.IndexOf('--model') + 1]} | ConvertTo-Json -Compress
  exit 0
}
# Defense in depth: a watchdog kills this fake if a parent test forgot to clean it up.
# Production real wt.exe does not honor this env var.
$watchdogRaw=[Environment]::GetEnvironmentVariable('PI_TEAM_FAKE_TIMEOUT_SEC')
if ([string]::IsNullOrEmpty($watchdogRaw)) { $watchdogRaw='15' }
$watchdog=0
if (-not [int]::TryParse($watchdogRaw,[ref]$null)) { $watchdog=0 } else { $watchdog=[int]$watchdogRaw }
if ($watchdog -gt 0) {
  $timer=New-Object System.Timers.Timer
  $timer.Interval=$watchdog*1000
  $timer.AutoReset=$false
  Register-ObjectEvent -InputObject $timer -EventName Elapsed -Action { Stop-Process -Id $PID -Force; exit 124 } | Out-Null
  $timer.Start() | Out-Null
}
 $encodedIndex = [Array]::IndexOf($Args, '-EncodedCommand')
if ($encodedIndex -ge 0) {
  if ($encodedIndex -ge ($Args.Count - 1)) { Write-Error 'fake Windows Terminal requires an encoded bootstrap'; exit 2 }
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand $Args[$encodedIndex + 1]
  exit $LASTEXITCODE
}
$record=[ordered]@{
  task_id=$env:PI_TEAM_TASK_ID
  role=$env:PI_TEAM_ROLE
  agent_id=$env:PI_TEAM_AGENT_ID
  worktree=$env:PI_TEAM_WORKTREE
  state_root=$env:PI_TEAM_STATE_ROOT
  scope_id=$env:PI_TEAM_SCOPE_ID
  args=@($Args)
}
# Walk the parent chain so the test cleanup can taskkill every node, even if the
# intermediate cmd.exe / powershell.exe decoders detach from the recorded launcher.
$chain=New-Object System.Collections.Generic.List[int]
$chain.Add($PID)
try {
  $current=$PID
  for ($depth=0; $depth -lt 16; $depth++) {
    $parent=(Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue).ParentProcessId
    if (-not $parent -or $parent -le 0 -or $chain.Contains($parent)) { break }
    $chain.Add($parent); $current=$parent
  }
} catch { }
$runtime=[ordered]@{version=1;task_id=$env:PI_TEAM_TASK_ID;role=$env:PI_TEAM_ROLE;agent_id=$env:PI_TEAM_AGENT_ID;launch_id=$env:PI_TEAM_LAUNCH_ID;intercom_id=$env:PI_INTERCOM_STABLE_ID;runtime_pid=$PID;parent_pid=(Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue).ParentProcessId;process_chain=@($chain | Select-Object -Unique);ready_at=[DateTime]::UtcNow.ToString('o');worktree=$env:PI_TEAM_WORKTREE}
$runtime | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $env:PI_TEAM_STATE_ROOT "$($env:PI_TEAM_TASK_ID)-$($env:PI_TEAM_ROLE)-runtime.json")
$record | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 -LiteralPath $env:PI_TEAM_TEST_LOG
`);
    // Detach powershell.exe and exit the cmd.exe wrapper immediately so the
    // Start-Process -WindowStyle Hidden window closes within a single frame and
    // the test never holds a visible console-subsystem Terminal open. The
    // `start /b` shares the parent console without allocating a new one.
    await writeFile(fakePi, `@echo off\r\nstart \"\" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake-pi.ps1\" %* >nul 2>&1\r\nexit /b 0\r\n`);
    await writeFile(questionFile, "Determine the runtime identity contract.\n");
    await writeFile(contract, `# Runtime test\n\n\`\`\`json\n${JSON.stringify({
      version: 2,
      task_id: taskId,
      name: "Runtime identity test",
      description: "Exercise all role launch paths.",
      base_ref: "master",
      branch,
      worktree,
      in_scope: ["runtime identity"],
      out_of_scope: ["production changes"],
      done_criteria: [{ id: "C-001", description: "fake processes receive identity", owner: "executor", artifacts: ["implementation_notes/ENV-001.md"] }],
      delegations: [
        { id: "EXECUTOR-001", role: "executor", objective: "Exercise the launcher.", artifact_path: "implementation_notes/ENV-001.md", required_capabilities: ["bash", "write"] },
        { id: "REVIEWER-001", role: "reviewer", objective: "Review the launcher.", artifact_path: "failures/ENV-001-review.md", required_capabilities: ["read", "write"] },
        { id: "RESEARCH-001", role: "researcher", objective: "Research the runtime identity contract.", artifact_path: "research/ENV-001.md", required_capabilities: ["web_search", "write"] },
      ],
      constraints: ["use the common Git directory"],
    }, null, 2)}\n\`\`\`\n`);

    const branchCreate = spawnSync("git", ["branch", branch, "master"], { cwd: REPO, encoding: "utf8" });
    assert.equal(branchCreate.status, 0, branchCreate.stderr);
    const missingBlackboard = run("start", [contract], { PI_TEAM_TEST_LOG: launchLog });
    assert.notEqual(missingBlackboard.status, 0, "start must refuse a task that Lead has not created on the Blackboard");
    assert.match(missingBlackboard.stderr, /Lead must create Blackboard task/);
    const publish = run("publish", [contract]);
    assert.equal(publish.status, 0, publish.stderr || publish.stdout);
    assert.match(publish.stdout, /PUBLISHED ENV-001/);
    const publishedTask = parseJsonText(await readFile(blackboardStateFile, "utf8"));
    assert.equal(publishedTask.name, "Runtime identity test");
    assert.equal(publishedTask.description, "Exercise all role launch paths.");
    assert.equal(publishedTask.status, "active");
    const start = run("start", [contract], { PI_TEAM_TEST_LOG: launchLog });
    assert.equal(start.status, 0, start.stderr || start.stdout);
    const startRecords = await waitForRecords(2);
    assert.deepEqual(startRecords.map((record) => record.role).sort(), ["executor", "reviewer"]);
    const startState = parseJsonText(await readFile(stateFile, "utf8"));
    assert.equal(startState.scope_id.length > 0, true);
    assert.equal(startState.worktree, worktree);
    assert.equal(startState.contract_path, contractSnapshot);
    assert.deepEqual(
      { provider: startState.sessions.executor.provider, model: startState.sessions.executor.model },
      { provider: "minimax-cn", model: "MiniMax-M3" },
      "Executor provider/model must be frozen in task state",
    );
    assert.deepEqual(
      { provider: startState.sessions.reviewer.provider, model: startState.sessions.reviewer.model },
      ROLE_RUNTIME.reviewer,
      "Reviewer provider/model must be frozen in task state",
    );
    assert.deepEqual(
      { provider: startState.role_configs.researcher.provider, model: startState.role_configs.researcher.model },
      { provider: "minimax-cn", model: "MiniMax-M3" },
      "Researcher provider/model must be frozen in task state before on-demand launch",
    );
    assert.equal(await readFile(contractSnapshot, "utf8"), await readFile(contract, "utf8"), "launcher must freeze the exact task contract outside the worktree");
    for (const record of startRecords) {
      assert.equal(record.task_id, taskId);
      assert.equal(record.worktree, worktree);
      assert.equal(record.state_root, stateRoot);
      assert.equal(record.scope_id, startState.scope_id);
      assert.equal(record.agent_id, record.role === "executor" ? startState.sessions.executor.agent_id : startState.sessions.reviewer.agent_id);
      const expectedTools = record.role === "executor" ? EXECUTOR_TOOLS : REVIEWER_TOOLS;
      assert.equal(record.args.includes("--agent"), false, "Pi CLI has no --agent option");
      assert.equal(record.args[record.args.indexOf("--provider") + 1], ROLE_RUNTIME[record.role].provider);
      assert.equal(record.args[record.args.indexOf("--model") + 1], ROLE_RUNTIME[record.role].model);
      assert.equal(record.args.includes("--no-extensions"), true, "ambient extensions including pi-subagents/runs.run must be disabled");
      assert.equal(record.args.includes("--no-skills"), true, "ambient skills must be disabled");
      assert.equal(record.args[record.args.indexOf("--tools") + 1], expectedTools.join(","));
      assert.equal(record.args[record.args.indexOf("--session-id") + 1], startState.sessions[record.role].session_id, "first launch must bind the persisted session ID");
      assert.equal(record.args[record.args.indexOf("--skill") + 1], join(REPO, ".pi", "skills", record.role === "executor" ? "execute-delegated-task" : "review-delegated-task", "SKILL.md"));
      assert.equal(record.args.some((arg) => arg.includes(`${worktree}\\.pi\\communication`)), false, "role runtime extensions must not depend on the task branch snapshot");
      assert.equal(record.args.some((arg) => arg.includes(join(REPO, ".pi", "communication", "extensions"))), true);
      assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)), false, "initial assignment must not name the frozen contract path; state.contract_path remains the Lead-side pointer");
    }
    // Issue #1 — role-scoped assignment must include only role-critical content and exclude Lead-only text.
    const roleDelegations = {
      executor: "EXECUTOR-001",
      reviewer: "REVIEWER-001",
    };
    const initialPrompts = new Map();
    for (const record of startRecords) {
      const promptArgument = record.args[record.args.length - 1];
      assert.match(promptArgument, /^@/, `${record.role} must receive its initial prompt via Pi's @file argument`);
      initialPrompts.set(record.role, await readFile(promptArgument.slice(1), "utf8"));
    }
    for (const record of startRecords) {
      const prompt = initialPrompts.get(record.role);
      const delegationId = roleDelegations[record.role];
      assert.match(prompt, new RegExp(`Role: ${record.role}\\b`), `${record.role} prompt must declare its role identity`);
      assert.match(prompt, new RegExp(`Delegation: ${delegationId}\\b`), `${record.role} prompt must declare its own delegation id`);
      assert.match(prompt, /Artifact: /, `${record.role} prompt must declare its artifact path`);
      assert.match(prompt, /Required capabilities: /, `${record.role} prompt must declare its required capabilities`);
      assert.match(prompt, /Objective: /, `${record.role} prompt must declare its objective`);
      assert.match(prompt, /Tool runtime metadata: os_family=/, `${record.role} prompt must include launch-time OS metadata`);
      assert.match(prompt, /command_interpreter=/, `${record.role} prompt must expose the detected command interpreter`);
      assert.match(prompt, /command_syntax_examples=/, `${record.role} prompt must expose syntax examples for that interpreter`);
      assert.match(prompt, /Builtin bash-tool contract: its legacy name does not define command syntax/, `${record.role} prompt must reject inference from the builtin bash tool name`);
      assert.match(prompt, /Done criteria: /, `${record.role} prompt must declare its own done criteria`);
      assert.doesNotMatch(prompt, /^-/, `${record.role} prompt must not begin with a CLI option marker`);
      assert.match(prompt, /--- PI TEAM TASK CONTEXT v1 ---/, `${record.role} prompt must include the dynamic task context marker`);
      assert.match(prompt, /Stable project context: AGENTS\.md/, `${record.role} prompt must point to inherited AGENTS.md context`);
      assert.match(prompt, /Visible scope: /, `${record.role} prompt must include its visible scope`);
      assert.match(prompt, /Recommended role reads: /, `${record.role} prompt must include bounded navigation hints`);
      assert.match(prompt, /--- END PI TEAM TASK CONTEXT ---/, `${record.role} prompt must close the dynamic task context`);
      // Lead-only tokens that must never appear in role-scoped prompts.
      assert.doesNotMatch(prompt, /Frozen task contract:/, `${record.role} prompt must not name the frozen contract`);
      assert.doesNotMatch(prompt, /Read that exact contract before acting/, `${record.role} prompt must not instruct reading the contract from prompt`);
      assert.doesNotMatch(prompt, /\bConstraints: /, `${record.role} prompt must not include the Lead-only Constraints field`);
      assert.doesNotMatch(prompt, /\[owner=/, `${record.role} prompt must not leak other roles' owner= annotations`);
      // Cross-role delegation ids must never appear.
      const otherDelegations = Object.entries(roleDelegations).filter(([, id]) => id !== delegationId).map(([, id]) => id);
      for (const otherId of otherDelegations) {
        assert.equal(prompt.includes(`Delegation: ${otherId}`), false, `${record.role} prompt must not include other role delegation ${otherId}`);
        assert.equal(prompt.includes(otherId), false, `${record.role} prompt must not leak other role delegation id ${otherId}`);
      }
      // RESEARCH-001 is the Researcher delegation in this contract; it must never appear in Executor/Reviewer prompts.
      assert.equal(prompt.includes("RESEARCH-001"), false, `${record.role} prompt must not include the Researcher delegation id`);
    }
    const executorRecord = startRecords.find((record) => record.role === "executor");
    const reviewerRecord = startRecords.find((record) => record.role === "reviewer");
    assert.notEqual(executorRecord.agent_id, reviewerRecord.agent_id, "Executor and Reviewer must not share an Agent ID");
    assert.match(executorRecord.state_root, /[\\/]\.git[\\/]pi-team[\\/]v1$/i);
    assert.doesNotMatch(executorRecord.state_root, /task-worktree[\\/]\.git/i, "state must not be rooted under worktree .git");

    await writeFile(stateFile, JSON.stringify({
      version: 1, task_id: taskId, name: "Runtime identity test", description: "Exercise all role launch paths.", status: "active",
      worktree, contract_path: contractSnapshot, scope_id: scopeId,
      role_configs: {
        researcher: { provider: "minimax-cn", model: "MiniMax-M3" },
        executor: { provider: "minimax-cn", model: "MiniMax-M3" },
        reviewer: { provider: "volcengine-ark", model: "deepseek-v4-flash" },
      },
      sessions: {
        executor: { agent_id: executorAgentId, session_id: executorSessionId, role: "executor", provider: "minimax-cn", model: "MiniMax-M3" },
        reviewer: { agent_id: reviewerAgentId, session_id: reviewerSessionId, role: "reviewer", provider: "volcengine-ark", model: "deepseek-v4-flash" },
      },
    }));
    await rm(launchLog, { force: true });
    const research = run("research", [taskId, "RESEARCH-001", questionFile], { PI_TEAM_TEST_LOG: launchLog });
    assert.equal(research.status, 0, research.stderr || research.stdout);
    const researchRecords = await waitForRecords(1);
    assert.equal(researchRecords.length, 1);
    assert.equal(researchRecords[0].task_id, taskId);
    assert.equal(researchRecords[0].role, "researcher");
    assert.notEqual(researchRecords[0].agent_id, executorAgentId);
    assert.notEqual(researchRecords[0].agent_id, reviewerAgentId);
    assert.equal(researchRecords[0].worktree, worktree);
    assert.equal(researchRecords[0].scope_id, scopeId);
    assert.equal(researchRecords[0].state_root, stateRoot);
    assert.equal(researchRecords[0].args[researchRecords[0].args.indexOf("--provider") + 1], ROLE_RUNTIME.researcher.provider);
    assert.equal(researchRecords[0].args[researchRecords[0].args.indexOf("--model") + 1], ROLE_RUNTIME.researcher.model);
    assert.equal(researchRecords[0].args.includes("--no-extensions"), true);
    assert.equal(researchRecords[0].args.includes("--no-skills"), true);
    assert.equal(researchRecords[0].args[researchRecords[0].args.indexOf("--tools") + 1], RESEARCHER_TOOLS.join(","));
    assert.equal(researchRecords[0].args.includes("--session-id"), false, "on-demand Researcher does not claim a persistent pair session");
    const researchPromptArgument = researchRecords[0].args[researchRecords[0].args.length - 1];
    assert.match(researchPromptArgument, /^@/, "Researcher must receive its initial prompt via Pi's @file argument");
    const researchPrompt = await readFile(researchPromptArgument.slice(1), "utf8");
    assert.match(researchPrompt, /Context mode: research/);
    assert.match(researchPrompt, /Research question: /);
    assert.match(researchPrompt, /Recommended role reads: .*answer-research-question/);

    await rm(launchLog, { force: true });
    const resume = run("resume", [taskId], { PI_TEAM_TEST_LOG: launchLog });
    assert.equal(resume.status, 0, resume.stderr || resume.stdout);
    const resumeRecords = await waitForRecords(2);
    assert.deepEqual(resumeRecords.map((record) => record.role).sort(), ["executor", "reviewer"]);
    const resumedExecutor = resumeRecords.find((record) => record.role === "executor");
    const resumedReviewer = resumeRecords.find((record) => record.role === "reviewer");
    assert.equal(resumedExecutor.agent_id, executorAgentId, "resume must reuse Executor Agent ID");
    assert.equal(resumedReviewer.agent_id, reviewerAgentId, "resume must reuse Reviewer Agent ID");
    assert.equal(resumedExecutor.task_id, taskId);
    assert.equal(resumedReviewer.task_id, taskId);
    assert.equal(resumedExecutor.worktree, worktree);
    assert.equal(resumedReviewer.worktree, worktree);
    assert.equal(resumedExecutor.scope_id, scopeId);
    assert.equal(resumedReviewer.scope_id, scopeId);
    assert.equal(resumedExecutor.state_root, stateRoot);
    assert.equal(resumedReviewer.state_root, stateRoot);
    assert.equal(resumedExecutor.args[resumedExecutor.args.indexOf("--provider") + 1], "minimax-cn");
    assert.equal(resumedExecutor.args[resumedExecutor.args.indexOf("--model") + 1], "MiniMax-M3");
    assert.equal(resumedReviewer.args[resumedReviewer.args.indexOf("--provider") + 1], ROLE_RUNTIME.reviewer.provider);
    assert.equal(resumedReviewer.args[resumedReviewer.args.indexOf("--model") + 1], ROLE_RUNTIME.reviewer.model);
    assert.match(resumeRecords.map((record) => record.args.join(" ")).join("\n"), new RegExp(executorSessionId));
    assert.match(resumeRecords.map((record) => record.args.join(" ")).join("\n"), new RegExp(reviewerSessionId));
    for (const record of resumeRecords) {
      assert.equal(record.args.includes("--session-id"), true, "resume must bind the persisted session ID and create it if the initial launch failed before session creation");
      assert.equal(record.args.includes("--session"), false);
      assert.equal(record.args.includes("--no-extensions"), true);
      const promptArgument = record.args[record.args.length - 1];
      assert.match(promptArgument, /^@/, `${record.role} resume prompt must use Pi's @file argument`);
      const prompt = await readFile(promptArgument.slice(1), "utf8");
      assert.doesNotMatch(promptArgument, /^-/, `${record.role} resume prompt must not begin with a CLI option marker`);
      assert.match(prompt, /Context mode: resume/);
      assert.match(prompt, /Resume rule: preserve the existing task scope/);
      assert.doesNotMatch(prompt, /Recommended common reads:/, "resume must not repeat the shared context map");
      assert.doesNotMatch(prompt, /Recommended role reads:/, "resume must not repeat role navigation");
    }

    // Issue #2 — verify the runtime JSON recorded every role's process chain so
    // cleanup can taskkill /T /F the entire tree without an empirical sleep.
    for (const role of ["executor", "reviewer", "researcher"]) {
      const runtimePath = join(stateRoot, `${taskId}-${role}-runtime.json`);
      const runtimeText = await readFile(runtimePath, "utf8").catch(() => null);
      if (!runtimeText) continue;
      const runtime = parseJsonText(runtimeText);
      assert.ok(Array.isArray(runtime.process_chain) && runtime.process_chain.length >= 1,
        `${role} runtime JSON must record a process_chain that contains at least the runtime_pid`);
      assert.ok(runtime.process_chain.includes(runtime.runtime_pid),
        `${role} process_chain must contain the recorded runtime_pid=${runtime.runtime_pid}; got ${JSON.stringify(runtime.process_chain)}`);
    }
  } finally {
    // Issue #2 — deterministically reap every recorded role-process tree before
    // removing the worktree. Replaces an empirical 750 ms sleep with synchronous
    // `taskkill /T /F` on the recorded launcher_pid (from state JSON) and
    // process_chain (from runtime JSON). The test never relies on timing and the
    // test never leaves an orphan cmd.exe / powershell.exe attached to the
    // sandboxed worktree path.
    const killedPids = new Set();
    for (const role of ["executor", "reviewer", "researcher"]) {
      const runtimePath = join(stateRoot, `${taskId}-${role}-runtime.json`);
      const runtimeText = await readFile(runtimePath, "utf8").catch(() => null);
      if (!runtimeText) continue;
      const runtime = parseJsonText(runtimeText);
      const pids = [
        ...(Array.isArray(runtime.process_chain) ? runtime.process_chain : []),
        runtime.runtime_pid,
      ].filter((pid) => Number.isInteger(pid) && pid > 0);
      for (const pid of pids) {
        if (killedPids.has(pid)) continue;
        killedPids.add(pid);
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
      }
    }
    if (killedPids.size > 0) {
      // Give the kernel a single short tick to deliver the kill to the entire
      // process tree before git tries to release the worktree directory.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await rm(stateFile, { force: true });
    await rm(contractSnapshot, { force: true });
    await rm(blackboardStateFile, { force: true });
    for (const path of eventFiles) await rm(path, { force: true });
    for (const path of runtimeFiles) await rm(path, { force: true });
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO, encoding: "utf8" });
    spawnSync("git", ["branch", "-D", branch], { cwd: REPO, encoding: "utf8" });
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 contracts bind stable criteria and reject Researcher work that needs unavailable capabilities", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-team-v2-contract-"));
  const contract = join(root, "contract.md");
  const script = join(REPO, "scripts/pi-team.ps1");
  const base = {
    version: 2,
    task_id: "CAP-001",
    name: "Capability preflight",
    description: "Reject a Researcher delegation that requires an unavailable capability.",
    base_ref: "master",
    branch: `pi-team/test-capabilities-${process.pid}`,
    worktree: join(root, "worktree"),
    in_scope: ["contract validation"],
    out_of_scope: ["live performance measurement"],
    done_criteria: [{ id: "C-001", description: "The contract validates role capabilities.", owner: "executor", artifacts: ["implementation_notes/CAP-001.md"] }],
    delegations: [
      { id: "EXECUTOR-001", role: "executor", objective: "Validate the contract.", artifact_path: "implementation_notes/CAP-001.md", required_capabilities: ["bash", "write"] },
      { id: "REVIEWER-001", role: "reviewer", objective: "Review the contract.", artifact_path: "failures/CAP-001-review.md", required_capabilities: ["read", "write"] },
      { id: "RESEARCH-001", role: "researcher", objective: "Collect web evidence.", artifact_path: "research/CAP-001.md", required_capabilities: ["web_search", "write"] },
    ],
    constraints: ["no live profiler access for Researcher"],
  };
  const run = () => spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "validate", contract], { cwd: root, encoding: "utf8" });
  try {
    await writeFile(contract, `# Contract\n\n\`\`\`json\n${JSON.stringify(base, null, 2)}\n\`\`\`\n`);
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.match(valid.stdout, /VALID CAP-001/);

    base.delegations[2].required_capabilities = ["shell", "profiler"];
    await writeFile(contract, `# Invalid contract\n\n\`\`\`json\n${JSON.stringify(base, null, 2)}\n\`\`\`\n`);
    const rejected = run();
    assert.notEqual(rejected.status, 0, "Researcher must not be launched for a shell/profiler delegation");
    assert.match(rejected.stderr, /unavailable to role researcher/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("acceptance requires each frozen criterion ID and synchronizes the Blackboard outcome", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-team-acceptance-"));
  const worktree = join(root, "worktree");
  const contract = join(root, "contract.md");
  const evidence = join(root, "acceptance.json");
  const script = join(REPO, "scripts/pi-team.ps1");
  const taskId = "ACC-001";
  const commonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO, encoding: "utf8" }).stdout.trim().replaceAll("/", "\\");
  const stateRoot = join(commonDir, "pi-team", "v1");
  const stateFile = join(stateRoot, `${taskId}.json`);
  const contractSnapshot = join(stateRoot, "contracts", `${taskId}.md`);
  const blackboardFile = join(commonDir, "harness-blackboard", "v1", `${taskId}.json`);
  const value = {
    version: 2, task_id: taskId, name: "Strict acceptance", description: "Validate criteria IDs.", base_ref: "master", branch: `pi-team/test-acceptance-${process.pid}`, worktree,
    in_scope: ["acceptance"], out_of_scope: ["implementation"],
    done_criteria: [{ id: "C-001", description: "Implementation evidence exists.", owner: "executor", artifacts: ["implementation_notes/ACC-001.md"] }],
    delegations: [
      { id: "EXECUTOR-001", role: "executor", objective: "Produce evidence.", artifact_path: "implementation_notes/ACC-001.md", required_capabilities: ["write"] },
      { id: "REVIEWER-001", role: "reviewer", objective: "Review evidence.", artifact_path: "failures/ACC-001-review.md", required_capabilities: ["read"] },
    ], constraints: ["Lead acceptance only"],
  };
  const run = (command, args = []) => spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, command, ...args], { cwd: REPO, encoding: "utf8" });
  try {
    await mkdir(join(worktree, "implementation_notes"), { recursive: true });
    await writeFile(join(worktree, "implementation_notes", "ACC-001.md"), "evidence\n");
    await writeFile(contract, `# Acceptance\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`);
    assert.equal(run("publish", [contract]).status, 0);
    await mkdir(join(stateRoot, "contracts"), { recursive: true });
    await writeFile(contractSnapshot, await readFile(contract));
    await writeFile(stateFile, JSON.stringify({ version: 2, task_id: taskId, execution_status: "active", outcome: "pending", worktree, contract_path: contractSnapshot, sessions: {} }));
    await appendAgentEvent(REPO, { task_id: taskId, role: "reviewer", agent_id: "reviewer-acceptance", worktree }, {
      state: "ready_for_acceptance", activity: "Acceptance evidence is ready.", next: "Await Lead acceptance.",
    });

    await writeFile(evidence, JSON.stringify({ outcome: "accepted", criteria: [{ criterion_id: "C-999", artifacts: ["implementation_notes/ACC-001.md"] }] }));
    const rejected = run("accept", [taskId, evidence]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unknown criterion/);
    assert.equal(parseJsonText(await readFile(stateFile, "utf8")).outcome, "pending");

    await writeFile(evidence, JSON.stringify({ outcome: "accepted", criteria: [{ criterion_id: "C-001", artifacts: ["implementation_notes/ACC-001.md"] }] }));
    const accepted = run("accept", [taskId, evidence]);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    assert.equal(parseJsonText(await readFile(stateFile, "utf8")).outcome, "accepted");
    assert.equal(parseJsonText(await readFile(blackboardFile, "utf8")).outcome, "accepted");
  } finally {
    for (const path of [stateFile, contractSnapshot, blackboardFile]) await rm(path, { force: true });
    await rm(join(commonDir, "harness-blackboard", "v1", `${taskId}-reviewer.jsonl`), { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("finalize integrates an accepted task and reclaims its worktree and branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-team-finalize-"));
  const clone = join(root, "repo");
  const worktree = join(root, "task-worktree");
  const contract = join(root, "contract.md");
  const taskId = "FIN-001";
  const branch = `pi-team/test-finalize-${process.pid}`;
  const cloneResult = spawnSync("git", ["clone", "--no-local", REPO, clone], { encoding: "utf8" });
  assert.equal(cloneResult.status, 0, cloneResult.stderr);
  try {
    await copyFile(join(REPO, "scripts/pi-team.ps1"), join(clone, "scripts/pi-team.ps1"));
    await writeFile(join(clone, "tests/run-tests.ps1"), "$ErrorActionPreference='Stop'\nexit 0\n");
    spawnSync("git", ["-C", clone, "config", "user.email", "test@example.invalid"], { encoding: "utf8" });
    spawnSync("git", ["-C", clone, "config", "user.name", "Pi Team Test"], { encoding: "utf8" });
    const fixtureAdd = spawnSync("git", ["-C", clone, "add", "--", "scripts/pi-team.ps1", "tests/run-tests.ps1"], { encoding: "utf8" });
    assert.equal(fixtureAdd.status, 0, fixtureAdd.stderr || fixtureAdd.stdout);
    const fixtureCommit = spawnSync("git", ["-C", clone, "commit", "--quiet", "-m", "test fixture"], { encoding: "utf8" });
    assert.equal(fixtureCommit.status, 0, fixtureCommit.stderr || fixtureCommit.stdout);
    const addWorktree = spawnSync("git", ["-C", clone, "worktree", "add", "--quiet", "-b", branch, worktree, "develop"], { encoding: "utf8" });
    assert.equal(addWorktree.status, 0, addWorktree.stderr);
    await mkdir(join(worktree, "implementation_notes"), { recursive: true });
    await writeFile(join(worktree, "implementation_notes", `${taskId}.md`), "integrated evidence\n");
    const value = {
      version: 2, task_id: taskId, name: "Finalizer integration", description: "Test deterministic finalization.",
      base_ref: "develop", branch, worktree, in_scope: [`implementation_notes/${taskId}.md`], out_of_scope: ["other files"],
      done_criteria: [{ id: "C-001", description: "The change is integrated.", owner: "executor", artifacts: [`implementation_notes/${taskId}.md`] }],
      delegations: [
        { id: "EXECUTOR-FIN-001", role: "executor", objective: "Prepare the integration change.", artifact_path: `implementation_notes/${taskId}.md`, required_capabilities: ["write"] },
        { id: "REVIEW-FIN-001", role: "reviewer", objective: "Review the integration change.", artifact_path: `reports/${taskId}-review.md`, required_capabilities: ["read"] },
      ], constraints: ["finalizer test"],
    };
    await writeFile(contract, `# Finalizer test\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`);
    const commonDir = spawnSync("git", ["-C", clone, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).stdout.trim();
    const stateRoot = join(commonDir, "pi-team", "v1");
    const blackboardRoot = join(commonDir, "harness-blackboard", "v1");
    const contractSnapshot = join(stateRoot, "contracts", `${taskId}.md`);
    await mkdir(join(stateRoot, "contracts"), { recursive: true });
    await copyFile(contract, contractSnapshot);
    await mkdir(blackboardRoot, { recursive: true });
    const cli = join(clone, "plugins/agent-blackboard/server/blackboard-cli.mjs");
    const publish = spawnSync("node", [cli, "publish", clone, contract], { encoding: "utf8" });
    assert.equal(publish.status, 0, publish.stderr || publish.stdout);
    const acceptBoard = spawnSync("node", [cli, "accept", clone, taskId], { encoding: "utf8" });
    assert.equal(acceptBoard.status, 0, acceptBoard.stderr || acceptBoard.stdout);
    const state = {
      version: 2, task_id: taskId, name: value.name, description: value.description,
      execution_status: "active", outcome: "accepted", worktree, contract_path: contractSnapshot,
      sessions: {},
    };
    await writeFile(join(stateRoot, `${taskId}.json`), JSON.stringify(state, null, 2));
    const script = join(clone, "scripts/pi-team.ps1");
    const finalized = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "finalize", taskId], { cwd: clone, encoding: "utf8" });
    assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout);
    const finalState = parseJsonText(await readFile(join(stateRoot, `${taskId}.json`), "utf8"));
    assert.equal(finalState.finalization.status, "succeeded");
    assert.equal(finalState.finalization.merged_to_target, true);
    assert.equal(finalState.finalization.worktree_removed, true);
    assert.equal(finalState.finalization.branch_removed, true);
    assert.equal(finalState.finalization.blackboard_archived, true);
    assert.equal(finalState.execution_status, "cleaned");
    assert.equal((spawnSync("git", ["-C", clone, "branch", "--list", branch], { encoding: "utf8" }).stdout.trim()), "");
    assert.equal((spawnSync("git", ["-C", clone, "show", `develop:implementation_notes/${taskId}.md`], { encoding: "utf8" }).stdout.trim()), "integrated evidence");
    await stat(join(commonDir, "harness-blackboard", "v1", `${taskId}.json`));
    const archived = parseJsonText(await readFile(join(commonDir, "harness-blackboard", "v1", `${taskId}.json`), "utf8"));
    assert.equal(archived.status, "archived");
  } finally {
    spawnSync("git", ["-C", clone, "worktree", "remove", "--force", worktree], { encoding: "utf8" });
    spawnSync("git", ["-C", clone, "branch", "-D", branch], { encoding: "utf8" });
    await rm(root, { recursive: true, force: true });
  }
});

test("tests directory contains the deterministic contract and communication-policy tests", async () => {
  const { readdir } = await import("node:fs/promises");
  const entries = (await readdir(join(REPO, "tests"))).filter((name) => !name.startsWith(".")).sort();
  assert.deepEqual(entries, ["blackboard.test.mjs", "communication-policy.test.mjs", "fixtures", "legacy", "run-tests.ps1", "team-contract.test.mjs"].sort(),
    `tests/ must contain only the deterministic contract and communication-policy tests; got ${entries.join(", ")}`);
  // Both top-level .test.mjs files are allowed.
  const topLevelTests = entries.filter((name) => name.endsWith(".test.mjs")).sort();
  assert.deepEqual(topLevelTests, ["blackboard.test.mjs", "communication-policy.test.mjs", "team-contract.test.mjs"]);
  // The contract test must be referenced by run-tests.ps1.
  const runner = await readFile(join(REPO, "tests/run-tests.ps1"), "utf8");
  assert.match(runner, /team-contract\.test\.mjs/);
  assert.match(runner, /communication-policy\.test\.mjs/);
  assert.match(runner, /blackboard\.test\.mjs/);
});

test("shared AGENTS context and Lead skill keep separate responsibilities", async () => {
  const agents = await readFile(join(REPO, "AGENTS.md"), "utf8");
  assert.match(agents, /# Pi Team Shared Agent Context/);
  assert.match(agents, /## Repository map and validation/);
  assert.match(agents, /## Context boundary/);
  assert.doesNotMatch(agents, /<lead-pi-team-runbook>/);
  assert.doesNotMatch(agents, /pi-team\.cmd publish <contract-path>/);
  const readme = await readFile(join(REPO, "README.md"), "utf8");
  assert.match(readme, /Publishing a Blackboard task only publishes the Lead-owned scope; it does not\s+start Pi roles/);
  assert.match(readme, /pi-team\.cmd publish/);
  assert.match(readme, /pi-team\.cmd codex-setup/);
  const leadSkill = await readFile(join(REPO, "plugins/agent-blackboard/skills/pi-team-lead/SKILL.md"), "utf8");
  assert.match(leadSkill, /pi-team\.cmd codex-setup/);
  assert.match(leadSkill, /pi-team\.cmd publish <absolute-contract-path>/);
  assert.match(leadSkill, /pi-team\.cmd preflight <issue-number>/);
  assert.match(leadSkill, /pi-team\.cmd finalize <task-id>/);
  assert.match(leadSkill, /task-specific contamination/i);
  const launcher = await readFile(join(REPO, "scripts/pi-team.ps1"), "utf8");
  assert.match(launcher, /function Preflight/);
  assert.match(launcher, /function Finalize-Task/);
  assert.match(launcher, /'finalize' \{Finalize-Task \$Arg1\}/);
  assert.match(launcher, /merged_to_target/);
  assert.match(launcher, /github_issue_synced/);
});
