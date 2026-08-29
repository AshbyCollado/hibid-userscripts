import type { HiBidLotRecord } from '../core/types.js';

export const DEAL_LOT_STATE_PREFIX = 'flippahDealLotV1:';
export const DEAL_AUCTION_STATE_PREFIX = 'flippahDealAuctionV1:';

export interface StoredLotState {
  queryOverride: string;
  amazonOverrideAsin: string;
  resaleEstimate: number | null;
  confirmedQuantity: number | null;
  maxBid: number | null;
  updatedAt: number;
}

export type SavedResearchSource = 'flippah-lot-settings' | 'legacy-watchlist' | 'flippah-auction-settings';

export interface SavedLotResearchInput {
  queryOverride?: string;
  amazonAsinOverride?: string;
  unverifiedResaleEstimateUsd?: number;
  confirmedQuantity?: number;
  hardMaxBidUsd?: number;
  sources: Partial<Record<'queryOverride' | 'amazonAsinOverride' | 'unverifiedResaleEstimateUsd' | 'confirmedQuantity' | 'hardMaxBidUsd', SavedResearchSource>>;
}

export interface SavedAuctionResearchInput {
  buyerPremiumOverridePct: number;
  source: 'flippah-auction-settings';
}

export interface HibidSavedResearchSnapshot {
  schemaVersion: 1;
  lots: Record<string, SavedLotResearchInput>;
  auctions: Record<string, SavedAuctionResearchInput>;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finite(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= minimum && result <= maximum ? result : null;
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

export function lotStateKey(id: string): string {
  return `${DEAL_LOT_STATE_PREFIX}${id}`;
}

export function auctionStateKey(id: string): string {
  return `${DEAL_AUCTION_STATE_PREFIX}${id || 'unknown'}`;
}

export function normalizeStoredLotState(value: unknown): StoredLotState {
  const source = object(value) ? value : {};
  const asin = text(source.amazonOverrideAsin, 10).toUpperCase();
  const quantity = finite(source.confirmedQuantity, 1, 100_000);
  return {
    queryOverride: text(source.queryOverride, 180),
    amazonOverrideAsin: /^[A-Z0-9]{10}$/.test(asin) ? asin : '',
    resaleEstimate: finite(source.resaleEstimate, 0, 10_000_000),
    confirmedQuantity: quantity === null ? null : Math.round(quantity),
    maxBid: finite(source.maxBid, 0, 10_000_000),
    updatedAt: finite(source.updatedAt, 0) ?? 0,
  };
}

export function hibidSavedResearchStorageKeys(items: readonly Pick<HiBidLotRecord, 'id' | 'auctionId'>[]): string[] {
  const keys = new Set<string>(['watchlist']);
  for (const item of items) {
    if (item.id) keys.add(lotStateKey(item.id));
    if (item.auctionId) keys.add(auctionStateKey(item.auctionId));
  }
  return [...keys];
}

export function emptyHibidSavedResearchSnapshot(): HibidSavedResearchSnapshot {
  return { schemaVersion: 1, lots: {}, auctions: {} };
}

export function buildHibidSavedResearchSnapshot(
  items: readonly Pick<HiBidLotRecord, 'id' | 'auctionId'>[],
  storage: Record<string, unknown>,
): HibidSavedResearchSnapshot {
  const snapshot = emptyHibidSavedResearchSnapshot();
  const watchlist = object(storage.watchlist) ? storage.watchlist : {};

  for (const item of items) {
    const stored = normalizeStoredLotState(storage[lotStateKey(item.id)]);
    const watchedValue = watchlist[item.id];
    const watched: Record<string, unknown> = object(watchedValue) ? watchedValue : {};
    const watchResale = finite(watched.resaleCents, 0, 1_000_000_000);
    const watchMax = finite(watched.maxBidCents, 0, 1_000_000_000);
    const values: Omit<SavedLotResearchInput, 'sources'> = {};
    const sources: SavedLotResearchInput['sources'] = {};

    if (stored.queryOverride) {
      values.queryOverride = stored.queryOverride;
      sources.queryOverride = 'flippah-lot-settings';
    }
    if (stored.amazonOverrideAsin) {
      values.amazonAsinOverride = stored.amazonOverrideAsin;
      sources.amazonAsinOverride = 'flippah-lot-settings';
    }
    if (stored.confirmedQuantity !== null) {
      values.confirmedQuantity = stored.confirmedQuantity;
      sources.confirmedQuantity = 'flippah-lot-settings';
    }
    if (stored.resaleEstimate !== null) {
      values.unverifiedResaleEstimateUsd = stored.resaleEstimate;
      sources.unverifiedResaleEstimateUsd = 'flippah-lot-settings';
    } else if (watchResale !== null) {
      values.unverifiedResaleEstimateUsd = watchResale / 100;
      sources.unverifiedResaleEstimateUsd = 'legacy-watchlist';
    }
    if (stored.maxBid !== null) {
      values.hardMaxBidUsd = stored.maxBid;
      sources.hardMaxBidUsd = 'flippah-lot-settings';
    } else if (watchMax !== null) {
      values.hardMaxBidUsd = watchMax / 100;
      sources.hardMaxBidUsd = 'legacy-watchlist';
    }
    if (Object.keys(values).length) snapshot.lots[item.id] = { ...values, sources };
  }

  for (const auctionId of new Set(items.map((item) => item.auctionId).filter(Boolean))) {
    const source = storage[auctionStateKey(auctionId)];
    const premiumPct = finite(object(source) ? source.premiumPct : null, 0, 30);
    if (premiumPct !== null) {
      snapshot.auctions[auctionId] = { buyerPremiumOverridePct: premiumPct, source: 'flippah-auction-settings' };
    }
  }

  return snapshot;
}
