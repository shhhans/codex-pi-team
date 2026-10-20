// Group runtime v2. SQLite is the authority; Markdown and Git are evidence.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';

export const ROLES = ['coordinator', 'executor', 'validator'];
export function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
const json = x => JSON.stringify(x);
const unpack = row => row ? JSON.parse(row.data) : null;
export const identifier = x => { if (typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(x) || x.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(x)) throw Error('invalid Windows-safe identifier'); return x; };
const id = identifier;
const required = (x, name) => { if (typeof x !== 'string' || !x.trim()) throw Error(`${name} is required`); return x; };
export function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
export function parseCurrentState(text) {
  const match = /^\[current_state:\s*("(?:[^"\\]|\\.)*")\]\s*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try { const value = JSON.parse(match[1]); return typeof value === 'string' && value.trim() && value.length <= 500 ? value : null; } catch { return null; }
}

export class TeamError extends Error {
  constructor(code, message, next_action = 'read_current_work') { super(message); this.code = code; this.next_action = next_action; }
}

export class GroupStore {
  constructor(projectRoot) {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 24 || major === 24 && minor < 11) throw Error('Pi Team v2 requires Node 24.11 or newer');
    if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) throw Error('project_root must be an absolute path');
    this.projectRoot = resolve(projectRoot);
    this.common = git(this.projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    this.root = join(this.common, 'pi-team-runtime', 'v2');
    mkdirSync(this.root, { recursive: true });
    this.db = new DatabaseSync(join(this.root, 'groups.sqlite'));
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS group_identity ON groups(id COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS task_identity ON tasks(id COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS work (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', result TEXT, UNIQUE(task_id,kind));
      CREATE TABLE IF NOT EXISTS artifacts (task_id TEXT NOT NULL, kind TEXT NOT NULL, round INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(task_id,kind,round));
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, recipient TEXT NOT NULL, data TEXT NOT NULL, read_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (group_id TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(group_id,role));
      CREATE TABLE IF NOT EXISTS operations (name TEXT PRIMARY KEY, pid INTEGER NOT NULL);
      PRAGMA user_version=2;`);
    this.tx(() => { if (!this.db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === "presented_at")) this.db.exec("ALTER TABLE messages ADD COLUMN presented_at TEXT"); });
  }
  close() { this.db.close(); }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  operation(name, fn) {
    this.tx(() => { const old = this.db.prepare('SELECT pid FROM operations WHERE name=?').get(name); if (old && alive(old.pid)) throw Error(`operation in progress: ${name}`); this.db.prepare('INSERT OR REPLACE INTO operations VALUES (?,?)').run(name, process.pid); });
    try { return fn(); } finally { this.db.prepare('DELETE FROM operations WHERE name=? AND pid=?').run(name, process.pid); }
  }
  put(table, key, data) { this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(json(data), key); return data; }
  group(group) { const row = unpack(this.db.prepare('SELECT data FROM groups WHERE id=?').get(id(group))); if (!row) throw Error(`unknown group: ${group}`); return row; }
  task(task) { const row = unpack(this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id(task))); if (!row) throw Error(`unknown task: ${task}`); return row; }
  list() { return this.db.prepare('SELECT data FROM groups ORDER BY id').all().map(unpack); }
  legacyPending() {
    const base = join(this.common, 'pi-team', 'v1');
    if (!existsSync(base)) return [];
    const result = [];
    for (const name of readdirSync(base).filter(n => n.endsWith('.json') && !n.endsWith('-runtime.json'))) {
      try { const s = JSON.parse(readFileSync(join(base, name), 'utf8').replace(/^\uFEFF/, '')); if (s.task_id && (s.outcome === 'pending' || (!s.outcome && !['cleaned', 'reclaimed'].includes(s.status)))) result.push(s.task_id); } catch { result.push(`unreadable:${name}`); }
    }
    return result;
  }
  assertCutover() { const pending = this.legacyPending(); if (pending.length) throw Error(`finish or explicitly close legacy tasks before cutover: ${pending.join(', ')}`); }
  createGroup(input) {
    const name = id(input.group_id); const worktree = resolve(required(input.worktree, 'worktree'));
    if (worktree === this.projectRoot) throw Error('group cannot use the Lead worktree');
    if (git(worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir') !== this.common) throw Error('group worktree belongs to another repository');
    return this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(name)) throw Error('group already exists');
      const g = { group_id: name, name: input.name || name, worktree, idle_branch: required(input.idle_branch, 'idle_branch'), generation: 0, active_task: null, archived: false, created_at: new Date().toISOString() };
      this.db.prepare('INSERT INTO groups VALUES (?,?)').run(name, json(g)); return g;
    });
  }
  session(group, role) { return unpack(this.db.prepare('SELECT data FROM sessions WHERE group_id=? AND role=?').get(group, role)); }
  sessions(group) { return this.db.prepare('SELECT data FROM sessions WHERE group_id=?').all(group).map(unpack); }
  register(group, role, input) {
    if (!ROLES.includes(role)) throw Error('invalid role'); this.group(group);
    return this.tx(() => {
      const old = this.session(group, role);
      if (old && old.launch_id !== input.launch_id && alive(old.pid)) throw Error('role already has a live session');
      this.db.prepare('UPDATE messages SET presented_at=NULL WHERE group_id=? AND recipient=? AND read_at IS NULL').run(group, role);
      const value = { ...input, group_id: group, role, busy: false, claim: null, ready_at: new Date().toISOString() };
      this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(group, role, json(value));
      for (const work of this.db.prepare("SELECT * FROM work WHERE group_id=? AND owner=? AND status='open'").all(group, role)) this.notice(group, role, { type: 'work_recovered', task_id: work.task_id, work_id: work.id, kind: work.kind });
      return value;
    });
  }
  updateSession(group, role, launch, patch) {
    return this.tx(() => { const s = this.session(group, role); if (!s || s.launch_id !== launch) throw Error('stale role process'); Object.assign(s, patch); this.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(json(s), group, role); return s; });
  }
  assertIdle(group) { for (const s of this.sessions(group)) if (alive(s.pid) && s.busy) throw Error(`role still busy: ${s.role}`); }
  notice(group, recipient, body) { return Number(this.db.prepare('INSERT INTO messages(group_id,recipient,data) VALUES (?,?,?)').run(group, recipient, json({ ...body, at: new Date().toISOString() })).lastInsertRowid); }
  addWork(task, kind, owner) {
    const result = this.db.prepare('INSERT OR IGNORE INTO work(group_id,task_id,kind,owner) VALUES (?,?,?,?)').run(task.group_id, task.task_id, kind, owner);
    if (result.changes) this.notice(task.group_id, owner, { type: 'work', task_id: task.task_id, generation: task.generation, work_id: Number(result.lastInsertRowid), kind });
  }
  startTask(group, input) {
    return this.tx(() => {
      const g = this.group(group); if (g.archived || g.active_task) throw Error('group is archived or already has a task'); this.assertIdle(group);
      const t = { task_id: id(input.task_id), group_id: group, generation: g.generation + 1, objective: required(input.objective, 'objective'), acceptance: input.acceptance, base_ref: required(input.base_ref, 'base_ref'), base_commit: git(g.worktree, 'rev-parse', 'HEAD'), branch: required(input.branch, 'branch'), outcome: 'pending', round: 0, delivery: null, review: null, finalization: null };
      if (!Array.isArray(t.acceptance) || !t.acceptance.length || t.acceptance.some(x => typeof x !== 'string' || !x.trim())) throw Error('acceptance must contain observable results');
      if (git(g.worktree, 'branch', '--show-current') !== t.branch || git(g.worktree, 'status', '--porcelain')) throw Error('task requires its clean, explicitly selected branch');
      git(g.worktree, 'merge-base', '--is-ancestor', g.transition?.base_commit || t.base_commit, 'HEAD');
      this.db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(t.task_id, group, json(t));
      Object.assign(g, { active_task: t.task_id, generation: t.generation }); delete g.transition; this.put('groups', group, g); this.addWork(t, 'task', 'coordinator'); return t;
    });
  }
  identity(actor) {
    const g = this.group(actor.group_id);
    if (!ROLES.includes(actor.role)) throw Error('invalid actor role');
    if (actor.launch_id) { const s = this.session(g.group_id, actor.role); if (!s || s.launch_id !== actor.launch_id) throw Error('stale role process'); }
    if (!g.active_task || actor.task_id !== g.active_task || actor.generation !== g.generation) throw Error('stale task or generation');
    return { g, t: this.task(g.active_task) };
  }
  read(group, role) {
    const g = this.group(group); return { group: g, task: g.active_task ? this.task(g.active_task) : null, work: this.db.prepare("SELECT * FROM work WHERE group_id=? AND owner=? AND status='open' ORDER BY id").all(group, role), messages: this.inbox(group, role).filter(m => m.data.type === 'message' || !m.data.task_id || m.data.task_id === g.active_task).slice(-20), sessions: this.sessions(group) };
  }
  inbox(group, recipient, cursor = 0) { return this.db.prepare('SELECT * FROM messages WHERE group_id=? AND recipient=? AND id>? ORDER BY id').all(group, recipient, cursor).map(r => ({ ...r, data: JSON.parse(r.data) })); }
  pending(group, role) {
    const g = this.group(group);
    return this.inbox(group, role).filter(m => !m.read_at && !m.presented_at &&
      (!m.data.task_id || m.data.task_id === g.active_task) &&
      (!m.data.work_id || this.db.prepare('SELECT status FROM work WHERE id=?').get(m.data.work_id)?.status === 'open'));
  }
  present(group, role, launch) {
    return this.tx(() => this.presentInside(group, role, launch));
  }
  presentInside(group, role, launch) {
    const s = this.session(group, role);
    if (!s || s.launch_id !== launch) throw Error('stale role process');
    const messages = this.pending(group, role);
    const now = new Date().toISOString();
    for (const m of messages) this.db.prepare('UPDATE messages SET presented_at=? WHERE id=?').run(now, m.id);
    s.claim = [...new Set([...(s.claim || []), ...messages.map(m => m.id)])];
    this.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(json(s), group, role);
    return messages;
  }
  claim(group, role, launch) {
    return this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM operations WHERE name=?').get(`group:${group}`)) return null;
      const s = this.session(group, role); if (!s || s.launch_id !== launch || s.busy) return null;
      const messages = this.presentInside(group, role, launch); if (!messages.length) return null;
      const current = this.session(group, role); current.busy = true;
      this.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(json(current), group, role);
      return messages;
    });
  }
  alertUnfinished(group, role, launch, rejection = null) {
    return this.tx(() => {
      const session = this.session(group, role); if (session?.launch_id !== launch) return;
      const work = this.read(group, role).work;
      if (!work.length && !rejection) return;
      // New arrivals will get their own turn; no alert for a normal handoff race.
      if (!rejection && this.pending(group, role).length) return;
      const key = `${this.group(group).active_task}:${role}:${work.map(w => w.id).join(',')}`;
      if (this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND json_extract(data,'$.alert_key')=?").get(group, key)) return;
      const t = this.group(group).active_task ? this.task(this.group(group).active_task) : null;
      if (t && work.some(w => w.kind === `code_review-${t.round}`)) this.addWork(t, `blocked-${t.round}`, 'coordinator');
      this.notice(group, role === 'coordinator' ? 'lead' : 'coordinator', {
        type: 'unfinished_work', alert_key: key, task_id: t?.task_id, role,
        work: work.map(w => ({ id: w.id, kind: w.kind })), rejection,
        detail: 'Turn ended without completing assigned work. Database state is authoritative; inspect and resolve or ask the owner to continue.'
      });
    });
  }
  settle(group, role, launch, success = true) {
    return this.tx(() => {
      const s = this.session(group, role); if (!s || s.launch_id !== launch) return;
      for (const n of s.claim || []) {
          if (success) this.db.prepare('UPDATE messages SET read_at=? WHERE id=?').run(new Date().toISOString(), n);
          else this.db.prepare('UPDATE messages SET presented_at=NULL WHERE id=? AND read_at IS NULL').run(n);
        }
      Object.assign(s, { busy: false, claim: null }); this.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(json(s), group, role);
    });
  }
  send(actor, input) {
    return this.tx(() => {
      const source = this.group(actor.group_id); const target = input.group_id || actor.group_id;
      if (source.archived || this.group(target).archived) throw Error('cannot message an archived group'); const to = input.to; required(input.body, 'body');
      if (actor.role === 'lead') { if (to !== 'coordinator') throw Error('Lead addresses Coordinator only'); }
      else {
        if (!ROLES.includes(actor.role)) throw Error('invalid sender');
        if (actor.launch_id && this.session(actor.group_id, actor.role)?.launch_id !== actor.launch_id) throw Error('stale role process');
        if (source.active_task && (actor.task_id !== source.active_task || actor.generation !== source.generation)) throw Error('stale task or generation');
        if (to === 'lead' && actor.role !== 'coordinator') throw Error('only Coordinator addresses Lead');
        if (to !== 'lead' && !ROLES.includes(to)) throw Error('invalid recipient');
        if (target !== actor.group_id && (actor.role !== 'coordinator' || to !== 'coordinator')) throw Error('cross-group communication requires Coordinators');
      }
      return { message_id: this.notice(target, to, { type: 'message', from_group: actor.group_id, from_role: actor.role, body: input.body, refs: input.refs || [], reply_to: input.reply_to || null, task_id: actor.task_id || null }) };
    });
  }
  artifact(task, kind, round = 0) { return unpack(this.db.prepare('SELECT data FROM artifacts WHERE task_id=? AND kind=? AND round=?').get(task, kind, round)); }
  submit(actor, input) {
    return this.tx(() => {
      const { g, t } = this.identity(actor);
      if (actor.launch_id && this.pending(g.group_id, actor.role).length) throw new TeamError('INBOX_PENDING', 'New messages must be presented before submission', 'read_messages_and_reconsider');
      if (t.outcome !== 'pending') throw Error('task is closed');
      const rules = { task: ['coordinator', 'task.md'], plan: ['executor', 'plan.md'], plan_review: ['validator', 'plan-review.md'], implementation: ['executor', 'implementation.md'], code_review: ['validator', ''], delivery: ['coordinator', 'delivery.md'], resolution: ['coordinator', `decision-${input.round}.md`] };
      const rule = rules[input.kind]; if (!rule || actor.role !== rule[0]) throw Error('artifact not owned by this role');
      const round = input.kind === 'delivery' ? t.round : ['implementation', 'code_review', 'resolution'].includes(input.kind) ? input.round : 0;
      if (!Number.isInteger(round) || round < 0) throw Error('invalid round');
      const file = `groups/${g.group_id}/tasks/${t.task_id}/${rule[1] || `code-review-${String(round).padStart(2, '0')}.md`}`;
      const submittedPath = relative(g.worktree, resolve(g.worktree, required(input.path, 'path'))).replaceAll('\\', '/');
      if (submittedPath !== file) throw Error(`expected artifact path: ${file}`);
      const full = realpathSync(join(g.worktree, file)); const rel = relative(realpathSync(g.worktree), full);
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw Error('artifact escapes worktree');
      const content = required(readFileSync(full, 'utf8'), 'artifact content');
      const stored = this.artifact(t.task_id, input.kind, round);
      if (stored) { if (stored.content !== content || stored.commit !== (input.commit || null) || stored.verdict !== (input.verdict || null)) throw Error('submitted artifact is immutable'); return { ...stored, replay: true }; }
      const resolutionKind = this.db.prepare("SELECT kind FROM work WHERE task_id=? AND owner='coordinator' AND status='open' AND kind IN (?,?)").get(t.task_id, `blocked-${round}`, `revision-${round}`)?.kind;
      const workKind = input.kind === 'implementation' ? `implementation-${round}` : input.kind === 'code_review' ? `code_review-${round}` : input.kind === 'resolution' ? resolutionKind : input.kind === 'delivery' ? `delivery-${round}` : input.kind;
      const work = this.db.prepare("SELECT * FROM work WHERE task_id=? AND kind=? AND owner=? AND status='open'").get(t.task_id, workKind || '', actor.role);
      if (!work) throw new TeamError('NO_OPEN_WORK', 'No matching open work for this submission; a new delivery requires review feedback or Coordinator resolution', 'read_current_work');
      const value = { task_id: t.task_id, kind: input.kind, round, path: file, content, commit: input.commit || null, verdict: input.verdict || null, at: new Date().toISOString() };
      if (input.kind === 'plan' || input.kind === 'plan_review') {
        const changed = git(g.worktree, 'diff', t.base_commit, '--name-only', '--', '.', `:(exclude)groups/${g.group_id}/**`);
        if (changed) throw Error('production changed before the single plan review');
      }
      if (input.kind === 'implementation') {
        const commit = required(input.commit, 'commit'); if (commit !== git(g.worktree, 'rev-parse', '--verify', `${commit}^{commit}`) || commit !== git(g.worktree, 'rev-parse', 'HEAD')) throw Error('delivery must identify current full HEAD commit');
        git(g.worktree, 'merge-base', '--is-ancestor', t.base_commit, commit);
        const uncommitted = git(g.worktree, 'status', '--porcelain'); if (uncommitted) throw Error('delivery requires a clean committed worktree');
        if (git(g.worktree, 'show', `${commit}:${file}`) !== content.trim()) throw Error('implementation evidence is not committed');
        this.assertEvidence(g, t, true);
        t.round = round; t.delivery = { id: `D${round}`, commit, round }; t.review = null;
      }
      if (input.kind === 'code_review') {
        if (!t.delivery || t.delivery.round !== round || input.commit !== t.delivery.commit) throw Error('review targets a stale delivery');
        if (!['pass', 'changes_requested', 'blocked'].includes(input.verdict)) throw Error('invalid review verdict');
        this.assertDelivery(g, t);
        t.review = { round, verdict: input.verdict, commit: input.commit, path: file };
      }
      if (input.kind === 'delivery') { if (t.review?.verdict !== 'pass') throw Error('delivery requires passing code review'); this.assertDelivery(g, t); }
      this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?)').run(t.task_id, input.kind, round, json(value));
      this.db.prepare("UPDATE work SET status='complete',result=? WHERE id=?").run(json({ artifact: file, round }), work.id);
      switch (input.kind) {
        case 'task': this.addWork(t, 'plan', 'executor'); break;
        case 'plan': this.addWork(t, 'plan_review', 'validator'); break;
        case 'plan_review': this.addWork(t, 'implementation-1', 'executor'); break;
        case 'implementation': this.addWork(t, `code_review-${round}`, 'validator'); break;
        case 'code_review':
          if (input.verdict === 'pass') this.addWork(t, `delivery-${round}`, 'coordinator');
          else if (input.verdict === 'changes_requested') this.addWork(t, `implementation-${round + 1}`, 'executor');
          else this.addWork(t, `blocked-${round}`, 'coordinator');
          break;
        case 'delivery': this.notice(g.group_id, 'lead', { type: 'delivery', task_id: t.task_id, path: file, delivery: t.delivery, review: t.review }); break;
        case 'resolution': this.db.prepare("UPDATE work SET status='cancelled' WHERE task_id=? AND kind=? AND status='open'").run(t.task_id, `code_review-${round}`); this.addWork(t, `implementation-${round + 1}`, 'executor'); break;
      }
      this.put('tasks', t.task_id, t); return value;
    });
  }
  assertDelivery(g, t) {
    if (!t.delivery) throw Error('no delivery');
    git(g.worktree, 'merge-base', '--is-ancestor', t.delivery.commit, 'HEAD');
    const prefix = `groups/${g.group_id}/tasks/${t.task_id}/`;
    const allowed = [`${prefix}code-review-*.md`, `${prefix}review-*/**`, `${prefix}delivery.md`, `${prefix}decision-*.md`];
    const changed = git(g.worktree, 'diff', t.delivery.commit, '--name-only', '--', '.', ...allowed.map(p => `:(exclude)${p}`));
    const untracked = git(g.worktree, 'ls-files', '--others', '--exclude-standard').split(/\r?\n/).filter(p => p && !(p.startsWith(prefix) && /^(code-review-\d+\.md$|review-\d+\/|delivery\.md$|decision-\d+\.md$)/.test(p.slice(prefix.length))));
    if (changed || untracked.length) throw new TeamError('DELIVERY_CHANGED', 'production files changed during review or delivery documents changed; review the registered snapshot only', 'report_to_coordinator');
    this.assertEvidence(g, t);
  }
  assertEvidence(g, t, allowImplementationUpdate = false) {
    const latest = new Map();
    for (const row of this.db.prepare('SELECT data FROM artifacts WHERE task_id=? ORDER BY round').all(t.task_id)) { const a = unpack(row); latest.set(a.path, a); }
    for (const a of latest.values()) {
      // implementation.md intentionally gets a new snapshot in the next delivery.
      if (a.kind === 'implementation' && allowImplementationUpdate || a.kind === 'delivery' && a.round < t.round) continue;
      const current = readFileSync(join(g.worktree, a.path), 'utf8');
      if (current.replaceAll('\r\n', '\n') !== a.content.replaceAll('\r\n', '\n')) throw new TeamError('DELIVERY_EVIDENCE_CHANGED', `submitted evidence changed: ${a.path}`, 'report_to_coordinator');
    }
  }
  requestChanges(task, reason) {
    return this.tx(() => { const t = this.task(task); required(reason, 'reason'); if (!['pending', 'accepted'].includes(t.outcome) || t.finalization?.merged || !t.delivery) throw Error('task cannot be revised now'); t.outcome = 'pending'; t.review = null; this.db.prepare("UPDATE work SET status='cancelled' WHERE task_id=? AND kind LIKE 'delivery-%' AND status='open'").run(task); this.addWork(t, `revision-${t.round}`, 'coordinator'); this.notice(t.group_id, 'coordinator', { type: 'lead_changes', task_id: task, reason }); return this.put('tasks', task, t); });
  }
  accept(task, rationale) {
    return this.tx(() => { const t = this.task(task), g = this.group(t.group_id); required(rationale, 'rationale'); if (t.outcome === 'accepted') { this.assertDelivery(g, t); return t; } if (t.outcome !== 'pending' || !this.artifact(task, 'delivery', t.round) || t.review?.verdict !== 'pass') throw Error('task is not ready for acceptance'); this.assertDelivery(g, t); t.outcome = 'accepted'; t.acceptance_decision = { rationale, commit: t.delivery.commit, at: new Date().toISOString() }; return this.put('tasks', task, t); });
  }
  cancel(task, reason) {
    return this.tx(() => { const t = this.task(task), g = this.group(t.group_id); required(reason, 'reason'); this.assertIdle(g.group_id); if (t.outcome !== 'pending') throw Error('cannot cancel closed task'); t.outcome = 'incomplete'; t.reason = reason; this.db.prepare("UPDATE work SET status='cancelled' WHERE task_id=? AND status='open'").run(task); return this.put('tasks', task, t); });
  }
}
