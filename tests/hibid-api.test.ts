import assert from 'node:assert/strict';
import test from 'node:test';
import type { HiBidTransport } from '../src/core/types.js';
import { resolveHiBidRoute } from '../src/core/route.js';
import { buildHibidSearchRequest, HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, HIBID_WATCHLIST_SEARCH_OPERATION, HIBID_WATCHLIST_SEARCH_QUERY, mergeHibidVisibleWithHydrated, normalizeHibidLot, scrapeHibidApiCatalog, scrapeHibidWatchlist, validateHibidApiCoverage } from '../src/hibid/api.js';

test('GraphQL operation name matches the operation declared by the query', () => {
  assert.match(HIBID_LOT_SEARCH_QUERY, new RegExp(`\\bquery\\s+${HIBID_LOT_SEARCH_OPERATION}\\b`));
  assert.match(HIBID_WATCHLIST_SEARCH_QUERY, new RegExp(`\\bquery\\s+${HIBID_WATCHLIST_SEARCH_OPERATION}\\b`));
});

test('closed lots prefer a nonzero realized price over HiBid highBid zero', () => {
  const route = resolveHiBidRoute('https://hibid.com/lot/317880392/example');
  const record = normalizeHibidLot({
    eventItemId: 317880392,
    lotNumber: '9m',
    lead: 'Samsung TV',
    lotState: { highBid: 0, priceRealized: 365, status: 'CLOSED' }
  }, { route, sourceUrl: 'https://hibid.com/lot/317880392/example' });
  assert.equal(record?.currentBid, 365);
});

test('GraphQL normalization retains the auctioneer estimate used by the donor fallback', () => {
  const route = resolveHiBidRoute('https://hibid.com/catalog/769459/example');
  const record = normalizeHibidLot({
    eventItemId: 317882346,
    lotNumber: '98',
    lead: 'ErGear Dual Monitor Arm',
    estimate: '$80.00 - $129.00',
  }, { route, sourceUrl: 'https://hibid.com/catalog/769459/example' });
  assert.equal(record?.estimate, '$80.00 - $129.00');
});

test('hydration cannot overwrite a visible realized price with zero', () => {
  const visible = { id: '1', currentBid: 365, status: 'Closed', rawText: 'Price Realized: 365.00 USD' } as any;
  const hydrated = { id: '1', currentBid: 0, status: 'CLOSED', rawText: '1 | Samsung TV | CLOSED' } as any;
  assert.equal(mergeHibidVisibleWithHydrated(visible, hydrated).currentBid, 365);
});

function lot(id: number) {
  return {
    id,
    itemId: id + 10_000,
    lotNumber: String(id),
    lead: `Lot ${id}`,
    description: `<p>Description ${id}</p>`,
    featuredPicture: { fullSizeLocation: `https://cdn.example/${id}.jpg` },
    pictures: [{ fullSizeLocation: `https://cdn.example/${id}-2.jpg` }],
    category: [
      { categoryName: 'Desktop / All-in-Ones', fullCategory: 'Computers & Electronics - Computers - Desktop / All-in-Ones' },
      { categoryName: 'Computers', fullCategory: 'Computers & Electronics - Computers' }
    ],
    lotState: { highBid: id, minBid: id + 1, bidCount: 2, productUrl: `/lot/${id}/lot-${id}`, status: 'OPEN', watchNotes: `Private note ${id}` },
    auction: { id: 765226, eventName: 'Test Auction', eventCity: 'Paterson', eventState: 'NJ', buyerPremiumRate: 15 }
  };
}

function graphqlPage(total: number, page: number, pageSize = 100) {
  const start = (page - 1) * pageSize + 1;
  const count = Math.max(0, Math.min(pageSize, total - start + 1));
  return { data: { lotSearch: { pagedResults: { pageNumber: page, pageLength: pageSize, totalCount: total, filteredCount: total, results: Array.from({ length: count }, (_, index) => lot(start + index)) } } } };
}

function watchlistPage(total: number, page: number, pageSize = 100, returnedTotal = total) {
  const start = (page - 1) * pageSize + 1;
  const count = Math.max(0, Math.min(pageSize, returnedTotal - start + 1));
  return { data: { watchList: { pagedResults: { pageNumber: page, pageLength: pageSize, totalCount: total, filteredCount: total, results: Array.from({ length: count }, (_, index) => lot(start + index)) } } } };
}

test('watchlist API exports all 51 lots even when the visible page was limited to 50', async () => {
  const url = 'https://hibid.com/account/watchlist';
  const route = resolveHiBidRoute(url);
  const result = await scrapeHibidWatchlist(async (body: any) => {
    assert.equal(body.operationName, HIBID_WATCHLIST_SEARCH_OPERATION);
    assert.equal(body.variables.pageLength, 100);
    return watchlistPage(51, body.variables.pageNumber, body.variables.pageLength);
  }, route, url);
  assert.equal(result.source, 'hibid-watchlist-api');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.expectedTotal, 51);
  assert.equal(result.items.length, 51);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 51);
  assert.equal(result.items[0]?.description, 'Description 1');
  assert.equal(result.items[0]?.images.length, 2);
});

