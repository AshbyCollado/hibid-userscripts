import type { PageContext, ScrapeJobSummary } from './types.js';

export function jobMatchesContextAndScope(
  job: ScrapeJobSummary | null,
  context: PageContext | null,
  selectedGroupId = ''
): boolean {
  if (!job || !context || job.fingerprint !== context.fingerprint) return false;
  const isPast = context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist';
  return isPast ? Boolean(selectedGroupId) && job.scopeId === selectedGroupId : job.scopeId === null;
}

export function chooseNewestJob(existing: ScrapeJobSummary | null, incoming: ScrapeJobSummary): ScrapeJobSummary {
  return existing && existing.revision > incoming.revision ? existing : incoming;
}
