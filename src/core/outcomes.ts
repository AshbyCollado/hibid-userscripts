export const OUTCOME_STORAGE_PREFIX = 'flippahOutcomeV1:';

export type OutcomeChannel = 'ebay' | 'local' | 'marketplace' | 'other' | '';

export interface DealOutcome {
  lotId: string;
  lotNumber: string;
  title: string;
  url: string;
  auctionId: string;
  actualAllInCost: number | null;
  soldPrice: number | null;
  sellingCosts: number | null;
  predictedResale: number | null;
  channel: OutcomeChannel;
  soldAt: string;
  note: string;
  updatedAt: number;
}

export interface DealOutcomeResult {
  profit: number | null;
  predictionError: number | null;
}

function finite(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function outcomeStorageKey(lotId: string): string {
  return `${OUTCOME_STORAGE_PREFIX}${String(lotId).trim()}`;
}

export function normalizeDealOutcome(value: unknown): DealOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const lotId = text(source.lotId, 80);
  if (!lotId) return null;
  const channel = text(source.channel, 20);
  return {
    lotId,
    lotNumber: text(source.lotNumber, 80),
    title: text(source.title, 300),
    url: text(source.url, 1000),
    auctionId: text(source.auctionId, 80),
    actualAllInCost: finite(source.actualAllInCost),
    soldPrice: finite(source.soldPrice),
    sellingCosts: finite(source.sellingCosts),
    predictedResale: finite(source.predictedResale),
    channel: ['ebay', 'local', 'marketplace', 'other'].includes(channel) ? channel as OutcomeChannel : '',
    soldAt: /^\d{4}-\d{2}-\d{2}$/.test(text(source.soldAt, 10)) ? text(source.soldAt, 10) : '',
    note: text(source.note, 1000),
    updatedAt: finite(source.updatedAt) ?? 0,
  };
}

export function calculateDealOutcome(value: Pick<DealOutcome, 'actualAllInCost' | 'soldPrice' | 'sellingCosts' | 'predictedResale'>): DealOutcomeResult {
  const sellingCosts = value.sellingCosts ?? 0;
  return {
    profit: value.actualAllInCost === null || value.soldPrice === null
      ? null
      : value.soldPrice - value.actualAllInCost - sellingCosts,
    predictionError: value.soldPrice === null || value.predictedResale === null
      ? null
      : value.soldPrice - value.predictedResale,
  };
}

export function collectStoredOutcomes(storage: Record<string, unknown>): DealOutcome[] {
  return Object.entries(storage)
    .filter(([key]) => key.startsWith(OUTCOME_STORAGE_PREFIX))
    .flatMap(([, value]) => {
      const outcome = normalizeDealOutcome(value);
      return outcome ? [outcome] : [];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
