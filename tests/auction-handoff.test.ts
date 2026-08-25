import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  buildHibidLotHandoffV1,
  eventItemIdFromHibidLotUrl,
  hydrateHibidLotHandoff,
  isHibidChallengeDocument,
  validateHibidLotHandoffV1,
} from '../src/hibid/handoff.js';
import {
  auctionRelayUrl,
  normalizeAuctionRelayToken,
  postHibidLotToAuctionRelay,
  validateAuctionRelayResponse,
} from '../src/core/auction-relay.js';
import { installHibidAuctionHandoffAction } from '../src/content/auction-handoff-action.js';
import type { HiBidTransport } from '../src/core/types.js';

const sourceUrl = 'https://hibid.com/lot/317135308/books?ref=catalog';

function picture(index: number, patch: Record<string, unknown> = {}) {
  return {
    description: `Seller photo ${index}`,
    fullSizeLocation: `https://cdn.hibid.com/lot-317135308-${index}.jpg`,
    hdThumbnailLocation: `https://media.sandhills.com/lot-317135308-${index}-hd.jpg`,
    thumbnailLocation: `https://cdn.hibid.com/lot-317135308-${index}-thumb.jpg`,
    width: 1600,
    height: 1200,
    ...patch,
  };
}

function rawLot(count = 9, patch: Record<string, unknown> = {}) {
  return {
    id: 317135308,
    itemId: 99123,
    lotNumber: '308',
    lead: 'Books',
    description: '<p>Large book lot</p>',
    pictureCount: count,
    featuredPicture: picture(1),
    pictures: Array.from({ length: count }, (_, index) => picture(index + 1)),
    shippingOffered: true,
    quantity: 1,
    category: [{ fullCategory: 'Books & Manuscripts' }],
    lotState: { highBid: 12.34, minBid: 15, bidCount: 4, status: 'OPEN', watchNotes: 'never transmit me', buyerHighBid: 999 },
    auction: {
      id: 765226,
      eventName: 'Book Auction',
      buyerPremium: '10% cash/check or 13% credit card',
      buyerPremiumRate: 13,
      currencyAbbreviation: 'USD',
      eventAddress: '1 Main St',
      eventCity: 'Edison',
      eventState: 'NJ',
      eventZip: '08817',
      description: 'Pickup by appointment',
      checkoutDateInfo: 'Pay after the sale',
      previewDateInfo: 'Preview Tuesday',
    },
    ...patch,
  };
}

test('individual lot URLs yield the exact event-item ID, including state portals', () => {
  assert.equal(eventItemIdFromHibidLotUrl(sourceUrl), '317135308');
  assert.equal(eventItemIdFromHibidLotUrl('https://hibid.com/newjersey/lot/123/books'), '123');
  assert.throws(() => eventItemIdFromHibidLotUrl('https://hibid.com/catalog/123/books'), /exact event-item ID/i);
});

for (const count of [7, 8, 9]) {
  test(`physical GraphQL picture descriptors reconcile ${count}/${count} without a six-photo truncation`, () => {
    const manifest = buildHibidLotHandoffV1(rawLot(count), sourceUrl, '2026-08-25T12:00:00.000Z');
    assert.equal(manifest.expected_picture_count, count);
    assert.equal(manifest.pictures.length, count);
    assert.equal(manifest.fidelity.reconciled, true);
    assert.equal(manifest.rights_basis.attested_at, '2026-08-25T12:00:00.000Z');
    assert.equal(Number.isNaN(Date.parse(manifest.rights_basis.attested_at!)), false);
    assert.deepEqual(manifest.pictures.map((item) => item.seller_ordinal), Array.from({ length: count }, (_, index) => index + 1));
    validateHibidLotHandoffV1(manifest);
  });
}

