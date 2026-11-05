import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHibidExportPayload, buildHibidLlmBrief } from '../src/hibid/exports.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { resolveHiBidRoute, routeFingerprint } from '../src/core/route.js';
import type { HiBidLotRecord, PageContext, ScrapeJobSummary } from '../src/core/types.js';
import { buildHibidResearchBatchPacket } from '../src/testing/research-batch-packet.js';

const historyUrl = 'https://hibid.com/account/pastbids';
const activeUrl = 'https://hibid.com/account/watchlist';

function item(auctionId: string): HiBidLotRecord {
  return { auctionId, id: 'lot-1', eventItemId: 'lot-1', itemId: 'lot-1', lot: '1', title: 'Item', lead: 'Item',
    source: 'hibid-dom', pageKind: 'pastbids', url: 'https://hibid.com/lot/1/item', image: '', images: [],
    description: '', descriptionHtml: '', category: '', categories: [], currentBid: null, nextBid: null, bidCount: null,
    status: 'Closed', timeLeft: '', quantity: null, shippingOffered: false, auctionTitle: 'Auction', location: '',
    buyerPremium: '', rawText: '' };
}

function context(url: string): PageContext {
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  return { supported: true, url, title: 'History', route, fingerprint, visibleExpectedTotal: 1,
    noMatches: false, auctionGroups: [], job: null,
    analysis: { phase: 'idle', routeFingerprint: fingerprint, total: 0, analyzed: 0, retailMatched: 0,
      retailUnmatched: 0, amazonAnalyzed: 0, amazonMatched: 0, mixedLots: 0, quantityReview: 0, message: '', updatedAt: 0 } };
}

function job(page: PageContext, scopeId: string | null): ScrapeJobSummary {
  return { jobId: 'job-1', schemaVersion: 1, tabId: 1, sourceUrl: page.url, fingerprint: page.fingerprint,
    routeKind: page.route.kind, scopeId, phase: 'completed', revision: 1, expectedTotal: 1, enumeratedCount: 1,
    hydratedCount: 1, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2 };
}

test('history export carries selected-auction scope through brief and batch packet', () => {
  const page = context(historyUrl);
  const payload = buildHibidExportPayload(page, job(page, '787572'), [item('787572')], DEFAULT_SETTINGS);
  assert.deepEqual(payload.context.scope, { kind: 'selected-auction', auctionId: '787572' });
  assert.match(buildHibidLlmBrief(payload, DEFAULT_SETTINGS), /"scope":\s*\{\s*"kind":\s*"selected-auction"/);

  const packet = buildHibidResearchBatchPacket(payload, 1);
  assert.deepEqual(packet.data.masterContext.scope, payload.context.scope);
});

test('current-route export keeps current-route scope for public and active account pages', () => {
  for (const url of ['https://hibid.com/lots/40198/tools', activeUrl]) {
    const page = context(url);
    const payload = buildHibidExportPayload(page, job(page, null), [item('unrelated')], DEFAULT_SETTINGS);
    assert.deepEqual(payload.context.scope, { kind: 'current-route' });
  }
});

test('history export rejects invalid, unknown, and cross-auction rows', () => {
  const page = context(historyUrl);
  for (const scopeId of ['not-numeric', '']) {
    assert.throws(() => buildHibidExportPayload(page, job(page, scopeId), [item('787572')], DEFAULT_SETTINGS), /unverified export/);
  }
  assert.throws(() => buildHibidExportPayload(page, job(page, '787572'), [item('787573')], DEFAULT_SETTINGS), /unverified export/);
  assert.throws(() => buildHibidExportPayload(page, job(page, '787572'), [{ ...item('787572'), auctionId: undefined }], DEFAULT_SETTINGS), /unverified export/);
});
