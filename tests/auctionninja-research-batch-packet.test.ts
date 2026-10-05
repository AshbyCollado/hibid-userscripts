import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuctionNinjaResearchBatchPacket, renderAuctionNinjaResearchBatchPacket } from '../src/testing/auctionninja-research-batch-packet.js';

function payload() {
  const ids = Array.from({ length: 10 }, (_, index) => String(index + 1));
  const sourceUrl = 'https://www.auctionninja.com/seller/sales/details/sale--17395.html';
  const items = ids.map((id) => ({ source: 'AuctionNinja', pageKind: 'sale-catalog', id, stableId: id, saleUrl: sourceUrl, title: `Item ${id}` }));
  const researchSession = { schemaVersion: 1, sourceUrl, routeFingerprint: 'fp-sale-17395', sourceIds: ids, merchandiseIds: ids, catalogDiscoveryIds: [], informationalExclusions: [], batches: [{ batchNumber: 1, sourceIds: ids.slice(0, 8) }, { batchNumber: 2, sourceIds: ids.slice(8) }], queryGroups: [] };
  return { context: { source: 'AuctionNinja', pageKind: 'sale-catalog', sourceUrl, routeFingerprint: 'fp-sale-17395', complete: true, expectedCount: 10, copiedCount: 10, scopeId: '17395' }, researchSession, audit: { complete: true, expectedCount: 10, uniqueItemCount: 10, stableIds: ids }, items, researchQueue: ids.map((id) => ({ id, lot: id, mode: 'item', query: `query ${id}` })), savedResearch: { schemaVersion: 1, lots: { '1': { queryOverride: 'first' }, '10': { queryOverride: 'tenth' } }, auctions: { '17395': { buyerPremiumOverridePct: 15 }, unrelated: { buyerPremiumOverridePct: 10 } } } };
}

test('selects exact batch, keeps immutable context, and scopes saved research', () => {
  const input = payload();
  const before = JSON.stringify(input);
  const packet = buildAuctionNinjaResearchBatchPacket(input, 2);
  assert.deepEqual(packet.batchSourceIds, ['9', '10']);
  assert.deepEqual(packet.data.researchSession, input.researchSession);
  assert.deepEqual(packet.data.items.map((item) => item.stableId), ['9', '10']);
  assert.deepEqual(packet.data.researchQueue.map((row) => row.id), ['9', '10']);
  assert.deepEqual(Object.keys(packet.data.savedResearch.lots), ['10']);
  assert.deepEqual(Object.keys(packet.data.savedResearch.auctions), ['17395']);
  assert.equal(JSON.stringify(input), before);
});

test('fails closed for duplicate, drifted, wrong-count, malformed, and invalid batches', () => {
  assert.throws(() => buildAuctionNinjaResearchBatchPacket({ ...payload(), researchSession: undefined }, 1), /researchSession/);
  assert.throws(() => buildAuctionNinjaResearchBatchPacket({ ...payload(), context: { ...payload().context, routeFingerprint: 'other' } }, 1), /fingerprints/);
  const duplicate = payload(); duplicate.items[1]!.stableId = '1'; duplicate.items[1]!.id = '1';
  assert.throws(() => buildAuctionNinjaResearchBatchPacket(duplicate, 1), /duplicate/);
  const queueDrift = payload(); queueDrift.researchQueue[0]!.id = 'other';
  assert.throws(() => buildAuctionNinjaResearchBatchPacket(queueDrift, 1), /reconcile/);
  assert.throws(() => buildAuctionNinjaResearchBatchPacket({ ...payload(), context: { ...payload().context, expectedCount: 9 } }, 1), /counts/);
  const oversized = payload(); oversized.researchSession.batches[0]!.sourceIds.push('9');
  assert.throws(() => buildAuctionNinjaResearchBatchPacket(oversized, 1), /8-ID/);
  const crossAuction = payload(); crossAuction.items[0]!.saleUrl = 'https://www.auctionninja.com/seller/sales/details/other--99999.html';
  assert.throws(() => buildAuctionNinjaResearchBatchPacket(crossAuction, 1), /scope/);
  assert.throws(() => buildAuctionNinjaResearchBatchPacket(payload(), 3), /does not exist/);
});

