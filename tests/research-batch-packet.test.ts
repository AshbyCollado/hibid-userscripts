import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHibidResearchBatchPacket, renderHibidResearchBatchPacket } from '../src/testing/research-batch-packet.js';

function payload() {
  const ids = Array.from({ length: 10 }, (_, index) => String(index + 1));
  const queue = ids.map((id) => ({ id, lot: id, mode: 'item', nonMerchandiseReason: null, query: id, querySource: 'generated', ebaySoldUrl: null, amazonSearchUrl: null, amazonProductUrl: null, sourceItemUrl: `https://hibid.com/lot/${id}` }));
  const items = ids.map((id) => ({ id, eventItemId: id, auctionId: 'auction-1', title: id }));
  const researchSession = { schemaVersion: 1, sourceUrl: 'https://hibid.com/catalog/1/x', routeFingerprint: 'fp', sourceIds: ids, merchandiseIds: ids, catalogDiscoveryIds: [], informationalExclusions: [], batches: [{ batchNumber: 1, sourceIds: ids.slice(0, 8) }, { batchNumber: 2, sourceIds: ids.slice(8) }], queryGroups: [] };
  return {
    context: { source: 'HiBid', sourceUrl: researchSession.sourceUrl, routeFingerprint: 'fp', complete: true, expectedCount: 10, copiedCount: 10 },
    researchSession, audit: { complete: true, expectedCount: 10, uniqueItemCount: 10, provenance: 'keep' }, items, researchQueue: queue,
    savedResearch: { schemaVersion: 1, lots: { '1': { queryOverride: 'first' }, '10': { queryOverride: 'tenth' } }, auctions: { 'auction-1': { buyerPremiumOverridePct: 15 }, unrelated: { buyerPremiumOverridePct: 10 } } },
  };
}

test('selects the exact batch and preserves full provenance without mutation', () => {
  const input = payload();
  const before = JSON.stringify(input);
  const packet = buildHibidResearchBatchPacket(input, 2);
  assert.deepEqual(packet.batchSourceIds, ['9', '10']);
  assert.deepEqual(packet.data.researchSession, input.researchSession);
  assert.deepEqual(packet.data.masterContext, input.context);
  assert.deepEqual(packet.data.masterAudit, input.audit);
  assert.deepEqual(packet.data.items.map((item) => item.eventItemId), ['9', '10']);
  assert.deepEqual(packet.data.researchQueue.map((row) => row.id), ['9', '10']);
  assert.deepEqual(Object.keys(packet.data.savedResearch.lots), ['10']);
  assert.deepEqual(Object.keys(packet.data.savedResearch.auctions), ['auction-1']);
  assert.equal(JSON.stringify(input), before);
});

test('rejects old exports, drift, duplicates, and invalid batches', () => {
  assert.throws(() => buildHibidResearchBatchPacket({ ...payload(), researchSession: undefined }, 1), /researchSession/);
  assert.throws(() => buildHibidResearchBatchPacket({ ...payload(), context: { ...payload().context, routeFingerprint: 'other' } }, 1), /fingerprints/);
  const duplicate = payload();
  duplicate.items[1]!.eventItemId = '1';
  duplicate.items[1]!.id = '1';
  assert.throws(() => buildHibidResearchBatchPacket(duplicate, 1), /duplicate/);
  const aliasDrift = payload();
  aliasDrift.items[0]!.id = 'other';
  assert.throws(() => buildHibidResearchBatchPacket(aliasDrift, 1), /alias conflicts/);
  const queueDrift = payload();
  queueDrift.researchQueue[0]!.id = 'other';
  assert.throws(() => buildHibidResearchBatchPacket(queueDrift, 1), /reconcile/);
  assert.throws(() => buildHibidResearchBatchPacket(payload(), 3), /does not exist/);
});

