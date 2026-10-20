// A valid group.md is registration. Runtime rows are a recoverable projection.
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { identifier, git } from './group-store.mjs';

export function definitionPath(store, id) { return join(store.projectRoot, 'groups', identifier(id), 'group.md'); }
const digest = body => createHash('sha256').update(body).digest('hex');
export function parseDefinition(text, expectedId) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''));
  if (!match) throw Error('group.md requires YAML front matter and a Markdown responsibility description');
  const header = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const field = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!field || !['schema_version', 'id', 'name', 'worktree', 'base_ref', 'archived'].includes(field[1])) throw Error(`unsupported group header field: ${line}`);
    if (Object.hasOwn(header, field[1])) throw Error(`duplicate group header field: ${field[1]}`);
    const value = field[2];
    if (value.startsWith('"')) { try { header[field[1]] = JSON.parse(value); } catch { throw Error('quoted header strings must use JSON double-quote escaping'); } }
    else if (value.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(value)) throw Error('invalid single-quoted header string'); header[field[1]] = value.slice(1, -1).replace(/''/g, "'"); }
    else if (/^(true|false)$/.test(value)) header[field[1]] = value === 'true';
    else if (/^\d+$/.test(value)) header[field[1]] = Number(value);
    else if (!value || /^[\[{*&!>|]/.test(value) || /\s+#/.test(value)) throw Error('header requires a simple scalar or quoted string');
    else header[field[1]] = value;
  }
  if (header.schema_version !== 1) throw Error('unsupported group schema_version');
  identifier(header.id);
  if (expectedId && header.id !== expectedId) throw Error('group directory and header id disagree');
  if (typeof header.name !== 'string' || !header.name.trim()) throw Error('group name is required');
  if (typeof header.worktree !== 'string' || !isAbsolute(header.worktree)) throw Error('group worktree must be absolute');
  if (typeof header.base_ref !== 'string' || !header.base_ref.trim()) throw Error('group base_ref is required');
  if (header.archived !== undefined && typeof header.archived !== 'boolean') throw Error('archived must be boolean');
  const description = match[2].trim();
  if (!description) throw Error('group responsibility description is required');
  return { ...header, archived: header.archived || false, worktree: resolve(header.worktree), description, definition_hash: digest(description.replace(/\r\n/g, '\n')), file_hash: digest(text.replace(/\r\n/g, '\n')) };
}
export function serializeDefinition(input) {
  const scalar = value => JSON.stringify(value);
  return `---\nschema_version: 1\nid: ${scalar(identifier(input.group_id || input.id))}\nname: ${scalar(input.name || input.group_id || input.id)}\nworktree: ${scalar(resolve(input.worktree))}\nbase_ref: ${scalar(input.base_ref || 'develop')}\narchived: ${Boolean(input.archived)}\n---\n\n${input.description?.trim() || ''}\n`;
}
export function writeDefinition(store, input, { replace = false } = {}) {
  const path = definitionPath(store, input.group_id || input.id);
  const text = serializeDefinition(input); parseDefinition(text, input.group_id || input.id);
  if (!replace && existsSync(path)) throw Error('group definition conflict: definition already exists');
  mkdirSync(join(path, '..'), { recursive: true });
  if (lstatSync(join(path, '..')).isSymbolicLink() || existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('group definition cannot be a symbolic link');
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx' }); renameSync(temporary, path);
  return parseDefinition(text, input.group_id || input.id);
}
export function readDefinition(store, id) {
  const path = definitionPath(store, id);
  if (lstatSync(join(path, '..')).isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw Error('group definition cannot be a symbolic link');
  return parseDefinition(readFileSync(path, 'utf8'), id);
}
export function definitionInventory(store) {
  const root = join(store.projectRoot, 'groups'); if (!existsSync(root)) return [];
  const seen = new Set();
  return readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory() || x.isSymbolicLink()).map(x => {
    if (!existsSync(join(root, x.name, 'group.md'))) return null;
    try { const key = x.name.toLowerCase(); if (seen.has(key)) throw Error('case-colliding group id'); seen.add(key); return { registered: true, definition: readDefinition(store, x.name) }; }
    catch (e) { return { registered: false, group_id: x.name, error: e.message }; }
  }).filter(Boolean);
}
export function committedDefinition(store, id) {
  const current = readDefinition(store, id);
  let committed;
  try { committed = parseDefinition(git(store.projectRoot, 'show', `HEAD:groups/${id}/group.md`) + '\n', id); }
  catch { throw Error('Lead must commit the current group definition before starting a task'); }
  if (committed.definition_hash !== current.definition_hash || committed.worktree !== current.worktree || committed.archived !== current.archived || committed.base_ref !== current.base_ref) throw Error('Lead must commit the current group definition before starting a task');
  return current;
}

// The Lead checkout is the source of truth. A group worktree receives only
// committed Lead changes, and only while idle and completely clean.
export function syncGroupBaseline(store, id) {
  const group = store.group(id);
  if (group.active_task) throw Error('cannot sync group baseline during an active task');
  if (git(group.worktree, 'branch', '--show-current') !== group.idle_branch) throw Error('group must be on its idle branch before baseline sync');
  if (git(group.worktree, 'status', '--porcelain')) throw Error('group worktree must be clean before baseline sync');
  if (git(store.projectRoot, 'status', '--porcelain')) throw Error('Lead checkout must be clean before baseline sync');
  const head = git(store.projectRoot, 'rev-parse', 'HEAD');
  const base = git(group.worktree, 'rev-parse', 'HEAD');
  const ancestor = git(store.projectRoot, 'merge-base', '--is-ancestor', base, head);
  void ancestor;
  git(group.worktree, 'merge', '--ff-only', head);
  return { group_id: id, lead_commit: head, group_commit: git(group.worktree, 'rev-parse', 'HEAD') };
}
