import type { PageContext, ScrapeJobSummary } from './types.js';

export function jobMatchesContextAndScope(
  job: ScrapeJobSummary | null,
  context: PageContext | null,
  selectedGroupId = ''
): boolean {
  if (!job || !context || job.fingerprint !== context.fingerprint) return false;
  const isPast = context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist';
  if (isPast) return Boolean(selectedGroupId) && job.scopeId === selectedGroupId;
  if (job.scopeId !== null) return false;
  const pageTotal = context.visibleExpectedTotal;
  if (job.phase === 'completed' && pageTotal !== null && job.expectedTotal !== pageTotal) return false;
  return true;
}

export function chooseNewestJob(existing: ScrapeJobSummary | null, incoming: ScrapeJobSummary): ScrapeJobSummary {
  return existing && existing.revision > incoming.revision ? existing : incoming;
}
