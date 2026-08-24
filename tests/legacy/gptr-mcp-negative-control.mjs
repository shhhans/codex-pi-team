import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../.pi/researcher-runtime/context-management-extension.ts";

test("negative control: disabling gptr-mcp fails closed without a web-search fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "researcher-mcp-disabled-"));
  const registered = new Map();
  const pi = { on() {}, registerTool(tool) { registered.set(tool.name, tool); } };
  const previous = process.env.DEEP_RESEARCH_MCP_DISABLE_STDIO;
  process.env.DEEP_RESEARCH_MCP_DISABLE_STDIO = "1";
  try {
    extension(pi);
    assert.equal(registered.has("web_search"), false);
    await registered.get("research_run").execute("run", { action: "create", brief: "disabled control", sub_questions: ["Q"] }, { cwd: root });
    const blocked = await registered.get("deep_research_task").execute("task", { action: "start", objective: "Q", sub_questions: ["Q"] }, {});
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /disabled|MCP/i);
  } finally {
    if (previous === undefined) delete process.env.DEEP_RESEARCH_MCP_DISABLE_STDIO;
    else process.env.DEEP_RESEARCH_MCP_DISABLE_STDIO = previous;
    await rm(root, { recursive: true, force: true });
  }
});
