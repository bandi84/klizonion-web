# Builder Protocol V0.2

The Cloudflare Worker is the control plane. A supervised local runner must be started with an authorized workspace and the `RUNNER_SHARED_SECRET` configured in its environment.

## Agent -> Runner operations

- `workspace.list`
- `file.read`
- `file.write`
- `git.status`
- `test.run`
- `train.start`
- `train.status`
- `checkpoint.list`
- `experiment.record`

## Runner lifecycle

1. The runner sends `POST /api/runner/heartbeat` with its hardware and workspace metadata.
2. The Worker returns authenticated pending actions and marks them `running`.
3. The runner executes only the allowlisted structured operation.
4. The runner sends `POST /api/runner/result` with `missionId`, `actionId`, `success`, and a structured `result` or `error`.
5. The Worker updates the action and mission. The frontend reads `GET /api/builder/missions/:missionId` and advances only from those results.

Actions are rejected with `runner_unavailable` when no recent authenticated heartbeat exists. They must not remain silently queued in that state.

Every operation must include an operation id and workspace-relative paths. The runner must reject path traversal, absolute paths outside the workspace, unapproved executables, and requests for secrets.

## Training lifecycle

`queued -> running -> checkpointed -> evaluating -> accepted|rejected -> next_experiment`
