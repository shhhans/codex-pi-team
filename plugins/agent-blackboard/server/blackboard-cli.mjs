import { acceptTask, closeIncompleteTask, publishTask, reconcileTask } from "./blackboard-core.mjs";
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
  const projectRoot = process.argv[3];
  const inputPath = process.argv[4];
  if (!projectRoot) throw new Error(`${command || "command"} requires project root`);
  let result;
  if (command === "publish") {
    if (!inputPath) throw new Error("publish requires project root and contract path");
    result = await publishTask(projectRoot, await readContract(inputPath));
  } else if (command === "accept") {
    if (!inputPath) throw new Error("accept requires project root and task id");
    result = await acceptTask(projectRoot, inputPath);
  } else if (command === "close-incomplete" || command === "reconcile") {
    const taskId = inputPath;
    const outcomePath = process.argv[5];
    if (!taskId || !outcomePath) throw new Error(`${command} requires project root, task id, and outcome file`);
    const input = JSON.parse(await readFile(resolve(outcomePath), "utf8"));
    result = command === "close-incomplete" ? await closeIncompleteTask(projectRoot, taskId, input) : await reconcileTask(projectRoot, taskId, input);
  } else throw new Error(`unknown Blackboard CLI command: ${command || "<missing>"}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
