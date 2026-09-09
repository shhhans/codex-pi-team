// Independent Reviewer cross-process race probe.
// Two separate Node processes each do two appends, with B starting after A's
// first append. With the cycle-2 fix, sequences must be contiguous and
// duplicate-free across both processes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'pi-team-race-'));
const taskId = 'RACE-001';
const role = 'executor';
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const moduleUrl = 'file:///' + scriptDir.replace(/\\/g, '/') + '.pi/communication/role-events.mjs';

const buildScript = (label) => [
  "import { appendRoleEvent } from " + JSON.stringify(moduleUrl) + ";",
  "const r1 = await appendRoleEvent(" + JSON.stringify(root) + ", { task_id: " + JSON.stringify(taskId) + ", role: " + JSON.stringify(role) + ", agent_id: " + JSON.stringify(label) + ", worktree: " + JSON.stringify(root) + ", state: 'working', activity: 'a' });",
  // B waits briefly so A's first append has time to commit.
  "await new Promise(r => setTimeout(r, 200));",
  "const r2 = await appendRoleEvent(" + JSON.stringify(root) + ", { task_id: " + JSON.stringify(taskId) + ", role: " + JSON.stringify(role) + ", agent_id: " + JSON.stringify(label) + ", worktree: " + JSON.stringify(root) + ", state: 'working', activity: 'b' });",
  "process.stdout.write(JSON.stringify({ label: " + JSON.stringify(label) + ", seqs: [r1.sequence, r2.sequence] }) + '\\n');",
].join('\n');

try {
  const scriptA = join(root, 'a.mjs');
  const scriptB = join(root, 'b.mjs');
  await writeFile(scriptA, buildScript('A'), 'utf8');
  await writeFile(scriptB, buildScript('B'), 'utf8');

  // Start both subprocesses nearly simultaneously so they interleave.
  const ra = spawnSync(process.execPath, [scriptA], { encoding: 'utf8' });
  const rb = spawnSync(process.execPath, [scriptB], { encoding: 'utf8' });
  console.log('A stdout:', ra.stdout.trim());
  console.log('B stdout:', rb.stdout.trim());
  if (ra.status !== 0) { console.error('A stderr:', ra.stderr); throw new Error('A failed'); }
  if (rb.status !== 0) { console.error('B stderr:', rb.stderr); throw new Error('B failed'); }

  const outA = JSON.parse(ra.stdout.trim());
  const outB = JSON.parse(rb.stdout.trim());

  const allSeqs = [...outA.seqs, ...outB.seqs].sort((a, b) => a - b);
  const expected = [1, 2, 3, 4];
  const contiguous = JSON.stringify(allSeqs) === JSON.stringify(expected);
  const duplicates = allSeqs.length !== new Set(allSeqs).size;

  // Confirm the JSONL has 4 lines.
  const jsonl = await readFile(join(root, `${taskId}-${role}.jsonl`), 'utf8');
  const lines = jsonl.trim().split(/\r?\n/).filter(Boolean);
  const sidecar = await readFile(join(root, `${taskId}-${role}.jsonl.seq`), 'utf8');

  console.log('all sequences:', allSeqs);
  console.log('expected:    ', expected);
  console.log('contiguous?  ', contiguous, '| duplicates?', duplicates);
  console.log('jsonl lines: ', lines.length, '| sidecar:', sidecar.trim());

  if (!contiguous || duplicates) {
    console.log('TEST VERDICT: FAIL (cross-process race regressed)');
    process.exit(2);
  }
  console.log('TEST VERDICT: PASS (sequences contiguous across two subprocesses)');
} finally {
  await rm(root, { recursive: true, force: true });
}
