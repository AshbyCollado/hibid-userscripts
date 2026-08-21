import assert from 'node:assert/strict';
import test from 'node:test';
import type { HiBidTransport } from '../src/core/types.js';
import { resolveHiBidRoute } from '../src/core/route.js';
import { buildHibidSearchRequest, HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, scrapeHibidApiCatalog, validateHibidApiCoverage } from '../src/hibid/api.js';

test('GraphQL operation name matches the operation declared by the query', () => {
  assert.match(HIBID_LOT_SEARCH_QUERY, new RegExp(`\\bquery\\s+${HIBID_LOT_SEARCH_OPERATION}\\b`));
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
