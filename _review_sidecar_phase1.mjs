// Phase 1 of a fresh-process probe.
// Run a small standalone append in its own Node process so the in-process
// sequenceCache cannot leak. Pass the stateRoot via argv.
import { appendRoleEvent } from './.pi/communication/role-events.mjs';

const stateRoot = process.argv[2];
if (!stateRoot) {
  console.error('usage: node phase1.mjs <stateRoot>');
  process.exit(2);
}
const base = {
  task_id: 'COLD-001',
  role: 'executor',
  agent_id: 'cold-test',
  worktree: stateRoot,
  state: 'working',
  activity: 'phase1',
};
const r1 = await appendRoleEvent(stateRoot, base);
const r2 = await appendRoleEvent(stateRoot, { ...base, activity: 'phase1-second' });
console.log(JSON.stringify({ r1Seq: r1.sequence, r2Seq: r2.sequence }));
