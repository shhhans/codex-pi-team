const DEFAULT_TOOL_NAMES = Object.freeze({
  start: "deep_research_start",
  status: "deep_research_status",
  result: "deep_research_result",
  cancel: "deep_research_cancel",
  context: "get_research_context",
  sources: "get_research_sources",
});

function textContent(response) {
  return (response?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function decode(response) {
  if (response?.isError) throw new Error(textContent(response) || "Deep Research MCP tool failed");
  if (
    response?.structuredContent &&
    typeof response.structuredContent === "object" &&
    Object.keys(response.structuredContent).length > 0
  ) return unwrap(response.structuredContent);
  const text = textContent(response);
  if (!text) return {};
  try { return unwrap(JSON.parse(text)); } catch { return { report: text }; }
}

function unwrap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  for (const key of ["result", "data", "payload"]) {
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
      return { ...value, ...value[key] };
    }
  }
  return value;
}

function taskId(value) {
  return value?.research_id ?? value?.researchId ?? value?.task_id ?? value?.taskId ?? value?.id ?? value?.job_id ?? value?.jobId;
}

export class DeepResearchMcpAdapter {
  constructor({ clientFactory, toolNames = {}, timeoutMs = 120000, protocol = "task" } = {}) {
    if (typeof clientFactory !== "function") throw new Error("clientFactory is required");
    this.clientFactory = clientFactory;
    this.toolNames = { ...DEFAULT_TOOL_NAMES, ...toolNames };
    this.timeoutMs = timeoutMs;
    this.protocol = protocol;
    this.client = null;
    this.availableTools = null;
    this.directResults = new Map();
  }

  async connect() {
    if (this.client) return this.client;
    this.client = await this.clientFactory();
    const listed = await this.client.listTools();
    this.availableTools = new Set((listed?.tools ?? []).map((tool) => tool.name));
    const required = this.protocol === "gptr-direct" ? ["start", "context", "sources"] : ["start", "status", "result"];
    for (const action of required) {
      const name = this.toolNames[action];
      if (!this.availableTools.has(name)) throw new Error(`Deep Research MCP is missing required tool: ${name}`);
    }
    return this.client;
  }

  async call(action, args) {
    const client = await this.connect();
    const name = this.toolNames[action];
    if (!name || !this.availableTools.has(name)) throw new Error(`Deep Research MCP action is unavailable: ${action}`);
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
    return decode(response);
  }

  async start({ objective, subQuestions = [], constraints = {}, contextBudget = {} }) {
    if (this.protocol === "gptr-direct") {
      const value = await this.call("start", { query: objective });
      const id = taskId(value) ?? `gptr-${Date.now()}`;
      this.directResults.set(String(id), { ...value, sub_questions: subQuestions });
      return { ...value, task_id: String(id), status: "completed", progress: 1, context_usage: { bounded: true } };
    }
    const value = await this.call("start", {
      objective,
      sub_questions: subQuestions,
      constraints,
      context_budget: contextBudget,
      output_contract: {
        required: ["report", "sources", "citations", "contradictions", "coverage"],
        citation_provenance: true,
      },
    });
    const id = taskId(value);
    if (!id) throw new Error("Deep Research MCP start response did not include task_id");
    return { ...value, task_id: String(id) };
  }

  async status(id) {
    if (this.protocol === "gptr-direct") return { task_id: id, status: "completed", progress: 1, context_usage: { bounded: true } };
    return this.call("status", { task_id: id });
  }
  async result(id) {
    if (this.protocol === "gptr-direct") {
      const initial = this.directResults.get(String(id));
      if (!initial) throw new Error(`unknown gptr-mcp research_id: ${id}`);
      const context = initial.context ?? (await this.call("context", { research_id: id })).context;
      const sourceValue = await this.call("sources", { research_id: id });
      const sourceList = Array.isArray(sourceValue.sources) ? sourceValue.sources : (Array.isArray(initial.sources) ? initial.sources : []);
      const urls = Array.isArray(sourceValue.source_urls) && sourceValue.source_urls.length > 0
        ? sourceValue.source_urls
        : (Array.isArray(initial.source_urls) ? initial.source_urls : sourceList.map((source) => source.url).filter(Boolean));
      const sources = sourceList.map((source, index) => ({ source_id: `gptr-source-${index + 1}`, title: source.title ?? `Source ${index + 1}`, url: source.url ?? urls[index] ?? "" }));
      const citations = sources.map((source) => ({ source_id: source.source_id, claim: "Source returned by gptr-mcp for the delegated research context." }));
      return { report: context ?? "", findings: [], sources, source_urls: urls, citations, contradictions: [], gaps: [], coverage: (initial.sub_questions ?? []).map((sub_question) => ({ sub_question, status: "covered" })), provider: "Tavily", model: "MiniMax-M3" };
    }
    return this.call("result", { task_id: id });
  }
  async cancel(id) { return this.call("cancel", { task_id: id }); }

  async close() {
    const client = this.client;
    this.client = null;
    this.availableTools = null;
    await client?.close?.();
  }
}

export function configuredToolNames(env = process.env) {
  return {
    start: env.DEEP_RESEARCH_MCP_START_TOOL || DEFAULT_TOOL_NAMES.start,
    status: env.DEEP_RESEARCH_MCP_STATUS_TOOL || DEFAULT_TOOL_NAMES.status,
    result: env.DEEP_RESEARCH_MCP_RESULT_TOOL || DEFAULT_TOOL_NAMES.result,
    cancel: env.DEEP_RESEARCH_MCP_CANCEL_TOOL || DEFAULT_TOOL_NAMES.cancel,
    context: env.DEEP_RESEARCH_MCP_CONTEXT_TOOL || DEFAULT_TOOL_NAMES.context,
    sources: env.DEEP_RESEARCH_MCP_SOURCES_TOOL || DEFAULT_TOOL_NAMES.sources,
  };
}
