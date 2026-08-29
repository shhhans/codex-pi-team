// Global test setup. Removes any leftover state files from interrupted
// previous runs so the deterministic suite can start from a clean slate.
// Idempotent: missing files are silently ignored.
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();

function gitCommonDir() {
  const result = spawnSync("git", ["-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim().replaceAll("/", "\\");
}

const commonDir = gitCommonDir();
if (!commonDir) process.exit(0);

// Remove orphan worktree references whose backing directory no longer
// exists. Without this, `git branch -D` refuses to delete branches still
// listed as "used by worktree" even after the worktree directory is gone.
const worktreeList = spawnSync("git", ["-C", REPO, "worktree", "list", "--porcelain"], { encoding: "utf8" });
if (worktreeList.status === 0) {
  for (const line of worktreeList.stdout.split(/\r?\n/)) {
    const match = line.match(/^worktree\s+(.+)$/);
    if (!match) continue;
    const wtPath = match[1].trim();
    if (!existsSync(wtPath)) {
      spawnSync("git", ["-C", REPO, "worktree", "remove", "--force", wtPath], { encoding: "utf8" });
    }
  }
}
spawnSync("git", ["-C", REPO, "worktree", "prune"], { encoding: "utf8" });

const stateRoot = join(commonDir, "pi-team", "v1");
const blackboardRoot = join(commonDir, "harness-blackboard", "v1");

const PREFIXES = ["ENV-", "BND-", "TMO-", "ACC-", "CAP-", "EVT-", "FRESH-", "LEGACY-", "CORRUPT-", "HEAVY-"];

for (const root of [stateRoot, blackboardRoot]) {
  if (!existsSync(root)) continue;
  for (const prefix of PREFIXES) {
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Get-ChildItem '${root}' -Filter '${prefix}*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue`], { encoding: "utf8" });
    void result;
  }
}

// Drop orphan test branches created by the role-launcher integration test.
const branchResult = spawnSync("git", ["branch", "--list", "pi-team/test-*", "pi-team/test-bootstrap-*", "pi-team/test-wait-*"], { cwd: REPO, encoding: "utf8" });
if (branchResult.status === 0) {
  for (const line of branchResult.stdout.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || name.startsWith("*")) continue;
    spawnSync("git", ["branch", "-D", name], { cwd: REPO, encoding: "utf8" });
  }
}

void rm;