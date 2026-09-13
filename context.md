# KLIZONION Project Context

## What KLIZONION is
KLIZONION is an AI engineering/building agent. Its long-term purpose is to understand a request, inspect an authorized project, plan changes, edit files, run builds and tests, observe results, fix failures, and verify completion under human supervision.

Core loop:

```text
UNDERSTAND -> INSPECT -> PLAN -> EDIT -> RUN -> TEST -> OBSERVE -> FIX -> VERIFY -> DONE
```

The product should feel like a real engineering environment, not a simulated AI demo. Agent progress must eventually come from real backend state. Never use `setTimeout()`, simulated milestones, or fake success messages to imply work that did not happen.

## Canonical repository
The canonical source of truth is:

```text
C:\Users\reddy\Downloads\klizonion-web
```

Do not treat duplicate or outer KLIZONION folders under Downloads as canonical. Do not create duplicate project folders or a second `context.md`.

## Current build
The current priority is rebuilding the KLIZONION Agent Builder website UI while preserving the working system beneath it. The canonical frontend is a vanilla HTML/CSS/ES-module application:

```text
apps/agent-web/index.html
apps/agent-web/styles.css
apps/agent-web/app.js
apps/agent-web/ui-enhancements.js
apps/agent-web/zip.js
```

The frontend currently contains:
- Public landing and authentication routes (`#home`, `#register`, `#login`, `#verify`, `#dashboard`)
- Registration with Turnstile, email verification, login, session validation, and logout
- Authenticated Builder workspace with Chat, Files, Activity, Preview, Terminal, Projects, and Settings areas
- Prompt-driven mission creation, effort selection, mission actions, runner status, activity logging, preview rendering, and model save/publish controls
- Runtime DOM IDs/classes and hidden compatibility elements used by existing JavaScript; preserve them when changing the UI

Execution path status: the Worker now rejects new actions when no authenticated runner is online, delivers actions through heartbeat, accepts authenticated structured results, and asks the configured agent planner for the next allowlisted actions. The frontend polls mission state and reports runner failures, timeouts, and verified completion honestly.

## Architecture

```text
User
  -> GitHub Pages frontend (apps/agent-web)
  -> authenticated Cloudflare Worker control plane
  -> supervised local runner / authorized workspace
  -> structured mission actions and real build/test results
```

Deployment:
- Frontend: GitHub Pages
- Custom domain: `klizonion.vexr.dev`
- Backend: Cloudflare Worker `klizonion-agent`
- Backend storage: Cloudflare D1, with Worker state and bindings configured in `apps/worker/`

The Worker owns authentication, verification, sessions, mission APIs, runner state, mission actions, and model save/publish endpoints. The browser must never receive runner secrets or unrestricted filesystem/shell access. The eventual agent should use structured, policy-checked tools and an explicitly authorized workspace boundary.

Architecture modules now include:
- `packages/core/tools.js`: shared structured-tool definitions and input validation
- `packages/core/evolution.js`: evaluator-driven isolated candidate lifecycle primitives
- `packages/core/roles.js`: least-privilege specialized role/tool contracts
- `packages/core/research.js`: provider-gated structured web research adapter
- `packages/core/requirements.js`: backend request classification and bounded requirement/evidence evaluation
- Worker mission evaluator and bounded continuation loop with structured event history
- `packages/agent/runner.py`: persistent authenticated runner with reconnect and safe shutdown

P1 status: conversational versus engineering classification now occurs in the Worker. Engineering missions persist bounded requirements, invoke the planner to select the first tool, continue after real runner results, and complete only when requirement evidence passes. The frontend submits unified requests and polls authoritative mission state; it does not choose the initial tool sequence.

P2 hardening status: runner commands now return structured build/test evidence with process-group timeout handling; unsupported preview/evaluation/experiment operations return explicit unavailable results; expired leases are recoverable on same-workspace reconnect; stale runner records are marked unavailable; wrong runner/workspace result callbacks are rejected; and deployment/migration prerequisites are documented in `docs/DEPLOYMENT.md`. Host-level process isolation still requires an external restricted account/container/VM in production.

