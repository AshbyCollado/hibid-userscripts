import type { PageContext, ScrapeJobSummary } from '../core/types.js';

export function currentViewRenderKey(
  tab: 'current' | 'watchlist',
  context: PageContext | null,
  selectedGroupId: string,
  jobPhase: ScrapeJobSummary['phase'] | null,
): string {
  return JSON.stringify({
    tab,
    supported: context?.supported ?? false,
    fingerprint: context?.fingerprint ?? null,
    url: context?.url ?? null,
    route: context?.route.kind ?? null,
    group: selectedGroupId,
    auctionGroups: context?.auctionGroups.map(({ id, title, location }) => [id, title, location]) ?? [],
    jobPhase,
    analysisPhase: context?.analysis.phase ?? null,
  });
}