test('the lazy ninth photo comes from exact GraphQL hydration rather than the eight-photo DOM', async () => {
  const dom = new JSDOM('<main>' + Array.from({ length: 8 }, (_, index) => `<img src="thumb-${index}.jpg">`).join('') + '</main>', { url: sourceUrl });
  assert.equal(dom.window.document.images.length, 8);
  const transport: HiBidTransport = {
    searchLots: async () => { throw new Error('search is not used'); },
    hydrateLots: async (body: any) => {
      assert.deepEqual(body.variables.eventItemIds, [317135308]);
      assert.equal(body.variables.pageLength, 1);
      return { data: { lotSearch: { pagedResults: { results: [rawLot(9)] } } } };
    },
  };
  const manifest = await hydrateHibidLotHandoff(transport, sourceUrl, { observedAt: '2026-08-25T12:00:00.000Z' });
  assert.equal(manifest.pictures.length, 9);
});

test('a transient eight-of-nine GraphQL snapshot is retried without duplicating the featured photo', async () => {
  let calls = 0;
  const transport: HiBidTransport = {
    searchLots: async () => { throw new Error('search is not used'); },
    hydrateLots: async () => {
      calls += 1;
      const lot = calls === 1 ? rawLot(9, { pictures: rawLot(8).pictures }) : rawLot(9);
      return { data: { lotSearch: { pagedResults: { results: [lot] } } } };
    },
  };
  const manifest = await hydrateHibidLotHandoff(transport, sourceUrl);
  assert.equal(calls, 2);
  assert.equal(manifest.pictures.length, 9);
  assert.equal(manifest.fidelity.duplicate_url_count, 0);
});

test('featuredPicture is added only when GraphQL pictures excludes it', () => {
  const raw = rawLot(3, { featuredPicture: picture(1), pictures: [picture(2), picture(3)] });
  const manifest = buildHibidLotHandoffV1(raw, sourceUrl);
  assert.equal(manifest.pictures.length, 3);
  assert.match(manifest.pictures[0]!.full_size_url, /-1\.jpg$/);
});

test('exact-image duplicates are retained as seller descriptors and called out for host suppression', () => {
  const duplicate = picture(1);
  const manifest = buildHibidLotHandoffV1(rawLot(2, { pictures: [duplicate, duplicate] }), sourceUrl);
  assert.equal(manifest.pictures.length, 2);
  assert.equal(manifest.fidelity.duplicate_url_count, 1);
  assert.notEqual(manifest.pictures[0]!.source_picture_key, manifest.pictures[1]!.source_picture_key);
});

test('seller reordering changes ordinals deterministically without dropping descriptors', () => {
  const first = buildHibidLotHandoffV1(rawLot(3), sourceUrl);
  const reorderedRaw = rawLot(3, { pictures: [picture(3), picture(1), picture(2)] });
  const reordered = buildHibidLotHandoffV1(reorderedRaw, sourceUrl);
  assert.equal(reordered.pictures.length, 3);
  assert.match(reordered.pictures[0]!.full_size_url, /-3\.jpg$/);
  assert.deepEqual(reordered.pictures.map((item) => item.seller_ordinal), [1, 2, 3]);
  assert.notDeepEqual(first.pictures.map((item) => item.full_size_url), reordered.pictures.map((item) => item.full_size_url));
  assert.deepEqual(
    new Set(first.pictures.map((item) => item.source_picture_key)),
    new Set(reordered.pictures.map((item) => item.source_picture_key)),
  );
});

test('handoff fails closed on picture drift, over-limit lots, missing full size, and wrong exact ID', () => {
  assert.throws(() => buildHibidLotHandoffV1(rawLot(9, { pictures: rawLot(7).pictures }), sourceUrl), /reconciliation failed/i);
  assert.throws(() => buildHibidLotHandoffV1(rawLot(61), sourceUrl), /at most 60/i);
  assert.throws(() => buildHibidLotHandoffV1(rawLot(1, { pictures: [picture(1, { fullSizeLocation: '' })] }), sourceUrl), /full-size/i);
  assert.throws(() => buildHibidLotHandoffV1({ ...rawLot(1), id: 999 }, sourceUrl), /requested lot/i);
});

