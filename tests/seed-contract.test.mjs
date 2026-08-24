import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const SKILL_NAMES = ["answer-research-question", "execute-delegated-task", "review-delegated-task"];
const RESEARCHER_TOOLS = ["read", "grep", "find", "ls", "write", "web_search", "fetch_content", "get_search_content", "source_check", "contact_supervisor", "intercom"];
const EXECUTOR_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor", "intercom"];
const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor", "intercom"];
const DEEP_RESEARCH_TOOLS = ["research_run", "deep_research_task", "deep_research_review", "research_synthesis_input", "research_report_artifact"];

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("missing frontmatter");
  const body = match[1];
  const out = {};
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseToolsList(frontmatter) {
  return String(frontmatter.tools ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

async function expectExists(path) {
  const info = await stat(path);
  assert.ok(info.isFile(), `${path} must be a regular file`);
}

test("three seed skills exist with SKILL.md and agents/openai.yaml", async () => {
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

test("researcher, executor, reviewer agent definitions exist with valid frontmatter", async () => {
  for (const role of ["researcher", "executor", "reviewer"]) {
    const path = join(REPO, ".pi/agents", `${role}.md`);
    await expectExists(path);
    const text = await readFile(path, "utf8");
    const fm = parseFrontmatter(text);
    assert.equal(fm.name, role, `${role} frontmatter name must match`);
    assert.equal(fm.inheritSkills, "false", `${role} must set inheritSkills: false`);
    assert.equal(fm.skillPath, "../skills", `${role} must use the project-private skill path`);
    assert.ok(fm.tools, `${role} must declare tools`);
    assert.match(text, /^tools:.*\bintercom\b/m, `${role} must include intercom for paired peer communication`);
    assert.match(text, /Peer policy:/, `${role} must declare a peer policy`);
    assert.match(text, /refuse before/i, `${role} must refuse before intercom send/ask`);
  }
});

test("researcher is bounded, has new tools, and has no Deep Research tools or extensions", async () => {
  const text = await readFile(join(REPO, ".pi/agents/researcher.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseToolsList(fm);
  for (const required of RESEARCHER_TOOLS) assert.ok(tools.includes(required), `Researcher must include tool ${required}`);
  for (const banned of DEEP_RESEARCH_TOOLS) assert.equal(tools.includes(banned), false, `Researcher must not include Deep Research tool ${banned}`);
  assert.match(text, /answer-research-question/);
  assert.equal(fm.skills, "answer-research-question");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /research\/<task-id>-<slug>\.md/);
  assert.doesNotMatch(text, /researcher-runtime\/context-management-extension\.ts/, "Researcher must not reference the Deep Research runtime extension");
  assert.doesNotMatch(text, /^subagentOnlyExtensions:.*deep_research/m, "Researcher must not enable a Deep Research subagentOnlyExtension");
  assert.doesNotMatch(text, /\.pi\/research\/runs/i, "Active Researcher must use the project-root research directory");
  for (const banned of DEEP_RESEARCH_TOOLS) {
    const toolRe = new RegExp(`\\b${banned}\\b`, "i");
    assert.equal(toolRe.test(fm.tools), false, `Researcher frontmatter tools must not list ${banned}`);
  }
});

test("executor has required implementation tools and the delegated-task skill", async () => {
  const text = await readFile(join(REPO, ".pi/agents/executor.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseToolsList(fm);
  for (const required of EXECUTOR_TOOLS) assert.ok(tools.includes(required), `Executor must include tool ${required}`);
  assert.match(text, /execute-delegated-task/);
  assert.equal(fm.skills, "execute-delegated-task");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /Lead task ID/i);
  assert.match(text, /isolated worktree/i);
  assert.match(text, /implementation_notes\/<task-id>\.md/);
  assert.doesNotMatch(text, /\.pi\/research\/runs/i);
});

test("reviewer has bash/edit/write and the review-delegated-task skill", async () => {
  const text = await readFile(join(REPO, ".pi/agents/reviewer.md"), "utf8");
  const fm = parseFrontmatter(text);
  const tools = parseToolsList(fm);
  for (const required of REVIEWER_TOOLS) assert.ok(tools.includes(required), `Reviewer must include tool ${required}`);
  assert.match(text, /review-delegated-task/);
  assert.equal(fm.skills, "review-delegated-task");
  assert.equal(fm.skillPath, "../skills");
  assert.match(text, /never edit production code/i);
  assert.match(text, /failures\/<task-id>-<finding-id>\.md/);
  assert.doesNotMatch(text, /\.pi\/research\/runs/i);
});

test("architect, critic, and engineer are preserved unchanged during the seed", async () => {
  for (const role of ["architect", "critic", "engineer"]) {
    const path = join(REPO, ".pi/agents", `${role}.md`);
    await expectExists(path);
    const text = await readFile(path, "utf8");
    assert.match(text, /Peer policy:/);
    assert.match(text, /refuse before/i);
  }
});

test("deep_research artifacts and old research runtime files are not deleted by the seed", async () => {
  await expectExists(join(REPO, ".pi/researcher-runtime/package.json"));
  await expectExists(join(REPO, ".pi/decisions/2026-08-21-agent-team-communication-baseline.md"));
  await expectExists(join(REPO, ".pi/decisions/_at-tamper-fixture.md"));
  await expectExists(join(REPO, ".pi/agents/architect.md"));
  await expectExists(join(REPO, ".pi/agents/critic.md"));
  await expectExists(join(REPO, ".pi/agents/engineer.md"));
});
