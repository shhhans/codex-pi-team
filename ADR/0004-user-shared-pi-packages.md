# ADR 0004 — User-shared Pi packages and role-scoped Web Access

Status: Accepted
Date: 2026-08-24

## Context

Task worktrees inherit `.pi/settings.json` but not the ignored
`.pi/npm/node_modules/` directory. Declaring npm packages in project settings
therefore caused every new worktree to install another copy. A globally
autoloaded Web Access extension would also execute in Pi sessions that do not
need it, even when their strict tool allowlists hide its tools.

## Decision

Install the pinned runtime packages once under `~/.pi/agent/npm/` through the
explicit `pi-team setup` command. Project settings declare no packages. Every
role disables ambient extensions and explicitly loads shared intercom plus its
project policy extensions. Researcher alone additionally loads shared
`pi-web-access` and allowlists its four bounded web tools.

The setup command configures the user-level `pi-web-access` package with an
empty extension filter, so its installation is storage rather than ambient
activation. `doctor` is read-only, while role-launching commands fail fast when
the shared installation is absent or inconsistent.

## Consequences

New worktrees do not download Pi packages. A clone requires one explicit setup
step per user account. Package versions are deterministic, unrelated user
settings are preserved, and Executor/Reviewer do not load the Web Access
provider.
