import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class PersistentRunLifecycle {
  constructor(root) { this.root = root; }
  runPath(runId) { return join(this.root, "runs", `${String(runId).replaceAll(/[^a-zA-Z0-9._-]/g, "_")}.json`); }
  async writeRun(run) { const path = this.runPath(run.id); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(run, null, 2), "utf8"); return run; }
  async readRun(runId) { return JSON.parse(await readFile(this.runPath(runId), "utf8")); }
  async start({ runId, planVersion, role, memoryPath, artifactDir, references = [] }) {
    if (!planVersion || typeof planVersion !== "string") throw new Error("canonical plan version is required");
    return this.writeRun({ id: runId, planVersion, role, memoryPath, artifactDir, references, status: "active", safeBoundary: false, partials: [] });
  }
  async markStale(runId, { newPlanVersion, partialArtifacts = [], reason = "scope-change" }) {
    const old = await this.readRun(runId);
    old.status = "stale"; old.staleAsOf = newPlanVersion; old.safeBoundary = true; old.staleReason = reason;
    const preserved = [];
    for (const artifact of partialArtifacts) {
      const path = join(old.artifactDir, artifact.name);
      await mkdir(dirname(path), { recursive: true });
      const content = `STALE-AS-OF:${newPlanVersion}\nPRESERVED-PARTIAL\n${artifact.content ?? ""}`;
      await writeFile(path, content, "utf8"); preserved.push(path);
    }
    old.partials = [...new Set([...(old.partials ?? []), ...preserved])];
    await this.writeRun(old);
    const next = await this.start({ runId: `${runId}:restart:${newPlanVersion}`, planVersion: newPlanVersion, role: old.role, memoryPath: old.memoryPath, artifactDir: old.artifactDir, references: preserved });
    if (old.memoryPath) {
      await mkdir(dirname(old.memoryPath), { recursive: true });
      await appendFile(old.memoryPath, `\n[stale-run:${runId}] STALE-AS-OF:${newPlanVersion}; preserved=${preserved.join(",")}\n`, "utf8");
    }
    return { old, next, preserved };
  }
  async safeBoundary(runId) { const run = await this.readRun(runId); run.safeBoundary = true; await this.writeRun(run); return run; }
  async acceptResult(runId, planVersion, result) {
    const run = await this.readRun(runId);
    if (run.status !== "active" || run.planVersion !== planVersion) return { accepted: false, authoritative: false, result: null };
    return { accepted: true, authoritative: true, result };
  }
}
