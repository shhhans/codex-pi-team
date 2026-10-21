// Active v2 acceptance entrypoint. v1 suites remain historical specifications.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const suites = ['optional-planning.test.mjs', 'group-runtime.test.mjs', 'document-alignment.test.mjs', 'service-manager.test.mjs', 'group-registration.test.mjs', 'group-provider-migration.test.mjs', 'group-blackboard.test.mjs', 'group-context.test.mjs', 'group-efficiency.test.mjs', 'group-role-runner.test.mjs', 'provider-fault.test.mjs', 'integration-snapshot.test.mjs'];
const child = spawn(process.execPath, ['--test', ...suites.map(name => join(import.meta.dirname, name))], { stdio: 'inherit', env: { ...process.env, PI_TEAM_TEST_MODE: '1' } });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
