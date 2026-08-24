import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const LOCAL_ECOSYSTEM_START = "<researcher-local-ecosystem>";
export const LOCAL_ECOSYSTEM_END = "</researcher-local-ecosystem>";

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function packageNameFromSpec(spec) {
  const value = spec.replace(/^npm:/, "");
  if (value.startsWith("@")) {
    const versionAt = value.indexOf("@", value.indexOf("/") + 1);
    return versionAt === -1 ? value : value.slice(0, versionAt);
  }
  return value.split("@")[0];
}

function packageRootFromReference(agentFile, reference) {
  const normalized = reference.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return undefined;
  const prefix = normalized.slice(0, markerIndex + marker.length);
  const remainder = normalized.slice(markerIndex + marker.length);
  const parts = remainder.split("/");
  const packageName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return { packageName, path: resolve(dirname(agentFile), prefix, packageName) };
}

function describePackage(projectRoot, packageName, packageRoot, source) {
  const manifestPath = join(packageRoot, "package.json");
  const manifestText = readText(manifestPath);
  const localPath = relative(projectRoot, packageRoot).split(sep).join("/");
  if (!manifestText) return `- ${packageName}: NOT FOUND at ${localPath} (${source})`;
  try {
    const manifest = JSON.parse(manifestText);
    const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    const suffix = repository ? `; upstream ${repository.replace(/^git\+/, "")}` : "";
    return `- ${manifest.name ?? packageName} ${manifest.version ?? "version-unknown"}: ${localPath}${suffix}`;
  } catch {
    return `- ${packageName}: INVALID package.json at ${localPath} (${source})`;
  }
}

export function createLocalEcosystemSnapshot(projectRoot) {
  const root = resolve(projectRoot);
  const settingsPath = join(root, ".pi", "settings.json");
  const researcherAgentPath = join(root, ".pi", "agents", "researcher.md");
  const packages = new Map();

  const settingsText = readText(settingsPath);
  if (settingsText) {
    try {
      const settings = JSON.parse(settingsText);
      for (const spec of settings.packages ?? []) {
        if (typeof spec !== "string" || !spec.startsWith("npm:")) continue;
        const packageName = packageNameFromSpec(spec);
        const packageRoot = join(root, ".pi", "npm", "node_modules", packageName);
        packages.set(packageRoot, { packageName, packageRoot, source: ".pi/settings.json" });
      }
    } catch {
      packages.set(settingsPath, { packageName: "shared Pi settings", packageRoot: settingsPath, source: "invalid JSON" });
    }
  }

  const agentText = readText(researcherAgentPath) ?? "";
  for (const match of agentText.matchAll(/^\s*-?\s*(\.\.\/[^\s]+node_modules\/[^\s]+)\s*$/gm)) {
    const located = packageRootFromReference(researcherAgentPath, match[1]);
    if (located) packages.set(located.path, { ...located, packageRoot: located.path, source: ".pi/agents/researcher.md" });
  }

  const descriptions = [...packages.values()]
    .map(({ packageName, packageRoot, source }) => describePackage(root, packageName, packageRoot, source))
    .sort();

  return [
    LOCAL_ECOSYSTEM_START,
    "Current project-local Pi ecosystem (generated from live files; this is bootstrap context, not durable memory):",
    ...(descriptions.length ? descriptions : ["- No configured local Pi packages were discovered from the known anchors."]),
    "Discovery contract:",
    "- Start with these known anchors; do not rescan the whole workspace from scratch.",
    "- Verify pivotal behavior in the exact local package source before relying on names, READMEs, or remembered APIs.",
    "- Search both .pi/npm/node_modules and role-specific runtimes before concluding that a package or implementation is absent.",
    "- Record stable locations and reusable methods in Researcher memory; keep versions and other changing state in this live snapshot.",
    LOCAL_ECOSYSTEM_END,
  ].join("\n");
}

export function appendLocalEcosystem(systemPrompt, snapshot) {
  const escapedStart = LOCAL_ECOSYSTEM_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = LOCAL_ECOSYSTEM_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutOldSnapshot = systemPrompt
    .replace(new RegExp(`\\n*${escapedStart}[\\s\\S]*?${escapedEnd}`, "g"), "")
    .trimEnd();
  return `${withoutOldSnapshot}\n\n${snapshot}`;
}

export function installResearcherLocalDiscovery(pi) {
  pi.on("before_agent_start", (event, ctx) => ({
    systemPrompt: appendLocalEcosystem(event.systemPrompt, createLocalEcosystemSnapshot(ctx.cwd)),
  }));
}
