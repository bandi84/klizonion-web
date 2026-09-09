# KLIZONION BUILDER — PROJECT CONTEXT / HANDOFF MEMORY

## 1. PURPOSE

KLIZONION Builder is a separate engineering-agent product from the existing `klizonion-web` product.

The Builder's long-term goal is to let a user describe something they want built, then have an AI engineering agent plan, implement, test, debug, and iterate on the project inside an explicitly authorized local workspace, with a live preview where applicable.

The product message is:

> Describe it. Build it. See it live.

The Builder can eventually build many categories of software, including websites, backend services, developer tools, Roblox projects, and AI/model projects.

A major long-term capability is the ability to build a genuine Klizonion model/training system from scratch. The Builder is the engineering machine; the model itself is a separate product/runtime.

## 2. IMPORTANT PROJECT SEPARATION

There are two related but separate repositories/products:

1. Existing product: `klizonion-web`
2. New engineering product: `KLIZONION-BUILDER`

Do not confuse them, merge them, or overwrite the existing product accidentally.

The existing `klizonion-web` product and its backend history are useful reference context only.

## 3. USER WORKFLOW PREFERENCES

- Prefer direct, practical instructions.
- For code changes involving 1–3 files, discuss the change and provide complete updated files when practical.
- Do NOT make the user manually replace one line at a time.
- For larger changes, use a controlled Copilot Agent task, ideally around 4–5 files at a time.
- Do not ask the user to perform repetitive precision edits.
- For large multi-file changes, a downloadable ZIP is preferred when practical.
- Never invent paths. Use paths actually present in the repository/context.
- Do not rewrite unrelated working code.
- Do not create huge numbers of redundant folders/files.
- Keep one authoritative repository structure, one roadmap, and one project context file.

## 4. COPILOT WORKFLOW

Copilot is a worker, not the sole architect.

The intended workflow is:

1. ChatGPT/user decides architecture and scope.
2. Copilot implements a narrowly defined milestone.
3. Copilot runs relevant tests.
4. User sends the implementation report/diff back for review.
5. ChatGPT reviews and decides the next task.
6. Repeat.

Credit discipline is important. Do not use large Agent runs when a small change can be implemented directly.

When an Agent prompt is used:
- Explicitly name the intended files when known.
- Explicitly state what is out of scope.
- Require tests.
- Require a final changed-files summary.
- Require the agent to stop at the requested milestone.

## 5. CURRENT BUILDER ARCHITECTURE

Current V0.1 consists of:

```text
Builder Web UI
      │
      ▼
Cloudflare Worker Control Plane
      ▲
      │ authenticated runner channel
      ▼
Local Supervised Runner
      │
      ▼
Authorized Workspace
```

The current implementation has:
- Vanilla HTML/CSS/JS Builder web UI
- Cloudflare Worker control plane
- Python local supervised runner
- Shared protocol documentation
- Runner authentication using `RUNNER_SHARED_SECRET`
- Runner heartbeat/state tracking
- Safe read-only operations
- Unit/integration tests

The existing V0.1 bridge milestone is considered successful based on the implementation report:
- Worker authentication tests passed
- Runner tests passed
- End-to-end heartbeat/job communication tests passed
- Workspace boundary checks exist
- The browser does not receive the runner secret

## 6. CURRENT READ-ONLY RUNNER OPERATIONS

Current safe operations are intentionally limited to:

- `workspace.list`
- `git.status`

The runner also has an allowlist concept for:
- `git status`
- `git diff`
- `git log`
- `python -m pytest`

Do not expose arbitrary shell execution to the browser.

Do not add unrestricted filesystem access.

Do not remove path-boundary validation.

## 7. NEXT BUILDER DIRECTION

The Builder website must become the actual product interface rather than a technical runner dashboard.

The intended UX is:

```text
User describes what they want
          ↓
Builder Agent plans
          ↓
Builder Agent edits authorized workspace
          ↓
Build / test / debug loop
          ↓
Live preview or project result
```

The Builder website should emphasize:
- Build anything
- Natural-language project description
- Live preview
- Project/workspace state
- Agent activity
- Clear progress
- Studio/Roblox integration when applicable
- Model-building capability as an available future mode

