export function createCandidate({ candidateId, parentId = null, generation = 0, strategy, workspace }) {
  if (!candidateId || !strategy || !workspace) throw new Error('candidateId, strategy, and isolated workspace are required');
  return {
    candidateId,
    parentId,
    generation,
    strategy,
    workspace,
    status: 'created',
    result: null,
    fitness: null,
    evaluation: null,
  };
}

export function recordEvaluation(candidate, evaluation) {
  if (!evaluation || typeof evaluation.score !== 'number' || typeof evaluation.passed !== 'boolean') {
    throw new Error('An evaluator result with score and passed is required');
  }
  return {
    ...candidate,
    status: evaluation.passed ? 'evaluated' : 'rejected',
    fitness: evaluation.score,
    evaluation,
  };
}

export function selectElite(candidates, populationSize = 2) {
  return [...candidates]
    .filter((candidate) => candidate.status === 'evaluated' && typeof candidate.fitness === 'number')
    .sort((left, right) => right.fitness - left.fitness)
    .slice(0, populationSize);
}

export function createMutation(parent, { candidateId, strategy, workspace }) {
  if (!parent || parent.status !== 'evaluated') throw new Error('Only evaluated candidates can be mutated');
  return createCandidate({
    candidateId,
    parentId: parent.candidateId,
    generation: parent.generation + 1,
    strategy,
    workspace,
  });
}

export function canPromote(candidate, { minimumScore = 1 } = {}) {
  return candidate?.status === 'evaluated'
    && Boolean(candidate.evaluation?.passed)
    && Number(candidate.fitness) >= minimumScore;
}
