import assert from 'node:assert/strict';
import test from 'node:test';
import type { HiBidTransport } from '../src/core/types.js';
import { resolveHiBidRoute } from '../src/core/route.js';
import { HIBID_LOT_DETAILS_OPERATION, hydrateHibidLotDetail } from '../src/hibid/api.js';
import { buildHibidLotDetailsVariables, HIBID_LOT_DETAILS_QUERY, HIBID_LOT_SEARCH_QUERY, normalizeHibidLot } from '../src/hibid/api.js';

const route = resolveHiBidRoute('https://hibid.com/lot/317135307/example');
const context = { route, sourceUrl: 'https://hibid.com/lot/317135307/example' };

function photo(index: number, url = `https://images.example/${index}.jpg`) {
  return { description: `Seller photo ${index}`, fullSizeLocation: url, hdThumbnailLocation: `${url}?size=hd`, thumbnailLocation: `${url}?size=thumb`, width: 1200, height: 900 };
}

function record(lot: Record<string, unknown>) {
  return normalizeHibidLot({ eventItemId: 317135307, lotNumber: '1', ...lot }, context)!;
}

test('reconciles a single physical photo', () => {
  const value = record({ pictureCount: 1, pictures: [photo(1)] });
  assert.deepEqual(value.photoAudit, { expectedCount: 1, observedCount: 1, reconciled: true, verification: 'verified' });
  assert.equal(value.physicalPhotoDescriptors.length, 1);
  assert.equal(value.physicalPhotoDescriptors[0].sellerOrdinal, 1);
});

test('description-only featured placeholders do not invent photos for zero-photo notices', () => {
  const value = record({ pictureCount: 0, pictures: [], featuredPicture: { description: 'Pickup instructions', fullSizeLocation: null, thumbnailLocation: null, hdThumbnailLocation: null, width: 0, height: 0 } });
  assert.deepEqual(value.physicalPhotoDescriptors, []);
  assert.deepEqual(value.photoAudit, { expectedCount: 0, observedCount: 0, reconciled: true, verification: 'verified' });
});

test('unusable featured placeholders cannot fill a missing reported physical photo', () => {
  const value = record({ pictureCount: 1, pictures: [], featuredPicture: { description: 'Lot title' } });
  assert.deepEqual(value.physicalPhotoDescriptors, []);
  assert.equal(value.photoAudit.verification, 'mismatch');
  assert.equal(value.photoAudit.observedCount, 0);
});

test('explicit picture-list entries remain evidence even if their URLs are missing', () => {
  const value = record({ pictureCount: 1, pictures: [{ description: 'Photo unavailable' }] });
  assert.equal(value.physicalPhotoDescriptors.length, 1);
  assert.equal(value.photoAudit.verification, 'unverified');
  assert.equal(value.photoAudit.reconciled, false);
});

test('preserves distinct query photo IDs and case-sensitive paths', () => {
  for (const urls of [
    ['https://cdn.hibid.com/img.axd?id=first&w=400', 'https://cdn.hibid.com/img.axd?id=second&w=200'],
    ['https://images.example/Case.jpg', 'https://images.example/case.jpg'],
    ['https://images.example/photo?key=first', 'https://images.example/photo?key=second'],
  ]) {
    const value = record({ pictureCount: 2, featuredPicture: photo(1, urls[0]), pictures: [photo(2, urls[1])] });
    assert.equal(value.physicalPhotoDescriptors.length, 2);
    assert.equal(value.photoAudit.reconciled, true);
  }
});

test('recognizes same query photo ID across thumbnail sizes', () => {
  const value = record({
    pictureCount: 1,
    featuredPicture: photo(1, 'https://cdn.hibid.com/img.axd?id=123&w=400&h=400'),
    pictures: [photo(1, 'https://cdn.hibid.com/img.axd?id=123&w=200&h=200')],
  });
  assert.equal(value.physicalPhotoDescriptors.length, 1);
  assert.equal(value.photoAudit.reconciled, true);
});

test('retains a featured full-size URL when matching seller slots only have thumbnails', () => {
  const value = record({
    pictureCount: 2,
    featuredPicture: { id: 'photo-1', fullSizeLocation: 'https://cdn.hibid.com/img.axd?id=1', width: 1200, height: 900 },
    pictures: [
      { id: 'photo-1', thumbnailLocation: 'https://cdn.hibid.com/img.axd?id=1&w=200', description: 'First slot' },
      { id: 'photo-1', thumbnailLocation: 'https://cdn.hibid.com/img.axd?id=1&w=200', description: 'Repeated seller slot' },
    ],
  });
  assert.equal(value.physicalPhotoDescriptors.length, 2);
  assert.equal(value.photoAudit.reconciled, true);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.fullResolutionUrl), [
    'https://cdn.hibid.com/img.axd?id=1', 'https://cdn.hibid.com/img.axd?id=1',
  ]);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.description), ['First slot', 'Repeated seller slot']);
});

