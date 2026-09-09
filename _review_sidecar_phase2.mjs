// Phase 2 of a fresh-process probe.
// Run AFTER phase1 wrote a sidecar but the JSONL was truncated.
// If the sidecar is read, this append issues sequence 3.
// If the sidecar is NOT read, this append issues sequence 1 (regression).
import { appendRoleEvent } from './.pi/communication/role-events.mjs';
import { readFile } from 'node:fs/promises';

const stateRoot = process.argv[2];
const before = process.hrtime.bigint();
const result = await appendRoleEvent(stateRoot, {
  task_id: 'COLD-001',
  role: 'executor',
  agent_id: 'cold-test',
  worktree: stateRoot,
  state: 'working',
  activity: 'phase2',
});
const elapsedMs = Number(process.hrtime.bigint() - before) / 1e6;
const sidecar = await readFile(`${stateRoot}/COLD-001-executor.jsonl.seq`, 'utf8');
console.log(JSON.stringify({ sequence: result.sequence, sidecar: sidecar.trim(), elapsedMs }));
