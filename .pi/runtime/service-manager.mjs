import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, renameSync, rmSync, realpathSync, readdirSync, lstatSync, chmodSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { git, alive, identifier } from './group-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function killWindowsTree(record, primary = 'taskkill.exe') {
  if (!Number.isInteger(record.pid) || !/^\d+$/.test(record.process_stamp || '')) throw Error('service PID identity is invalid');
  let actual;
  try { actual = stamp(record.pid); } catch (error) { if (alive(record.pid)) throw error; }
  if (!actual) return;
  if (actual !== record.process_stamp) throw Error('service PID identity changed; refusing to kill');
  try { execFileSync(primary, ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' }); }
  catch (error) {
    if (!alive(record.pid)) return;
    if (!Number.isInteger(record.pid) || !/^\d+$/.test(record.process_stamp || '')) throw error;
    // taskkill's tree enumeration can fail with Windows quota/cancellation
    // errors under load. PowerShell 7 uses .NET's native process-tree API.
    // Pin the Process handle and recheck creation time before terminating.
    const script = `$p=Get-Process -Id ${record.pid} -ErrorAction SilentlyContinue;if($null -eq $p){exit 0};$h=$p.SafeHandle;if($p.StartTime.ToUniversalTime().Ticks -ne [Int64]::Parse('${record.process_stamp}')){throw 'service PID identity changed'};if(-not $p.HasExited){$p.Kill($true);if(-not $p.WaitForExit(5000)){throw 'service process tree did not stop'}}`;
    try { execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' }); }
    catch (fallback) { if (alive(record.pid)) throw Error(`Unable to stop owned process tree: ${error.message}; PowerShell 7 fallback: ${fallback.message}`); }
  }
}
function inside(root, value) {
  const path = resolve(root, value || '.');
  const rel = relative(realpathSync(root), realpathSync(path));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw Error('service path escapes source snapshot');
  return path;
}
function stamp(pid) {
  if (!Number.isInteger(pid) || pid < 1 || !alive(pid)) return null;
  if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { encoding: 'utf8', windowsHide: true }).trim();
  return readFileSync(`/proc/${Number(pid)}/stat`, 'utf8').slice(readFileSync(`/proc/${Number(pid)}/stat`, 'utf8').lastIndexOf(')') + 2).split(' ')[19];
}
function treeHash(root) {
  const entries = [];
  function visit(dir) { for (const name of readdirSync(dir).sort()) { const path = join(dir, name), stat = lstatSync(path); if (stat.isSymbolicLink()) throw Error('service snapshots do not permit symbolic links'); if (stat.isDirectory()) visit(path); else entries.push([relative(root, path), hash(readFileSync(path))]); } }
  visit(root); return hash(JSON.stringify(entries));
}

/** Coordinator operates named project specifications, never a shell command supplied by a model. */
export class ServiceManager {
  constructor(store) { this.store = store; this.root = join(store.root, 'services'); mkdirSync(this.root, { recursive: true }); }
  path(group, service) { identifier(group); identifier(service); const dir = join(this.root, 'records', group); mkdirSync(dir, { recursive: true }); return join(dir, `${service}.json`); }
  records() { const root = join(this.root, 'records'); if (!existsSync(root)) return []; return readdirSync(root).flatMap(group => readdirSync(join(root, group)).filter(x => x.endsWith('.json')).map(x => JSON.parse(readFileSync(join(root, group, x), 'utf8')))); }
  record(group, service) { const path = this.path(group, service); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
  save(record) { const path = this.path(record.group_id, record.service_id), temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(record, null, 2)); renameSync(temp, path); return record; }
  specs(root) {
    const raw = readFileSync(join(root, '.pi/services.json'), 'utf8'), input = JSON.parse(raw);
    if (!input.services || typeof input.services !== 'object' || Array.isArray(input.services)) throw Error('services must be an object');
    for (const [id, spec] of Object.entries(input.services)) {
      identifier(id);
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw Error('service specification must be an object');
      if (spec.external === true) {
        if (typeof spec.description !== 'string' || !spec.description.trim()) throw Error('external service requires a description');
        if (['executable', 'args', 'cwd', 'env_refs', 'env', 'command', 'shell'].some(key => Object.hasOwn(spec, key))) throw Error('external service cannot define a process or command');
      } else if (typeof spec.executable !== 'string' || !spec.executable || !Array.isArray(spec.args || []) || (spec.args || []).some(x => typeof x !== 'string')) throw Error('service requires executable and string args');
      if (spec.env || spec.command || spec.shell) throw Error('service environment uses env_refs; shell commands are unsupported');
      if ((spec.env_refs || []).some(x => typeof x !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))) throw Error('invalid environment reference');
      if ((spec.ports || []).some(x => !Number.isInteger(x) || x < 1 || x > 65535)) throw Error('invalid port');
      if (spec.health) {
        if (typeof spec.health !== 'object' || typeof spec.health.url !== 'string') throw Error('health requires a URL');
        const url = new URL(spec.health.url);
        if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('health URL must be loopback HTTP');
      }
    }
    return { services: input.services, config_digest: hash(raw) };
  }
  configuredSpec(group, service) {
    const root = this.store.group(group).worktree;
    if (!existsSync(join(root, '.pi/services.json'))) return null;
    return this.specs(root).services[service] || null;
  }
  describe(group) {
    const config = this.specs(this.store.group(group).worktree);
    return { ...config, services: Object.fromEntries(Object.entries(config.services).map(([id, spec]) => [id, spec.external === true ? { ...spec, owned: false } : spec])) };
  }
  status(group, service) {
    const spec = this.configuredSpec(group, service);
    const record = this.record(group, service);
    if (!record && spec?.external === true) return this.externalStatus(group, service, spec);
    if (!record) return null;
    let owned = false; try { owned = record.pid && stamp(record.pid) === record.process_stamp; } catch {}
    if (spec?.external === true && !owned) return this.externalStatus(group, service, spec);
    let snapshot_intact = true;
    if (record.mode === 'review') { try { snapshot_intact = treeHash(record.source_path) === record.snapshot_digest; } catch { snapshot_intact = false; } }
    return { ...record, external: false, configured_external: spec?.external === true, owned: Boolean(owned), process_alive: Boolean(owned), snapshot_intact, ready: Boolean(owned && snapshot_intact && record.state === 'ready') };
  }
  externalStatus(group, service, spec) { return { group_id: group, service_id: service, external: true, owned: false, description: spec.description, health: spec.health || null, ports: spec.ports || [], process_alive: false, ready: null }; }
  lock() {
    const lock = join(this.root, 'operation.lock'); let fd;
    try { fd = openSync(lock, 'wx'); } catch { throw Error('service operation is already in progress; inspect lock before recovery'); }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, process_stamp: stamp(process.pid), started_at: new Date().toISOString() }));
    return () => { closeSync(fd); rmSync(lock); };
  }
  recoverLock() {
    const lock = join(this.root, 'operation.lock'), guard = `${lock}.recovery`;
    let fd;
    try { fd = openSync(guard, 'wx'); } catch { throw Error('service lock recovery is already in progress'); }
    try {
      if (!existsSync(lock)) return { recovered: false, absent: true };
      const raw = readFileSync(lock, 'utf8'); let owner;
      try { owner = JSON.parse(raw); } catch { throw Error('service operation lock is unreadable; inspect it before recovery'); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.process_stamp !== 'string' || !owner.process_stamp) throw Error('service operation lock lacks a valid owner identity; inspect it before recovery');
      const isAlive = alive(owner.pid); let actual = null;
      if (isAlive) {
        try { actual = stamp(owner.pid); } catch { throw Error('service lock owner is live but its identity cannot be verified'); }
        if (!actual) throw Error('service lock owner is live but its identity cannot be verified');
        if (actual === owner.process_stamp) throw Error('service operation is still owned by a live process');
      }
      if (readFileSync(lock, 'utf8') !== raw) throw Error('service operation lock changed during recovery; retry after inspection');
      rmSync(lock);
      return { recovered: true, reason: isAlive ? 'owner_pid_reused' : 'owner_exited' };
    } finally { closeSync(fd); rmSync(guard, { force: true }); }
  }
  async start(group, service, options = {}) {
    const release = this.lock();
    try { return await this.startUnlocked(group, service, options); } finally { release(); }
  }
  async startUnlocked(group, service, options) {
    const old = this.status(group, service);
    if (old?.external === true || old?.configured_external) throw Error('external services are read-only and cannot be started by the manager');
    if (old?.process_alive) {
      if (old.task_id === (options.task_id || null) && old.mode === (options.mode || 'development') && (!options.commit || old.source_commit === git(this.store.group(group).worktree, 'rev-parse', `${options.commit}^{commit}`))) return old;
      throw Error('service already running with another task or snapshot; stop it first');
    }
    const mode = options.mode || 'development'; if (!['development', 'review'].includes(mode)) throw Error('unknown service mode');
    const g = this.store.group(group), run = join(this.root, 'runs', randomUUID()); mkdirSync(run, { recursive: true });
    const source_commit = git(g.worktree, 'rev-parse', `${options.commit || 'HEAD'}^{commit}`);
    let source_path = g.worktree;
    if (mode === 'review') {
      if (!options.commit) throw Error('review services require an explicit delivery commit');
      source_path = join(run, 'snapshot'); mkdirSync(source_path);
      const archive = join(run, 'snapshot.tar'); git(g.worktree, 'archive', '--format=tar', `--output=${archive}`, source_commit);
      execFileSync('tar', ['-xf', archive, '-C', source_path], { windowsHide: true }); rmSync(archive);
    }
    const config = this.specs(source_path), spec = config.services[service]; if (!spec) throw Error('unknown service');
    if (spec.external === true) throw Error('external services are read-only and cannot be started by the manager');
    for (const record of this.records()) if (this.status(record.group_id, record.service_id)?.process_alive && (spec.ports || []).some(port => record.ports?.includes(port))) throw Error('declared port is owned by another managed service');
    const cwd = inside(source_path, spec.cwd || '.');
    // Files exported for review are isolated from the worktree; detect any later drift before reporting readiness.
    const snapshot_digest = mode === 'review' ? treeHash(source_path) : null;
    if (mode === 'review') { const protect = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) protect(path); else chmodSync(path, 0o444); } }; protect(source_path); }
    const data_path = join(run, 'data'), log_path = join(run, 'service.log'); mkdirSync(data_path);
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
    for (const key of spec.env_refs || []) { if (process.env[key] === undefined) throw Error(`missing service environment reference: ${key}`); env[key] = process.env[key]; }
    Object.assign(env, { PI_TEAM_SERVICE_DATA: data_path, PI_TEAM_SERVICE_LOG: log_path });
    const record = { group_id: group, service_id: service, task_id: options.task_id || null, mode, source_commit, source_path, snapshot_digest, config_digest: config.config_digest, data_path, log_path, ports: spec.ports || [], state: 'starting', started_at: new Date().toISOString() };
    this.save(record);
    const log = openSync(log_path, 'a'); let child;
    try { child = spawn(spec.executable, spec.args || [], { cwd, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', log, log] }); await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
    catch (error) { record.state = 'failed'; record.error = error.message; this.save(record); throw error; }
    finally { closeSync(log); }
    child.unref(); record.pid = child.pid; record.process_stamp = stamp(child.pid); this.save(record);
    try {
      if (spec.health) {
        const deadline = Date.now() + Math.min(Math.max(spec.health.timeout_ms || 10000, 1), 60000); let healthy = false;
        while (Date.now() < deadline && alive(record.pid)) { try { const response = await fetch(spec.health.url, { signal: AbortSignal.timeout(1000), redirect: 'error' }); if (response.ok) { healthy = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
        if (!healthy) throw Error('service health check failed; process retained for inspection and explicit stop');
      }
      if (!record.process_stamp || stamp(record.pid) !== record.process_stamp) throw Error('service exited before readiness');
      record.state = 'ready'; this.save(record); return this.status(group, service);
    } catch (error) { record.state = 'failed'; record.error = error.message; this.save(record); throw error; }
  }
  stop(group, service) {
    const release = this.lock(); try { return this.stopUnlocked(group, service); } finally { release(); }
  }
  stopUnlocked(group, service) {
    const record = this.record(group, service), spec = this.configuredSpec(group, service);
    if (spec?.external === true) {
      if (!record) throw Error('external services are read-only and cannot be stopped by the manager');
      let stillOwned = false; try { stillOwned = record.pid > 0 && stamp(record.pid) === record.process_stamp; } catch {}
      if (!stillOwned) throw Error('external services are read-only and cannot be stopped by the manager');
    }
    if (!record) return { stopped: true };
    if (record.pid > 0 && alive(record.pid)) {
      let actual;
      try { actual = stamp(record.pid); } catch (error) { if (alive(record.pid)) throw error; }
      if (actual) {
        if (!record.process_stamp || actual !== record.process_stamp) throw Error('service PID identity changed; refusing to kill');
        try {
          if (process.platform === 'win32') killWindowsTree(record);
          else process.kill(-record.pid, 'SIGTERM');
        } catch (error) { if (alive(record.pid)) throw error; }
      }
    }
    record.state = 'stopped'; record.stopped_at = new Date().toISOString(); this.save(record); return { stopped: true, service_id: service };
  }
  stopGroup(group) { return this.records().filter(x => x.group_id === group).map(x => this.stop(group, x.service_id)); }
}
