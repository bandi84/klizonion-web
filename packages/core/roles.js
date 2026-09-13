export const AGENT_ROLES = Object.freeze({
  RESEARCHER: ['web.search', 'web.open', 'web.extract'],
  PLANNER: ['workspace.list', 'file.read', 'git.status'],
  CODER: ['file.read', 'file.write', 'file.patch', 'directory.create'],
  TESTER: ['build.run', 'test.run', 'preview.status'],
  REVIEWER: ['git.diff', 'evaluation.run'],
  EVALUATOR: ['evaluation.run', 'test.run', 'preview.status'],
});

export function toolsForRole(role) {
  return AGENT_ROLES[role] ? [...AGENT_ROLES[role]] : [];
}

export function roleCanUseTool(role, operation) {
  return toolsForRole(role).includes(operation);
}
