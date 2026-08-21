import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { resolveHiBidRoute, routeFingerprint } from '../src/core/route.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';
import { extractHiBidPageState, extractHiBidPortalSearchContext } from '../src/hibid/dom.js';

test('resolves every supported HiBid route without confusing category IDs for auctions', () => {
  const cases = [
    ['https://hibid.com/catalog/765226/example', 'catalog'],
    ['https://hibid.com/livecatalog/752334/example', 'livecatalog'],
    ['https://hibid.com/lots/40198/computers?q=pc', 'search'],
    ['https://hibid.com/newjersey/lots/40196/electronics', 'search'],
    ['https://hibid.com/newjersey/catalog/765226/example', 'catalog'],
    ['https://hibid.com/newjersey/livecatalog/752334/example', 'livecatalog'],
    ['https://hibid.com/lot/123/example', 'lot'],
    ['https://hibid.com/newjersey/lot/123/example', 'lot'],
    ['https://hibid.com/account/watchlist', 'watchlist'],
    ['https://hibid.com/newjersey/account/watchlist', 'watchlist'],
    ['https://hibid.com/account/currentbids?status=WINNING', 'currentbids-winning'],
    ['https://hibid.com/account/currentbids?status=OUTBID', 'currentbids-outbid'],
    ['https://hibid.com/account/pastbidsm', 'pastbids'],
    ['https://hibid.com/account/pastwatchlist', 'pastwatchlist']
  ] as const;
  for (const [url, kind] of cases) assert.equal(resolveHiBidRoute(url).kind, kind, url);
  const category = resolveHiBidRoute('https://hibid.com/lots/40198/computers');
  assert.equal(category.auctionId, null);
  assert.equal(category.categoryId, '40198');
  const state = resolveHiBidRoute('https://hibid.com/newjersey/lots/40196/electronics');
  assert.equal(state.statePrefix, 'newjersey');
  assert.equal(state.siteType, 2);
  const stateCatalog = resolveHiBidRoute('https://hibid.com/newjersey/catalog/765226/example');
  assert.equal(stateCatalog.auctionId, '765226');
  assert.equal(stateCatalog.statePrefix, 'newjersey');
  assert.equal(stateCatalog.siteType, 2);
});

test('route fingerprints retain filters and ignore pagination only', () => {
  const a = 'https://hibid.com/lots/40198/x?q=gaming+pc&status=OPEN&apage=1';
  const b = 'https://hibid.com/lots/40198/x?apage=9&status=OPEN&q=gaming+pc';
  assert.equal(routeFingerprint(resolveHiBidRoute(a), a), routeFingerprint(resolveHiBidRoute(b), b));
  const changed = b.replace('gaming+pc', 'laptop');
  assert.notEqual(routeFingerprint(resolveHiBidRoute(a), a), routeFingerprint(resolveHiBidRoute(changed), changed));
});

test('visible no-match state overrides broad embedded data', () => {
  const dom = new JSDOM('<body><p>No matches found</p><script id="hibid-state" type="application/json">{"ROOT_QUERY":{"lots":[1,2,3]}}</script></body>');
  const state = extractHiBidPageState(dom.window.document, 'https://hibid.com/catalog/757032/example?q=lebron');
  assert.equal(state.noMatches, true);
  assert.equal(state.visibleExpectedTotal, 0);
  assert.equal(state.filters.query, 'lebron');
});

test('hidden empty templates and unrelated lot totals do not contaminate visible state', () => {
  const dom = new JSDOM(`<body>
    <template><p>No matches found</p></template>
    <div hidden>No matches found</div>
    <p>Total lots in other auctions: 1105 lots</p>
    <app-lot-tile id="lot-77"><a href="/lot/77/example">Lot 77</a></app-lot-tile>
  </body>`);
  const state = extractHiBidPageState(dom.window.document, 'https://hibid.com/catalog/765226/example');
  assert.equal(state.noMatches, false);
  assert.equal(state.visibleExpectedTotal, null);
  assert.equal(state.visibleCount, 1);
});

test('state portal context extracts only numeric portal children', () => {
  const dom = new JSDOM('<script id="hibid-state" type="application/json">{"portal":{"portalChildren":["12",34,"bad"]}}</script>');
  assert.deepEqual(extractHiBidPortalSearchContext(dom.window.document), { portalAuctioneerIds: ['12', '34'], siteType: 2 });
});

test('settings preserve calculator keys and add durable research defaults', () => {
  assert.equal(DEFAULT_SETTINGS.originZip, '08817');
  const settings = normalizeSettings({ taxExempt: true, taxOnPremium: false, originZip: '07008', radiusMiles: 50, customInstructions: 'Be strict.' });
  assert.equal(settings.taxExempt, true);
  assert.equal(settings.taxOnPremium, false);
  assert.equal(settings.originZip, '07008');
  assert.equal(settings.radiusMiles, 50);
  assert.equal(settings.customInstructions, 'Be strict.');
});
