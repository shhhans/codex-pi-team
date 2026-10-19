// Active v2 acceptance entrypoint. v1 suites remain historical specifications.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const child = spawn(process.execPath, ['--test', join(import.meta.dirname, 'group-runtime.test.mjs')], { stdio: 'inherit', env: { ...process.env, PI_TEAM_TEST_MODE: '1' } });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