test('markdown makes partial status and evidence prohibitions explicit', () => {
  const markdown = renderHibidResearchBatchPacket(buildHibidResearchBatchPacket(payload(), 1));
  assert.match(markdown, /partial batch/);
  assert.match(markdown, /cannot conclude auction-wide completion/);
  assert.match(markdown, /active asking price/);
  assert.match(markdown, /physical photo descriptor/);
  assert.match(markdown, /masterAudit fields describe the complete source export, not this partial packet/);
  assert.match(markdown, /Do not stop after only the first source ID/);
  assert.match(markdown, /attemptSource must be exactly ebay-public-sold/);
  assert.match(markdown, /do not invent one/);
  assert.match(markdown, /not one timestamp reused across searches/);
  assert.match(markdown, /A clearly rendered primary exact zero remains executed\/empty\/0 even with a separate broader/);
  assert.doesNotMatch(markdown, /Zero exact results with broader fallback cards is a parse gap/);
  assert.match(markdown, /top-level photoReviews with one row per physicalPhotoDescriptors entry/);
  assert.match(markdown, /top-level photoAudit with numeric expectedPhysicalPhotoRows, opened, reviewed, and accessFailures/);
  assert.match(markdown, /multi-sale badge is a lead only/);
  assert.match(markdown, /actual physical seller photos to determine brand, model, generation, quantity, and included accessories before accepting Amazon or eBay evidence/);
  assert.match(markdown, /photo box conflicts with the seller title or UPC, retain the conflict and reject mismatched comps/);
  assert.match(markdown, /product art showing a tablet does not establish that a tablet is included/);
  assert.match(markdown, /raw action-log row with actionID, sourceID, requestURL, and the actual UTC openclock/);
  assert.match(markdown, /actual UTC observedclock, literal photo-specific visible fact or query-specific result evidence/);
  assert.match(markdown, /Keep the raw action log separate from the derived attemptLedger\/photoReviews/);
  assert.match(markdown, /downloaded or opened image that was not visually inspected remains pending/);
});

test('rendering removes duplicate renditions and terms without losing verified seller photos', () => {
  const input = payload();
  const descriptors = [1, 2].map((ordinal) => ({
    ordinal,
    descriptorId: `seller-photo-${ordinal}`,
    fullResolutionUrl: `https://hibid.com/photos/full-${ordinal}.jpg`,
    thumbnailUrl: `https://hibid.com/photos/thumb-${ordinal}.jpg`,
    hdThumbnailUrl: `https://hibid.com/photos/hd-${ordinal}.jpg`,
  }));
  for (const item of input.items.slice(0, 2)) {
    Object.assign(item, {
      auctionTerms: 'Buyer premium is 15 percent. '.repeat(50),
      images: descriptors.map((photo) => photo.thumbnailUrl),
      image: descriptors[0]!.thumbnailUrl,
      physicalPhotoDescriptors: descriptors,
      photoAudit: { verification: 'verified', reconciled: true, expectedCount: 2, observedCount: 2 },
    });
  }
  const packet = buildHibidResearchBatchPacket(input, 1);
  const before = JSON.stringify(packet);
  const markdown = renderHibidResearchBatchPacket(packet);
  const rendered = JSON.parse(markdown.split('## Packet Data\n\n```json\n')[1]!.split('\n```')[0]!) as {
    auctionContexts: Array<{ reference: string; auctionTerms: string }>;
    items: Array<Record<string, unknown>>;
  };
  assert.equal(rendered.auctionContexts.length, 1);
  assert.equal(rendered.auctionContexts[0]!.auctionTerms, 'Buyer premium is 15 percent. '.repeat(50));
  for (const item of rendered.items.slice(0, 2)) {
    assert.equal(item.auctionContextRef, rendered.auctionContexts[0]!.reference);
    assert.equal(item.auctionTerms, undefined);
    assert.equal(item.images, undefined);
    assert.equal(item.image, undefined);
    const photos = item.physicalPhotoDescriptors as typeof descriptors;
    assert.deepEqual(photos.map((photo) => photo.descriptorId), ['seller-photo-1', 'seller-photo-2']);
    assert.deepEqual(photos.map((photo) => photo.fullResolutionUrl), descriptors.map((photo) => photo.fullResolutionUrl));
    assert.ok(photos.every((photo) => photo.thumbnailUrl === undefined && photo.hdThumbnailUrl === undefined));
  }
  assert.equal(JSON.stringify(packet), before);
});

test('rendering keeps alternate image evidence when the physical photo set is unverified', () => {
  const input = payload();
  Object.assign(input.items[0]!, {
    image: 'https://hibid.com/photos/only-thumbnail.jpg',
    images: ['https://hibid.com/photos/only-thumbnail.jpg'],
    physicalPhotoDescriptors: [{ descriptorId: 'unverified-1', thumbnailUrl: 'https://hibid.com/photos/only-thumbnail.jpg' }],
    photoAudit: { verification: 'unverified', reconciled: false, expectedCount: 2, observedCount: 1 },
  });
  const markdown = renderHibidResearchBatchPacket(buildHibidResearchBatchPacket(input, 1));
  const rendered = JSON.parse(markdown.split('## Packet Data\n\n```json\n')[1]!.split('\n```')[0]!) as {
    items: Array<Record<string, unknown>>;
  };
  assert.equal(rendered.items[0]!.image, 'https://hibid.com/photos/only-thumbnail.jpg');
  assert.deepEqual(rendered.items[0]!.images, ['https://hibid.com/photos/only-thumbnail.jpg']);
  assert.deepEqual(rendered.items[0]!.physicalPhotoDescriptors, [
    { descriptorId: 'unverified-1', thumbnailUrl: 'https://hibid.com/photos/only-thumbnail.jpg' },
  ]);
});