Avoid exposing unnecessary infrastructure plumbing such as raw Worker URLs, database status, internal bindings, or implementation-specific backend details in the normal product UI.

A small `BETA · V0.1` marker should be visible while the Builder beta is being developed.

Visual direction:
- very dark coal/black interface
- polished AI/developer product feel
- minimal, modern, simple
- avoid blue-gray enterprise dashboard styling

## 8. LIVE PREVIEW CONCEPT

The Builder should eventually support a live preview surface.

For web projects, this can be an iframe/sandboxed preview or another isolated preview mechanism.

The preview should update as the agent builds.

The preview must not silently execute arbitrary untrusted code outside the intended sandbox.

For non-web projects, show an appropriate project state/log/result view instead of pretending a live browser preview exists.

## 9. FUTURE AGENT LOOP

The target autonomous engineering loop is:

```text
PLAN
 ↓
INSPECT
 ↓
READ
 ↓
EDIT
 ↓
RUN
 ↓
TEST
 ↓
OBSERVE
 ↓
FIX
 ↓
EVALUATE
 ↓
REPEAT
```

The agent should have structured tools, not unrestricted shell access.

Future operation concepts include:
- `workspace.list`
- `file.read`
- `file.write`
- `file.patch`
- `directory.create`
- `git.status`
- `test.run`
- `build.run`
- `preview.start`
- `preview.status`
- `experiment.record`

Every filesystem operation must be checked against the authorized workspace root.

Every command must be validated against an explicit allowlist or policy.

## 10. SELF-TRAINER SERVER

A separate Self-Trainer service should eventually be added rather than embedding training directly into the Builder runner.

Target architecture:

```text
Builder Agent
      ↓
train.start
      ↓
Self-Trainer Server
      ↓
CPU / GPU
      ↓
training metrics + checkpoint
      ↓
Builder Agent
      ↓
next experiment
```

The Self-Trainer should eventually:
- detect available CPU/GPU resources
- select an appropriate backend
- prepare datasets/tokenizer/model config
- launch training jobs
- checkpoint periodically
- report metrics
- recover from interruptions when safe
- evaluate checkpoints
- record experiments

It must have explicit resource controls and must not be allowed to consume the host indefinitely without limits.

Examples of resource controls:
- CPU utilization cap
- RAM cap
- GPU/VRAM awareness
- checkpoint interval
- maximum run duration
- cancellation support

## 11. FROM-SCRATCH MODEL GOAL

The user does not want a disguised wrapper around a pretrained model to be called the actual Klizonion model.

Long-term target:
- genuine decoder-only causal Transformer
- own tokenizer
- own weights
- actual training
- checkpoint/evaluation pipeline

A pretrained model may be used for the Builder agent itself if useful. That does not make it the Klizonion model.

Never claim a tiny experimental checkpoint is equivalent to a frontier model.

## 12. EMAIL VERIFICATION REQUIREMENT

Registration must use a separate verification step.

Required flow:

1. User enters username, email, password, and password confirmation.
2. User clicks Create account.
3. Backend creates a pending verification session/account state and sends a verification email.
4. Browser navigates to a new registration URL shaped like:
   `https://klizonion.vexr.dev/register?verification=<secure-verification-session-id>`
5. The verification page shows the code-entry UI only when the `verification` query parameter is present.
6. The email contains a unique **16-digit numeric verification code**.
7. The code is single-use.
8. The code expires after approximately 10 minutes.
9. Correct verification activates the account and signs the user in or redirects to the dashboard according to the final auth design.

### Verification-code security requirements

- The code must contain exactly 16 decimal digits (`0-9`).
- Generate it using a cryptographically secure random source, not `Math.random()` or equivalent non-cryptographic randomness.
- Treat uniqueness as uniqueness within the active verification session/account. Do not claim mathematical global uniqueness.
- Store only a secure hash of the code where practical, not the plaintext code.
- Store an expiration timestamp.
- Mark the code/session as used after successful verification.
- Reject expired codes.
- Reject reused codes.
- Rate-limit verification attempts.
- Rate-limit resend requests.
- Do not log the plaintext verification code.
- Do not expose the code to browser JavaScript except through the email itself.
- Prevent email enumeration where practical.
- Never place secrets or mail-provider credentials in frontend code.

