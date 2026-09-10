# ADR 0008 — Agent Blackboard update protocol

Status: Accepted
Date: 2026-08-25

## Context

The Agent Blackboard is Lead's only observability plane for the three active
roles (ADR 0005). Issue #6 reports that an Agent's status, progress, next step,
and blocker can go stale for the whole duration of a long-running slice, so
Lead intervenes, reviews, or accepts against outdated information. The
`blackboard_update` tool already exists and the runtime owns role identity,
sequence, and observation time, but the tool only validates field lengths; it
has no protocol for *when* a role must publish, *what* each field must
semantically carry, and *what* counts as a meaningful update versus a
heartbeat.

A previous ISSUE-006 attempt tripped a Pi compression unit bug that aborted
the session on the first tool call. The compression extension is unchanged
here, but any new runtime constraint must avoid the same terminate-on-first-
event pattern.

## Decision

Add an Agent-side Blackboard update protocol. It is implemented in
`.pi/communication/blackboard-protocol.mjs`, wired through
`.pi/communication/extensions/blackboard-update.ts`, and documented in the
three role prompts and skills. The protocol is the single source of truth for
"what a Blackboard update means"; other documents summarize it and defer to it
when wording conflicts.

### Lifecycle checkpoints per role

Each role has a fixed map of role states to lifecycle checkpoints:

- researcher: start / progress = `working`; blocked = `blocked`; handoff =
  `completed`; waiting = `waiting`.
- executor: start / progress = `working`; blocked = `blocked`; handoff =
  `ready_for_review`; waiting = `waiting`.
- reviewer: start / progress = `reviewing`; blocked = `blocked`; handoff =
  `ready_for_acceptance` or `changes_requested`; waiting = `waiting`.

Any update whose `state` is not a checkpoint for the current role is refused
at the tool boundary. The Lead therefore always sees the role in a named
phase of the pair lifecycle and never has to guess.

### Field semantics

- `activity` is the observed fact. It must be a non-empty line of at least
  eight characters, free of placeholder text such as `ok`, `done`, `still
  working`, or `tbd`. Identical repeat of the previous event's `state` and
  `activity` is refused so the role cannot mask real progress with a
  heartbeat. The "previous event" is the role's own most recent event on
  the task board; the extension scans a wide window because peer roles
  routinely publish between this role's updates and a single-slot
  `latest-event` lookup would silently disable the anti-heartbeat guard.
- `blocker` is mandatory whenever the state is `blocked` or
  `changes_requested`, because a request for help or correction that does not
  name the obstacle is the exact stale-information pattern Issue #6
  describes. Other states must not carry a `blocker`; risks go in `activity`
  or `next`.
- `next` is mandatory for every non-terminal state except
  `ready_for_review`, `ready_for_acceptance`, `changes_requested`, and
  `completed`. The Lead needs a concrete follow-up to triage progress
  without polling the model. Terminal handoffs are exempt because the Lead
  is the only next step and that is implied by the role and state.

### Bounded lifecycle gate

The extension registers a `tool_call` gate:

- It blocks the first substantive tool call until a `blackboard_update` has
  been published, with a clear reason naming the bypass counter.
- After the first publish, it blocks every 20 substantive tool calls that
  pass without a further update, with the same bypass counter.
- The bypass counter is hard-capped at two. After that, the gate fails
  *open* and records an `opened` event in its history so tests and Lead
  observation can see the bypass fire. The counter is reset on every
  successful `blackboard_update`. The compression extension's
  terminate-on-resource-cap is unchanged; the Blackboard gate never
  terminates the session, so it cannot recreate the previous ISSUE-006
  crash.

The gate never grants task control, completion authority, or peer
communication. It only blocks substantive tool calls until a Blackboard
event is published. Validation failures are surfaced as tool errors; the
Lead observes the resulting event in the append-only log exactly as it
observes any other event.

## Consequences

Lead always knows which phase of the pair lifecycle the Agent is in and
always sees a fact, a next action, and (when relevant) a blocker. A role
that tries to publish a meaningless heartbeat, an empty fact, or a blocked
event without a blocker is refused at the tool boundary, and the refusal
appears in the Agent's own error output. Long-running slices that drift
from their last Blackboard publish are forced to publish again after 20
substantive tool calls, with a two-block bypass cap so the session can
never deadlock. The Blackboard remains the observation plane described in
ADR 0005; this ADR only tightens the contract an Agent must keep with it.
