import { mkdir, readFile, readdir, writeFile, appendFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_BUDGETS = Object.freeze({
  searchResultTokens: 4000,
  evidenceCardTokens: 1200,
  briefTokens: 3000,
  activeContextSoftLimit: 64000,
  rolloverHardLimit: 96000,
  synthesisOutputReserve: 16000,
  maxToolCalls: 40,
  maxPayloadCharsPerCall: 16000,
});

const now = () => new Date().toISOString();
const estimateTokens = (value) => Math.ceil(String(value ?? "").length / 4);
const clamp = (value, max) => String(value ?? "").slice(0, Math.max(0, max));
const uniquePush = (items, value, max = 24) => {
  const text = String(value ?? "").trim();
  if (!text || items.includes(text)) return;
  items.push(text);
  if (items.length > max) items.splice(0, items.length - max);
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function atomicJson(path, value) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  const serialized = JSON.stringify(value, null, 2) + "\n";
  await writeFile(tmp, serialized, "utf8");
  let lastError;
  try {
    // Windows can briefly deny replacement while another process is reading
    // state.json. Retry the replacement instead of poisoning the write queue.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await rename(tmp, path);
        return;
      } catch (error) {
        lastError = error;
        if (!(["EPERM", "EBUSY", "EACCES"].includes(error?.code))) throw error;
        await sleep(25 * (attempt + 1));
      }
    }
    throw lastError;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

function initialState(runId, plan, budgets) {
  return {
    run_id: runId, phase: "planning", round: 0, status: "active", created_at: now(), updated_at: now(),
    plan, tool_calls: { total: 0, by_tool: {}, by_round: {} },
    sources: [], sub_questions: (plan.sub_questions ?? []).map((question) => ({ question, status: "open" })),
    contradictions: [], gaps: [], mcp_tasks: [], review: null, research_activity: { searches: [], inspected: [], observations: [] }, working_summary: "", usage: { payload_chars: 0, result_chars: 0, largest_result_chars: 0, estimated_tokens: 0, raw_result_tokens: 0, active_context_chars: 0, active_context_tokens: 0, provider: null, provider_usage: null, context_chars_before: 0, context_chars_after: 0, pruned_messages: 0, offloaded_results: 0 },
    budgets,
  };
}

export class ResearchRun {
  constructor(root, runId, state) { this.root = root; this.runId = runId; this.dir = join(root, runId); this.state = state; this.writeChain = Promise.resolve(); }

  static async create(root, plan, budgets = {}) {
    const runId = randomUUID();
    const merged = { ...DEFAULT_BUDGETS, ...budgets };
    const run = new ResearchRun(root, runId, initialState(runId, plan, merged));
    await mkdir(run.dir, { recursive: true });
    for (const dir of ["sources", "evidence", "briefs", "tool-results", "deep-research"]) await mkdir(join(run.dir, dir), { recursive: true });
    await writeFile(join(run.dir, "plan.md"), renderPlan(plan), "utf8");
    await run.refreshWorkingSummary();
    await run.save();
    return run;
  }

  static async resume(root, runId) {
    const state = JSON.parse(await readFile(join(root, runId, "state.json"), "utf8"));
    state.research_activity ??= { searches: [], inspected: [], observations: [] };
    state.working_summary ??= "";
    state.mcp_tasks ??= [];
    state.review ??= null;
    state.usage ??= {};
    state.usage.raw_result_tokens ??= state.usage.estimated_tokens ?? 0;
    state.usage.active_context_chars ??= 0;
    state.usage.active_context_tokens ??= 0;
    await mkdir(join(root, runId, "deep-research"), { recursive: true });
    return new ResearchRun(root, runId, state);
  }

  async save() {
    const snapshot = structuredClone(this.state);
    snapshot.updated_at = now();
    this.state.updated_at = snapshot.updated_at;
    this.writeChain = this.writeChain.catch(() => undefined).then(() => atomicJson(join(this.dir, "state.json"), snapshot));
    await this.writeChain;
  }
  path(kind, name = "") { return join(this.dir, kind, name); }
  relativePath(path) { return path.replaceAll("\\", "/"); }

  renderWorkingSummary() {
    const activity = this.state.research_activity ?? { searches: [], inspected: [], observations: [] };
    const covered = this.state.sub_questions.filter((q) => q.status === "covered" || q.answered === true).map((q) => q.question);
    const claims = [];
    for (const source of this.state.sources.filter((item) => item.evidence_id)) claims.push(`${source.title || source.url} [${source.source_id}]`);
    const lines = [
      `# Working Research Summary`, ``, `Run: ${this.runId}`, `Phase: ${this.state.phase} | Round: ${this.state.round}`, ``,
      `## Research target`, this.state.plan.brief || "(not specified)", ``,
      `## Searched / inspected`, ...(activity.searches.length ? activity.searches.map((item) => `- Search: ${item}`) : ["- No search query recorded yet."]),
      ...(activity.inspected.length ? activity.inspected.map((item) => `- Inspected: ${item}`) : []), ``,
      `## Sources and evidence`, ...(claims.length ? claims.map((item) => `- Evidence promoted from: ${item}`) : ["- No evidence card has been promoted yet."]),
      ``, `## Covered questions`, ...(covered.length ? covered.map((item) => `- ${item}`) : ["- None marked covered yet."]),
      ``, `## Findings observed during collection`, ...(activity.observations.length ? activity.observations.map((item) => `- ${item}`) : ["- No structured finding recorded yet; inspect evidence cards before making claims."]),
      ``, `## Contradictions`, ...(this.state.contradictions.length ? this.state.contradictions.map((item) => `- ${item}`) : ["- None recorded."]),
      ``, `## Gaps / next actions`, ...(this.state.gaps.length ? this.state.gaps.map((item) => `- ${item}`) : ["- Continue coverage using the open sub-questions."]),
    ];
    return clamp(lines.join("\n"), 12000);
  }

  async refreshWorkingSummary() {
    this.state.working_summary = this.renderWorkingSummary();
    await writeFile(this.path("briefs", "working-summary.md"), `${this.state.working_summary}\n`, "utf8");
  }

  async recordToolCall(tool, payload, providerUsage = null) {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
    const round = this.state.round;
    this.state.tool_calls.total += 1;
    this.state.tool_calls.by_tool[tool] = (this.state.tool_calls.by_tool[tool] ?? 0) + 1;
    this.state.tool_calls.by_round[round] = (this.state.tool_calls.by_round[round] ?? 0) + 1;
    this.state.usage.payload_chars += text.length;
    this.state.usage.estimated_tokens += estimateTokens(text);
    if (providerUsage) this.state.usage.provider_usage = providerUsage;
    await appendFile(join(this.dir, "tool-calls.jsonl"), JSON.stringify({ at: now(), tool, round, payload_chars: text.length, provider_usage: providerUsage }) + "\n");
    await this.save();
    return { total: this.state.tool_calls.total, payload_chars: text.length };
  }

  async observeToolResult(tool, input, content, providerUsage = null) {
    const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
    const inputText = typeof input === "string" ? input : JSON.stringify(input ?? {});
    const round = this.state.round;
    this.state.tool_calls.total += 1;
    this.state.tool_calls.by_tool[tool] = (this.state.tool_calls.by_tool[tool] ?? 0) + 1;
    this.state.tool_calls.by_round[round] = (this.state.tool_calls.by_round[round] ?? 0) + 1;
    this.state.usage.payload_chars += inputText.length;
    this.state.usage.result_chars = (this.state.usage.result_chars ?? 0) + text.length;
    this.state.usage.largest_result_chars = Math.max(this.state.usage.largest_result_chars ?? 0, text.length);
    this.state.usage.estimated_tokens += estimateTokens(text);
    this.state.usage.raw_result_tokens = (this.state.usage.raw_result_tokens ?? 0) + estimateTokens(text);
    const parsed = typeof input === "object" && input ? input : {};
    if (tool === "web_search") uniquePush(this.state.research_activity.searches, parsed.query ?? parsed.search ?? JSON.stringify(parsed));
    if (["web_extract", "read", "research_fetch_source"].includes(tool)) uniquePush(this.state.research_activity.inspected, parsed.url ?? parsed.path ?? parsed.file_path ?? JSON.stringify(parsed));
    if (text && !["web_search", "web_extract", "read"].includes(tool)) uniquePush(this.state.research_activity.observations, `${tool}: ${clamp(text.replace(/\s+/g, " "), 500)}`);
    await this.refreshWorkingSummary();
    if (providerUsage) this.state.usage.provider_usage = providerUsage;
    await appendFile(join(this.dir, "tool-calls.jsonl"), JSON.stringify({ at: now(), tool, round, input_chars: inputText.length, result_chars: text.length, provider_usage: providerUsage }) + "\n");
    await this.save();
    return { result_chars: text.length, estimated_tokens: estimateTokens(text), total: this.state.tool_calls.total };
  }

  async recordActiveResultSize(chars) {
    const size = Math.max(0, Number(chars) || 0);
    this.state.usage.active_context_chars = (this.state.usage.active_context_chars ?? 0) + size;
    const tokens = Math.ceil(size / 4);
    this.state.usage.active_context_tokens = (this.state.usage.active_context_tokens ?? 0) + tokens;
    await this.save();
    return { active_context_chars: size, active_context_tokens: tokens };
  }

  async addToolResultArtifact({ tool, input, content }) {
    const id = randomUUID();
    const artifact = this.path("tool-results", `${id}.txt`);
    await writeFile(artifact, String(content ?? ""), "utf8");
    this.state.usage.offloaded_results = (this.state.usage.offloaded_results ?? 0) + 1;
    await this.save();
    return { artifact_id: id, artifact_path: this.relativePath(artifact), raw_chars: String(content ?? "").length, tool, input };
  }

  async recordProviderUsage(usage) { this.state.usage.provider_usage = usage ?? null; await this.save(); }

  async recordContextWindow(beforeChars, afterChars, prunedMessages) {
    this.state.usage.context_chars_before = Math.max(this.state.usage.context_chars_before ?? 0, beforeChars);
    this.state.usage.context_chars_after = Math.max(this.state.usage.context_chars_after ?? 0, afterChars);
    this.state.usage.pruned_messages = (this.state.usage.pruned_messages ?? 0) + prunedMessages;
    await this.save();
  }

  async markFailed(reason, details = {}) { this.state.status = "failed"; this.state.phase = "partial"; this.state.failure = { reason, ...details, at: now() }; await this.save(); }

  async registerMcpTask(task) {
    if (!task?.task_id) throw new Error("Deep Research MCP task_id is required");
    const item = { task_id: String(task.task_id), status: task.status ?? "submitted", created_at: now(), updated_at: now(), requested_context_budget: task.requested_context_budget ?? null, provider_metadata: task };
    this.state.mcp_tasks.push(item);
    this.state.phase = "delegated-research";
    await this.save();
    return item;
  }

  async updateMcpTask(taskId, status) {
    const item = this.state.mcp_tasks.find((task) => task.task_id === String(taskId));
    if (!item) throw new Error(`unknown Deep Research MCP task: ${taskId}`);
    item.status = String(status?.status ?? status?.state ?? item.status);
    item.progress = status?.progress ?? item.progress ?? null;
    item.context_usage = status?.context_usage ?? status?.usage ?? item.context_usage ?? null;
    const usedTokens = Number(item.context_usage?.total_tokens ?? item.context_usage?.tokens ?? item.context_usage?.used_tokens ?? 0);
    const tokenLimit = Number(item.requested_context_budget?.max_tokens ?? item.requested_context_budget?.activeContextSoftLimit ?? 0);
    item.budget_state = tokenLimit > 0 && usedTokens >= tokenLimit ? "EXCEEDED" : tokenLimit > 0 && usedTokens >= tokenLimit * 0.8 ? "WARNING" : "WITHIN_BUDGET";
    item.updated_at = now();
    item.provider_metadata = status;
    await this.save();
    return item;
  }

  async storeMcpResult(taskId, value) {
    const item = this.state.mcp_tasks.find((task) => task.task_id === String(taskId));
    if (!item) throw new Error(`unknown Deep Research MCP task: ${taskId}`);
    const artifact = this.path("deep-research", `${taskId}.json`);
    const serialized = JSON.stringify(value, null, 2) + "\n";
    await writeFile(artifact, serialized, "utf8");
    item.status = "completed";
    item.result_path = this.relativePath(artifact);
    item.result_tokens_estimate = estimateTokens(serialized);
    item.updated_at = now();
    this.state.phase = "review";
    await this.save();
    return { task_id: item.task_id, result_path: item.result_path, result_tokens_estimate: item.result_tokens_estimate };
  }

  async reviewMcpResult(taskId) {
    const item = this.state.mcp_tasks.find((task) => task.task_id === String(taskId));
    if (!item?.result_path) throw new Error(`Deep Research MCP result is not available: ${taskId}`);
    const value = JSON.parse(await readFile(item.result_path, "utf8"));
    const sources = Array.isArray(value.sources) ? value.sources : [];
    const citations = Array.isArray(value.citations) ? value.citations : [];
    const contradictions = Array.isArray(value.contradictions) ? value.contradictions : [];
    const gaps = Array.isArray(value.gaps) ? value.gaps : [];
    const coverage = Array.isArray(value.coverage) ? value.coverage : [];
    const covered = new Set(coverage.filter((entry) => entry?.status === "covered" || entry?.covered === true).map((entry) => entry.sub_question ?? entry.question));
    const requested = this.state.sub_questions.map((entry) => entry.question);
    const coverageRate = requested.length ? requested.filter((question) => covered.has(question)).length / requested.length : Number(value.coverage_rate ?? 1);
    const sourceRefs = new Set(sources.map((source) => source.source_id ?? source.id).filter(Boolean));
    const orphanCitations = citations.filter((citation) => {
      const ref = citation.source_id ?? citation.sourceId;
      return ref && !sourceRefs.has(ref);
    }).length;
    const issues = [];
    if (!String(value.report ?? value.summary ?? "").trim()) issues.push("missing report");
    if (!sources.length) issues.push("missing sources");
    if (!citations.length) issues.push("missing citations");
    if (orphanCitations) issues.push(`${orphanCitations} citation(s) lack source provenance`);
    if (requested.length && coverageRate < 0.8) issues.push(`sub-question coverage is ${(coverageRate * 100).toFixed(0)}%`);
    this.state.contradictions = contradictions.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry));
    this.state.gaps = gaps.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry));
    this.state.review = {
      task_id: String(taskId), verdict: issues.length ? "NEEDS_MORE_RESEARCH" : "READY_FOR_SYNTHESIS", issues,
      source_count: sources.length, citation_count: citations.length, orphan_citations: orphanCitations,
      coverage_rate: coverageRate, contradiction_count: contradictions.length, gap_count: gaps.length, reviewed_at: now(),
    };
    this.state.phase = issues.length ? "review-failed" : "synthesis";
    await this.refreshWorkingSummary();
    await this.save();
    return this.state.review;
  }

  async addSource({ title = "", url, sourceType = "web", publishedDate = null, content, query = null, provider = null }) {
    if (!url) throw new Error("source url is required");
    const sourceId = randomUUID();
    const artifact = this.path("sources", `${sourceId}.md`);
    const body = `# ${title}\n\nURL: ${url}\nSource type: ${sourceType}\n${publishedDate ? `Published/updated: ${publishedDate}\n` : ""}\n${content ?? ""}\n`;
    await writeFile(artifact, body, "utf8");
    const source = { source_id: sourceId, title, url, source_type: sourceType, published_updated: publishedDate, query, provider, artifact_path: this.relativePath(artifact), raw_chars: body.length, raw_tokens_estimate: estimateTokens(body) };
    this.state.sources.push(source); uniquePush(this.state.research_activity.inspected, `${title || url} (${url})`); this.state.phase = "gathering"; await this.refreshWorkingSummary(); await this.save();
    return { source_id: sourceId, title, url, artifact_path: this.relativePath(artifact), raw_tokens_estimate: source.raw_tokens_estimate };
  }

  async addEvidenceCard(card) {
    const source = this.state.sources.find((item) => item.source_id === card.source_id);
    if (!source) throw new Error(`unknown source_id: ${card.source_id}`);
    const evidenceId = card.evidence_id ?? randomUUID();
    const value = { evidence_id: evidenceId, source_id: source.source_id, title: card.title ?? source.title, url: card.url ?? source.url, source_type: card.source_type ?? source.source_type, published_updated: card.published_updated ?? source.published_updated, sub_questions: card.sub_questions ?? [], supported_claims: card.supported_claims ?? [], supporting_excerpts: card.supporting_excerpts ?? [], contradictions_caveats: card.contradictions_caveats ?? [], provenance: card.provenance ?? { artifact_path: source.artifact_path }, artifact_path: source.artifact_path };
    const text = JSON.stringify(value, null, 2);
    if (estimateTokens(text) > this.state.budgets.evidenceCardTokens) throw new Error("evidence card exceeds configured token budget");
    await writeFile(this.path("evidence", `${evidenceId}.json`), text + "\n", "utf8");
    source.evidence_id = evidenceId; for (const claim of value.supported_claims) uniquePush(this.state.research_activity.observations, claim); this.state.phase = "evidence"; await this.refreshWorkingSummary(); await this.save();
    return { ...value, evidence_path: this.relativePath(this.path("evidence", `${evidenceId}.json`)) };
  }

  async addBrief({ subQuestion, content }) {
    if (estimateTokens(content) > this.state.budgets.briefTokens) throw new Error("sub-question brief exceeds configured token budget");
    const name = `${this.state.sub_questions.findIndex((q) => q.question === subQuestion) + 1}.md`;
    const path = this.path("briefs", name);
    await writeFile(path, `# ${subQuestion}\n\n${content}\n`, "utf8");
    const item = this.state.sub_questions.find((q) => q.question === subQuestion);
    if (item) { item.status = "covered"; item.brief_path = path; item.brief_tokens_estimate = estimateTokens(content); }
    uniquePush(this.state.research_activity.observations, `${subQuestion}: ${clamp(content.replace(/\s+/g, " "), 500)}`);
    await this.refreshWorkingSummary(); await this.save();
    return { sub_question: subQuestion, brief_path: path };
  }

  async writeReport(content) { await writeFile(join(this.dir, "report.md"), content, "utf8"); this.state.status = "completed"; this.state.phase = "complete"; await this.save(); return join(this.dir, "report.md"); }

  boundedResult({ summary = "", sourceIds = [], urls = [], artifactPaths = [], metadata = {} } = {}) {
    const text = clamp(summary, this.state.budgets.maxPayloadCharsPerCall);
    return { summary: text, source_ids: sourceIds, urls, artifact_paths: artifactPaths, metadata, payload_chars: JSON.stringify({ summary: text, source_ids: sourceIds, urls, artifact_paths: artifactPaths, metadata }).length };
  }

  async checkpoint(input = {}) {
    const actual = this.state.tool_calls.total;
    const budget = this.state.budgets;
    const coverage = this.state.sub_questions.length ? this.state.sub_questions.filter((q) => q.status === "covered" || q.answered === true).length / this.state.sub_questions.length : 0;
    const estimated = this.state.usage.active_context_tokens ?? 0;
    let verdict = "CONTINUE_CURRENT_RUN";
    const reasons = [];
    if (actual >= budget.maxToolCalls || estimated >= budget.rolloverHardLimit || estimated + budget.synthesisOutputReserve >= budget.activeContextSoftLimit) { verdict = "ROLLOVER_REQUIRED"; reasons.push("runtime budget reached"); }
    else if (coverage >= (input.minCoverage ?? 0.8) && this.state.sources.length >= (input.minSources ?? 1) && !this.state.gaps.length) { verdict = "READY_FOR_SYNTHESIS"; }
    if (input.stopWithGaps || (this.state.gaps.length && input.allowStopWithGaps)) verdict = "STOP_WITH_GAPS";
    this.state.round = Math.max(this.state.round, Number(input.round) || 0);
    this.state.phase = verdict === "READY_FOR_SYNTHESIS" ? "synthesis" : verdict === "ROLLOVER_REQUIRED" ? "rollover" : "gathering";
    this.state.contradictions = input.contradictions ?? this.state.contradictions;
    this.state.gaps = input.gaps ?? this.state.gaps;
    await this.refreshWorkingSummary(); await this.save();
    const evidenceCards = (await readdir(this.path("evidence"))).filter((file) => file.endsWith(".json")).length;
    return { verdict, reasons, runtime: { tool_calls: actual, payload_tokens_estimate: estimated, active_context_tokens: estimated, raw_result_tokens: this.state.usage.raw_result_tokens ?? this.state.usage.estimated_tokens ?? 0, sources: this.state.sources.length, evidence_cards: evidenceCards, coverage, round: this.state.round }, reserve_tokens: budget.synthesisOutputReserve };
  }

  async rollover() { this.state.status = "rollover"; await this.save(); return ResearchRun.create(this.root, this.state.plan, this.state.budgets); }

  async synthesisInput({ evidenceIds = null } = {}) {
    if (this.state.mcp_tasks.length) {
      if (this.state.review?.verdict !== "READY_FOR_SYNTHESIS") throw new Error("Deep Research MCP result must pass review before synthesis");
      const task = this.state.mcp_tasks.find((item) => item.task_id === this.state.review.task_id);
      const value = JSON.parse(await readFile(task.result_path, "utf8"));
      const bounded = {
        report: clamp(value.report ?? value.summary ?? "", this.state.budgets.maxPayloadCharsPerCall),
        findings: Array.isArray(value.findings) ? value.findings.slice(0, 50) : [],
        sources: Array.isArray(value.sources) ? value.sources.slice(0, 100) : [],
        citations: Array.isArray(value.citations) ? value.citations.slice(0, 200) : [],
        contradictions: this.state.contradictions,
        gaps: this.state.gaps,
      };
      this.state.phase = "synthesis-pending";
      await this.save();
      return { run_id: this.runId, fresh_session_required: true, plan: this.state.plan, review: this.state.review, deep_research: bounded, result_artifact_path: task.result_path };
    }
    const files = await readdir(this.path("evidence"));
    const selected = evidenceIds ? files.filter((file) => evidenceIds.includes(file.replace(/\.json$/, ""))) : files;
    const evidence = await Promise.all(selected.map((file) => readFile(this.path("evidence", file), "utf8").then(JSON.parse)));
    this.state.phase = "synthesis-pending";
    await this.refreshWorkingSummary(); await this.save();
    return { run_id: this.runId, fresh_session_required: true, working_summary: this.state.working_summary, plan: this.state.plan, sub_question_briefs: this.state.sub_questions, evidence_cards: evidence, contradictions: this.state.contradictions, gaps: this.state.gaps, source_index: this.state.sources.map(({ source_id, title, url, artifact_path }) => ({ source_id, title, url, artifact_path })) };
  }
}

export function renderPlan(plan) { return `# Research plan\n\n${plan.brief ?? ""}\n\n## Sub-questions\n${(plan.sub_questions ?? []).map((q) => `- ${q}`).join("\n")}\n`; }
