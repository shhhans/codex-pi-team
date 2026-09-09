// Truncate the JSONL after phase1 has run, so the sidecar is the only
// remaining evidence of the prior sequence.
import { writeFile } from 'node:fs/promises';

const stateRoot = process.argv[2];
const jsonlPath = `${stateRoot}/COLD-001-executor.jsonl`;
await writeFile(jsonlPath, '', 'utf8');
console.log('truncated', jsonlPath);
