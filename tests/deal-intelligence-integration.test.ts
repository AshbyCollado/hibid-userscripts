import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';
import { canReuseRetailEvidence, mutationAffectedLotIds, reserveTileAnnotationSpace, shouldRenderProvisionalDealAnnotations, visibleLotIdSignature } from '../src/content/deal-intelligence.js';
import {
  DEV_RELOAD_PENDING_MAX_AGE_MS,
  shouldConsumePendingPageRefresh,
  shouldRefreshSupportedTab,
  shouldReloadExtension,
} from '../src/background/dev-auto-reload.js';

test('Chrome and Waterfox use direct background Amazon transport without opening helper tabs', async () => {
  const chrome = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  const waterfox = JSON.parse(await readFile('dist/waterfox/manifest.json', 'utf8'));
  assert.equal(chrome.version, '0.5.19');
  assert.ok(chrome.host_permissions.includes('https://www.amazon.com/*'));
  assert.ok(chrome.host_permissions.includes('https://*.auctionninja.com/*'));
  assert.equal(chrome.host_permissions.includes('https://www.ebay.com/*'), false);
  assert.equal(chrome.permissions.includes('offscreen'), false);
  assert.equal(chrome.permissions.includes('declarativeNetRequest'), false);
  assert.equal(waterfox.permissions.includes('offscreen'), false);
  assert.equal(waterfox.permissions.includes('declarativeNetRequest'), false);
  assert.equal(chrome.content_scripts.some((entry: any) => entry.matches?.includes('https://www.amazon.com/*')), false);
  assert.equal(chrome.content_scripts.some((entry: any) => entry.matches?.some((value: string) => /auctionninja\.com/i.test(value)) && entry.js?.includes('auctionninja-content.js')), true);
  assert.equal(chrome.content_scripts.some((entry: any) => entry.matches?.some((value: string) => /ebay/i.test(value))), false);
  assert.equal(chrome.host_permissions.some((value: string) => /bestbuy|amazon\.ca/i.test(value)), false);
  assert.deepEqual(chrome.host_permissions, waterfox.host_permissions);
  const background = await readFile('src/background/index.ts', 'utf8');
  assert.match(background, /fetch\(url\.href/);
  assert.match(background, /credentials: 'include'/);
  assert.match(background, /cache: 'default'/);
  assert.doesNotMatch(background, /credentials: 'omit'/);
  assert.doesNotMatch(background, /AmazonHelper|chrome\.windows\.|flippahToken|amazon\.browser\.result/);
  assert.equal('web_accessible_resources' in chrome, false);
  assert.deepEqual(await readdir('dist/chrome/assets'), ['index-uNBN1arP.css']);
});

test('unpacked builds self-reload only when the installed semantic version changes', () => {
  assert.equal(shouldReloadExtension('0.3.51', '0.3.51'), false);
  assert.equal(shouldReloadExtension('0.4.1', '0.4.2'), true);
  assert.equal(shouldReloadExtension('0.3.51', 'not-a-version'), false);
});

test('extension reload refreshes only supported auction pages once for the new version', () => {
  assert.equal(shouldRefreshSupportedTab('https://hibid.com/livecatalog/771616/example'), true);
  assert.equal(shouldRefreshSupportedTab('https://subdomain.hibid.com/catalog/1/example'), true);
  assert.equal(shouldRefreshSupportedTab('https://www.auctionninja.com/category/electronics'), true);
  assert.equal(shouldRefreshSupportedTab('https://www.ebay.com/sh/lst/active'), false);
  assert.equal(shouldRefreshSupportedTab('chrome://extensions'), false);

  const now = 1_000_000;
  const pending = { requestedAt: now - 1_000, fromVersion: '0.5.1', toVersion: '0.5.2' };
  assert.equal(shouldConsumePendingPageRefresh(pending, '0.5.2', now), true);
  assert.equal(shouldConsumePendingPageRefresh(pending, '0.5.1', now), false);
  assert.equal(shouldConsumePendingPageRefresh({ ...pending, requestedAt: now - DEV_RELOAD_PENDING_MAX_AGE_MS - 1 }, '0.5.2', now), false);
});

test('HiBid redraws with the same stable lot IDs do not look like a new catalog', () => {
  const first = new JSDOM('<app-lot-tile id="lot-30"></app-lot-tile><app-lot-tile id="lot-10"></app-lot-tile>');
  const redraw = new JSDOM('<section><app-lot-tile id="lot-10"></app-lot-tile><app-lot-tile id="lot-30"></app-lot-tile></section>');
  const changed = new JSDOM('<app-lot-tile id="lot-10"></app-lot-tile><app-lot-tile id="lot-40"></app-lot-tile>');
  assert.equal(visibleLotIdSignature(first.window.document), '10|30');
  assert.equal(visibleLotIdSignature(redraw.window.document), '10|30');
  assert.equal(visibleLotIdSignature(changed.window.document), '10|40');
});

test('same-ID native watch redraws request annotation repair without reacting to Flippah itself', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-291"><div class="native">Watch</div><div data-flippah-owned="true">Amazon</div></app-lot-tile>');
  const tile = dom.window.document.querySelector('app-lot-tile')!;
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(tile, { childList: true, subtree: true });

  tile.innerHTML = '<div class="native">Unwatch</div>';
  const nativeRecords = observer.takeRecords() as unknown as MutationRecord[];
  assert.deepEqual(mutationAffectedLotIds(nativeRecords), ['291']);

  const owned = dom.window.document.createElement('div');
  owned.dataset.flippahOwned = 'true';
  tile.append(owned);
  const ownedRecords = observer.takeRecords() as unknown as MutationRecord[];
  assert.deepEqual(mutationAffectedLotIds(ownedRecords), []);
  observer.disconnect();
});

