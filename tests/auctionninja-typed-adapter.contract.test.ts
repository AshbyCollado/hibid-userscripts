import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

type AnyRecord = Record<string, any>;
type AdapterModule = AnyRecord;

const fixture = JSON.parse(readFileSync(new URL('./fixtures/auctionninja-typed-adapter.contract.json', import.meta.url), 'utf8')) as AnyRecord;
const legacyFixture = JSON.parse(readFileSync(new URL('../legacy/tampermonkey/fixtures/auctionninja-network.sanitized.json', import.meta.url), 'utf8')) as AnyRecord;
const legacyTests = readFileSync(new URL('../legacy/tampermonkey/tests/hibid-unified-assistant.test.mjs', import.meta.url), 'utf8');

async function loadFutureAdapter(): Promise<AdapterModule | null> {
  for (const moduleUrl of ['../src/auctionninja/index.js', '../src/auctionninja/dom.js']) {
    try {
      return await import(moduleUrl);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  return null;
}

function getExport(adapter: AdapterModule, names: string[]): ((...args: any[]) => any) | null {
  for (const name of names) {
    if (typeof adapter[name] === 'function') return adapter[name] as (...args: any[]) => any;
  }
  return null;
}

async function optionalExport(t: { skip: (message?: string) => void }, names: string[]): Promise<((...args: any[]) => any) | null> {
  const adapter = await loadFutureAdapter();
  const fn = adapter ? getExport(adapter, names) : null;
  if (!fn) {
    t.skip(`future typed adapter export pending: ${names.join(' or ')}`);
    return null;
  }
  return fn;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('sanitized legacy AuctionNinja evidence remains the source of typed expectations', () => {
  assert.equal(legacyFixture.site, 'auctionninja');
  assert.deepEqual(legacyFixture.saleCatalog.pages.map((page: AnyRecord) => page.count), fixture.expectedExports.saleCatalog.pageCounts);
  assert.equal(legacyFixture.saleCatalog.expectedTotal, fixture.expectedExports.saleCatalog.expectedTotal);
  assert.deepEqual(legacyFixture.category.pageCounts, fixture.expectedExports.category.pageCounts);
  assert.equal(legacyFixture.category.expectedTotal, fixture.expectedExports.category.expectedTotal);
  assert.deepEqual(legacyFixture.auctionSearch.pageCounts, fixture.expectedExports.auctionSearch.pageCounts);
  assert.equal(legacyFixture.auctionSearch.expectedTotal, fixture.expectedExports.auctionSearch.expectedTotal);
  assert.equal(legacyFixture.saleCatalog.coverage.complete, true);
  assert.equal(legacyFixture.saleCatalog.coverage.collected, legacyFixture.saleCatalog.coverage.unique);
  assert.equal(legacyFixture.auctionSearch.scopeRejection.promotionalShippingCardsOutsideResultContainer, 12);
});

test('legacy tests cover the contract areas this typed suite must preserve', () => {
  for (const name of [
    'assistant resolves supported and blocked AuctionNinja route families',
    'assistant validates AuctionNinja exact page coverage and rejects gaps, overlap, and duplicates',
    'assistant sanitizes AuctionNinja account detail enrichment at the export boundary',
    'assistant extracts AuctionNinja lot cards without treating bid controls as actions',
    'assistant rejects a direct AuctionNinja item whose canonical product id changed'
  ]) {
    assert.match(legacyTests, new RegExp(`test\\(['"]${escapeRegExp(name)}['"]`));
  }
});

test('future adapter route detection matches public, account, detail, and blocked paths', async (t) => {
  const resolveRoute = await optionalExport(t, ['resolveAuctionNinjaRoute', 'resolveAuctionNinjaPage']);
  if (!resolveRoute) return;
  for (const routeCase of fixture.routes) {
    const result = await resolveRoute(routeCase.url);
    assert.equal(result.kind, routeCase.kind, routeCase.url);
    if (routeCase.kind === 'unsupported') assert.equal(result.supported, false, routeCase.url);
  }
});

test('future adapter sale pagination preserves 106 unique product identities', async (t) => {
  const validate = await optionalExport(t, ['validateAuctionNinjaCoverage']);
  if (!validate) return;
  const expected = fixture.expectedExports.saleCatalog;
  const ids = Array.from({ length: expected.expectedTotal }, (_, index) => `sale-${String(index + 1).padStart(3, '0')}`);
  const result = await validate({
    expectedTotal: expected.expectedTotal,
    enumeratedIds: ids,
    hydratedIds: ids,
    pageCounts: expected.pageCounts,
    startFingerprint: 'auctionninja|sale|17395',
    endFingerprint: 'auctionninja|sale|17395'
  });
  assert.equal(result.complete, true);
  assert.equal(result.uniqueCount ?? result.uniqueHydratedCount ?? result.uniqueStableIds, 106);
});

test('future adapter coverage rejects duplicate, count, filter, and route drift', async (t) => {
  const validate = await optionalExport(t, ['validateAuctionNinjaCoverage']);
  if (!validate) return;
  for (const scenario of fixture.coverageCases.slice(1)) {
    const ids = scenario.enumeratedIds ?? Array.from({ length: scenario.enumeratedCount ?? 0 }, (_, index) => `id-${index}`);
    const hydratedIds = scenario.hydratedIds ?? Array.from({ length: scenario.hydratedCount ?? 0 }, (_, index) => `id-${index}`);
    const result = await validate({
      expectedTotal: scenario.expectedTotal,
      enumeratedIds: ids,
      hydratedIds,
      startFingerprint: scenario.startFingerprint,
      endFingerprint: scenario.endFingerprint
    });
    assert.equal(result.complete, false, scenario.name);
    assert.equal(result.reason, scenario.reason, scenario.name);
  }
});

test('future adapter detail extraction retains descriptions and every image descriptor', async (t) => {
  const extractDetail = await optionalExport(t, ['extractAuctionNinjaItemDetail']);
  if (!extractDetail) return;
  const dom = new JSDOM(fixture.detailHtml, { url: 'https://www.auctionninja.com/testseller/product/portable-receiver--123456.html' });
  const result = await extractDetail(dom.window.document, dom.window.location);
  assert.equal(result.stableProductId ?? result.productId ?? result.id, fixture.expectedDetail.stableProductId);
  assert.equal(result.lot, fixture.expectedDetail.lot);
  assert.equal(result.title, fixture.expectedDetail.title);
  for (const text of fixture.expectedDetail.descriptionContains) assert.match(result.description, new RegExp(escapeRegExp(text)));
  for (const image of fixture.expectedDetail.images) assert.ok(result.images.includes(image), image);
  for (const forbidden of fixture.expectedDetail.mustExclude) assert.doesNotMatch(JSON.stringify(result), new RegExp(escapeRegExp(forbidden)));
});

test('AuctionNinja detail extraction excludes seller and shipping boilerplate from item condition', async (t) => {
  const extractDetail = await optionalExport(t, ['extractAuctionNinjaItemDetail']);
  if (!extractDetail) return;
  const dom = new JSDOM(`<!doctype html><html><head><link rel="canonical" href="https://www.auctionninja.com/testseller/product/bostitch-btfp12233--4130688.html"></head><body>
    <main class="item-detail-main"><h1 class="item-detail-box-title">Bostitch BTFP12233 Brad Nailer Kit</h1>
      <div class="item-description-deta">
        <div class="item-description-title">Item Description</div><p>New pneumatic nailer kit. View photos before bidding.</p>
        <div class="item-description-title">Condition</div><p>New</p>
        <div class="responsive-auction-seller-box">Seller is not responsible for lost or damaged items once shipped. Broken pickup appointments are forfeited.</div>
        <div class="item-description-title">Auction Manager</div><p>Private seller contact</p>
      </div>
    </main></body></html>`, { url: 'https://www.auctionninja.com/testseller/product/bostitch-btfp12233--4130688.html' });
  const result = await extractDetail(dom.window.document, dom.window.location);
  assert.match(result.description, /New pneumatic nailer kit/);
  assert.match(result.description, /Condition: New/);
  assert.doesNotMatch(result.description, /damaged items|Broken pickup|Private seller contact/);
});

test('future adapter account export removes private account data without dropping public fields', async (t) => {
  const sanitize = await optionalExport(t, ['sanitizeAuctionNinjaAccountExport']);
  if (!sanitize) return;
  const result = await sanitize({
    source: 'AuctionNinja',
    pageKind: 'followed-items',
    url: 'https://www.auctionninja.com/followed-items?an=private-value',
    items: [{
      id: '123456',
      title: 'Portable Receiver',
      price: 25,
      status: 'WON',
      url: 'https://www.auctionninja.com/testseller/product/portable-receiver--123456.html?an=private-value',
      bidderAlias: 'private-alias',
      email: 'private@example.invalid'
    }]
  });
  const serialized = JSON.stringify(result);
  for (const field of fixture.accountPrivacy.mustRemove) {
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(field), 'i'));
  }
  assert.match(serialized, /Portable Receiver/);
  assert.match(serialized, /123456/);
});

test('future adapter condition and image contract keeps review states distinct', async (t) => {
  const adapter = await loadFutureAdapter();
  const assess = adapter ? getExport(adapter, ['assessAuctionNinjaCondition', 'parseAuctionNinjaCondition']) : null;
  if (!assess) {
    t.skip('future typed adapter condition export pending');
    return;
  }
  for (const condition of fixture.conditionCases) {
    const result = await assess(condition.text.replaceAll('\\\\n', '\\n'));
    assert.equal(result.status ?? result.kind ?? result.classification, condition.expected, condition.text);
  }
});