test('watchlist API retries a changing 51-to-50 snapshot instead of exporting stale coverage', async () => {
  const url = 'https://hibid.com/account/watchlist';
  const route = resolveHiBidRoute(url);
  let calls = 0;
  const result = await scrapeHibidWatchlist(async (body: any) => {
    calls += 1;
    return calls === 1
      ? watchlistPage(51, body.variables.pageNumber, body.variables.pageLength, 50)
      : watchlistPage(50, body.variables.pageNumber, body.variables.pageLength);
  }, route, url);
  assert.ok(calls >= 2);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.expectedTotal, 50);
  assert.equal(result.items.length, 50);
});

for (const total of [245, 618, 287]) {
  test(`API-first catalog proves ${total}/${total} unique records`, async () => {
    const route = resolveHiBidRoute('https://hibid.com/catalog/765226/example');
    const transport: HiBidTransport = {
      searchLots: async () => { throw new Error('search index should not be used'); },
      hydrateLots: async (body: any) => graphqlPage(total, body.variables.pageNumber, body.variables.pageLength)
    };
    const result = await scrapeHibidApiCatalog(transport, route, 'https://hibid.com/catalog/765226/example');
    assert.equal(result.coverage.complete, true);
    assert.equal(result.items.length, total);
    assert.equal(new Set(result.items.map((item) => item.eventItemId)).size, total);
    assert.equal(result.items[0]?.description, 'Description 1');
    assert.equal(result.items[0]?.watchNotes, 'Private note 1');
    assert.equal(result.items[0]?.category, 'Computers & Electronics - Computers - Desktop / All-in-Ones');
    assert.ok(result.items[0]?.categories.includes('Computers & Electronics - Computers'));
    assert.equal(result.items.at(-1)?.images.length, 2);
  });
}

test('filtered search enumerates six IDs then hydrates exactly those IDs', async () => {
  const url = 'https://hibid.com/lots/40198/computers?q=gaming%20pc&status=OPEN&shippingoffered=true';
  const route = resolveHiBidRoute(url);
  const ids = [91, 92, 93, 94, 95, 96];
  const transport: HiBidTransport = {
    searchLots: async () => ({ data: { pageNumber: 1, pageSize: 100, totalCount: 6, filteredCount: 6, totalPages: 1, noExactMatches: false, lots: ids.map((id) => ({ id })) } }),
    hydrateLots: async (body: any) => {
      assert.equal(body.operationName, HIBID_LOT_SEARCH_OPERATION);
      return { data: { lotSearch: { pagedResults: { pageNumber: 1, pageLength: 6, totalCount: 6, filteredCount: 6, results: body.variables.eventItemIds.map(lot) } } } };
    }
  };
  const result = await scrapeHibidApiCatalog(transport, route, url);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.items.map((item) => Number(item.id)), ids);
  const request = buildHibidSearchRequest(route, url);
  assert.equal(request.options.categoryId, 40198);
  assert.deepEqual(request.options.status, ['OPEN']);
  assert.equal(request.options.shipping, true);
});

test('filtered no-exact-match response closes to zero even if fallback IDs are present', async () => {
  const url = 'https://hibid.com/lots?q=lebron';
  const route = resolveHiBidRoute(url);
  const transport: HiBidTransport = {
    searchLots: async () => ({ data: { pageNumber: 1, pageSize: 100, totalCount: 455, filteredCount: 455, totalPages: 5, noExactMatches: true, lots: [{ id: 1 }, { id: 2 }] } }),
    hydrateLots: async () => { throw new Error('must not hydrate fallback suggestions'); }
  };
  const result = await scrapeHibidApiCatalog(transport, route, url);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.items, []);
});

test('coverage rejects duplicate, missing, unexpected, and route-drift records', () => {
  const duplicate = validateHibidApiCoverage({ enumeratedIds: ['1', '1', '2'], hydratedItems: [{ id: '1' }, { id: '2' }], expectedTotal: 2 });
  assert.equal(duplicate.complete, false);
  assert.deepEqual(duplicate.duplicateIds, ['1']);
  const missing = validateHibidApiCoverage({ enumeratedIds: ['1', '2'], hydratedItems: [{ id: '1' }], expectedTotal: 2 });
  assert.equal(missing.reason, 'api-missing-hydration');
  const unexpected = validateHibidApiCoverage({ enumeratedIds: ['1'], hydratedItems: [{ id: '1' }, { id: '9' }], expectedTotal: 1 });
  assert.equal(unexpected.reason, 'api-unexpected-hydration');
  const drift = validateHibidApiCoverage({ enumeratedIds: ['1'], hydratedItems: [{ id: '1' }], expectedTotal: 1, startFingerprint: 'a', endFingerprint: 'b' });
  assert.equal(drift.reason, 'route-fingerprint-changed');
});

test('missing hydration IDs are retried and remain blocked after terminal failure', async () => {
  const url = 'https://hibid.com/lots?q=test';
  const route = resolveHiBidRoute(url);
  let hydrationCalls = 0;
  const transport: HiBidTransport = {
    searchLots: async () => ({ data: { pageNumber: 1, pageSize: 100, totalCount: 2, filteredCount: 2, totalPages: 1, lots: [{ id: 1 }, { id: 2 }] } }),
    hydrateLots: async () => {
      hydrationCalls += 1;
      return { data: { lotSearch: { pagedResults: { pageNumber: 1, pageLength: 2, totalCount: 1, filteredCount: 1, results: [lot(1)] } } } };
    }
  };
  const result = await scrapeHibidApiCatalog(transport, route, url);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.reason, 'api-hydration-failure');
  assert.ok(hydrationCalls >= 3);
  assert.deepEqual(result.coverage.missingIds, ['2']);
});
