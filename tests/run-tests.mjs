// Deterministic active-suite entrypoint. Every test owns its temporary Git
// repository and runtime state; no shared checkout cleanup is performed here.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const files = ["module-contract.test.mjs", "module-lifecycle.test.mjs", "blackboard-protocol.test.mjs", "blackboard.test.mjs", "communication-policy.test.mjs", "team-contract.test.mjs", "compression.test.mjs", "automatic-compression.test.mjs"].map((file) => join(here, file));
const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit", env: { ...process.env, PI_TEAM_TEST_MODE: "1" } });
child.once("exit", (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