test('reconciles a list over fifteen photos without an arbitrary cap', () => {
  const value = record({ pictureCount: 61, pictures: Array.from({ length: 61 }, (_, index) => photo(index + 1)) });
  assert.equal(value.photoAudit.reconciled, true);
  assert.equal(value.physicalPhotoDescriptors.length, 61);
  assert.equal(value.physicalPhotoDescriptors.at(-1)?.sellerOrdinal, 61);
});

test('retains repeated seller URLs as separate descriptors', () => {
  const repeated = photo(1, 'https://images.example/repeated.jpg');
  const value = record({ pictureCount: 2, pictures: [repeated, { ...repeated, description: 'Second seller descriptor' }] });
  assert.equal(value.physicalPhotoDescriptors.length, 2);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.fullResolutionUrl), ['https://images.example/repeated.jpg', 'https://images.example/repeated.jpg']);
});

test('does not count featuredPicture twice when pictures are authoritative', () => {
  const value = record({ pictureCount: 2, featuredPicture: photo(1), pictures: [photo(1), photo(2)] });
  assert.equal(value.photoAudit.observedCount, 2);
  assert.equal(value.physicalPhotoDescriptors.length, 2);
});

test('adds a distinct featured picture only when it fills the authoritative count', () => {
  const value = record({ pictureCount: 2, featuredPicture: photo(1), pictures: [photo(2)] });
  assert.equal(value.photoAudit.reconciled, true);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.sellerOrdinal), [1, 2]);
});

test('does not invent a missing picture when featured repeats a listed picture', () => {
  const value = record({ pictureCount: 2, featuredPicture: photo(1), pictures: [photo(1)] });
  assert.deepEqual(value.photoAudit, { expectedCount: 2, observedCount: 1, reconciled: false, verification: 'mismatch' });
  assert.equal(value.physicalPhotoDescriptors[0].sellerOrdinal, null);
});

test('reports a short authoritative list as a mismatch', () => {
  const value = record({ pictureCount: 3, pictures: [photo(1), photo(2)] });
  assert.equal(value.photoAudit.expectedCount, 3);
  assert.equal(value.photoAudit.observedCount, 2);
  assert.equal(value.photoAudit.reconciled, false);
  assert.equal(value.photoAudit.verification, 'mismatch');
});

test('reports an overlong authoritative list as a mismatch', () => {
  const value = record({ pictureCount: 1, pictures: [photo(1), photo(2)] });
  assert.equal(value.photoAudit.verification, 'mismatch');
  assert.equal(value.physicalPhotoDescriptors.length, 2);
});

test('marks a missing pictureCount as unverified', () => {
  const value = record({ pictures: [photo(1), photo(2)] });
  assert.deepEqual(value.photoAudit, { expectedCount: null, observedCount: 2, reconciled: false, verification: 'unverified' });
});

test('marks a missing picture list as unverified even when featured exists', () => {
  const value = record({ featuredPicture: photo(1) });
  assert.equal(value.photoAudit.verification, 'unverified');
  assert.equal(value.physicalPhotoDescriptors[0].sellerOrdinal, null);
});

test('preserves legacy images while exposing sanitized descriptor URLs', () => {
  const value = record({ pictureCount: 1, pictures: [{ ...photo(1), fullSizeLocation: ' http://images.example/full.jpg ', hdThumbnailLocation: 'not a url' }] });
  assert.deepEqual(value.images, ['http://images.example/full.jpg', 'not a url', 'https://images.example/1.jpg?size=thumb']);
  assert.equal(value.physicalPhotoDescriptors[0].fullResolutionUrl, null);
  assert.equal(value.physicalPhotoDescriptors[0].hdThumbnailUrl, null);
});

test('uses the full-size source for fullResolutionUrl without substituting thumbnails', () => {
  const value = record({ pictureCount: 1, pictures: [{ hdThumbnailLocation: 'https://images.example/hd.jpg', thumbnailLocation: 'https://images.example/thumb.jpg' }] });
  assert.equal(value.physicalPhotoDescriptors[0].fullResolutionUrl, null);
  assert.equal(value.physicalPhotoDescriptors[0].hdThumbnailUrl, 'https://images.example/hd.jpg');
  assert.equal(value.physicalPhotoDescriptors[0].thumbnailUrl, 'https://images.example/thumb.jpg');
});