test('manifest retains economics and premium variants but excludes private account state', () => {
  const manifest = buildHibidLotHandoffV1(rawLot(1), sourceUrl);
  assert.equal(manifest.lot.current_bid_cents, 1234);
  assert.equal(manifest.lot.next_bid_cents, 1500);
  assert.deepEqual(manifest.lot.buyer_premium_variants.map((item) => item.rate_basis_points), [1000, 1300]);
  assert.deepEqual(manifest.lot.buyer_premium_variants.map((item) => item.payment_method), ['cash', 'credit']);
  const json = JSON.stringify(manifest);
  assert.doesNotMatch(json, /never transmit me|buyerHighBid|watchNotes|authorization|cookie/i);
});

test('decimal GraphQL buyer premium rates normalize to percentage basis points', () => {
  const manifest = buildHibidLotHandoffV1(rawLot(1, {
    auction: { ...(rawLot(1).auction as object), buyerPremium: '', buyerPremiumRate: 0.13 },
  }), sourceUrl);
  assert.deepEqual(manifest.lot.buyer_premium_variants, [{ label: '13%', rate_basis_points: 1300, payment_method: 'unknown' }]);
});

test('challenge pages are detected and ordinary lot copy is not', () => {
  const challenge = new JSDOM('<title>Just a moment...</title><body>Verify you are human</body>');
  const lot = new JSDOM('<title>Books | HiBid</title><body>A challenging collection of books</body>');
  assert.equal(isHibidChallengeDocument(challenge.window.document), true);
  assert.equal(isHibidChallengeDocument(lot.window.document), false);
});

test('relay configuration permits only a bounded loopback port and a separate strong token', () => {
  assert.equal(auctionRelayUrl(undefined), 'http://127.0.0.1:8000/v1/auction-lots/handoffs/hibid');
  assert.equal(auctionRelayUrl(9000), 'http://127.0.0.1:9000/v1/auction-lots/handoffs/hibid');
  assert.throws(() => auctionRelayUrl(80), /port is invalid/i);
  assert.throws(() => auctionRelayUrl('not-a-port'), /port is invalid/i);
  assert.equal(normalizeAuctionRelayToken('a'.repeat(32)), 'a'.repeat(32));
  assert.throws(() => normalizeAuctionRelayToken('short'), /invalid/i);
});

test('only exact media.sandhills.com and HiBid subdomains pass image fidelity', () => {
  assert.throws(() => buildHibidLotHandoffV1(rawLot(1, {
    pictures: [picture(1, { fullSizeLocation: 'https://other.sandhills.com/photo.jpg' })],
  }), sourceUrl), /full-size/i);
});

