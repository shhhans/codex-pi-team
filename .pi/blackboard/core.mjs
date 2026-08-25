// Compatibility entrypoint for Pi extensions and local callers.
// The implementation lives inside the installable Agent Blackboard plugin so
// the MCP server remains self-contained after Codex copies the plugin to cache.
export * from "../../plugins/agent-blackboard/server/blackboard-core.mjs";