test('normalizes whitespace in descriptions and URLs', () => {
  const value = record({ pictureCount: 1, pictures: [{ description: '  Seller   photo  ', fullSizeLocation: 'https://images.example/full.jpg ' }] });
  assert.equal(value.physicalPhotoDescriptors[0].description, 'Seller photo');
  assert.equal(value.physicalPhotoDescriptors[0].fullResolutionUrl, 'https://images.example/full.jpg');
});

test('rejects non-finite and non-integer picture counts as unverified', () => {
  for (const pictureCount of ['unknown', 1.5, Number.NaN]) {
    const value = record({ pictureCount, pictures: [photo(1)] });
    assert.equal(value.photoAudit.verification, 'unverified');
    assert.equal(value.photoAudit.expectedCount, null);
  }
});

test('supports an authoritative zero-photo response without descriptors', () => {
  const value = record({ pictureCount: 0, pictures: [] });
  assert.deepEqual(value.photoAudit, { expectedCount: 0, observedCount: 0, reconciled: true, verification: 'verified' });
  assert.deepEqual(value.physicalPhotoDescriptors, []);
});

test('does not assign ordinals to an unverified featured-only descriptor', () => {
  const value = record({ featuredPicture: photo(1), pictures: [] });
  assert.equal(value.physicalPhotoDescriptors[0].sellerOrdinal, null);
});

test('keeps descriptor order and contiguous ordinals after featured reconciliation', () => {
  const value = record({ pictureCount: 3, featuredPicture: photo(0), pictures: [photo(1), photo(2)] });
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.description), ['Seller photo 0', 'Seller photo 1', 'Seller photo 2']);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.sellerOrdinal), [1, 2, 3]);
});

test('preserves a distinct featured descriptor when the known list is still short', () => {
  const value = record({ pictureCount: 4, featuredPicture: photo(0), pictures: [photo(1), photo(2)] });
  assert.equal(value.physicalPhotoDescriptors.length, 3);
  assert.equal(value.photoAudit.observedCount, 3);
  assert.equal(value.photoAudit.verification, 'mismatch');
});

test('preserves a distinct featured descriptor without pictureCount', () => {
  const value = record({ featuredPicture: photo(0), pictures: [photo(1)] });
  assert.equal(value.physicalPhotoDescriptors.length, 2);
  assert.equal(value.photoAudit.verification, 'unverified');
});

test('uses provider photo identity when featured and listed renditions have different URLs', () => {
  const value = record({
    pictureCount: 1,
    featuredPicture: { id: 'photo-1', fullSizeLocation: 'https://images.example/photo-1/full.jpg' },
    pictures: [{ id: 'photo-1', fullSizeLocation: 'https://images.example/photo-1/thumb.jpg' }],
  });
  assert.equal(value.physicalPhotoDescriptors.length, 1);
  assert.equal(value.photoAudit.reconciled, true);
});

test('retains duplicate seller entries while matching only featured identity', () => {
  const value = record({
    pictureCount: 3,
    featuredPicture: { id: 'featured', fullSizeLocation: 'https://images.example/featured.jpg' },
    pictures: [
      { id: 'seller-1', fullSizeLocation: 'https://images.example/a.jpg' },
      { id: 'seller-1', fullSizeLocation: 'https://images.example/a.jpg' },
    ],
  });
  assert.equal(value.physicalPhotoDescriptors.length, 3);
  assert.deepEqual(value.physicalPhotoDescriptors.map((item) => item.fullResolutionUrl), [
    'https://images.example/featured.jpg',
    'https://images.example/a.jpg',
    'https://images.example/a.jpg',
  ]);
});

test('keeps extra known evidence and reports more-than-expected mismatch', () => {
  const value = record({ pictureCount: 1, featuredPicture: photo(0), pictures: [photo(1), photo(2)] });
  assert.equal(value.physicalPhotoDescriptors.length, 3);
  assert.equal(value.photoAudit.reconciled, false);
  assert.equal(value.photoAudit.verification, 'mismatch');
});

test('does not reconcile a fully counted list without usable full-size URLs', () => {
  const value = record({ pictureCount: 2, pictures: [
    { hdThumbnailLocation: 'https://images.example/1-hd.jpg' },
    { thumbnailLocation: 'https://images.example/2-thumb.jpg' },
  ] });
  assert.equal(value.photoAudit.expectedCount, 2);
  assert.equal(value.photoAudit.observedCount, 2);
  assert.equal(value.photoAudit.reconciled, false);
  assert.equal(value.photoAudit.verification, 'unverified');
});

