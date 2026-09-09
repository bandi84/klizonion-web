# Builder Protocol V0.1

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

Every operation must include an operation id and workspace-relative paths. The runner must reject path traversal, absolute paths outside the workspace, unapproved executables, and requests for secrets.

## Training lifecycle

`queued -> running -> checkpointed -> evaluating -> accepted|rejected -> next_experiment`
