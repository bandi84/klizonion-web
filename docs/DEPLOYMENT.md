# KLIZONION P2 Deployment

## Deployment order

1. Deploy the Worker code and migration files together.
2. Apply D1 migrations to the production database.
3. Configure Worker variables and secrets.
4. Start a supervised runner for an explicitly authorized workspace.
5. Verify runner health through `/api/builder/status`.
6. Publish the GitHub Pages frontend.

## D1 migrations

The canonical Worker configuration uses the `DB` binding and migrations directory in `apps/worker/wrangler.toml`.

Review migrations locally:

```powershell
npx wrangler d1 migrations list model-backend --remote
```

Apply pending migrations only after deployment authorization:

```powershell
npx wrangler d1 migrations apply model-backend --remote
```

P2 requires migrations `0001_secure_vault.sql`, `0002_agent_execution.sql`, `0003_agent_requirements.sql`, and `0004_account_integrity.sql`. Do not run production migration commands without explicit approval. Do not edit production tables manually or use destructive reset commands.

## Account integrity and tamper handling

The server, not the browser, decides whether an integrity violation occurred. Modified frontend files, browser extensions, DevTools, blocked scripts, and malformed client telemetry are not treated as proof of tampering and do not trigger bans.

The Worker audits high-confidence ownership-boundary violations. Repeated authenticated attempts to access another account's mission resource are permanently disabled after the configured threshold, with all sessions revoked. The account lock and security event are stored in D1. This is intentionally conservative to avoid false-positive permanent bans.

## Worker configuration

Required non-secret variables are in `apps/worker/wrangler.toml`:

- `ENVIRONMENT`
- `BUILDER_PROTOCOL_VERSION`
- `TURNSTILE_SITEKEY`
- `FRONTEND_ORIGIN`
- `VERIFICATION_FROM`

Required secret names only:

- `TURNSTILE_SECRET`
- `EMAIL_API_KEY`
- `RUNNER_SHARED_SECRET`

Set secrets with Wrangler; never place values in this repository or frontend code.

## Runner startup

The runner reads `KLIZONION_WORKER_URL`, `RUNNER_SHARED_SECRET`, and optionally `KLIZONION_RUNNER_ID` from its environment:

```powershell
$env:KLIZONION_WORKER_URL = "https://your-worker-url"
$env:RUNNER_SHARED_SECRET = "<configured-secret>"
python packages/agent/runner.py --workspace "C:\path\to\authorized-workspace"
```

For persistent Windows startup, use `scripts/install-runner-task.ps1`. The task uses the user environment variable for the secret and can be removed with `-Unregister`.

## Health checks

The runner must report an authenticated heartbeat before actions are queued. Check:

```text
GET /api/builder/status
```

A healthy response reports `runner: true`, a runner lifecycle state, runner identity, workspace identity, and workspace path. Mission state is read through the authenticated mission endpoint.

## Rollback considerations

- Do not roll back Worker code while leaving incompatible D1 migrations applied.
- Roll back application code only to a version that understands the existing execution tables and statuses.
- Preserve mission/action/event rows during rollback.
- Stop or drain runners before changing action protocol fields.
- Re-run the real temporary-workspace E2E test after rollback or protocol changes.

## Process isolation limitation

The runner uses fixed allowlisted commands and process-group termination, but it is not a container or OS sandbox. Project-controlled `npm run build` and `python -m pytest` still execute with the runner user's host permissions. Production deployments must run the runner under a restricted OS account and preferably inside an external container or VM boundary before treating untrusted projects as safe.
