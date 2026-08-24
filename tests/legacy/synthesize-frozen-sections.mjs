import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const tracePath = join(process.cwd(), ".pi", "research", "acceptance-trace.json");
const trace = JSON.parse(await readFile(tracePath, "utf8"));
const frozen = JSON.parse(await readFile(trace.synthesis.frozen_result_path, "utf8"));
const baseUrl = process.env.MINIMAX_OPENAI_BASE_URL || "https://api.minimaxi.com/v1";
if (!process.env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required");
const frozenInput = JSON.stringify({
  report: String(frozen.report ?? "").slice(0, 3000),
  sources: (frozen.sources ?? []).map(({ title, url }) => ({ title, url })), source_urls: frozen.source_urls ?? [],
  citations: frozen.citations ?? [], coverage: frozen.coverage ?? [],
}, null, 2);
const sections = [
  ["执行摘要与研究范围和方法", "写执行摘要，以及研究范围、方法、来源事实/Researcher 推断/不确定性标注规则。"],
  ["主要技术路线及 2024 年至今演进", "写主要技术路线、时间演进和 2024 年至今趋势，覆盖子任务/子 Agent 隔离、分层上下文、检索压缩、外部 artifact/memory、checkpoint/resume、token budget、长上下文退化。"],
  ["论文与开源实现、评估和证据问题", "写代表性原始论文与官方/主流开源实现对比，覆盖引用与证据溯源、评估方法、证据冲突、共识、分歧和未解决问题。"],
  ["对当前架构的建议与来源清单", "写对当前 Researcher / Deep Research MCP 两层架构的具体建议、上下文预算/隔离/压缩/恢复机制，并给出来源清单；来源清单必须只使用冻结结果中的具体 URL，使用可点击 Markdown 链接。"],
];

async function callSection(title, instruction) {
  const system = `你是 Researcher 的最终综合层。只能使用下方冻结的 gptr-mcp 研究结果；不得联网、不得自行搜索、不得调用 MCP、不得补造来源。输出中文 Markdown 的“${title}”章节，内容具体，重要结论标注“来源事实”“Researcher 推断”或“不确定性”。若引用来源，只使用冻结结果中的 source_urls。${instruction}`;
  const user = `冻结 MCP 研究结果：\n${frozenInput}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
        body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 3000, temperature: 0.2 }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 400)}`);
      const value = JSON.parse(body);
      const content = String(value.choices?.[0]?.message?.content ?? "").replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
      if (!content) throw new Error("empty section");
      return content;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
}

const parts = [];
for (const [title, instruction] of sections) parts.push(await callSection(title, instruction));
const report = `# Deep Research Agent 上下文管理研究报告\n\n${parts.join("\n\n---\n\n")}\n`;
const reportPath = join(dirname(trace.synthesis.frozen_result_path), "..", "report.md");
await writeFile(reportPath, report, "utf8");
trace.calls.push({ tool: "Researcher MiniMax synthesis", action: "sectioned_calls", model: "MiniMax-M3", sections: sections.map(([title]) => title), input: "frozen MCP result only", write_report_called: false });
trace.report_path = reportPath; trace.status = "completed"; delete trace.error;
trace.synthesis.section_count = sections.length; trace.synthesis.input_report_chars = 3000; trace.synthesis.input_source_count = (frozen.sources ?? []).length;
await writeFile(tracePath, JSON.stringify(trace, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify({ status: "completed", report_path: reportPath, report_chars: report.length, sections: sections.length }));