test('renders concise evidence-first partial status without auction completion claim', () => {
  const markdown = renderAuctionNinjaResearchBatchPacket(buildAuctionNinjaResearchBatchPacket(payload(), 1));
  assert.match(markdown, /partial batch/);
  assert.match(markdown, /cannot conclude auction-wide completion/);
  assert.match(markdown, /Complete one source ID at a time/);
  assert.match(markdown, /Do not use accessFailure for a photo you never attempted to open/);
  assert.match(markdown, /A clearly rendered primary exact zero remains executed\/empty\/0 even with a separate broader/);
  assert.match(markdown, /Only an actually unavailable, uncertain, conflicting or loading primary count is deferred with null count/);
  assert.doesNotMatch(markdown, /If the page shows broader matching-fewer-words cards or no dependable exact count, use outcome: deferred/);
  assert.match(markdown, /attemptLedger is for eBay Sold searches only/);
  assert.match(markdown, /Copy queryGroupId from researchSession\.queryGroups/);
  assert.match(markdown, /outcomes executed, blocked-after-attempt, deferred, unattempted/);
  assert.match(markdown, /parse-gap, loading, or error status with deferred and observedResultCount: null/);
  assert.match(markdown, /raw action-log row with actionID, sourceID, requestURL, and the actual UTC openclock/);
  assert.match(markdown, /actual UTC observedclock, literal photo-specific visible fact or query-specific result evidence/);
  assert.match(markdown, /Keep the raw action log separate from the derived attemptLedger\/photoReviews/);
  assert.match(markdown, /downloaded or opened image that was not visually inspected remains pending/);
  assert.doesNotMatch(markdown, /Broader fallback cards with zero exact matches are a parse gap/);
  assert.match(markdown, /accessBlockedReason and accessObservation with the specific visible challenge/);
  assert.match(markdown, /eBay search error:/);
  assert.match(markdown, /never manufacture execution timing/);
  assert.match(markdown, /photoReviews \(plural\) as one JSON array/);
  assert.match(markdown, /Search Observation Record/);
  assert.match(markdown, /try one shorter Sold\+Completed query that preserves the photographed identity/);
  assert.match(markdown, /Record both attempts with their own URLs and times under the same source ID and queryGroupId/);
  assert.match(markdown, /A tab ID, "page visible," or a generated link is not evidence/);
  assert.match(markdown, /ordinal equal to that descriptor's sellerOrdinal/);
  assert.match(markdown, /Image dimensions or load status alone are not a visible product fact/);
  assert.match(markdown, /photoAudit with numeric expectedPhysicalPhotoRows, opened, reviewed, and accessFailures/);
  assert.match(markdown, /different attemptId for every navigation, including a challenge followed by a retry/);
  assert.match(markdown, /URL key is exactly fullResolutionUrl, copied byte-for-byte/);
  assert.match(markdown, /Do not fill unvisited photos with null times/);
  assert.match(markdown, /original eBay item URL key is url; it must match itemId/);
  assert.match(markdown, /physical seller photos to check brand, model, generation, quantity, and accessories/);
  assert.match(markdown, /photo conflicts with seller title or UPC, retain the conflict and reject mismatched comps/);
  assert.match(markdown, /Best Offer accepted banner or struck-through display price does not reveal the accepted offer/);
  assert.match(markdown, /open the expanded original eBay listing via See original listing/);
  assert.match(markdown, /originalListingObservation with its exact itemUrl and itemId, observedAt/);
  assert.match(markdown, /Do not infer these fields from a Sold search card or invent an observation/);
  assert.match(markdown, /Seller Hub Product Research Sold row independently proves totalSold=1 and the actual paid amount/);
  assert.match(markdown, /transactionQuantity: 1, and totalSold: 1/);
  assert.match(markdown, /sellerHubPaidProof must contain the same itemId/);
  assert.match(markdown, /Immutable Packet Data/);
});

test('unknown AuctionNinja sale links remain exportable without inventing a sale scope', () => {
  const input = payload();
  input.items[0]!.saleUrl = '';
  const packet = buildAuctionNinjaResearchBatchPacket(input, 1);
  assert.equal(packet.data.items[0]!.saleUrl, '');
  assert.deepEqual(Object.keys(packet.data.savedResearch.auctions), ['17395']);
});
