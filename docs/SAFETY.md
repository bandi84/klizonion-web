# Builder Safety Model

The Builder is designed to be autonomous inside a controlled development environment, not unrestricted on the host machine.

1. Workspace root is fixed at runner startup.
2. Paths are workspace-relative.
3. Executables are allowlisted.
4. Secrets are never returned to the model.
5. Training jobs have explicit resource limits.
6. Checkpoints are created before automated code transformations.
7. Destructive operations require a separate approval capability.