test('relay sends only the metadata manifest with bearer auth and refuses redirects', async () => {
  const manifest = buildHibidLotHandoffV1(rawLot(2), sourceUrl);
  const lotId = '11111111-1111-4111-8111-111111111111';
  let request: { url: string; init: RequestInit } | null = null;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init: init! };
    return new Response(JSON.stringify({ lot_id: lotId, lot_url: `http://localhost:8080/auction-lots/${lotId}`, accepted_at: '2026-08-25T12:00:01Z' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const result = await postHibidLotToAuctionRelay(manifest, 't'.repeat(48), 8000, 8080, fetcher);
  assert.equal(result.lot_id, lotId);
  assert.equal(result.lot_url, `http://localhost:8080/auction-lots/${lotId}`);
  assert.equal(request!.url, 'http://127.0.0.1:8000/v1/auction-lots/handoffs/hibid');
  assert.equal(request!.init.redirect, 'error');
  assert.equal((request!.init.headers as Record<string, string>).authorization, `Bearer ${'t'.repeat(48)}`);
  assert.deepEqual(JSON.parse(String(request!.init.body)), manifest);
});

test('relay response refuses a remote lot URL', () => {
  assert.throws(() => validateAuctionRelayResponse({ lot_id: 'x', lot_url: 'https://evil.example/x', accepted_at: '2026-08-25T12:00:00Z' }), /non-local/i);
  assert.throws(() => validateAuctionRelayResponse({ lot_id: 'x', lot_url: 'http://127.0.0.1:80/auction-lots/x', accepted_at: '2026-08-25T12:00:00Z' }), /unexpected port/i);
  assert.throws(() => validateAuctionRelayResponse({ lot_id: 'x', lot_url: 'http://127.0.0.1:8080/admin', accepted_at: '2026-08-25T12:00:00Z' }), /unexpected lot URL path/i);
  const lotId = '11111111-1111-4111-8111-111111111111';
  assert.throws(() => validateAuctionRelayResponse({ lot_id: lotId, lot_url: `http://127.0.0.1:9000/auction-lots/${lotId}`, accepted_at: '2026-08-25T12:00:00Z' }), /unexpected port/i);
  assert.throws(() => validateAuctionRelayResponse({ lot_id: '22222222-2222-4222-8222-222222222222', lot_url: `http://127.0.0.1:8080/auction-lots/${lotId}`, accepted_at: '2026-08-25T12:00:00Z' }), /does not match/i);
});

test('lot-page action acknowledges immediately and exposes progress accessibly', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><h1>Books</h1></body></html>', { url: sourceUrl });
  let resolveAnalysis!: (value: any) => void;
  const analysis = new Promise((resolve) => { resolveAnalysis = resolve; });
  const action = installHibidAuctionHandoffAction(dom.window.document, dom.window as unknown as Window, async (onSending) => {
    await Promise.resolve();
    onSending(9);
    return analysis as any;
  });
  const button = dom.window.document.querySelector<HTMLButtonElement>('#flippah-auction-handoff button')!;
  const status = dom.window.document.querySelector<HTMLElement>('#flippah-auction-handoff [role="status"]')!;
  assert.ok(button);
  assert.equal(dom.window.document.querySelector('h1')!.nextElementSibling?.id, 'flippah-auction-handoff');
  assert.doesNotMatch(dom.window.document.querySelector('style[data-flippah-auction-handoff-style]')!.textContent || '', /position\s*:\s*fixed/i);
  assert.equal(button.getBoundingClientRect().width >= 0, true);
  button.click();
  assert.equal(action.phase(), 'enumerating');
  assert.equal(button.disabled, true);
  await Promise.resolve();
  assert.equal(action.phase(), 'sending');
  assert.match(status.textContent || '', /9 photos securely/i);
  resolveAnalysis({ lot_id: 'lot-1', lot_url: 'http://127.0.0.1:8000/auction-lots/lot-1', accepted_at: '2026-08-25T12:00:00Z' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(action.phase(), 'accepted');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Opened in Flippah');
  assert.equal(status.getAttribute('aria-live'), 'polite');
});

test('lot-page action remounts after a HiBid redraw and resets between lot routes', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><h1>Books</h1></main></body></html>', { url: sourceUrl });
  const action = installHibidAuctionHandoffAction(dom.window.document, dom.window as unknown as Window, async () => ({
    lot_id: 'lot-1', lot_url: 'http://127.0.0.1:8000/auction-lots/lot-1', accepted_at: '2026-08-25T12:00:00Z',
  }));
  const first = dom.window.document.querySelector('#flippah-auction-handoff')!;
  first.remove();
  action.update();
  const second = dom.window.document.querySelector('#flippah-auction-handoff')!;
  assert.ok(second);
  assert.notEqual(second, first);
  dom.window.history.pushState({}, '', '/lot/317135307/books');
  action.update();
  const third = dom.window.document.querySelector('#flippah-auction-handoff')!;
  assert.ok(third);
  assert.notEqual(third, second);
  assert.equal(action.phase(), 'idle');
});

test('lot-page action reports a failed reconciliation as an assertive status', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: sourceUrl });
  const action = installHibidAuctionHandoffAction(dom.window.document, dom.window as unknown as Window, async () => { throw new Error('pictureCount did not reconcile'); });
  dom.window.document.querySelector<HTMLButtonElement>('#flippah-auction-handoff button')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = dom.window.document.querySelector<HTMLElement>('#flippah-auction-handoff [role="status"]')!;
  assert.equal(action.phase(), 'failure');
  assert.match(status.textContent || '', /did not reconcile/i);
  assert.equal(status.getAttribute('aria-live'), 'assertive');
});
