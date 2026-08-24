# BOOTSTRAP-SELF-001-R2 — pi-subagents 0.56.0 frontmatter parsing of `skills` / `skillPath`

Task ID: BOOTSTRAP-SELF-001-R2
Question: Does pi-subagents 0.56.0 parse `skills` and `skillPath` from agent frontmatter, and what syntax should this project use?

## Headline answer

Yes. pi-subagents 0.56.0 parses both `skills` (and the alias `skill`) and `skillPath` from each agent markdown frontmatter. Both are stored as `string[]` on `AgentConfig` and are emitted into the resolved config only when at least one entry is present. The accepted syntax is the shared simple-scalar list shape used by `tools`, `defaultReads`, `fallbackModels`, `extensions`, and `subagentOnlyExtensions`: either comma-separated on one line, or a YAML block list with one `- item` per line. There is no project-specific override.

## Evidence — package metadata

- `.pi/npm/node_modules/pi-subagents/package.json:2` — `"version": "0.56.0"`.

## Evidence — docs/agents.md frontmatter reference

- `.pi/npm/node_modules/pi-subagents/docs/agents.md` "Frontmatter reference" shows both `skills: safe-bash, review-checklist` and `skillPath: ./skills, ../shared-skills` as scalar lines in the example block (full example near the top of the reference section).
- Same file, paragraph below the example: "Simple-scalar list fields accept either a comma-separated form or a newline block list with one `- item` per line. This applies to `tools`, `defaultReads`, `skill`/`skills`, `skillPath`, `fallbackModels`, `extensions`, and `subagentOnlyExtensions`."
- Field table row `skills` — "Selects specific skills for the child, regardless of `inheritSkills`."
- Field table row `skillPath` — "Invocation-private skill files or discovery directories. Relative paths resolve from the agent definition file. Local matches take precedence, while unresolved or unreadable matches fall back to normal skill discovery. This field discovers candidates only; `skills` still selects what the child receives."
- "Skills" section: "Agent-local `skillPath` candidates never enter Pi's parent/global skills catalog. Pair `inheritSkills: false` with explicit `skills` and `skillPath` when a child should receive only its selected private skills."

## Evidence — src/agents/agents.ts implementation

- Line 70 (interface `BuiltinAgentOverrideBase`): `skillPath?: string[];` is declared alongside `skills?: string[];` (line 69).
- Line 150 (interface `AgentConfig`): `skillPath?: string[];` is declared alongside `skills?: string[];` (line 149).
- Lines 1786–1788 (inside the frontmatter → config parser for each agent file):
  - `const skillStr = frontmatter.skill || frontmatter.skills;`
  - `const skills = parseFrontmatterList(skillStr);`
  - `const skillPath = parseFrontmatterList(frontmatter.skillPath);`
  This confirms both keys are read from the parsed frontmatter and that the singular `skill` alias is accepted (then normalized through `parseFrontmatterList`).
- Line 1922 (object spread into the returned `AgentConfig`): `...(skillPath?.length ? { skillPath } : {}),`. Empty arrays are dropped, so an agent that declares `skillPath:` with no values is treated as having no private path.
- Line 656 (`cloneOverrideBase`, used when stamping the override base for builtins): `...(agent.skillPath ? { skillPath: [...agent.skillPath] } : {}),`. The path is carried into `BuiltinAgentOverrideBase` so `subagents.agentOverrides.<name>.skillPath` settings overrides can re-supply it.
- Line 1702 (`validateExternalRunnerProfile`): both `skills`, `skill`, and `skillPath` are explicitly listed as "unsupported Pi-only fields" when `runner.type` is `external-cli` or `external-job`. The parser refuses to combine them with an external runner.

## Evidence — src/agents/frontmatter.ts (parser helper)

- `parseFrontmatterList` normalizes "a simple-scalar frontmatter list from comma-separated or block-list syntax." Lines are first split by `\n`, then each non-list line is split by `,`, leading `- ` markers are stripped, values are trimmed, and empties are filtered. `parseFrontmatter` itself stores a block list as a single string containing newlines, which `parseFrontmatterList` then expands. Both keys therefore accept:
  - Comma form: `skills: a, b, c` and `skillPath: ./skills, ../shared-skills`.
  - Block form:
    ```yaml
    skills:
      - a
      - b
    skillPath:
      - ./skills
      - ../shared-skills
    ```
  - Mix is also valid because each line is independently parsed.
  - Singular alias `skill` is read at the agent layer (agents.ts:1786) and forwarded through the same helper.

## Project syntax recommendation

Use the documented simple-scalar list shape for both `skills` and `skillPath`:

```yaml
---
name: <agent-name>
description: <one-line role>
skills:
  - safe-bash
  - review-checklist
skillPath:
  - ./skills
  - ../shared-skills
---
```

Equivalents that the parser also accepts on a single line:

```yaml
skills: safe-bash, review-checklist
skillPath: ./skills, ../shared-skills
```

Operational notes drawn from the docs:
- `skillPath` entries are relative to the agent definition file; unresolved or unreadable matches silently fall back to normal skill discovery.
- `skillPath` only discovers candidates. Pair it with explicit `skills` (and `inheritSkills: false`) when the child should receive only its selected private skills and not Pi's parent catalog.
- Declaring `skills`, `skill`, or `skillPath` together with `runner.type: external-cli` / `external-job` is rejected by `validateExternalRunnerProfile`.

## Confidence

High. The three required local sources agree: `package.json` pins 0.56.0, `docs/agents.md` documents both fields and the shared simple-scalar list syntax, and `agents.ts` reads both keys from the frontmatter via `parseFrontmatterList` and stores them on `AgentConfig`. No contradictory evidence in the three files.

## Gaps / contradictions

- No web sources were consulted (per task scope).
- The override path `subagents.agentOverrides.<name>.skillPath` is supported at the `BuiltinAgentOverrideBase`/settings level (line 70, line 656), but the docs/agents.md "Supported override fields" list above did not enumerate `skillPath` alongside `skills`. The TypeScript code shows it is wired through `cloneOverrideBase`, so settings overrides should work, but the docs surface is slightly under-specified. Not a blocker; flag for follow-up if the project plans to set `skillPath` via settings.
- Per-agent `defaultReads` and per-step `skill` overrides exist for skills but not for `skillPath` in the visible frontmatter parser. None requested.