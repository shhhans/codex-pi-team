import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "../npm/node_modules/typebox/build/index.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { ResearchRun, DEFAULT_BUDGETS } from "../research/context-manager.mjs";
import { DeepResearchMcpAdapter, configuredToolNames } from "../research/deep-research-mcp-adapter.mjs";

let active: ResearchRun | undefined;
let adapter: DeepResearchMcpAdapter | undefined;

function result(text: string) { return { content: [{ type: "text", text }] }; }
function rootFrom(ctx: any) { return `${ctx.cwd ?? process.cwd()}/.pi/research/runs`; }
function contentText(content: any[]) { return (content ?? []).filter((item) => item?.type === "text").map((item) => item.text ?? "").join("\n"); }
function messageChars(message: any) { return typeof message?.content === "string" ? message.content.length : contentText(message?.content ?? []).length; }

function getAdapter() {
  if (adapter) return adapter;
  const endpoint = process.env.DEEP_RESEARCH_MCP_URL;
  const stdio = !endpoint;
  if (!endpoint && process.env.DEEP_RESEARCH_MCP_DISABLE_STDIO === "1") throw new Error("Deep Research MCP is disabled");
  if (!endpoint && process.env.MINIMAX_API_KEY == null) throw new Error("MINIMAX_API_KEY is required for gptr-mcp stdio");
  const protocol = stdio ? "gptr-direct" : "task";
  adapter = new DeepResearchMcpAdapter({
    toolNames: configuredToolNames(),
    protocol,
    timeoutMs: Number(process.env.DEEP_RESEARCH_MCP_TIMEOUT_MS || 120000),
    clientFactory: async () => {
      const client = new Client({ name: "pi-researcher-adapter", version: "1.0.0" });
      let transport: any;
      if (stdio) {
        const python = process.env.GPTR_MCP_PYTHON || resolve(process.cwd(), ".sidecar/gptr-mcp/.venv/Scripts/python.exe");
        const baseUrl = process.env.MINIMAX_OPENAI_BASE_URL || "https://api.minimaxi.com/v1";
        const env = { ...process.env, OPENAI_API_KEY: process.env.MINIMAX_API_KEY, OPENAI_BASE_URL: baseUrl, FAST_LLM: "openai:MiniMax-M3", SMART_LLM: "openai:MiniMax-M3", STRATEGIC_LLM: "openai:MiniMax-M3", EMBEDDING: "minimax:embo-01", RETRIEVER: "tavily" };
        transport = new StdioClientTransport({ command: python, args: [resolve(process.cwd(), ".sidecar/gptr-mcp/server.py")], env });
      } else {
        const headers: Record<string, string> = {};
        if (process.env.DEEP_RESEARCH_MCP_TOKEN) headers.Authorization = `Bearer ${process.env.DEEP_RESEARCH_MCP_TOKEN}`;
        transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } });
      }
      await client.connect(transport);
      return client;
    },
  });
  return adapter;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event: any) => {
    if (!active) return;
    const raw = contentText(event.content);
    await active.observeToolResult(event.toolName, event.input, raw, event.usage ?? null);
    const budget = active.state.budgets;
    if (raw.length <= budget.maxPayloadCharsPerCall) {
      await active.recordActiveResultSize(raw.length);
      return;
    }
    const artifact = await active.addToolResultArtifact({ tool: event.toolName, input: event.input, content: raw });
    const replacement = JSON.stringify({ offloaded: true, tool: event.toolName, preview: raw.slice(0, 1200), artifact_path: artifact.artifact_path, raw_chars: raw.length });
    await active.recordActiveResultSize(replacement.length);
    return { content: [{ type: "text", text: replacement }] };
  });

  pi.on("context", async (event: any, ctx: any) => {
    if (!active) return;
    const before = event.messages.reduce((sum: number, message: any) => sum + messageChars(message), 0);
    const limit = active.state.budgets.maxPayloadCharsPerCall;
    let pruned = 0;
    const messages = event.messages.filter((message: any) => message?.customType !== "research-working-summary").map((message: any) => {
      if (message?.role !== "toolResult" || messageChars(message) <= limit) return message;
      pruned += 1;
      return { ...message, content: [{ type: "text", text: "[large result offloaded to the durable research run]" }] };
    });
    messages.push({ role: "custom", customType: "research-working-summary", content: active.renderWorkingSummary(), display: false, timestamp: Date.now() });
    const after = messages.reduce((sum: number, message: any) => sum + messageChars(message), 0);
    await active.recordContextWindow(before, after, pruned);
    const estimated = active.state.usage.active_context_tokens ?? 0;
    if (active.state.tool_calls.total >= active.state.budgets.maxToolCalls || estimated >= active.state.budgets.rolloverHardLimit) ctx?.abort?.();
    return { messages };
  });

  pi.on("message_end", async (event: any) => {
    if (active && event.message?.role === "assistant" && event.message?.usage) await active.recordProviderUsage(event.message.usage);
  });

  pi.on("agent_end", async (event: any) => {
    await adapter?.close().catch(() => undefined);
    adapter = undefined;
    if (active?.state.status !== "active") return;
    const signal = String(event?.reason ?? event?.error ?? event?.stopReason ?? "normal_agent_end");
    const hasResult = active.state.mcp_tasks.some((task: any) => task.result_path);
    await active.markFailed(hasResult ? "agent_terminated_after_mcp_result" : "agent_terminated_before_mcp_result", { classification: hasResult ? "partial" : "failed", signal });
  });

  pi.registerTool({
    name: "research_run", label: "Research Orchestration Run",
    description: "Create or resume a durable Researcher orchestration run. The Deep Research MCP owns searching, retrieval, decomposition, and cross-validation.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("resume")]), run_id: Type.Optional(Type.String()), brief: Type.Optional(Type.String()), sub_questions: Type.Optional(Type.Array(Type.String())), budgets: Type.Optional(Type.Record(Type.String(), Type.Number())) }),
    async execute(_id, params, ctx) {
      active = params.action === "resume" ? await ResearchRun.resume(rootFrom(ctx), params.run_id!) : await ResearchRun.create(rootFrom(ctx), { brief: params.brief ?? "", sub_questions: params.sub_questions ?? [] }, { ...DEFAULT_BUDGETS, ...(params.budgets ?? {}) });
      return result(JSON.stringify({ run_id: active.runId, state_path: `${active.dir}/state.json`, phase: active.state.phase, budgets: active.state.budgets }));
    },
  });

  pi.registerTool({
    name: "deep_research_task", label: "Deep Research MCP Task",
    description: "Controlled Deep Research MCP client. Start, monitor, retrieve, or cancel a delegated research task; large results are persisted outside active context.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("result"), Type.Literal("cancel")]), task_id: Type.Optional(Type.String()), objective: Type.Optional(Type.String()), sub_questions: Type.Optional(Type.Array(Type.String())), constraints: Type.Optional(Type.Record(Type.String(), Type.Unknown())), context_budget: Type.Optional(Type.Record(Type.String(), Type.Number())) }),
    async execute(_id, params) {
      if (!active) return { ...result("No active orchestration run. Call research_run first."), isError: true };
      try {
        const client = getAdapter();
        if (params.action === "start") {
          if (!params.objective) throw new Error("objective is required for start");
          const started = await client.start({ objective: params.objective, subQuestions: params.sub_questions ?? [], constraints: params.constraints ?? {}, contextBudget: params.context_budget ?? active.state.budgets });
          const task = await active.registerMcpTask({ ...started, requested_context_budget: params.context_budget ?? active.state.budgets });
          return result(JSON.stringify({ task_id: task.task_id, status: task.status, next_action: "poll status" }));
        }
        if (!params.task_id) throw new Error("task_id is required");
        if (params.action === "status") {
          const status = await client.status(params.task_id);
          const task = await active.updateMcpTask(params.task_id, status);
          return result(JSON.stringify({ task_id: task.task_id, status: task.status, progress: task.progress, context_usage: task.context_usage, budget_state: task.budget_state }));
        }
        if (params.action === "result") {
          const value = await client.result(params.task_id);
          const stored = await active.storeMcpResult(params.task_id, value);
          return result(JSON.stringify({ ...stored, next_action: "call deep_research_review; result body was not inserted into active context" }));
        }
        const cancelled = await client.cancel(params.task_id);
        await active.updateMcpTask(params.task_id, { ...cancelled, status: "cancelled" });
        return result(JSON.stringify({ task_id: params.task_id, status: "cancelled" }));
      } catch (error) { return { ...result(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "deep_research_review", label: "Review Deep Research Result",
    description: "Gate synthesis by checking evidence provenance, citations, contradictions, gaps, and requested sub-question coverage in the frozen MCP result.",
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id, params) {
      if (!active) return { ...result("No active orchestration run."), isError: true };
      try { return result(JSON.stringify(await active.reviewMcpResult(params.task_id))); } catch (error) { return { ...result(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "research_synthesis_input", label: "Fresh Final-Report Input",
    description: "After review passes, build a bounded clean input for the Researcher to write the final report.", parameters: Type.Object({}),
    async execute() {
      if (!active) return { ...result("No active orchestration run."), isError: true };
      try { return result(JSON.stringify(await active.synthesisInput())); } catch (error) { return { ...result(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "research_report_artifact", label: "Final Research Report",
    description: "Persist the Researcher's final report after the delegated result passes review.", parameters: Type.Object({ content: Type.String() }),
    async execute(_id, params) {
      if (!active) return { ...result("No active orchestration run."), isError: true };
      if (active.state.review?.verdict !== "READY_FOR_SYNTHESIS") return { ...result("Deep Research MCP result has not passed review."), isError: true };
      return result(JSON.stringify({ report_path: await active.writeReport(params.content) }));
    },
  });
}
