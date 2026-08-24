import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeepResearchMcpAdapter } from "../.pi/research/deep-research-mcp-adapter.mjs";
import { ResearchRun } from "../.pi/research/context-manager.mjs";

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async listTools() { return { tools: ["deep_research_start", "deep_research_status", "deep_research_result", "deep_research_cancel"].map((name) => ({ name })) }; },
    async callTool(request) {
      calls.push(request);
      if (request.name === "deep_research_start") return { structuredContent: { task_id: "task-1", status: "submitted" }, content: [] };
      if (request.name === "deep_research_status") return { structuredContent: { status: "running", progress: 0.5, context_usage: { tokens: 1200 } }, content: [] };
      return { structuredContent: overrides.result ?? {}, content: [] };
    },
    async close() {},
  };
  return client;
}

test("adapter causally delegates the objective and output contract to MCP", async () => {
  const client = fakeClient();
  const adapter = new DeepResearchMcpAdapter({ clientFactory: async () => client });
  const started = await adapter.start({ objective: "Assess X", subQuestions: ["Q1"], contextBudget: { maxToolCalls: 10 } });
  assert.equal(started.task_id, "task-1");
  assert.equal(client.calls[0].name, "deep_research_start");
  assert.equal(client.calls[0].arguments.objective, "Assess X");
  assert.deepEqual(client.calls[0].arguments.sub_questions, ["Q1"]);
  assert.ok(client.calls[0].arguments.output_contract.required.includes("citations"));
});

test("adapter fails closed when the server lacks a required task operation", async () => {
  const client = fakeClient();
  client.listTools = async () => ({ tools: [{ name: "deep_research_start" }] });
  const adapter = new DeepResearchMcpAdapter({ clientFactory: async () => client });
  await assert.rejects(() => adapter.start({ objective: "X" }), /missing required tool/);
});

test("review gate accepts cited complete MCP evidence and supplies bounded synthesis", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-mcp-review-"));
  try {
    const run = await ResearchRun.create(root, { brief: "Assess X", sub_questions: ["Q1"] }, { maxPayloadCharsPerCall: 1000 });
    await run.registerMcpTask({ task_id: "task-1", status: "submitted" });
    await run.storeMcpResult("task-1", {
      report: "Supported result with citation [source-1].", findings: [{ claim: "supported" }],
      sources: [{ source_id: "source-1", url: "https://example.test/source" }],
      citations: [{ source_id: "source-1", claim: "supported" }], contradictions: [], gaps: [],
      coverage: [{ sub_question: "Q1", status: "covered" }],
    });
    const review = await run.reviewMcpResult("task-1");
    assert.equal(review.verdict, "READY_FOR_SYNTHESIS");
    const input = await run.synthesisInput();
    assert.match(input.deep_research.report, /Supported result/);
    assert.equal(input.review.citation_count, 1);
    assert.match(await readFile(input.result_artifact_path, "utf8"), /example\.test/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("orchestration records MCP progress and warns on remote context budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-mcp-budget-"));
  try {
    const run = await ResearchRun.create(root, { brief: "Assess X", sub_questions: [] });
    await run.registerMcpTask({ task_id: "task-1", requested_context_budget: { max_tokens: 1000 } });
    const task = await run.updateMcpTask("task-1", { status: "running", progress: 0.8, context_usage: { total_tokens: 850 } });
    assert.equal(task.progress, 0.8);
    assert.equal(task.budget_state, "WARNING");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("negative control: an uncited or uncovered MCP result cannot reach synthesis", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-mcp-negative-"));
  try {
    const run = await ResearchRun.create(root, { brief: "Assess X", sub_questions: ["Q1"] });
    await run.registerMcpTask({ task_id: "task-1" });
    await run.storeMcpResult("task-1", { report: "Unsupported answer", sources: [], citations: [], contradictions: [], gaps: [], coverage: [] });
    const review = await run.reviewMcpResult("task-1");
    assert.equal(review.verdict, "NEEDS_MORE_RESEARCH");
    await assert.rejects(() => run.synthesisInput(), /must pass review/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
