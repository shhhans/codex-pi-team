import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { documentPaths, assertDocumentFiles, commitDocuments } from '../.pi/runtime/document-alignment.mjs';

function repoFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pi-doc-align-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Documentation Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/module.md'), '# old module docs\n');
  writeFileSync(join(root, 'app.mjs'), 'export const result = 1;\n');
  git('add', '.'); git('commit', '-m', 'baseline');
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

test('documentation allowlist accepts explicit module Markdown paths and rejects task, traversal, and non-Markdown paths', () => {
  assert.deepEqual(documentPaths(['README.md', 'docs/module.md', 'README.md']), ['README.md', 'docs/module.md']);
  for (const paths of [['../README.md'], ['groups/sample/group.md'], ['.git/config.md'], ['docs\\module.md'], ['/tmp/readme.md'], ['app.mjs'], ['docs//module.md']]) {
    assert.throws(() => documentPaths(paths), /documentation_paths/);
  }
  assert.throws(() => documentPaths('README.md'), /documentation_paths/);
});

test('document file validation rejects missing files, symlinks, and paths escaping the worktree', () => {
  const f = repoFixture();
  try {
    assertDocumentFiles(f.root, ['docs/module.md']);
    assert.throws(() => assertDocumentFiles(f.root, ['missing.md']));
    const outside = join(tmpdir(), `pi-doc-outside-${process.pid}`); mkdirSync(outside, { recursive: true }); writeFileSync(join(outside, 'module.md'), 'outside');
    try {
      symlinkSync(outside, join(f.root, 'docs/outside'), 'junction');
      assert.throws(() => assertDocumentFiles(f.root, ['docs/outside/module.md']), /symbolic links/);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  } finally { f.cleanup(); }
});

test('documentation commit refuses a polluted index and commits only allowlisted prose', () => {
  const f = repoFixture();
  try {
    writeFileSync(join(f.root, 'docs/module.md'), '# aligned module docs\n');
    writeFileSync(join(f.root, 'app.mjs'), 'export const result = 2;\n'); f.git('add', 'app.mjs');
    const commitGit = (_root, ...args) => f.git(...args);
    assert.throws(() => commitDocuments(commitGit, { worktree: f.root }, { task_id: 'T1', round: 1, documentation_paths: ['docs/module.md'] }), /empty index/);
    f.git('reset', 'app.mjs');
    const before = f.git('rev-parse', 'HEAD');
    const commit = commitDocuments(commitGit, { worktree: f.root }, { task_id: 'T1', round: 1, documentation_paths: ['docs/module.md'] });
    assert.notEqual(commit, before);
    assert.equal(f.git('show', `${commit}:docs/module.md`), '# aligned module docs');
    assert.equal(f.git('show', `${commit}:app.mjs`), 'export const result = 1;');
    assert.deepEqual(f.git('diff', before, commit, '--name-only').split(/\r?\n/), ['docs/module.md']);
  } finally { f.cleanup(); }
});
