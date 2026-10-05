import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { routeFingerprint, resolveHiBidRoute } from '../src/core/route.js';
import type { HiBidLotRecord, PageContext, ScrapeJobSummary } from '../src/core/types.js';
import { buildHibidExportPayload, buildHibidLlmBrief } from '../src/hibid/exports.js';
import { buildResearchCopyText } from '../src/popup/research-copy.js';
import type { AuctionNinjaExportPayload } from '../src/auctionninja/exports.js';

function payload(total: number) {
  const url = 'https://hibid.com/catalog/999999/copy-fixture';
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  const context: PageContext = {
    supported: true, url, title: 'Copy fixture', route, fingerprint,
    visibleExpectedTotal: total, noMatches: false, auctionGroups: [], job: null,
  };
  const job: ScrapeJobSummary = {
    jobId: 'copy-fixture', schemaVersion: 1, tabId: 1, sourceUrl: url, fingerprint,
    routeKind: 'catalog', scopeId: null, phase: 'completed', revision: 1,
    expectedTotal: total, enumeratedCount: total, hydratedCount: total,
    message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2,
  };
  const items: HiBidLotRecord[] = Array.from({ length: total }, (_, index) => {
    const id = String(317380519 + index);
    return {
      source: 'hibid-api', pageKind: 'catalog', id, eventItemId: id, itemId: String(index + 1),
      lot: String(index + 1), title: `Model ${index + 1}`, lead: `Model ${index + 1}`,
      url: `https://hibid.com/lot/${id}/model-${index + 1}`, image: `https://img.example/${id}.jpg`,
      images: [`https://img.example/${id}.jpg`], description: `Complete model ${index + 1}`,
      descriptionHtml: `<p>Complete model ${index + 1}</p>`, category: 'Electronics', categories: ['Electronics'],
      currentBid: 10, nextBid: 12, bidCount: 1, status: 'OPEN', timeLeft: '1h', quantity: 1,
      shippingOffered: true, auctionId: '999999', auctionTitle: 'Copy fixture',
      location: 'Scranton, PA', buyerPremium: '15%', rawText: 'OPEN',
    };
  });
  return buildHibidExportPayload(context, job, items, DEFAULT_SETTINGS);
}

test('popup Copy JSON always retains the entire auction regardless of selected AI batch', () => {
  const full = payload(10);
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'json', 2);
  const parsed = JSON.parse(copied.text) as typeof full;
  assert.equal(copied.batchNumber, 0);
  assert.equal(parsed.items.length, 10);
  assert.deepEqual(parsed.researchSession.sourceIds, full.researchSession.sourceIds);
});

test('small pages keep the existing AI brief', () => {
  const full = payload(8);
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 1);
  assert.equal(copied.batchNumber, 0);
  assert.equal(copied.text, buildHibidLlmBrief(full, DEFAULT_SETTINGS));
});

test('later AI batch includes only its source IDs while retaining full provenance', () => {
  const full = payload(10);
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 2);
  assert.equal(copied.batchNumber, 2);
  assert.equal(copied.batchCount, 2);
  assert.match(copied.text, /audit-only partial batch 2/);
  const data = JSON.parse(copied.text.split('## Packet Data\n\n```json\n')[1]!.split('\n```')[0]!) as {
    items: Array<{ eventItemId: string }>;
    researchSession: { sourceIds: string[] };
  };
  assert.deepEqual(data.items.map((item) => item.eventItemId), full.researchSession.sourceIds.slice(8));
  assert.deepEqual(data.researchSession.sourceIds, full.researchSession.sourceIds);
});

test('actual popup batch copy carries the component contract and preserves groupless component IDs for HiBid', () => {
  const full = payload(10);
  const component = full.researchQueue[0]!;
  Object.assign(component, { mode: 'component-review', query: '', querySource: 'component-review-required', ebaySoldUrl: null });
  full.researchSession.queryGroups = full.researchSession.queryGroups.filter((group) => !group.sourceIds.includes(component.id));
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 1);
  assert.equal(copied.batchCount, 2);
  assert.match(copied.text, /Component-review is still merchandise research/);
  assert.match(copied.text, /join its actual search attemptIds or explicit unresolved reason/);
  assert.match(copied.text, /original sold-evidence URL must be the observed eBay item URL/);
  const data = JSON.parse(copied.text.split('## Packet Data\n\n```json\n')[1]!.split('\n```')[0]!) as {
    researchQueue: Array<{ id: string; mode: string; query: string }>;
    researchSession: { sourceIds: string[]; queryGroups: Array<{ sourceIds: string[] }> };
  };
  assert.equal(data.researchQueue[0]!.id, full.researchSession.sourceIds[0]);
  assert.equal(data.researchQueue[0]!.mode, 'component-review');
  assert.equal(data.researchQueue[0]!.query, '');
  assert.equal(data.researchSession.queryGroups.some((group) => group.sourceIds.includes(data.researchQueue[0]!.id)), false);
});

