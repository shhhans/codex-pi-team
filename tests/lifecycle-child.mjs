import { PersistentRunLifecycle } from "../.pi/communication/lifecycle.mjs";
const [root, action, runId, version] = process.argv.slice(2);
const lifecycle = new PersistentRunLifecycle(root);
if (action === "start") await lifecycle.start({ runId, planVersion: version, role: "engineer", memoryPath: `${root}/memory/MEMORY.md`, artifactDir: `${root}/artifacts` });
if (action === "stale") await lifecycle.markStale(runId, { newPlanVersion: version, partialArtifacts: [{ name: "partial.md", content: "valid partial" }] });
if (action === "accept") process.stdout.write(JSON.stringify(await lifecycle.acceptResult(runId, version, { value: "candidate" })));
