import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';
import type { ScrapeJobSummary } from '../src/core/types.js';
import { buildAuctionNinjaExportPayload, buildAuctionNinjaLlmBrief } from '../src/auctionninja/exports.js';
import { auctionNinjaRouteFingerprint, resolveAuctionNinjaPage } from '../src/auctionninja/route.js';
import type { AuctionNinjaLotRecord } from '../src/auctionninja/types.js';

const url = 'https://www.auctionninja.com/testseller/sales/details/summer-sale--17395.html?an=opaque-secret';
const route = resolveAuctionNinjaPage(url);
const fingerprint = auctionNinjaRouteFingerprint(route, url);

function lot(id = '1001'): AuctionNinjaLotRecord {
  return {
    source: 'AuctionNinja', pageKind: 'sale-catalog', id, stableId: id, lot: '6',
    title: 'SteelSeries Arctis Nova 7', url: `https://www.auctionninja.com/testseller/product/headset--${id}.html?an=opaque-secret`,
    image: 'https://www.auctionninja.com/Pictures/headset-front.jpg?an=opaque-secret',
    images: ['https://www.auctionninja.com/Pictures/headset-front.jpg?an=opaque-secret', 'https://www.auctionninja.com/Pictures/headset-back.jpg'],
    description: 'Condition: New - Factory Sealed\nEmail owner@example.invalid for pickup.',
    descriptionHtml: '<p>Condition: New - Factory Sealed</p>',
    descriptionFields: { condition: 'New - Factory Sealed', packaging: 'Yes', assemblyRequired: '', damaged: '', functional: 'Yes', missingParts: 'No', shelfLocation: '' },
    category: 'Electronics', saleTitle: 'Summer Sale', saleUrl: url, seller: 'Test Seller', sellerUrl: 'https://www.auctionninja.com/testseller',
    location: 'Carteret, NJ', shippingText: 'Shipping Available', pickupText: 'Pickup available', highBid: '$5.00', highBidAmount: 5,
    currentBid: 5, currentPrice: 5, bidCount: '2 Bids', bidCountNumber: 2, timeLeft: '1 day', timeText: '1 day', status: 'OPEN', watched: false,
    detailEnriched: true, detailSource: 'same-origin-product-document', rawText: 'Current Bid: $5.00', extractionAudit: {
      sourceUrl: url, cardSelector: '.search-catalog-item-box', fieldsPresent: ['lot', 'title', 'url', 'description', 'image'], missingFields: []
    }
  };
}

function job(overrides: Partial<ScrapeJobSummary> = {}): ScrapeJobSummary {
  return {
    jobId: 'job-1', schemaVersion: 1, tabId: 1, sourceUrl: url, fingerprint, routeKind: 'catalog', scopeId: '17395', phase: 'completed', revision: 3,
    expectedTotal: 1, enumeratedCount: 1, hydratedCount: 1, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2, ...overrides
  };
}

function context() {
  return { source: 'AuctionNinja' as const, pageKind: 'sale-catalog' as const, url, title: 'Summer Sale', fingerprint, expectedTotal: 1, scopeId: '17395' };
}

test('builds a complete AuctionNinja payload with queue links, provenance, fidelity, and full media', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS, {
    schemaVersion: 1,
    lots: { '1001': { queryOverride: 'SteelSeries Nova 7', hardMaxBidUsd: 40, sources: { queryOverride: 'flippah-lot-settings', hardMaxBidUsd: 'legacy-watchlist' } } },
    auctions: { '17395': { buyerPremiumOverridePct: 15, source: 'flippah-auction-settings' } }
  });
  assert.equal(payload.context.source, 'AuctionNinja');
  assert.equal(payload.context.complete, true);
  assert.equal(payload.context.expectedCount, 1);
  assert.equal(payload.audit.uniqueItemCount, 1);
  assert.equal(payload.audit.fidelity.metrics.description.percent, 100);
  assert.equal(payload.audit.fidelity.metrics.images.percent, 100);
  assert.ok('images' in payload.items[0]!);
  assert.deepEqual(payload.items[0]!.images, [
    'https://www.auctionninja.com/Pictures/headset-front.jpg',
    'https://www.auctionninja.com/Pictures/headset-back.jpg'
  ]);
  assert.equal(payload.researchQueue[0]!.querySource, 'saved-lot-override');
  assert.match(payload.researchQueue[0]!.ebaySoldUrl || '', /LH_Sold=1/);
  assert.deepEqual(payload.researchQueue[0]!.savedResearchProvenance, ['hardMaxBidUsd:legacy-watchlist', 'queryOverride:flippah-lot-settings']);
  assert.equal(payload.savedResearch.auctions['17395']!.source, 'flippah-auction-settings');
});

