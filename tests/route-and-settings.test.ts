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
    ['https://hibid.com/account/currentbids', 'currentbids'],
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
  assert.equal(DEFAULT_SETTINGS.aiAnalysisMode, 'resale');
  assert.equal(DEFAULT_SETTINGS.originZip, '');
  assert.equal(DEFAULT_SETTINGS.originLabel, '');
  assert.equal(DEFAULT_SETTINGS.fullSizeImageHover, true);
  const settings = normalizeSettings({
    aiAnalysisMode: 'home-lab-electronics',
    taxExempt: true, taxOnPremium: false, originZip: '07008', radiusMiles: 50,
    targetProfitUsd: 73, minimumRoiPct: 44, defaultBuyerPremiumPct: 12,
    soldCompTarget: 7, auctionPaymentMethod: 'cash', resaleChannels: 'eBay, local pickup',
    transportDescription: 'Compact SUV; no stairs', customInstructions: 'Be strict.'
  });
  assert.equal(settings.taxExempt, true);
  assert.equal(settings.aiAnalysisMode, 'home-lab-electronics');
  assert.equal(settings.taxOnPremium, false);
  assert.equal(settings.originZip, '07008');
  assert.equal(settings.radiusMiles, 50);
  assert.equal(settings.targetProfitUsd, 73);
  assert.equal(settings.minimumRoiPct, 44);
  assert.equal(settings.defaultBuyerPremiumPct, 12);
  assert.equal(settings.soldCompTarget, 7);
  assert.equal(settings.auctionPaymentMethod, 'cash');
  assert.equal(settings.resaleChannels, 'eBay, local pickup');
  assert.equal(settings.transportDescription, 'Compact SUV; no stairs');
  assert.equal(settings.customInstructions, 'Be strict.');
  assert.equal(normalizeSettings({ fullSizeImageHover: false }).fullSizeImageHover, false);
  assert.equal(normalizeSettings({ aiAnalysisMode: 'anything-else' }).aiAnalysisMode, 'resale');
});

test('blank nullable numeric settings remain unset instead of becoming zero', () => {
  const settings = normalizeSettings({ taxPctOverride: null, defaultBuyerPremiumPct: '', bulkyItemProfitUsd: '', ebayFeePct: '', radiusMiles: null });
  assert.equal(settings.taxPctOverride, null);
  assert.equal(settings.defaultBuyerPremiumPct, null);
  assert.equal(settings.bulkyItemProfitUsd, null);
  assert.equal(settings.ebayFeePct, DEFAULT_SETTINGS.ebayFeePct);
  assert.equal(settings.radiusMiles, DEFAULT_SETTINGS.radiusMiles);
});

test('corrupt synced settings are bounded before they reach fee math or storage', () => {
  const settings = normalizeSettings({
    stateCode: 'xx', taxPctOverride: -9, ebayFeePct: 900, ebayFeeFixedCents: -25,
    radiusMiles: 9999, retailTargetPct: 0, retailWarningPct: 120,
    targetProfitUsd: -2, minimumRoiPct: 5000, defaultBuyerPremiumPct: 100,
    soldCompTarget: 99, auctionPaymentMethod: 'crypto', outboundShippingUsd: 99_999,
    packingReserveUsd: -5, promotedListingPct: 90, returnReservePct: 101, bulkyItemProfitUsd: 900_000,
    originLabel: 'x'.repeat(500), originZip: '9'.repeat(50), resaleChannels: 'r'.repeat(500),
    transportDescription: 'v'.repeat(1000), customInstructions: 'z'.repeat(10_000)
  });
  assert.equal(settings.stateCode, null);
  assert.equal(settings.taxPctOverride, 0);
  assert.equal(settings.ebayFeePct, 40);
  assert.equal(settings.ebayFeeFixedCents, 0);
  assert.equal(settings.radiusMiles, 500);
  assert.equal(settings.retailTargetPct, 1);
  assert.equal(settings.retailWarningPct, 95);
  assert.equal(settings.targetProfitUsd, 0);
  assert.equal(settings.minimumRoiPct, 1000);
  assert.equal(settings.defaultBuyerPremiumPct, 50);
  assert.equal(settings.soldCompTarget, 10);
  assert.equal(settings.auctionPaymentMethod, 'unspecified');
  assert.equal(settings.outboundShippingUsd, 10_000);
  assert.equal(settings.packingReserveUsd, 0);
  assert.equal(settings.promotedListingPct, 40);
  assert.equal(settings.returnReservePct, 100);
  assert.equal(settings.bulkyItemProfitUsd, 100_000);
  assert.equal(settings.originLabel.length, 120);
  assert.equal(settings.originZip.length, 20);
  assert.equal(settings.resaleChannels.length, 240);
  assert.equal(settings.transportDescription.length, 600);
  assert.equal(settings.customInstructions.length, 4000);
  assert.equal(normalizeSettings({ stateCode: 'nj' }).stateCode, 'NJ');
  assert.equal(normalizeSettings({ taxPctOverride: true }).taxPctOverride, null);
});