### Email delivery

Actual email delivery requires a configured provider/binding. The existing project history mentioned Cloudflare Email Service via an `EMAIL` binding as one possible implementation path.

Do not claim real email delivery works until a real provider/binding is configured and end-to-end tested.

## 13. AUTHENTICATION HISTORY FROM THE EXISTING KLIZONION PRODUCT

The older `klizonion-web` implementation had these intended auth endpoints:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/verify`

Historical storage concepts included:
- D1 users table
- password hashing with PBKDF2-SHA-256
- sessions with token hashes

Use the existing product as reference, but do not blindly copy historical schema assumptions into Builder.

## 14. EXISTING KLIZONION PRODUCT REFERENCE

Existing public product repository:
- GitHub repo: `klizonion-web`
- Website: `https://klizonion.vexr.dev`

Historical backend:
- Cloudflare Worker product backend
- D1 database
- Roblox Studio bridge

These details belong to the older product and should not be silently treated as Builder infrastructure.

## 15. ROBLOX / STUDIO DIRECTION

The existing Klizonion product has a Roblox Studio bridge concept.

Historical plugin capabilities included operations such as:
- `create_part`
- `create_folder`
- `create_script`
- `edit_script`
- `delete_instance`
- `get_instance`
- `get_children`
- recursive tree inspection (`get_tree` concept)

The Builder may eventually use the Studio bridge as one authorized build target.

Never display private/internal backend URLs in the Studio plugin UI.

Plugin commands must be authenticated and explicitly authorized.

## 16. SECURITY PRINCIPLES

- Never expose `RUNNER_SHARED_SECRET` or other server secrets to frontend code.
- Never trust browser-supplied filesystem paths without normalization and containment checks.
- Never allow arbitrary shell execution by default.
- Never trust generated code merely because an AI generated it.
- Sandbox previews and code execution where possible.
- Keep worker state persistence separate from routing logic.
- Cloudflare Worker in-memory state is not a reliable production persistence layer. Durable Objects/KV/D1 or another durable store may be required.
- Do not force-push Git history.
- Do not claim production readiness without end-to-end evidence.

## 17. REPOSITORY ORGANIZATION

Prefer a single clean repository structure:

```text
KLIZONION-BUILDER/
├── .github/
│   └── copilot-instructions.md
├── apps/
│   ├── web/
│   └── worker/
├── services/
│   ├── agent/
│   └── trainer/
├── packages/
│   ├── protocol/
│   └── config/
├── docs/
├── tests/
├── context.md
├── README.md
└── .env.example
```

Do not create duplicate versions of the same project in nested folders.

## 18. CURRENT PRIORITY ORDER

1. Rework Builder website into the actual AI Builder product UX.
2. Establish a clear Builder-to-runner/worker communication model.
3. Add safe authorized workspace editing.
4. Add structured agent execution loop.
5. Add live preview infrastructure.
6. Add real email verification/auth flow where needed.
7. Add Self-Trainer service.
8. Add CPU/GPU training orchestration.
9. Build/operate the from-scratch Klizonion model pipeline.
10. Improve Roblox Studio integration and broader agent tooling.

## 19. DO NOT DO THESE THINGS

- Do not build 12 trillion downloadable folders.
- Do not rewrite the whole repository for every feature.
- Do not spend Copilot credits on work that can be reasoned through or implemented directly.
- Do not implement a huge self-training system before the Builder can reliably communicate with its services.
- Do not pretend an API wrapper is the from-scratch Klizonion model.
- Do not expose internal infrastructure details as product UI.
- Do not use line-by-line manual editing instructions when a complete file can be provided.

## 20. DEFINITION OF SUCCESS

The long-term system should feel like this:

```text
User:
"Build me a website / Roblox system / AI model / tool."

        ↓

KLIZONION BUILDER
        ↓

plans the work
        ↓

uses authorized tools
        ↓

writes and tests the project
        ↓

shows live progress / preview
        ↓

fixes failures
        ↓

iterates
        ↓

delivers a working project
```

The Builder is an autonomous engineering system with supervision and explicit permission boundaries, not an unrestricted computer-control bot.
