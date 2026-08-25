import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO = process.cwd();
const SKILL_NAMES = ["answer-research-question", "execute-delegated-task", "review-delegated-task"];
const RESEARCHER_TOOLS = ["read", "grep", "find", "ls", "write", "web_search", "fetch_content", "get_search_content", "source_check", "intercom", "report_to_lead"];
const EXECUTOR_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead"];
const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead"];
const DEEP_RESEARCH_TOOLS = ["research_run", "deep_research_task", "deep_research_review", "research_synthesis_input", "research_report_artifact"];
const ACTIVE_ROLES = ["researcher", "executor", "reviewer"];
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
    assert.equal(fm.inheritSkills, "false", `${role} must set inheritSkills: false`);
    assert.equal(fm.skillPath, "../skills", `${role} must use the project-private skill path`);
    assert.equal(fm.extensions, "", `${role} must disable ambient extensions`);
    assert.match(text, /^tools:.*\bintercom\b/m, `${role} must include intercom for paired peer communication`);
    assert.match(text, /Peer policy:/, `${role} must declare a peer policy`);
    assert.match(text, /refuse before/i, `${role} must refuse before intercom send/ask`);
    // Active roles must not bind persistent memory; they use role prompt + private skills only.
    assert.ok(!("memory" in fm), `${role} frontmatter must not declare a memory binding`);
    assert.doesNotMatch(text, /^memory:\s*$/m, `${role} must not contain a memory: frontmatter block`);
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
  assert.deepEqual(exts, [SHARED_INTERCOM, SHARED_WEB_ACCESS, "../communication/extensions/researcher.ts", "../communication/extensions/report-to-lead.ts"],
    "Researcher must load shared intercom and web access plus project policy extensions");
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
    await writeFile(fakePi, String.raw`param([string]$Command,[string]$Source)
if ($Command -ne 'install') { Write-Error "unexpected command: $Command source: $Source"; exit 2 }
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

test("tests directory contains the deterministic contract and communication-policy tests", async () => {
  const { readdir } = await import("node:fs/promises");
  const entries = (await readdir(join(REPO, "tests"))).filter((name) => !name.startsWith(".")).sort();
  assert.deepEqual(entries, ["communication-policy.test.mjs", "fixtures", "legacy", "run-tests.ps1", "team-contract.test.mjs"].sort(),
    `tests/ must contain only the deterministic contract and communication-policy tests; got ${entries.join(", ")}`);
  // Both top-level .test.mjs files are allowed.
  const topLevelTests = entries.filter((name) => name.endsWith(".test.mjs")).sort();
  assert.deepEqual(topLevelTests, ["communication-policy.test.mjs", "team-contract.test.mjs"]);
  // The contract test must be referenced by run-tests.ps1.
  const runner = await readFile(join(REPO, "tests/run-tests.ps1"), "utf8");
  assert.match(runner, /team-contract\.test\.mjs/);
  assert.match(runner, /communication-policy\.test\.mjs/);
});