Account integrity status: `0004_account_integrity.sql` adds durable account disablement and security-event auditing. The Worker conservatively locks accounts only after repeated authenticated ownership-boundary violations, revokes sessions, and never treats browser tamper signals or ordinary client errors as proof of abuse.

Preferred structured tool concepts:
- `workspace.list`
- `file.read`
- `file.write`
- `file.patch`
- `directory.create`
- `git.status`
- `git.diff`
- `git.log`
- `build.run`
- `test.run`
- `preview.start`
- `preview.status`
- `experiment.record`

Possible future concepts include `project.inspect`, `dependency.inspect`, `artifact.list`, `evaluation.run`, and controlled `train.status/start/stop` operations.

## Approved UI direction
Build a premium dark developer workspace:
- Deep navy/black foundation with subtle borders
- Blue and purple accents used with restraint
- Polished modern typography and strong hierarchy
- Futuristic but professional, spacious, responsive layout
- Distinctive geometric KLIZONION `K` mark that works as both wordmark companion and app icon
- No generic AI imagery

Authenticated dashboard direction:
- Top bar: KLIZONION logo/K mark, `AI BUILDER`, Agent Ready status, search, GitHub, New Project, account/avatar
- Left navigation: Chat, Projects, Files, Preview, Terminal, Deploy, Settings; Activity should remain a dedicated area for agent events
- Main Chat initial state: KLIZONION mark, “What do you want to build?”, supporting text, and suggestion cards for building a website, Roblox game, tool, improving existing code, learning, and custom requests
- Composer: large prompt input, attachment and web controls, model selector, send/build control, polished focus and hover states
- Human-readable agent states: Understanding request, Inspecting project, Planning changes, Implementing, Testing, Verifying, Ready
- Right-side or integrated workspace panels: Live Preview, Project Files, and Terminal; keep them useful without overwhelming the Chat view
- Footer: Ready to build, `KLIZONION v1.0.0`, All systems operational

Internal details such as mission IDs, tool calls, queue operations, and diagnostics belong in Activity/Technical Details, not the primary chat. Preview, Files, Activity, Terminal, Projects, Deploy, and Settings should remain proper dedicated areas.

## Engineering constraints
- Preserve working authentication, API endpoints, backend behavior, and required DOM contracts.
- Keep the UI shell separate from the agent execution system.
- Do not rewrite backend logic solely for visual changes.
- Do not invent functionality that the backend does not provide.
- Do not expose arbitrary shell execution or unrestricted filesystem access.
- Validate and contain every workspace path; use allowlists/policies for commands.
- Sandbox previews and untrusted execution where possible.
- Do not expose secrets, API keys, passwords, tokens, or mail-provider credentials in frontend code or this document.
- Keep files small and maintainable; avoid giant generated replacements and unrelated refactors.
- Do not clutter the normal Builder with training controls.
- Do not claim production readiness or real email delivery without configured bindings and end-to-end evidence.

## Backend and future direction
The Worker currently supports the authenticated Builder control plane and supervised runner communication. Safe operations must remain explicit. The frontend may request mission creation and structured actions, but real implementation, testing, observation, and verification must be reported from backend/runner state rather than fabricated in the browser.

The long-term system is:

```text
User request
  -> agent plan
  -> authorized inspection
  -> controlled edits
  -> build/test/debug loop
  -> observed preview or project result
  -> verified delivery
```

A separate Self-Trainer service may later orchestrate CPU/GPU resources, datasets, tokenizer/model configuration, checkpoints, metrics, evaluation, cancellation, and resource limits. The from-scratch KLIZONION model goal is a genuine decoder-only causal Transformer with its own tokenizer, weights, training, evaluation, and inference pipeline. A pretrained model used for the Builder agent is not the KLIZONION model itself.
