import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const pluginRoot = dirname(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, "$1:")));
const jsonFiles = [".codex-plugin/plugin.json", ".mcp.json", ".app.json"];
for (const relative of jsonFiles) JSON.parse(await readFile(join(pluginRoot, relative), "utf8"));
const manifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
if (manifest.name !== "agent-blackboard") throw new Error("manifest name mismatch");
for (const relative of ["server/blackboard-mcp.mjs", "server/blackboard-core.mjs", "skills/blackboard-lead/SKILL.md", "skills/blackboard-lead/agents/openai.yaml", "apps/blackboard.html"]) {
  await access(join(pluginRoot, relative));
}
console.log(`PLUGIN_OK ${pluginRoot}`);
