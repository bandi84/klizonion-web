const ENGINEERING_PATTERNS = [
  /\b(build|create|make|implement|develop|write|edit|modify|fix|debug|refactor|test|run|deploy)\b/i,
  /\b(file|folder|workspace|project|repository|repo|codebase|website|web app|roblox|api|backend|frontend)\b/i,
];

const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|good morning|good afternoon)\b/i,
  /^(what is|what's|who is|why is|how does|explain|define)\b/i,
];

export function classifyRequest(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return 'conversational';
  if (CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(text))
    && !/\b(build|create|write|edit|fix|modify|test)\b/i.test(text)) {
    return 'conversational';
  }
  return ENGINEERING_PATTERNS.some((pattern) => pattern.test(text)) ? 'engineering' : 'conversational';
}

export function extractRequirements(prompt) {
  const text = String(prompt || '').trim();
  const requirements = [];
  const add = (id, description, type = 'semantic') => requirements.push({ id, description, type, status: 'pending' });

  if (/\bindex\.html\b/i.test(text)) add('file:index.html', 'index.html exists', 'file');
  if (/\b(button|buttons)\b/i.test(text)) add('content:button', 'A requested button exists in project content', 'content');
  if (/\b(build|compile|bundle)\b/i.test(text)) add('build:success', 'The project build succeeds', 'build');
  if (/\b(test|tests|testing)\b/i.test(text)) add('test:success', 'The requested tests pass', 'test');
  if (/\bdark\b/i.test(text)) add('style:dark', 'The project uses a dark visual theme', 'content');
  for (const section of ['hero', 'projects', 'contact form', 'navigation', 'login', 'api']) {
    if (new RegExp(`\\b${section}\\b`, 'i').test(text)) add(`content:${section.replace(/\s+/g, '-')}`, `The project includes ${section}`, 'content');
  }
  if (!requirements.length) add('task:completion', 'The requested engineering work is completed and verified', 'semantic');
  return requirements.slice(0, 20);
}

export function evaluateRequirements(requirements, actions) {
  const successful = actions.filter((action) => action.status === 'success');
  const evidenceText = successful
    .map((action) => JSON.stringify(action.result || {}))
    .join('\n')
    .toLowerCase();
  const results = requirements.map((requirement) => {
    let passed = false;
    if (requirement.type === 'file') passed = successful.some((action) => {
      const result = action.result || {};
      return result.path === 'index.html' || result.path === requirement.description.split(' ')[0];
    });
    if (requirement.type === 'content') passed = evidenceText.includes(requirement.description.split(' ').at(-1).toLowerCase())
      || (requirement.id === 'content:button' && evidenceText.includes('<button'))
      || (requirement.id === 'style:dark' && /dark|#0|black/.test(evidenceText));
    if (requirement.type === 'build') passed = successful.some((action) => action.operation === 'build.run' && Number(action.result?.returncode) === 0);
    if (requirement.type === 'test') passed = successful.some((action) => action.operation === 'test.run' && Number(action.result?.returncode) === 0);
    if (requirement.type === 'semantic') passed = successful.length > 0;
    return { ...requirement, status: passed ? 'passed' : 'pending', evidence: successful.map((action) => action.actionId) };
  });
  const passed = results.every((requirement) => requirement.status === 'passed');
  return {
    score: results.length ? results.filter((requirement) => requirement.status === 'passed').length / results.length : 0,
    passed,
    failures: results.filter((requirement) => requirement.status !== 'passed'),
    requirements: results,
    observations: successful.map((action) => ({ operation: action.operation, result: action.result || null })),
  };
}