test('retains auction terms and the explicit per-lot fee without reinterpreting it', () => {
  const value = record({
    pictureCount: 1,
    pictures: [photo(1)],
    auction: {
      eventName: 'Buda Auction',
      description: '<p>Public auction description</p>',
      termsAndConditions: '<p>15% buyer premium + $2 per lot fee</p>',
      shippingAndPickupInfo: '<p>Pickup only</p>',
      paymentInfo: '<p>Visa accepted</p>',
      biddingNotice: '<p>Bidder notice</p>',
      currencyAbbreviation: 'USD',
      checkoutDateInfo: '<p>Checkout Friday</p>',
      previewDateInfo: '<p>Preview Thursday</p>',
      eventDateBegin: '2026-09-20T10:00:00Z',
      eventDateEnd: '2026-09-22T19:00:00Z',
      eventDateInfo: '<p>Online close</p>',
    },
  });
  assert.equal(value.auctionTerms, '<p>15% buyer premium + $2 per lot fee</p>');
  assert.equal(value.shippingAndPickupInfo, '<p>Pickup only</p>');
  assert.equal(value.paymentInfo, '<p>Visa accepted</p>');
  assert.equal(value.biddingNotice, '<p>Bidder notice</p>');
  assert.equal(value.auctionDescription, '<p>Public auction description</p>');
  assert.equal(value.currencyAbbreviation, 'USD');
  assert.equal(value.checkoutDateInfo, '<p>Checkout Friday</p>');
  assert.equal(value.previewDateInfo, '<p>Preview Thursday</p>');
  assert.equal(value.eventDateBegin, '2026-09-20T10:00:00Z');
  assert.equal(value.eventDateEnd, '2026-09-22T19:00:00Z');
  assert.equal(value.eventDateInfo, '<p>Online close</p>');
});

test('public search requests retain auction context and exact hydration stays view-free', () => {
  assert.match(HIBID_LOT_SEARCH_QUERY, /shippingAndPickupInfo paymentInfo termsAndConditions biddingNotice/);
  assert.match(HIBID_LOT_SEARCH_QUERY, /\$countAsView:\s*Boolean\s*=\s*false/);
  assert.match(HIBID_LOT_DETAILS_QUERY, /shippingAndPickupInfo paymentInfo termsAndConditions biddingNotice/);
  assert.deepEqual(buildHibidLotDetailsVariables('323017950'), { lotId: '323017950', countAsView: false });
});

function exactDetail(id: number, pictureCount: number, pictures = pictureCount) {
  return {
    data: { lot: { lot: {
      eventItemId: id,
      lead: `Lot ${id}`,
      lotNumber: String(id),
      pictureCount,
      pictures: Array.from({ length: pictures }, (_, index) => ({ fullSizeLocation: `https://cdn.example/${id}-${index + 1}.jpg` })),
      lotState: { highBid: 12, minBid: 14, status: 'OPEN' },
    } } },
  };
}

test('exact lot hydration requires complete physical photo coverage', async () => {
  const exactRoute = resolveHiBidRoute('https://hibid.com/lot/323017946/example');
  const transport: HiBidTransport = { searchLots: async () => ({}), hydrateLots: async (body: any) => {
    assert.equal(body.operationName, HIBID_LOT_DETAILS_OPERATION);
    assert.deepEqual(body.variables, { lotId: '323017946', countAsView: false });
    return exactDetail(323017946, 4);
  } };
  const hydrated = await hydrateHibidLotDetail(transport, '323017946', exactRoute, 'https://hibid.com/lot/323017946/example');
  assert.equal(hydrated.physicalPhotoDescriptors?.length, 4);
  assert.equal(hydrated.photoAudit?.reconciled, true);
  assert.equal(hydrated.images.length, 4);
});

test('exact lot hydration rejects missing photos and ID mismatch', async () => {
  const exactRoute = resolveHiBidRoute('https://hibid.com/lot/323017946/example');
  const transport = (response: unknown): HiBidTransport => ({ searchLots: async () => ({}), hydrateLots: async () => response });
  await assert.rejects(
    hydrateHibidLotDetail(transport(exactDetail(323017946, 4, 1)), '323017946', exactRoute, 'https://hibid.com/lot/323017946/example'),
    /photo coverage incomplete.*1\/4/,
  );
  await assert.rejects(
    hydrateHibidLotDetail(transport(exactDetail(999, 4)), '323017946', exactRoute, 'https://hibid.com/lot/323017946/example'),
    /ID mismatch/,
  );
});
