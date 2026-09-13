export function createResearchAdapter(provider) {
  if (!provider || typeof provider.search !== 'function' || typeof provider.open !== 'function' || typeof provider.extract !== 'function') {
    return null;
  }
  return provider;
}

export async function runResearch(adapter, query, { maxSources = 5 } = {}) {
  if (!adapter) throw new Error('Web research is unavailable because no approved research provider is configured.');
  if (typeof query !== 'string' || !query.trim()) throw new Error('A research query is required.');

  const results = await adapter.search(query.trim(), { limit: Math.min(Math.max(maxSources, 1), 10) });
  const sources = Array.isArray(results) ? results.slice(0, maxSources) : [];
  const extracted = [];
  for (const source of sources) {
    if (!source?.url) continue;
    const page = await adapter.open(source.url);
    const content = await adapter.extract(page);
    extracted.push({ url: source.url, title: source.title || '', content });
  }
  return { query: query.trim(), sources: extracted };
}
