# Supervised Agent Runner

The controlled runner is implemented in `packages/agent/runner.py`. It is a local process supervised by the user and connected to the Cloudflare Worker control plane.

## Start

Set the Worker URL and runner secret in the local environment, then provide an explicitly authorized workspace:

```powershell
$env:KLIZONION_WORKER_URL = "https://your-worker-url"
$env:RUNNER_SHARED_SECRET = "<configured-worker-secret>"
python packages/agent/runner.py --workspace "C:\path\to\authorized-workspace"
```

The secret is read from the environment and is never sent to the browser or printed by the runner.

## Persistent Windows startup

Install the runner once as a Scheduled Task. This does not copy the secret into the task script; the task reads the `RUNNER_SHARED_SECRET` User environment variable at logon:

```powershell
$env:RUNNER_SHARED_SECRET = "<configured-worker-secret>"
[Environment]::SetEnvironmentVariable("RUNNER_SHARED_SECRET", $env:RUNNER_SHARED_SECRET, "User")
.\scripts\install-runner-task.ps1 -Workspace "C:\path\to\authorized-workspace" -WorkerUrl "https://your-worker-url"
```

Remove it with:

```powershell
.\scripts\install-runner-task.ps1 -Workspace "C:\path\to\authorized-workspace" -WorkerUrl "https://your-worker-url" -Unregister
```

## Execution boundary

The runner heartbeats to `POST /api/runner/heartbeat`, receives explicitly queued actions, executes only structured allowlisted operations, and posts each result to `POST /api/runner/result`.

Supported operations include:

- `workspace.list`
- `file.read`
- `file.write`
- `file.patch`
- `directory.create`
- `git.status`
- `git.diff`
- `git.log`
- `build.run` (fixed `npm run build` invocation)
- `test.run`

All file paths must remain inside the authorized workspace. Commands are fixed allowlisted invocations; the browser and model cannot submit arbitrary shell commands.

Build and test commands are terminated as process groups after 300 seconds and their output is capped. This is not OS-level sandboxing: child processes still run with the runner user's host permissions. Use a restricted account and external container or VM isolation for untrusted projects.

`preview.start`, `preview.status`, `evaluation.run`, and `experiment.record` return explicit unavailable results until their providers are configured; they are not silently simulated.

The runner reports `READY`, `BUSY`, `RECONNECTING`, and `ERROR` lifecycle states. If the Worker or runner secret is unavailable, it retries after a connection error. The Worker rejects new actions with `runner_unavailable` instead of leaving a task silently waiting forever.
