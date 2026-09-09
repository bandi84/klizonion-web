# KLIZONION Builder

The single authoritative repository for the KLIZONION Builder beta.

## Product

**Describe it. Build it. See it live.**

KLIZONION Builder is intended to become a supervised AI engineering platform that can build websites, backend services, developer tools, Roblox projects, and AI/model projects inside an explicitly authorized workspace.

## Repository rule

This is the one Builder folder. Do not create additional copies of the repository on the C: drive for each milestone. Downloaded ZIPs are release/handoff artifacts only. Extract the repository once and continue working in that same folder.

## Current structure

```text
KLIZONION-BUILDER/
├── .github/
│   └── copilot-instructions.md
├── apps/
│   ├── agent-web/          # Builder product UI
│   └── worker/             # Cloudflare Worker control plane
├── packages/
│   ├── agent/              # Local supervised runner
│   └── core/               # Shared protocol docs
├── docs/                   # Roadmap + safety
├── context.md              # Durable project memory
├── .env.example
├── .gitignore
└── README.md
```

## Existing product separation

- Existing product repo: `klizonion-web`
- New engineering product: `KLIZONION-BUILDER`

Do not overwrite or merge these repositories accidentally.

## Current architecture

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

## Current runner scope

The current read-only proof of concept is intentionally limited to safe operations such as `workspace.list` and `git.status`.

Do not add unrestricted shell execution or unrestricted filesystem access.

## Next direction

The Builder website is now the main product surface, with a natural-language build experience and live-preview concept. Future milestones will add the agent execution loop, safe workspace editing, and a separate Self-Trainer service for CPU/GPU experiments.

See `context.md` for the full handoff memory and `.github/copilot-instructions.md` for Copilot-specific rules.
