import { Client } from "../.pi/researcher-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../.pi/researcher-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DeepResearchMcpAdapter } from "../.pi/research/deep-research-mcp-adapter.mjs";
import { ResearchRun } from "../.pi/research/context-manager.mjs";

const objective = `调研 Deep Research Agent 的上下文管理。重点分析 2024 年至今的发展趋势，同时补充必要的更早奠基工作。研究应覆盖：子任务/子 Agent 上下文隔离、分层上下文、检索结果压缩、外部 artifact 或 memory、checkpoint/resume、token-budget-aware planning、长上下文退化、引用与证据溯源，以及相关评估方法。比较学术方法与主流开源实现，并总结当前共识、主要分歧、仍未解决的问题和对本项目 Researcher 架构的启示。优先引用原始论文、官方技术文档和项目官方仓库，不要调用 write_report。`;
const subQuestions = [
  "子任务/子 Agent 上下文隔离与分层上下文：学术方法和开源实现如何划分、传递、合并上下文？",
  "检索结果压缩、外部 artifact/memory、checkpoint/resume 和长上下文退化的机制与证据。",
  "token-budget-aware planning、引用/证据溯源和相关评估方法，尤其是 2024 年至今的进展。",
  "比较代表性原始论文与主流开源实现，总结共识、分歧、未解决问题及对当前 Researcher/MCP 两层架构的启示。",
];

const root = join(process.cwd(), ".pi", "research", "runs");
const sidecarPython = resolve(process.cwd(), ".sidecar/gptr-mcp/.venv/Scripts/python.exe");
const sidecarServer = resolve(process.cwd(), ".sidecar/gptr-mcp/server.py");
const baseUrl = process.env.MINIMAX_OPENAI_BASE_URL || "https://api.minimaxi.com/v1";
if (!process.env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required");

const childEnv = {
  ...process.env,
  OPENAI_API_KEY: process.env.MINIMAX_API_KEY,
  OPENAI_BASE_URL: baseUrl,
  FAST_LLM: "openai:MiniMax-M3",
  SMART_LLM: "openai:MiniMax-M3",
  STRATEGIC_LLM: "openai:MiniMax-M3",
  EMBEDDING: "minimax:embo-01",
  RETRIEVER: "tavily",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};

const clientFactory = async () => {
  const client = new Client({ name: "researcher-acceptance", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: sidecarPython, args: [sidecarServer], env: childEnv });
  await client.connect(transport);
  return client;
};

const adapter = new DeepResearchMcpAdapter({
  protocol: "gptr-direct",
  toolNames: { start: "deep_research", context: "get_research_context", sources: "get_research_sources" },
  clientFactory,
  timeoutMs: 900000,
});
const run = await ResearchRun.create(root, { brief: objective, sub_questions: subQuestions }, {
  maxPayloadCharsPerCall: 60000,
  activeContextSoftLimit: 120000,
  rolloverHardLimit: 160000,
  maxToolCalls: 12,
});
const trace = {
  config: { transport: "stdio", model: "MiniMax-M3", openai_base_url: baseUrl, search_provider: "Tavily", embedding: "minimax:embo-01", write_report_called: false },
  run_id: run.runId,
  calls: [],
};

try {
  const started = await adapter.start({ objective, subQuestions, contextBudget: run.state.budgets });
  trace.calls.push({ tool: "deep_research", action: "call", task_id: started.task_id, status: started.status, model: started.model ?? "MiniMax-M3" });
  await run.registerMcpTask({ ...started, requested_context_budget: run.state.budgets });
  const status = await adapter.status(started.task_id);
  trace.calls.push({ tool: "deep_research", action: "status", task_id: started.task_id, status: status.status, progress: status.progress });
  await run.updateMcpTask(started.task_id, status);
  const value = await adapter.result(started.task_id);
  trace.calls.push({ tool: "get_research_context/get_research_sources", action: "result", task_id: started.task_id, context_chars: String(value.report ?? "").length, source_count: value.sources?.length ?? 0, source_url_count: value.source_urls?.length ?? 0 });
  await run.storeMcpResult(started.task_id, value);
  const review = await run.reviewMcpResult(started.task_id);
  trace.review = review;
  if (review.verdict !== "READY_FOR_SYNTHESIS") throw new Error(`MCP review failed: ${JSON.stringify(review)}`);
  const input = await run.synthesisInput();
  trace.synthesis = { frozen_result_path: input.result_artifact_path, bounded_report_chars: input.deep_research.report.length, bounded_source_count: input.deep_research.sources.length, fresh_session_required: input.fresh_session_required };

  const synthesisSystem = `你是 Researcher 的最终综合层。你只能使用用户目标和下方冻结的 gptr-mcp 研究结果；不得联网、不得自行搜索、不得调用任何 MCP 工具、不得补造来源。输出详细中文 Markdown 报告，必须包含：执行摘要、研究范围和方法、主要技术路线及其演进、2024 年至今趋势、代表性论文和开源实现对比、上下文预算/隔离/压缩/恢复、证据冲突和未解决问题、对当前 Researcher/Deep Research MCP 两层架构建议、来源清单和可点击 URL。每个重要结论标注为“来源事实”“Researcher 推断”或“不确定性”，只引用冻结结果里的来源 URL。`;
  const synthesisUser = JSON.stringify({ plan: input.plan, frozen_mcp_research: input.deep_research, review: input.review }, null, 2);
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` }, body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "system", content: synthesisSystem }, { role: "user", content: synthesisUser }], max_completion_tokens: 14000, temperature: 0.2 }) });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Researcher synthesis HTTP ${response.status}: ${responseText.slice(0, 600)}`);
  const completion = JSON.parse(responseText);
  let report = completion.choices?.[0]?.message?.content ?? "";
  report = report.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
  if (!report) throw new Error("Researcher synthesis returned empty content");
  const reportPath = await run.writeReport(report);
  trace.calls.push({ tool: "Researcher MiniMax synthesis", action: "call", model: "MiniMax-M3", input: "frozen MCP result only", write_report_called: false });
  trace.report_path = reportPath;
  trace.status = "completed";
} catch (error) {
  trace.status = "failed";
  trace.error = String(error?.stack ?? error);
  await run.markFailed("acceptance_run_failed", { error: trace.error });
  throw error;
} finally {
  await adapter.close().catch(() => undefined);
  await writeFile(join(process.cwd(), ".pi", "research", "acceptance-trace.json"), JSON.stringify(trace, null, 2) + "\n", "utf8");
}

console.log(JSON.stringify(trace));
