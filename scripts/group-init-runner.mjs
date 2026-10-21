import { spawn, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, appendFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { GroupStore, ROLES, alive } from '../.pi/runtime/group-store.mjs';
import { roleArgs, roleConfig, sourceRoot, stopGroup } from '../.pi/runtime/group-service.mjs';
import { onboardingState, markOnboardingStopped } from '../.pi/runtime/group-onboarding.mjs';

const runnerPath = fileURLToPath(import.meta.url);
function processStamp(pid) {
  if (!Number.isInteger(pid) || !alive(pid)) return null;
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { encoding: 'utf8', windowsHide: true }).trim();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
function sameProcess(record) {
  const actual = processStamp(record?.pid);
  return Boolean(actual && (!record.process_stamp || record.process_stamp === actual));
}
export function scheduleOnboarding(store, groupId, options = {}) {
  try { return store.operation(`onboarding-schedule:${groupId}`, () => scheduleUnlocked(store, groupId, options)); }
  catch (error) {
    if (!error.message.startsWith('operation in progress: onboarding-schedule:')) throw error;
    return { operation_id: onboardingState(store, groupId, 'lead')?.operation_id, status: 'scheduled' };
  }
}
function scheduleUnlocked(store, groupId, options = {}) {
  const state = onboardingState(store, groupId, 'lead');
  if (!state || !['pending', 'waiting_for_task', 'failed', 'acknowledged'].includes(state.status)) return { operation_id: state?.operation_id || null, status: state?.status || 'missing' };
  if (state.status === 'waiting_for_task') return { operation_id: state.operation_id, status: state.status };
  if (state.status === 'failed') {
    state.status = state.resume_status || 'pending'; delete state.resume_status; delete state.error; delete state.failed_at;
    store.db.prepare('INSERT OR REPLACE INTO group_lifecycle VALUES (?,?)').run(groupId, JSON.stringify(state));
  }
  const projectRoot = store.projectRoot;
  const marker = join(store.root, `${state.operation_id}.scheduled`);
  if (existsSync(marker)) {
    let previous = {}; try { previous = JSON.parse(readFileSync(marker, 'utf8')); } catch {}
    if (sameProcess(previous)) return { operation_id: state.operation_id, status: 'scheduled' };
    try { unlinkSync(marker); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { writeFileSync(marker, JSON.stringify({ pid: process.pid, process_stamp: processStamp(process.pid), at: new Date().toISOString() }), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return { operation_id: state.operation_id, status: 'scheduled' }; throw error; }
  const child = spawn(process.execPath, [runnerPath, projectRoot, groupId, state.operation_id], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, PI_TEAM_ONBOARDING_TIMEOUT: String(options.timeout || 600000) } });
  let childStamp = null; const stampDeadline = Date.now() + 2000;
  while (!childStamp && Date.now() < stampDeadline) { childStamp = processStamp(child.pid); if (!childStamp) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
  writeFileSync(marker, JSON.stringify({ pid: child.pid, process_stamp: childStamp, at: new Date().toISOString() }));
  child.once('error', () => {}); child.unref();
  return { operation_id: state.operation_id, status: 'scheduled' };
}

async function run(projectRoot, groupId, operationId) {
  const store = new GroupStore(projectRoot);
  const state = onboardingState(store, groupId, 'lead');
  if (!state || state.operation_id !== operationId || !['pending', 'acknowledged'].includes(state.status)) { store.close(); return; }
  const operationEpoch = state.epoch;
  const group = store.group(groupId), packageRoot = process.env.PI_TEAM_PI_PACKAGE_ROOT || join(process.env.APPDATA || '', 'npm/node_modules/@earendil-works/pi-coding-agent');
  if (state.status === 'acknowledged') {
    const cli = join(packageRoot, 'dist/cli.js'), children = new Map(), launches = new Map(), notices = new Map();
    try {
      const deadBusy = ROLES.filter(role => { const session = store.session(groupId, role); return session?.busy && !alive(session.pid); });
      if (deadBusy.length && !existsSync(cli)) throw Error('Pi CLI package is unavailable to settle interrupted onboarding sessions');
      for (const role of deadBusy) {
        const prior = store.session(groupId, role);
        if (!prior.session_path || !existsSync(prior.session_path)) throw Error(`onboarding recovery needs the persisted ${role} session file: ${prior.session_path || '(missing)'}`);
        const launchId = randomUUID(), config = prior.config || roleConfig()[role];
        const noticeId = store.notice(groupId, role, { type: 'onboarding_recovery', lifecycle_id: operationId, definition_epoch: state.epoch, detail: 'Your onboarding acknowledgement is already recorded. Resume this session, use team_read to confirm it, do not submit it again, then finish idle.' });
        const args = roleArgs(store, group, role, prior.session_id, sourceRoot).slice(0, -1);
        const env = { ...process.env, PI_TEAM_PROJECT_ROOT: projectRoot, PI_TEAM_GROUP_ID: groupId, PI_TEAM_ROLE: role, PI_TEAM_LAUNCH_ID: launchId, PI_TEAM_SESSION_ID: prior.session_id, PI_TEAM_SOURCE_ROOT: sourceRoot, PI_TEAM_ROLE_CONFIG: JSON.stringify(config) };
        const logPath = join(store.root, `${operationId}-${role}-recovery.jsonl`);
        const child = spawn(process.execPath, [cli, '--mode', 'rpc', ...args], { cwd: group.worktree, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
        child.stdout.on('data', bytes => appendFileSync(logPath, bytes)); child.stderr.on('data', bytes => appendFileSync(logPath, bytes)); child.unref();
        children.set(role, child); launches.set(role, launchId); notices.set(role, noticeId);
      }
      const deadline = Date.now() + Number(process.env.PI_TEAM_ONBOARDING_TIMEOUT || 600000);
      while (Date.now() < deadline) {
        const sessions = store.sessions(groupId);
        const busyAlive = sessions.some(session => alive(session.pid) && session.busy);
        const recoverySettled = [...launches].every(([role, launchId]) => {
          const session = store.session(groupId, role), message = store.db.prepare('SELECT read_at FROM messages WHERE id=?').get(notices.get(role));
          return session?.launch_id === launchId && !session.busy && Boolean(message?.read_at);
        });
        if (!busyAlive && recoverySettled) break;
        if ([...children.values()].some(child => child.exitCode !== null)) throw Error('resumed onboarding session exited before settling the recorded acknowledgement');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (store.sessions(groupId).some(session => alive(session.pid) && session.busy) || ![...launches].every(([role, launchId]) => {
        const session = store.session(groupId, role), message = store.db.prepare('SELECT read_at FROM messages WHERE id=?').get(notices.get(role));
        return session?.launch_id === launchId && !session.busy && Boolean(message?.read_at);
      })) throw Error('acknowledged onboarding recovery timed out before interrupted roles settled');
      store.operation(`group:${groupId}`, () => {
        const current = onboardingState(store, groupId, 'lead'), latest = store.group(groupId);
        if (current?.operation_id === operationId && latest.definition_epoch === operationEpoch) stopGroup(store, groupId, true);
      });
      const stopDeadline = Date.now() + 10000;
      while (Date.now() < stopDeadline && store.sessions(groupId).some(session => alive(session.pid))) await new Promise(resolve => setTimeout(resolve, 100));
      store.operation(`group:${groupId}`, () => {
        const current = onboardingState(store, groupId, 'lead'), latest = store.group(groupId);
        if (current?.operation_id === operationId && latest.definition_epoch === operationEpoch) markOnboardingStopped(store, groupId);
      });
    } finally {
      for (const [role, child] of children) {
        const session = store.session(groupId, role);
        if (session?.launch_id === launches.get(role) && alive(session.pid)) { try { stopGroup(store, groupId, true); } catch {} }
        if (child.exitCode === null) { try { child.kill(); } catch {} }
      }
      const exitDeadline = Date.now() + 10000;
      while (Date.now() < exitDeadline && [...children.values()].some(child => child.exitCode === null && child.signalCode === null)) await new Promise(resolve => setTimeout(resolve, 100));
      store.close();
    }
    return;
  }
  const cli = join(packageRoot, 'dist/cli.js');
  if (!existsSync(cli)) throw Error('Pi CLI package is unavailable for onboarding');
  const children = new Map();
  const launchIds = new Map();
  try {
    for (const role of ROLES) {
      const prior = store.session(groupId, role), sessionId = prior?.session_id || randomUUID(), launchId = randomUUID();
      if (!onboardingState(store, groupId, role)?.receipts?.[role] && !store.pending(groupId, role).length) store.notice(groupId, role, { type: 'onboarding', lifecycle_id: operationId, definition_epoch: state.epoch, detail: role === 'coordinator' ? 'Complete finite onboarding. Review both peer acknowledgements when available, then submit your own responsibility acknowledgement.' : 'Complete finite onboarding by reading the group description and role instructions, then submit your explicit responsibility acknowledgement.' });
      if (prior && alive(prior.pid)) { children.set(role, null); continue; }
      launchIds.set(role, launchId);
      const args = roleArgs(store, group, role, sessionId, sourceRoot).slice(0, -1);
      const config = prior?.config || roleConfig()[role];
      const env = { ...process.env, PI_TEAM_PROJECT_ROOT: projectRoot, PI_TEAM_GROUP_ID: groupId, PI_TEAM_ROLE: role, PI_TEAM_LAUNCH_ID: launchId, PI_TEAM_SESSION_ID: sessionId, PI_TEAM_SOURCE_ROOT: sourceRoot, PI_TEAM_ROLE_CONFIG: JSON.stringify(config), PI_TEAM_DEFINITION_EPOCH: String(state.epoch), PI_TEAM_LIFECYCLE_ID: state.operation_id };
      const logPath = join(store.root, `${operationId}-${role}.jsonl`);
      const child = spawn(process.execPath, [cli, '--mode', 'rpc', ...args], { cwd: group.worktree, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
      child.stdout.on('data', bytes => appendFileSync(logPath, bytes)); child.stderr.on('data', bytes => appendFileSync(logPath, bytes));
      child.unref(); children.set(role, child);
    }
    const deadline = Date.now() + Number(process.env.PI_TEAM_ONBOARDING_TIMEOUT || 600000);
    while (Date.now() < deadline) {
      const current = onboardingState(store, groupId, 'lead');
      if (!current || current.operation_id !== operationId || !['pending', 'acknowledged'].includes(current.status)) break;
      const faulted = store.sessions(groupId).find(session => session.fault);
      if (faulted) throw Error(`onboarding role ${faulted.role} failed: ${faulted.fault}; inspect and explicitly retry group-init`);
      if (current.status === 'acknowledged' && store.sessions(groupId).length === 3 && current.receipts?.coordinator && store.sessions(groupId).every(session => !session.busy)) break;
      const launched = [...children.values()].filter(Boolean);
      if (launched.length && launched.every(child => child.exitCode !== null)) throw Error('all onboarding model processes exited before acknowledgement');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const final = onboardingState(store, groupId, 'lead');
    if (final?.status !== 'acknowledged') throw Error('onboarding timed out before all required acknowledgements');
  } finally {
    try {
      const lifecycleBeforeStop = onboardingState(store, groupId, 'lead');
      const groupBeforeStop = store.group(groupId);
      const stillOwner = lifecycleBeforeStop?.operation_id === operationId && groupBeforeStop.definition_epoch === operationEpoch;
      if (stillOwner) {
        try {
          store.operation(`group:${groupId}`, () => {
            const current = onboardingState(store, groupId, 'lead'), group = store.group(groupId);
            if (current?.operation_id === operationId && group.definition_epoch === operationEpoch) stopGroup(store, groupId, true);
          });
        } catch (error) { appendFileSync(join(store.root, `${operationId}-cleanup-error.log`), `${error.message}\n`); }
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (stillOwner && store.sessions(groupId).some(session => alive(session.pid)) || [...children.values()].some(child => child && child.exitCode === null && child.signalCode === null))) {
        for (const [role, child] of children) if (child && child.exitCode === null && child.signalCode === null) {
          const currentSession = store.session(groupId, role), launchId = launchIds.get(role);
          if (!currentSession || currentSession.launch_id === launchId && currentSession.pid === child.pid) { try { child.kill(); } catch {} }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const current = onboardingState(store, groupId, 'lead'), groupNow = store.group(groupId);
      if (current?.operation_id === operationId && groupNow.definition_epoch === operationEpoch && current.status === 'acknowledged' && !store.sessions(groupId).some(session => alive(session.pid))) {
        try { store.operation(`group:${groupId}`, () => {
          const latest = onboardingState(store, groupId, 'lead'), group = store.group(groupId);
          if (latest?.operation_id === operationId && group.definition_epoch === operationEpoch && !store.sessions(groupId).some(session => alive(session.pid))) markOnboardingStopped(store, groupId);
        }); } catch (error) { appendFileSync(join(store.root, `${operationId}-cleanup-error.log`), `${error.message}\n`); }
      }
    } finally { store.close(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(runnerPath) && process.argv.length >= 5) {
  run(process.argv[2], process.argv[3], process.argv[4]).catch(error => {
    try {
      const store = new GroupStore(process.argv[2]);
      const state = onboardingState(store, process.argv[3], 'lead');
      if (state?.operation_id === process.argv[4]) { state.resume_status = state.status === 'acknowledged' ? 'acknowledged' : 'pending'; state.status = 'failed'; state.error = error.message; state.failed_at = new Date().toISOString(); store.db.prepare('INSERT OR REPLACE INTO group_lifecycle VALUES (?,?)').run(process.argv[3], JSON.stringify(state)); store.notice(process.argv[3], 'lead', { type: 'onboarding_failed', lifecycle_id: state.operation_id, definition_epoch: state.epoch, detail: error.message, next_action: 'inspect logs and explicitly retry group-init' }); }
      store.close();
    } catch {}
  });
}
