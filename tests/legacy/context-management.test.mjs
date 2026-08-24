import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchRun } from "../.pi/research/context-manager.mjs";

const fixture = () => `PUBLIC FIXTURE PAGE\n${"untrusted page paragraph ".repeat(12000)}`;

test("raw pages are artifacts and bounded results keep them out of active context", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-run-"));
  try {
    const run = await ResearchRun.create(root, { brief: "bounded fixture", sub_questions: ["What is supported?"] });
    const source = await run.addSource({ title: "Fixture", url: "https://example.test/source", content: fixture() });
    const response = run.boundedResult({ summary: "stored", sourceIds: [source.source_id], urls: [source.url], artifactPaths: [source.artifact_path] });
    assert.ok((await readFile(join(run.dir, "sources", `${source.source_id}.md`), "utf8")).length > 200000);
    assert.ok(JSON.stringify(response).length < 2000);
    assert.doesNotMatch(JSON.stringify(response), /untrusted page paragraph/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("evidence cards preserve URL and artifact provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-evidence-"));
  try {
    const run = await ResearchRun.create(root, { sub_questions: ["Q"] });
    const source = await run.addSource({ title: "Source", url: "https://example.test/a", content: "claim excerpt" });
    const card = await run.addEvidenceCard({ source_id: source.source_id, sub_questions: ["Q"], supported_claims: ["claim"], supporting_excerpts: ["claim excerpt"] });
    assert.equal(card.url, "https://example.test/a");
    assert.equal(card.artifact_path, source.artifact_path);
    assert.match(await readFile(card.evidence_path, "utf8"), new RegExp(source.source_id));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("checkpoint uses runtime tool calls, not forged model round/count", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-checkpoint-"));
  try {
    const run = await ResearchRun.create(root, { sub_questions: ["Q"] }, { maxToolCalls: 2, activeContextSoftLimit: 100000, rolloverHardLimit: 100000 });
    await run.recordToolCall("web_search", { payload: "one" });
    await run.recordToolCall("web_search", { payload: "two" });
    const checkpoint = await run.checkpoint({ round: 0, minSources: 0, minCoverage: 0 });
    assert.equal(checkpoint.verdict, "ROLLOVER_REQUIRED");
    assert.equal(checkpoint.runtime.tool_calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rollover and resume preserve state while fresh synthesis excludes raw tool history", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-resume-"));
  try {
    const run = await ResearchRun.create(root, { brief: "resume", sub_questions: ["Q"] }, { maxToolCalls: 1 });
    const source = await run.addSource({ title: "Source", url: "https://example.test/a", content: fixture() });
    await run.addEvidenceCard({ source_id: source.source_id, sub_questions: ["Q"], supported_claims: ["claim"], supporting_excerpts: ["excerpt"] });
    await run.recordToolCall("web_extract", fixture());
    const next = await run.rollover();
    const resumed = await ResearchRun.resume(root, run.runId);
    assert.equal(resumed.state.sources.length, 1);
    assert.equal(next.state.status, "active");
    const input = await resumed.synthesisInput();
    assert.equal(input.evidence_cards.length, 1);
    assert.doesNotMatch(JSON.stringify(input), /untrusted page paragraph/);
    assert.equal(input.source_index[0].url, "https://example.test/a");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("negative control exposes growth when the bounded component is removed", async () => {
  const raw = fixture();
  const unboundedToolResult = JSON.stringify({ content: raw });
  const boundedToolResult = JSON.stringify({ summary: "stored", artifact_path: ".pi/research/runs/x/sources/y.md" });
  assert.ok(unboundedToolResult.length > 200000);
  assert.ok(boundedToolResult.length < 2000);
});

test("runtime result observation counts large results, offloads them, and serializes state writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-runtime-observe-"));
  try {
    const run = await ResearchRun.create(root, { sub_questions: [] });
    const raw = fixture();
    await Promise.all(Array.from({ length: 40 }, (_, index) => run.observeToolResult(index === 0 ? "web_extract" : "read", { index }, raw)));
    const artifact = await run.addToolResultArtifact({ tool: "web_extract", input: { url: "https://example.test" }, content: raw });
    const state = JSON.parse(await readFile(join(run.dir, "state.json"), "utf8"));
    assert.equal(state.tool_calls.total, 40);
    assert.equal(state.usage.largest_result_chars, raw.length);
    assert.ok(state.usage.result_chars >= raw.length * 40);
    assert.ok(state.usage.raw_result_tokens > state.usage.active_context_tokens);
    assert.equal((await readFile(join(run.dir, "tool-results", `${artifact.artifact_id}.txt`), "utf8")).length, raw.length);
    assert.equal(state.status, "active");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("offloaded raw results do not consume the active-context rollover budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-active-budget-"));
  try {
    const run = await ResearchRun.create(root, { sub_questions: ["open question"] }, { activeContextSoftLimit: 1000, rolloverHardLimit: 2000, synthesisOutputReserve: 100, maxToolCalls: 100 });
    const raw = fixture();
    await run.observeToolResult("read", { path: "large.md" }, raw);
    await run.recordActiveResultSize(240);
    const checkpoint = await run.checkpoint({ minSources: 0, minCoverage: 1 });
    assert.equal(checkpoint.verdict, "CONTINUE_CURRENT_RUN");
    assert.ok(run.state.usage.raw_result_tokens > 50000);
    assert.equal(run.state.usage.active_context_tokens, 60);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("working summary records search intent and promoted findings instead of only artifact references", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-working-summary-"));
  try {
    const run = await ResearchRun.create(root, { brief: "Investigate bounded context", sub_questions: ["What is the mechanism?"] });
    await run.observeToolResult("web_search", { query: "Pi context event hook" }, "search results stored");
    const source = await run.addSource({ title: "Pi Context API", url: "https://example.test/context", content: "raw page" });
    await run.addEvidenceCard({ source_id: source.source_id, sub_questions: ["What is the mechanism?"], supported_claims: ["context hook can rewrite messages"], supporting_excerpts: ["rewrite messages"] });
    const summary = await readFile(join(run.dir, "briefs", "working-summary.md"), "utf8");
    assert.match(summary, /Pi context event hook/);
    assert.match(summary, /context hook can rewrite messages/);
    assert.match(summary, /Pi Context API/);
    assert.doesNotMatch(summary, /raw page/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
