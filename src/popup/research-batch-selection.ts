export const RESEARCH_BATCH_SIZE = 8;

export interface ResearchBatchSelectionContext {
  routeFingerprint: string;
  selectedPastAuctionGroup: string;
}

export interface ResearchBatchSelection {
  key: string;
  batchCount: number;
  selectedBatch: number;
}

export function researchBatchCount(total: number): number {
  return Math.max(0, Math.ceil(Math.max(0, total) / RESEARCH_BATCH_SIZE));
}

export function clampResearchBatch(requestedBatch: number, total: number): number {
  const batchCount = researchBatchCount(total);
  if (batchCount === 0) return 0;
  return Math.min(batchCount, Math.max(1, Math.trunc(requestedBatch) || 1));
}

export function restoreResearchBatchSelection(storedValue: unknown, completedTotal: number | null): number {
  const storedNumber = Number(storedValue);
  const requested = Number.isFinite(storedNumber) ? Math.max(1, Math.trunc(storedNumber)) : 1;
  return completedTotal === null ? requested : clampResearchBatch(requested, completedTotal);
}

export function researchBatchScopeKey(fingerprint: string, selectedGroupId: string): string {
  return JSON.stringify(['flippah-research-batch', fingerprint, selectedGroupId]);
}

export function resolveResearchBatchSelection(
  context: ResearchBatchSelectionContext,
  total: number,
  requestedBatch: number,
  previous: ResearchBatchSelection | null = null,
): ResearchBatchSelection {
  const key = researchBatchScopeKey(context.routeFingerprint, context.selectedPastAuctionGroup);
  const batchCount = researchBatchCount(total);
  const selectedBatch = previous?.key === key
    ? clampResearchBatch(requestedBatch, total)
    : batchCount === 0 ? 0 : 1;

  return { key, batchCount, selectedBatch };
}