test('actual popup batch copy carries the component contract for AuctionNinja and keeps the JSON contract immutable', () => {
  const ids = Array.from({ length: 10 }, (_, index) => String(index + 1));
  const sourceUrl = 'https://www.auctionninja.com/seller/sales/details/sale--17395.html';
  const full = {
    context: { source: 'AuctionNinja', pageKind: 'sale-catalog', sourceUrl, routeFingerprint: 'fp', complete: true, expectedCount: 10, copiedCount: 10, scopeId: '17395' },
    researchSession: { schemaVersion: 1, sourceUrl, routeFingerprint: 'fp', sourceIds: ids, merchandiseIds: ids, catalogDiscoveryIds: [], informationalExclusions: [], batches: [{ batchNumber: 1, sourceIds: ids.slice(0, 8) }, { batchNumber: 2, sourceIds: ids.slice(8) }], queryGroups: [] },
    audit: { complete: true, expectedCount: 10, uniqueItemCount: 10, stableIds: ids },
    items: ids.map((id) => ({ source: 'AuctionNinja', pageKind: 'sale-catalog', id, stableId: id, saleUrl: sourceUrl })),
    researchQueue: ids.map((id) => ({ id, mode: 'component-review', query: '', querySource: 'component-review-required' })),
    savedResearch: { schemaVersion: 1, lots: {}, auctions: {} },
  } as unknown as AuctionNinjaExportPayload;
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 2);
  assert.equal(copied.batchNumber, 2);
  assert.equal(copied.batchCount, 2);
  assert.match(copied.text, /Component-review is still merchandise research/);
  assert.match(copied.text, /Use the required attemptLedger, photoReviews, photoAudit and soldProof field names/);
  assert.match(copied.text, /Search observation and paid-comp verification are separate checkpoints/);
  for (const batchNumber of [1, 2]) {
    const text = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', batchNumber).text;
    assert.match(text, /including zero, even when separate broader cards appear/);
    assert.doesNotMatch(text, /If the page shows broader matching-fewer-words cards or no dependable exact count, use outcome: deferred/);
  }
  assert.match(copied.text, /Checkpoint each observation before navigating away/);
  assert.match(copied.text, /do not leave a whole batch's provenance only in volatile browser-controller variables/);
  assert.match(copied.text, /Never combine deferred with settled/);
  assert.match(copied.text, /These examples are not observed evidence and must never be copied as facts/);
  assert.match(copied.text, /photoAudit must be ONE aggregate object, never an array/);
  assert.match(copied.text, /a true empty long query does not waive this fallback/);
  assert.match(copied.text, /Separate stock\/promotional photos from actual-unit inspection evidence/);
  assert.match(copied.text, /a Sold search card may lead to an active multi-quantity listing/);
  const json = buildResearchCopyText(full, DEFAULT_SETTINGS, 'json', 2);
  assert.equal(json.batchNumber, 0);
  assert.equal((JSON.parse(json.text) as AuctionNinjaExportPayload).items.length, 10);
});

test('actual popup brief at the batch boundary keeps the shared component rules', () => {
  const full = payload(8);
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 1);
  assert.equal(copied.batchNumber, 0);
  assert.match(copied.text, /Component-review is still merchandise research/);
  assert.match(copied.text, /join its actual search attemptIds or explicit unresolved reason/);
  assert.match(copied.text, /original sold-evidence URL must be the observed eBay item URL/);
});

test('popup brief and batches separate observed Sold results from verified paid comps', () => {
  for (const total of [8, 10]) {
    const full = payload(total);
    const batchCount = total > 8 ? 2 : 1;
    for (let batchNumber = 1; batchNumber <= batchCount; batchNumber++) {
      const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', batchNumber);
      assert.match(copied.text, /Search observation and paid-comp verification are separate checkpoints/);
      assert.match(copied.text, /including zero, even when separate broader cards appear/);
      assert.doesNotMatch(copied.text, /Zero exact results with broader fallback cards is a parse gap/);
      assert.doesNotMatch(copied.text, /If the page shows broader matching-fewer-words cards or no dependable exact count, use outcome: deferred/);
      assert.match(copied.text, /Checkpoint each observation before navigating away/);
      assert.match(copied.text, /If control resets, resume from saved rows and explicitly defer missing records/);
      assert.match(copied.text, /Never combine deferred with settled/);
      assert.match(copied.text, /These examples are not observed evidence and must never be copied as facts/);
      assert.match(copied.text, /Report the fallback count from the actual attempt rows/);
      assert.match(copied.text, /photoAudit must be ONE aggregate object, never an array/);
      assert.match(copied.text, /a true empty long query does not waive this fallback/);
      assert.match(copied.text, /Separate stock\/promotional photos from actual-unit inspection evidence/);
      assert.match(copied.text, /Retain explicit missing-parts or damage notes/);
      assert.match(copied.text, /a Sold search card may lead to an active multi-quantity listing/);
      assert.match(copied.text, /An expanded original showing or Best Offer leaves the actual paid price unknown/);
    }
  }
});

test('AuctionNinja AI batch tolerates a genuinely unknown sale link', () => {
  const ids = Array.from({ length: 9 }, (_, index) => String(index + 1));
  const sourceUrl = 'https://www.auctionninja.com/seller/sales/details/sale--17395.html';
  const full = {
    context: { source: 'AuctionNinja', pageKind: 'sale-catalog', sourceUrl, routeFingerprint: 'fp', complete: true, expectedCount: 9, copiedCount: 9, scopeId: '17395' },
    researchSession: { schemaVersion: 1, sourceUrl, routeFingerprint: 'fp', sourceIds: ids, batches: [{ batchNumber: 1, sourceIds: ids.slice(0, 8) }, { batchNumber: 2, sourceIds: ids.slice(8) }] },
    audit: { complete: true, expectedCount: 9, uniqueItemCount: 9, stableIds: ids },
    items: ids.map((id) => ({ source: 'AuctionNinja', pageKind: 'sale-catalog', id, stableId: id, saleUrl: id === '1' ? '' : sourceUrl })),
    researchQueue: ids.map((id) => ({ id })),
    savedResearch: { schemaVersion: 1, lots: {}, auctions: {} },
  } as unknown as AuctionNinjaExportPayload;
  const copied = buildResearchCopyText(full, DEFAULT_SETTINGS, 'llm', 1);
  assert.equal(copied.batchNumber, 1);
  assert.match(copied.text, /audit-only partial batch 1/);
});
