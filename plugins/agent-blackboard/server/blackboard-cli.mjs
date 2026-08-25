import { publishTask } from "./blackboard-core.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function readContract(path) {
  const text = await readFile(resolve(path), "utf8");
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
  if (blocks.length !== 1) throw new Error("contract must contain exactly one JSON fenced block");
  return JSON.parse(blocks[0][1]);
}

try {
  const command = process.argv[2];
  if (command !== "publish") throw new Error(`unknown Blackboard CLI command: ${command || "<missing>"}`);
  const projectRoot = process.argv[3];
  const contractPath = process.argv[4];
  if (!projectRoot || !contractPath) throw new Error("publish requires project root and contract path");
  const input = await readContract(contractPath);
  const result = await publishTask(projectRoot, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
