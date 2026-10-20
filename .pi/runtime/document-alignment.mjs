import { lstatSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

export function documentPaths(paths = []) {
  if (!Array.isArray(paths)) throw Error('documentation_paths must be an array');
  return [...new Set(paths.map(p => {
    if (typeof p !== 'string' || !p || p.includes('\\') || isAbsolute(p) || p.split('/').some(s => !s || s === '.' || s === '..') || !/\.md$/i.test(p) || p.startsWith('groups/') || p.startsWith('.git/')) throw Error('documentation_paths must be explicit module Markdown paths outside groups');
    return p;
  }))];
}

export function assertDocumentFiles(root, paths) {
  const base = realpathSync(root);
  for (const p of paths) {
    let current = root;
    for (const part of p.split('/')) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw Error('documentation paths cannot contain symbolic links');
    }
    const rel = relative(base, realpathSync(current));
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || !lstatSync(current).isFile()) throw Error('documentation escapes worktree');
  }
}

// The runtime commits only the explicitly delegated prose. Never consume a
// model's staged production changes or a pre-existing unrelated index entry.
export function commitDocuments(git, g, t) {
  if (git(g.worktree, 'diff', '--cached', '--name-only')) throw Error('documentation commit requires an empty index');
  const paths = documentPaths(t.documentation_paths);
  assertDocumentFiles(g.worktree, paths);
  if (paths.length) {
    git(g.worktree, 'add', '--', ...paths);
    const modes = git(g.worktree, 'diff', '--cached', '--raw');
    if (modes.split(/\r?\n/).some(line => line && !/^:100644 100644 /.test(line) && !/^:000000 100644 /.test(line))) throw Error('documentation commit contains unsupported file mode');
    if (git(g.worktree, 'diff', '--cached', '--name-only')) git(g.worktree, 'commit', '-m', `docs: align ${t.task_id} D${t.round}`);
  }
  return git(g.worktree, 'rev-parse', 'HEAD');
}