test('new live cards reserve the complete evidence row before hydration', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-188"><div class="lot-lead-heading">Gemmy Nativity</div><div class="lot-tile-content"></div></app-lot-tile>');
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    assert.equal(reserveTileAnnotationSpace('188'), true);
    const strip = dom.window.document.querySelector<HTMLElement>('[data-flippah-retail-for="188"]')!;
    assert.ok(strip);
    assert.equal(strip.getAttribute('aria-busy'), 'true');
    assert.equal(strip.getAttribute('aria-label'), 'Checking product prices');
    assert.match(strip.textContent || '', /Checking prices/);
    assert.equal(strip.dataset.flippahRenderSignature, 'pending');
    assert.equal(dom.window.document.querySelectorAll('[data-flippah-retail-for="188"]').length, 1);
    assert.equal(reserveTileAnnotationSpace('188'), true);
    assert.equal(dom.window.document.querySelectorAll('[data-flippah-retail-for="188"]').length, 1);
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('live redraws retain conclusive Amazon evidence but retry transient failures or changed queries', async () => {
  const matched = {
    query: 'Vicks Sinus Steam Inhaler', amazonOverrideAsin: '',
    result: { status: 'matched', query: 'Vicks Sinus Steam Inhaler', match: null, candidates: [], fetchedAt: 1, cached: true, message: 'matched' },
  } as any;
  assert.equal(canReuseRetailEvidence(matched, matched.query, ''), true);
  assert.equal(canReuseRetailEvidence({ ...matched, result: { ...matched.result, status: 'no_match' } }, matched.query, ''), true);
  assert.equal(canReuseRetailEvidence({ ...matched, result: { ...matched.result, status: 'network_error' } }, matched.query, ''), false);
  assert.equal(canReuseRetailEvidence(matched, 'Different product', ''), false);
  assert.equal(canReuseRetailEvidence(matched, matched.query, 'B000TEST'), false);

  const source = await readFile('src/content/deal-intelligence.ts', 'utf8');
  assert.match(source, /min-height:52px/);
  assert.match(source, /affectedIds\.filter\(\(id\) => !this\.records\.has\(id\)\)\.forEach\(reserveTileAnnotationSpace\)/);
  assert.match(source, /if \(!strip\) \{[\s\S]*applyTileAnnotation\(record, route\)/);
  assert.match(source, /flippahRenderSignature/);
  assert.match(source, /retailEvidence = new Map/);
  const locationHandler = source.match(/handleLocationChange\(\): void \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(locationHandler, /retailEvidence\.clear/);
  assert.match(source, /record\.state\.queryOverride === previous\.state\.queryOverride/);
});

test('list and live-account rows wait for hydration and cached evidence before their first annotation paint', async () => {
  assert.equal(shouldRenderProvisionalDealAnnotations({ kind: 'lot' }), true);
  for (const kind of ['catalog', 'livecatalog', 'search', 'watchlist', 'currentbids-winning', 'currentbids-outbid']) {
    assert.equal(shouldRenderProvisionalDealAnnotations({ kind } as any), false, kind);
  }

  const source = await readFile('src/content/deal-intelligence.ts', 'utf8');
  assert.match(source, /if \(shouldRenderProvisionalDealAnnotations\(route\)\) applyTileAnnotation\(record, route\)/);
  const preliminaryRestore = source.indexOf('await this.restoreCachedEvidence(preliminary)');
  const preliminaryPaint = source.indexOf('preliminary.forEach(repaint)');
  assert.ok(preliminaryRestore > 0 && preliminaryRestore < preliminaryPaint);
});

test('personalized watchlist exports use the account DOM and never extension-origin GraphQL', async () => {
  const content = await readFile('src/content/index.ts', 'utf8');
  assert.match(content, /\['watchlist', 'currentbids-winning'/);
  assert.match(content, /Watchlist changed during capture; refreshing snapshot/);
  assert.doesNotMatch(content, /abortableRuntime\('flippah:network\.account-watchlist'/);
});

test('retail transport returns normalized lookups and never exposes raw HTML or cache writes to content', async () => {
  const background = await readFile('src/background/index.ts', 'utf8');
  const policy = await readFile('src/intelligence/retail-policy.ts', 'utf8');
  assert.match(background, /flippah:retail\.lookup/);
  assert.match(background, /flippah:retail\.peek/);
  assert.match(background, /lookupAmazonCached/);
  assert.doesNotMatch(background, /flippah:retail\.amazon-search|flippah:retail\.cache\.get|flippah:retail\.cache\.set/);
  assert.match(background, /fetch\(url\.href/);
  assert.match(background, /AMAZON_BODY_LIMIT/);
  assert.match(background, /joinInflight\(amazonInflight/);
  assert.match(background, /providerStateStorageKey/);
  assert.doesNotMatch(background, /flippah:ebay\.lookup/);
  assert.doesNotMatch(background, /const retailQueue:/);
  assert.doesNotMatch(background, /source\.statedRetail/);
  assert.match(background, /evaluateAmazonCandidateEvidence/);
  assert.match(background, /canAmazonDetailEnrichmentResolve\(evaluation\.rejectionReasons\)/);
  assert.doesNotMatch(background, /evaluation\.matchedEvidence\.length >=/);
});

test('deal annotations are additive, stable-ID scoped, and do not rewrite HiBid layout', async () => {
  const content = await readFile('src/content/deal-intelligence.ts', 'utf8');
  const intelligence = await readFile('src/intelligence/us-deal-intelligence.ts', 'utf8');
  assert.match(content, /data-flippah-retail-for/);
  assert.match(content, /flippah-deal-dot/);
  assert.match(content, /flippah-deal-pill\.search/);
  assert.match(content, /flippah-search-pill/);
  assert.match(content, /buildRetailSearchPresentation\('amazon'/);
  assert.match(content, /buildRetailSearchPresentation\('ebay'/);
  assert.match(content, /buildRetailIndicatorTooltip/);
  assert.match(content, /buildConditionPresentation/);
  assert.match(content, /condition condition-\$\{condition\.tone\}/);
  assert.match(content, /explainHibidStatus/);
  assert.doesNotMatch(content, /Amazon: --|eBay: --/);
  assert.match(content, /content\.insertAdjacentElement\('beforebegin', strip\)/);
  assert.match(content, /return strip\.isConnected \? \{ tile, strip \} : null/);
  assert.match(content, /tileFor\(id\)/);
  assert.match(content, /links\.amazon/);
  assert.match(content, /links\.ebay/);
  assert.match(content, /Sold and Completed results to verify/);
  assert.match(content, /eBay resale \(manual\)/);
  assert.doesNotMatch(content, /flippah:ebay\.lookup/);
  assert.doesNotMatch(content, /extractStatedRetail|record\.statedRetail|Auctioneer retail/);
  assert.match(content, /pill\.target = '_blank'/);
  assert.match(content, /focus-visible/);
  assert.doesNotMatch(content, /\.innerHTML\s*=/);
  assert.doesNotMatch(content, /\.remove\(\)|style\.display\s*=|style\.opacity\s*=|replaceWith\(|outerHTML\s*=/);
  assert.doesNotMatch(content, /querySelectorAll\([^)]*\)\.forEach\([^)]*hidden/);
  assert.match(content, /Condition warning:/);
  assert.match(content, /Mixed\/group lot:/);
  assert.match(content, /CAD - no USD comparison/);
  assert.match(intelligence, /\\d\[\\d,.\]\*\\s\+Can\\b/);
  assert.doesNotMatch(content, /details\('Auction Terms'\)|details\('Fee Evidence'\)/);
});

test('built lot calculator omits shipping UI and saved shipping cannot enter fee math', async () => {
  const legacy = await readFile('dist/chrome/legacy-content.js', 'utf8');
  const options = await readFile('dist/chrome/options/options.js', 'utf8');
  assert.doesNotMatch(legacy, /<label for="lotlens-shipping">Shipping<\/label>/);
  assert.doesNotMatch(legacy, /shipCents:i\.shipCents|shipCents:wi\.shipCents|Budget is below shipping/);
  assert.doesNotMatch(legacy, /lotlens-catalog-chip/);
  assert.doesNotMatch(options, /Show true-cost chips on catalog tiles/);
});

test('scraper keeps simple price-check controls below its export actions', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');
  const options = await readFile('src/options/index.ts', 'utf8');
  assert.match(popup, /Price research/);
  assert.match(popup, /return 'Checking prices'/);
  assert.doesNotMatch(popup, /Amazon \$\{analysis\.amazonAnalyzed\}/);
  assert.doesNotMatch(popup, /eBay \$\{analysis\.ebayAnalyzed\}/);
  assert.match(popup, />Check again</);
  assert.match(popup, /Clear saved prices/);
  assert.match(popup, /Copy for AI/);
  assert.match(popup, /Copy JSON/);
  assert.ok(popup.indexOf('id="copy-llm"') < popup.indexOf('${analysisHtml}'));
  assert.doesNotMatch(popup, /analysis-counts|Amazon matches|US Deal Intelligence/);
  assert.match(options, /Automatically research Amazon\.com on supported HiBid pages/);
  assert.match(options, /Target profit per item \(\$\)/);
  assert.match(options, /Default buyer premium \(%\)/);
  assert.match(options, /Sold comps requested per lead/);
  assert.match(options, /Vehicle \/ pickup capability/);
  assert.match(options, /Seller-paid shipping default \(\$\)/);
  assert.equal(DEFAULT_SETTINGS.amazonAutoLookup, true);
  assert.equal(normalizeSettings({}).retailTargetPct, 50);
  assert.equal(normalizeSettings({}).retailWarningPct, 25);
});

test('open-source QoL additions stay optional, local, and visible through end-user controls', async () => {
  const content = await readFile('src/content/deal-intelligence.ts', 'utf8');
  const page = await readFile('src/content/index.ts', 'utf8');
  const popup = await readFile('src/popup/index.ts', 'utf8');
  const exports = await readFile('src/hibid/exports.ts', 'utf8');
  assert.match(page, /installHibidImagePreview/);
  assert.match(content, /Record resale outcome/);
  assert.match(content, /flippah-outcome-save/);
  assert.match(popup, /Export outcomes/);
  assert.match(popup, /details \$\{payload\.audit\.fidelity\.metrics\.description\.percent\}%/);
  assert.match(exports, /auditHibidRecordFidelity/);
});
