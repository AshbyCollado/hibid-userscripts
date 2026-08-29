import assert from 'node:assert/strict';
import test from 'node:test';
import type { HiBidLotRecord } from '../src/core/types.js';
import {
  auctionStateKey,
  buildHibidSavedResearchSnapshot,
  hibidSavedResearchStorageKeys,
  lotStateKey,
  normalizeStoredLotState,
} from '../src/intelligence/deal-storage.js';

const lots = [
  { id: '101', auctionId: '9001' },
  { id: '102', auctionId: '9001' },
] as HiBidLotRecord[];

test('saved research reads only current lot and auction keys plus the legacy watchlist', () => {
  assert.deepEqual(
    hibidSavedResearchStorageKeys(lots).sort(),
    ['watchlist', lotStateKey('101'), lotStateKey('102'), auctionStateKey('9001')].sort(),
  );
});

test('saved research preserves field provenance and excludes unrelated local storage', () => {
  const snapshot = buildHibidSavedResearchSnapshot(lots, {
    [lotStateKey('101')]: {
      queryOverride: 'GE Carescape B650 patient monitor', amazonOverrideAsin: 'b012345678',
      resaleEstimate: 800, confirmedQuantity: 2, maxBid: 125, updatedAt: 123,
    },
    [lotStateKey('102')]: { resaleEstimate: null, maxBid: null },
    [auctionStateKey('9001')]: { premiumPct: 17.5, updatedAt: 456 },
    watchlist: {
      101: { resaleCents: 1, maxBidCents: 2, note: 'private note must not escape' },
      102: { resaleCents: 33000, maxBidCents: 4500, note: 'another private note' },
      999: { resaleCents: 999999 },
    },
    flippahAuctionRelayTokenV1: 'secret-token-must-not-escape',
  });

  assert.deepEqual(snapshot.lots['101'], {
    queryOverride: 'GE Carescape B650 patient monitor', amazonAsinOverride: 'B012345678',
    confirmedQuantity: 2, unverifiedResaleEstimateUsd: 800, hardMaxBidUsd: 125,
    sources: {
      queryOverride: 'flippah-lot-settings', amazonAsinOverride: 'flippah-lot-settings',
      confirmedQuantity: 'flippah-lot-settings', unverifiedResaleEstimateUsd: 'flippah-lot-settings',
      hardMaxBidUsd: 'flippah-lot-settings',
    },
  });
  assert.deepEqual(snapshot.lots['102'], {
    unverifiedResaleEstimateUsd: 330, hardMaxBidUsd: 45,
    sources: { unverifiedResaleEstimateUsd: 'legacy-watchlist', hardMaxBidUsd: 'legacy-watchlist' },
  });
  assert.deepEqual(snapshot.auctions['9001'], {
    buyerPremiumOverridePct: 17.5, source: 'flippah-auction-settings',
  });
  assert.equal(snapshot.lots['999'], undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /private note|secret-token/);
});

test('stored null values stay null instead of becoming false zero-dollar inputs', () => {
  const normalized = normalizeStoredLotState({
    resaleEstimate: null, confirmedQuantity: null, maxBid: null, updatedAt: null,
  });
  assert.equal(normalized.resaleEstimate, null);
  assert.equal(normalized.confirmedQuantity, null);
  assert.equal(normalized.maxBid, null);
  assert.equal(normalized.updatedAt, 0);
});
