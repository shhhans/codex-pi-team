import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const tracePath = join(process.cwd(), ".pi", "research", "acceptance-trace.json");
const trace = JSON.parse(await readFile(tracePath, "utf8"));
const frozen = JSON.parse(await readFile(trace.synthesis.frozen_result_path, "utf8"));
const baseUrl = process.env.MINIMAX_OPENAI_BASE_URL || "https://api.minimaxi.com/v1";
if (!process.env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required");

const synthesisSystem = `你是 Researcher 的最终综合层。你只能使用用户目标和下方冻结的 gptr-mcp 研究结果；不得联网、不得自行搜索、不得调用任何 MCP 工具、不得补造来源。输出详细中文 Markdown 报告，必须包含：执行摘要、研究范围和方法、主要技术路线及其演进、2024 年至今趋势、代表性论文和开源实现对比、上下文预算/隔离/压缩/恢复、证据冲突和未解决问题、对当前 Researcher/Deep Research MCP 两层架构建议、来源清单和可点击 URL。每个重要结论标注为“来源事实”“Researcher 推断”或“不确定性”，只引用冻结结果里的来源 URL。`;
const frozenInput = {
  report: String(frozen.report ?? "").slice(0, 8000),
  sources: frozen.sources ?? [],
  source_urls: frozen.source_urls ?? [],
  citations: frozen.citations ?? [],
  coverage: frozen.coverage ?? [],
  provider: frozen.provider,
  model: frozen.model,
};
const synthesisUser = JSON.stringify({ brief: trace.config.research_objective ?? "Deep Research Agent 上下文管理", frozen_mcp_research: frozenInput }, null, 2);
let lastError;
for (let attempt = 1; attempt <= 4; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "system", content: synthesisSystem }, { role: "user", content: synthesisUser }], max_tokens: 12000, temperature: 0.2, reasoning_split: true }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Researcher synthesis HTTP ${response.status}: ${responseText.slice(0, 600)}`);
    const completion = JSON.parse(responseText);
    let report = completion.choices?.[0]?.message?.content ?? "";
    report = report.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
    if (!report) throw new Error("Researcher synthesis returned empty content");
    const reportPath = join(dirname(trace.synthesis.frozen_result_path), "..", "report.md");
    await writeFile(reportPath, report + "\n", "utf8");
    trace.calls.push({ tool: "Researcher MiniMax synthesis", action: "call", model: "MiniMax-M3", input: "frozen MCP result only", write_report_called: false, attempt });
    trace.report_path = reportPath;
    trace.status = "completed";
    delete trace.error;
    trace.synthesis.input_report_chars = frozenInput.report.length;
    trace.synthesis.input_source_count = frozenInput.sources.length;
    await writeFile(tracePath, JSON.stringify(trace, null, 2) + "\n", "utf8");
    process.stdout.write(JSON.stringify({ status: "completed", report_path: reportPath, attempt, report_chars: report.length }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
  }
}
trace.status = "failed";
trace.error = String(lastError?.stack ?? lastError);
await writeFile(tracePath, JSON.stringify(trace, null, 2) + "\n", "utf8");
throw lastError;