test('LLM export states the evidence, mixed-lot, workbook, provenance, and no-mutation contracts', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const brief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  for (const phrase of ['AuctionNinja', 'researchQueue', 'direct, visible eBay sold-listing URL', 'mandatory component review', 'profit_if_won_now', 'Sort decision sheets', 'savedResearch.lots', 'Do not bid', 'DATA BOUNDARY']) {
    assert.match(brief, new RegExp(phrase, 'i'));
  }
  assert.doesNotMatch(brief, /opaque-secret|owner@example\.invalid/i);
});

test('AuctionNinja Copy for AI honors the home-lab electronics profile', () => {
  const settings = normalizeSettings({
    aiAnalysisMode: 'home-lab-electronics',
    customInstructions: 'Prefer managed switches with quiet fans and current firmware.',
  });
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], settings);
  const brief = buildAuctionNinjaLlmBrief(payload, settings);
  assert.match(brief, /^# Flippah Home Lab and Personal Electronics Analysis/);
  assert.match(brief, /verified AuctionNinja records/);
  assert.match(brief, /managed switches with quiet fans and current firmware/);
  assert.match(brief, /direct, visible, completed eBay Sold evidence/i);
  assert.doesNotMatch(brief, /Act as an auction resale research coordinator/);
});

test('refuses incomplete, drifted, mismatched, duplicate, and out-of-scope exports', () => {
  const cases: Array<[string, Partial<ScrapeJobSummary>, ReturnType<typeof context>, AuctionNinjaLotRecord[]]> = [
    ['phase', { phase: 'hydrating' }, context(), [lot()]],
    ['fingerprint', { fingerprint: 'different' }, context(), [lot()]],
    ['count', { expectedTotal: 2 }, context(), [lot()]],
    ['scope', { scopeId: '99999' }, context(), [lot()]],
    ['duplicate stable id', {}, context(), [lot(), lot()]],
  ];
  for (const [name, jobPatch, page, items] of cases) {
    assert.throws(() => buildAuctionNinjaExportPayload(page, job(jobPatch), items, DEFAULT_SETTINGS), /unverified export/, name);
  }
  assert.throws(() => buildAuctionNinjaExportPayload({ ...context(), source: 'HiBid' as never }, job(), [lot()], DEFAULT_SETTINGS), /unverified export/);
});

test('sanitizes account PII, tokens, and opaque an query values at the export boundary', () => {
  const accountLot = { ...lot(), pageKind: 'followed-items' as const, bidderAlias: 'private-alias', email: 'private@example.invalid', authToken: 'token-value', phone: '201-555-0144' } as AuctionNinjaLotRecord;
  const accountUrl = 'https://www.auctionninja.com/followed-items?an=opaque-secret';
  const accountFingerprint = auctionNinjaRouteFingerprint(resolveAuctionNinjaPage(accountUrl), accountUrl);
  const accountContext = { ...context(), pageKind: 'followed-items' as const, url: accountUrl, fingerprint: accountFingerprint, scopeId: null, expectedTotal: 1 };
  const accountJob = job({ sourceUrl: accountUrl, fingerprint: accountFingerprint, scopeId: null });
  const payload = buildAuctionNinjaExportPayload(accountContext, accountJob, [accountLot], DEFAULT_SETTINGS);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /private-alias|private@example\.invalid|token-value|201-555-0144|opaque-secret/i);
  assert.match(serialized, /SteelSeries Arctis Nova 7/);
  assert.match(payload.items[0]!.url, /headset--1001\.html$/);
});

test('requires component review for mixed lots while keeping research queue links available for normal lots', () => {
  const mixed = { ...lot(), title: 'Assorted electronics bundle', description: 'Mixed components: receiver; headphones' };
  const payload = buildAuctionNinjaExportPayload(context(), job(), [mixed], DEFAULT_SETTINGS);
  assert.equal(payload.researchQueue[0]!.mode, 'component-review');
  assert.equal(payload.researchQueue[0]!.query, '');
  assert.deepEqual(payload.researchQueue[0]!.components, ['Assorted electronics bundle']);
});
