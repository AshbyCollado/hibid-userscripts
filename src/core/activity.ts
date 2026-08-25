export type ToolbarActivityKind = 'analysis' | 'scrape';

export interface ToolbarActivityUpdate {
  kind: ToolbarActivityKind;
  active: boolean;
  phase: string;
  message: string;
  current: number | null;
  total: number | null;
}

export interface ToolbarActivityPresentation {
  badgeText: string;
  badgeColor: string;
  title: string;
}

export type ToolbarActivityState = Partial<Record<ToolbarActivityKind, ToolbarActivityUpdate>>;

export function isToolbarActivityUpdate(value: unknown): value is ToolbarActivityUpdate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ToolbarActivityUpdate>;
  return (item.kind === 'analysis' || item.kind === 'scrape')
    && typeof item.active === 'boolean'
    && typeof item.phase === 'string'
    && typeof item.message === 'string'
    && (item.current === null || Number.isFinite(item.current))
    && (item.total === null || Number.isFinite(item.total));
}

export function isAnalysisActivityPhase(phase: string): boolean {
  return phase === 'scanning' || phase === 'retail';
}

export function isScrapeActivityPhase(phase: string): boolean {
  return ['queued', 'enumerating', 'hydrating', 'validating', 'stopping'].includes(phase);
}

export function toolbarActivityPresentation(state: ToolbarActivityState, endingSoonCount = 0): ToolbarActivityPresentation {
  const activity = state.scrape?.active ? state.scrape : (state.analysis?.active ? state.analysis : null);
  if (activity) {
    const progress = activity.total !== null && activity.total > 0
      ? ` (${Math.max(0, activity.current || 0)}/${activity.total})`
      : '';
    const action = activity.kind === 'scrape' ? 'scraping' : 'researching prices';
    return {
      badgeText: '↻',
      badgeColor: activity.kind === 'scrape' ? '#2563eb' : '#159447',
      title: `Flippah is ${action}${progress}: ${activity.message || activity.phase}`,
    };
  }
  if (endingSoonCount > 0) {
    return {
      badgeText: String(endingSoonCount).slice(0, 4),
      badgeColor: '#b64032',
      title: `Open Flippah by ALOS · ${endingSoonCount} watched lot${endingSoonCount === 1 ? '' : 's'} ending within one hour`,
    };
  }
  return { badgeText: '', badgeColor: '#159447', title: 'Open Flippah by ALOS' };
}
