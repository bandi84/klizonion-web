const PATH_OPERATIONS = new Set(['file.read', 'file.write', 'file.patch', 'directory.create']);
const CONTENT_OPERATIONS = new Set(['file.write', 'file.patch']);

export const TOOL_DEFINITIONS = Object.freeze({
  'workspace.list': { input: {} },
  'file.read': { input: { path: 'workspace-relative string' } },
  'file.write': { input: { path: 'workspace-relative string', content: 'string' } },
  'file.patch': { input: { path: 'workspace-relative string', content: 'string' } },
  'directory.create': { input: { path: 'workspace-relative string' } },
  'git.status': { input: {} },
  'git.diff': { input: {} },
  'git.log': { input: {} },
  'build.run': { input: {} },
  'test.run': { input: {} },
  'preview.start': { input: {} },
  'preview.status': { input: {} },
  'evaluation.run': { input: {} },
  'experiment.record': { input: {} },
});

export const STRUCTURED_OPERATIONS = new Set(Object.keys(TOOL_DEFINITIONS));

export function isSafeWorkspacePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500) return false;
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/') && !normalized.includes('..') && !/^[a-zA-Z]:/.test(normalized);
}

export function validateToolRequest(action) {
  if (!action || typeof action !== 'object' || !STRUCTURED_OPERATIONS.has(action.operation)) {
    return { valid: false, error: 'Operation is not allowlisted.' };
  }
  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
  if (PATH_OPERATIONS.has(action.operation) && !isSafeWorkspacePath(payload.path)) {
    return { valid: false, error: 'A safe workspace-relative path is required.' };
  }
  if (CONTENT_OPERATIONS.has(action.operation)) {
    if (typeof payload.content !== 'string') return { valid: false, error: 'File content must be a string.' };
    if (payload.content.length > 2 * 1024 * 1024) return { valid: false, error: 'File content exceeds the structured write limit.' };
  }
  return { valid: true, operation: action.operation, payload };
}
