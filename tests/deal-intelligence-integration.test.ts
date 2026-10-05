import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';
import { extractHibidLotDetail } from '../src/hibid/dom.js';
import { applyTileAnnotation, buildAnalysisRecords, canReuseRetailEvidence, mergeRetainedLotDetails, mutationAffectedLotIds, publishLotPanelEconomics, refreshLiveAnalysisRecord, refreshRecordIndicators, reserveTileAnnotationSpace, shouldRenderProvisionalDealAnnotations, visibleLotIdSignature } from '../src/content/deal-intelligence.js';
import { assessCondition, calculateUsAllIn, computeRetailIndicators, detectMixedLot, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import {
  DEV_RELOAD_PENDING_MAX_AGE_MS,
  shouldConsumePendingPageRefresh,
  shouldRefreshSupportedTab,
  shouldReloadExtension,
} from '../src/background/dev-auto-reload.js';

function shadowStrip(root: ParentNode, id: string): HTMLElement {
  const host = root.querySelector<HTMLElement>(`[data-flippah-retail-host-for="${id}"]`);
  assert.ok(host?.shadowRoot, `missing isolated annotation host for lot ${id}`);
  const strip = host.shadowRoot.querySelector<HTMLElement>('.flippah-deal-strip');
  assert.ok(strip, `missing isolated annotation strip for lot ${id}`);
  return strip;
}

test('Chrome and Waterfox use direct background Amazon transport without opening helper tabs', async () => {
  const chrome = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  const waterfox = JSON.parse(await readFile('dist/waterfox/manifest.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(chrome.version, pkg.version);
  assert.equal(waterfox.version, pkg.version);
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
  const account = new JSDOM('<article id="lot-0" class="bid-status-border"><a href="/lot/88/account-lot"></a></article>');
  const standalone = new JSDOM('<article data-event-item-id="99"><div class="lot-card-content"></div></article>');
  assert.equal(visibleLotIdSignature(first.window.document), '10|30');
  assert.equal(visibleLotIdSignature(redraw.window.document), '10|30');
  assert.equal(visibleLotIdSignature(changed.window.document), '10|40');
  assert.equal(visibleLotIdSignature(account.window.document), '88');
  assert.equal(visibleLotIdSignature(standalone.window.document), '99');
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

test('new live cards reserve an isolated evidence row without changing native card children', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-0"><div data-event-item-id="188"><div class="lot-lead-heading">Gemmy Nativity</div><div class="lot-tile-content"></div></div></app-lot-tile>');
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    const tile = dom.window.document.querySelector('app-lot-tile')!;
    const nativeChildren = [...tile.children];
    assert.equal(reserveTileAnnotationSpace('188', { kind: 'livecatalog' } as any), true);
    assert.deepEqual([...tile.children], nativeChildren);
    const strip = shadowStrip(tile, '188');
    assert.equal(strip.getAttribute('aria-busy'), 'true');
    assert.equal(strip.getAttribute('aria-label'), 'Checking product prices');
    assert.match(strip.textContent || '', /Checking prices/);
    assert.equal(strip.dataset.flippahRenderSignature, 'pending');
    assert.equal(tile.querySelectorAll('[data-flippah-retail-host-for="188"]').length, 1);
    assert.equal(reserveTileAnnotationSpace('188', { kind: 'livecatalog' } as any), true);
    assert.equal(tile.querySelectorAll('[data-flippah-retail-host-for="188"]').length, 1);
    assert.equal(dom.window.document.querySelector('style'), null);
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('recycled slot IDs cannot route one physical lot evidence row onto another', () => {
  const dom = new JSDOM(`
    <app-lot-tile id="lot-10"><a href="/lot/188/physical-lot-188"></a><div class="lot-tile-content"></div></app-lot-tile>
    <app-lot-tile id="lot-11"><a href="/lot/10/physical-lot-10"></a><div class="lot-tile-content"></div></app-lot-tile>
  `);
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    assert.equal(reserveTileAnnotationSpace('10', { kind: 'livecatalog' } as any), true);
    assert.equal(dom.window.document.querySelector('#lot-10 [data-flippah-retail-host-for]'), null);
    assert.equal(dom.window.document.querySelector('#lot-11 [data-flippah-retail-host-for="10"]')?.parentElement?.className, 'lot-tile-content');
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('in-place virtual tile recycling removes only the prior extension-owned host', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-0"><a href="/lot/188/first-lot"></a><div class="lot-tile-content"><span id="native">Native</span></div></app-lot-tile>');
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    const tile = dom.window.document.querySelector('app-lot-tile')!;
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(tile, { attributes: true, attributeFilter: ['id', 'href', 'data-event-item-id'], subtree: true });
    assert.equal(reserveTileAnnotationSpace('188', { kind: 'livecatalog' } as any), true);
    assert.match(shadowStrip(tile, '188').textContent || '', /Checking prices/);
    tile.querySelector('a')?.setAttribute('href', '/lot/244/recycled-lot');
    const identityChanges = observer.takeRecords() as unknown as MutationRecord[];
    assert.deepEqual(mutationAffectedLotIds(identityChanges), ['244']);
    assert.equal(reserveTileAnnotationSpace('244', { kind: 'livecatalog' } as any), true);
    assert.equal(tile.querySelectorAll('[data-flippah-retail-host-for]').length, 1);
    assert.equal(tile.querySelector('[data-flippah-retail-host-for="188"]'), null);
    assert.match(shadowStrip(tile, '244').textContent || '', /Checking prices/);
    assert.equal(tile.querySelector('#native')?.textContent, 'Native');
    observer.disconnect();
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('standalone event-item cards mount only through a verified content body', () => {
  const dom = new JSDOM('<article data-event-item-id="730"><header>Standalone lot</header><div class="lot-card-content"><span id="native">Current bid $5</span></div></article>');
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    assert.equal(reserveTileAnnotationSpace('730', { kind: 'catalog' } as any), true);
    const card = dom.window.document.querySelector('article')!;
    assert.equal(card.querySelector('.lot-card-content')?.firstElementChild?.getAttribute('data-flippah-retail-host-for'), '730');
    assert.match(shadowStrip(card, '730').textContent || '', /Checking prices/);
    assert.equal(card.querySelector('#native')?.textContent, 'Current bid $5');
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('recycled-card cleanup never removes a foreign host-shaped node', () => {
  const dom = new JSDOM(`
    <app-lot-tile id="lot-0"><a href="/lot/244/current-lot"></a><div class="lot-tile-content">
      <div id="foreign" data-flippah-retail-host-for="188">Foreign native content</div>
    </div></app-lot-tile>
  `);
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    assert.equal(reserveTileAnnotationSpace('244', { kind: 'livecatalog' } as any), true);
    const tile = dom.window.document.querySelector('app-lot-tile')!;
    assert.equal(tile.querySelector('#foreign')?.textContent, 'Foreign native content');
    assert.equal(tile.querySelectorAll('[data-flippah-owned="true"][data-flippah-retail-host-for="244"]').length, 1);
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('lot-detail annotations never enter native breadcrumbs, gallery, or content', () => {
  const dom = new JSDOM(`
    <nav id="breadcrumbs"><a href="/lot/34/set-cash-drawer"><span>SET CASH DRAWER W/ KEY &amp; EPSON PRINTER</span></a></nav>
    <main><h1>Lot # : 34 - SET CASH DRAWER W/ KEY &amp; EPSON PRINTER</h1><section id="gallery">Native gallery</section></main>
  `, { url: 'https://hibid.com/lot/34/set-cash-drawer' });
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    const breadcrumb = dom.window.document.querySelector('#breadcrumbs')!;
    const main = dom.window.document.querySelector('main')!;
    const breadcrumbHtml = breadcrumb.innerHTML;
    const mainHtml = main.innerHTML;
    assert.equal(reserveTileAnnotationSpace('34', { kind: 'lot' } as any), false);
    assert.equal(applyTileAnnotation({ lot: { id: '34' } } as any, { kind: 'lot' } as any), false);
    assert.equal(breadcrumb.innerHTML, breadcrumbHtml);
    assert.equal(main.innerHTML, mainHtml);
    assert.equal(dom.window.document.querySelector('[data-flippah-retail-host-for]'), null);
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('account-card annotations mount only inside its verified content body', () => {
  const dom = new JSDOM(`
    <article id="lot-311743157" class="bid-status-border current-bids-card">
      <header id="native-heading">Lot 26 | LEVOIT Core300-P Air Purifier</header>
      <div id="native-body" class="current-bids-card-content"><span>Current Bid: 14.00 USD</span><span>9 Bids</span></div>
      <footer id="native-actions"><button>Unwatch</button><button>Notes</button></footer>
    </article>
  `, { url: 'https://hibid.com/account/watchlist' });
  const previousDocument = (globalThis as any).document;
  const previousCss = (globalThis as any).CSS;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  try {
    const card = dom.window.document.querySelector('article')!;
    const nativeChildren = [...card.children];
    assert.equal(reserveTileAnnotationSpace('311743157', { kind: 'watchlist' } as any), true);
    assert.deepEqual([...card.children], nativeChildren);
    assert.equal(card.querySelector('#native-body')?.firstElementChild?.getAttribute('data-flippah-retail-host-for'), '311743157');
    assert.match(shadowStrip(card, '311743157').textContent || '', /Checking prices/);
    assert.equal(card.querySelector('#native-heading')?.textContent, 'Lot 26 | LEVOIT Core300-P Air Purifier');
    assert.equal(card.querySelector('#native-actions')?.textContent?.replace(/\s+/g, ''), 'UnwatchNotes');
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousCss === undefined) delete (globalThis as any).CSS;
    else (globalThis as any).CSS = previousCss;
  }
});

test('all-in evidence stays inside the isolated row and never changes native bid controls', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-192"><div class="lot-tile-content"></div><button>Bid 21.00 USD</button></app-lot-tile>');
  const previous = {
    document: (globalThis as any).document,
    CSS: (globalThis as any).CSS,
    HTMLAnchorElement: (globalThis as any).HTMLAnchorElement,
  };
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  (globalThis as any).HTMLAnchorElement = dom.window.HTMLAnchorElement;
  try {
    const identity = extractProductIdentity('Vicks Sinus Steam Inhaler');
    const allIn = calculateUsAllIn({ hammer: 21, buyerPremiumPct: 15, salesTaxPct: 0 });
    const indicators = computeRetailIndicators(allIn, { amazon: 42.98, ebay: null });
    const record: any = {
      lot: { id: '192', status: 'OPEN', rawText: 'OPEN', nextBid: 21 },
      identity,
      condition: assessCondition('Condition: New'),
      mixed: detectMixedLot('Vicks Sinus Steam Inhaler'),
      allIn,
      amazon: {
        status: 'matched', query: identity.query, fetchedAt: 1, cached: true, message: 'cached', candidates: [],
        match: { score: 100, candidate: { asin: 'B0TEST192', title: 'Vicks Sinus Steam Inhaler', price: 42.98, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0TEST192' } },
      },
      amazonIndicator: indicators.amazon,
      ebayIndicator: indicators.ebay,
      state: { confirmedQuantity: 1, resaleEstimate: null, maxBid: null, amazonOverrideAsin: null },
      currency: 'USD', needsQuantity: false, ebayNet: null, premiumPct: 15, outcome: null,
    };
    assert.equal(applyTileAnnotation(record, { kind: 'watchlist' } as any), true);
    assert.match(shadowStrip(dom.window.document, '192').textContent || '', /All-in \$24\.15/);
    assert.equal(dom.window.document.querySelector('button')?.textContent, 'Bid 21.00 USD');
    assert.equal(dom.window.document.querySelector('button [data-flippah-owned]'), null);
  } finally {
    if (previous.document === undefined) delete (globalThis as any).document; else (globalThis as any).document = previous.document;
    if (previous.CSS === undefined) delete (globalThis as any).CSS; else (globalThis as any).CSS = previous.CSS;
    if (previous.HTMLAnchorElement === undefined) delete (globalThis as any).HTMLAnchorElement; else (globalThis as any).HTMLAnchorElement = previous.HTMLAnchorElement;
  }
});

test('runtime economics uses hydrated auction terms only and keeps unconfigured tax estimated', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-323017949"><div class="lot-tile-content"></div></app-lot-tile>');
  const previous = { document: (globalThis as any).document, CSS: (globalThis as any).CSS, HTMLAnchorElement: (globalThis as any).HTMLAnchorElement };
  (globalThis as any).document = dom.window.document;
  (globalThis as any).CSS = { escape: (value: string) => value };
  (globalThis as any).HTMLAnchorElement = dom.window.HTMLAnchorElement;
  try {
    const lot: any = {
      source: 'hibid-api', pageKind: 'lot', id: '323017949', eventItemId: '323017949', itemId: '', lot: '323', title: 'Test lot', lead: 'Test lot',
      url: '/lot/323017949/test', image: '', images: [], description: 'Product retail fee $250 is irrelevant', descriptionHtml: '', category: '', categories: [],
      currentBid: 10, nextBid: 12.5, bidCount: 0, status: 'OPEN', timeLeft: '', quantity: null, shippingOffered: false, auctionId: '779483', auctionTitle: '', location: '',
      buyerPremium: '15%', rawText: 'OPEN USD $250 retail fee', auctionTerms: '15% buyer premium + $2 per lot', biddingNotice: '15% buyer premium + $2.00 per-lot fee', paymentInfo: '', shippingAndPickupInfo: '', descriptionFields: {},
    };
    const [record] = buildAnalysisRecords([lot], new Map(), new Map(), new Map(), normalizeSettings({ ...DEFAULT_SETTINGS, stateCode: '', taxPctOverride: null, taxExempt: false }));
    assert.equal(record?.allIn, null);
    assert.equal(record?.economics.flatFees, 2);
    assert.equal(record?.economics.estimatedCost, 16.375);
    record!.amazon = { status: 'matched', query: 'Test lot', fetchedAt: 1, cached: true, message: 'matched', candidates: [], match: { score: 100, candidate: { asin: 'B0TEST', title: 'Test lot', price: 42.98, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0TEST' } } } as any;
    refreshRecordIndicators(record!);
    assert.equal(record!.comparisonCost, 16.375);
    assert.equal(record!.amazonIndicator.cls, 'green');
    assert.equal(applyTileAnnotation(record as any, { kind: 'catalog' } as any), true);
    const strip = shadowStrip(dom.window.document, '323017949');
    assert.match(strip.textContent || '', /Amazon \$42\.98/);
    assert.match(strip.textContent || '', /Est\. \$16\.38 \+ costs/);
    assert.doesNotMatch(strip.textContent || '', /All-in/);
    assert.match(strip.querySelector('[title*="Sales tax"]')?.getAttribute('title') || '', /subtotal excludes tax/i);
    const amazonTitle = strip.querySelector('a[title*="Amazon:"]')?.getAttribute('title') || '';
    assert.match(amazonTitle, /Provisional bid cost \$16\.38/);
    assert.match(amazonTitle, /not a profit or final bid-ceiling estimate/i);
    assert.doesNotMatch(amazonTitle, /All-in/);
  } finally {
    if (previous.document === undefined) delete (globalThis as any).document; else (globalThis as any).document = previous.document;
    if (previous.CSS === undefined) delete (globalThis as any).CSS; else (globalThis as any).CSS = previous.CSS;
    if (previous.HTMLAnchorElement === undefined) delete (globalThis as any).HTMLAnchorElement; else (globalThis as any).HTMLAnchorElement = previous.HTMLAnchorElement;
  }
});

test('runtime economics reconciles a published card premium before the cash discount', () => {
  const lot: any = {
    source: 'hibid-api', pageKind: 'lot', id: '322934183', eventItemId: '322934183', itemId: '', lot: '32',
    title: 'Test lot', lead: 'Test lot', url: '/lot/322934183/test', image: '', images: [],
    description: '', descriptionHtml: '', category: '', categories: [], currentBid: 10, nextBid: 12.5,
    bidCount: 0, status: 'OPEN', timeLeft: '', quantity: null, shippingOffered: false,
    auctionId: '779320', auctionTitle: '', location: 'Maryland', buyerPremium: '15%', rawText: '',
    auctionTerms: 'Buyers shall pay a 20% buyers premuim on final accepted bids. A discount of 5% is offered if Buyer pays cash or check.',
    biddingNotice: '20% buyers premium with a payment of a credit card, 15% with cash or check',
    paymentInfo: '', shippingAndPickupInfo: '', descriptionFields: {},
  };
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, stateCode: '', taxPctOverride: null, taxExempt: false });
  const [record] = buildAnalysisRecords([lot], new Map(), new Map(), new Map(), settings);
  assert.equal(record?.economics.premiumPct, 20);
  assert.equal(record?.economics.premiumSource, 'auction_terms');
  assert.equal(record?.economics.premium, 2.5);
  assert.equal(record?.economics.knownSubtotal, 15);
  assert.match(record?.economics.warnings.join(' ') ?? '', /payment rate is confirmed/i);
  assert.equal(record?.economics.complete, false);
});

test('lot calculator economics bridge sends lot-bound fixed fees once per changed payload', () => {
  const dom = new JSDOM('<div id="lotlens-root"></div>');
  const host = dom.window.document.getElementById('lotlens-root')!;
  let updates = 0;
  host.addEventListener('flippah:economics', () => { updates += 1; });
  const record: any = {
    lot: { id: '323017949' }, currency: 'USD',
    economics: { flatFees: 2, premiumPct: 20, premiumSource: 'auction_terms', complete: false, warnings: ['Shipping is unknown.'] },
  };
  publishLotPanelEconomics(host, record);
  assert.equal(host.dataset.flippahEconomicsLotId, '323017949');
  assert.equal(host.dataset.flippahFixedFeeCents, '200');
  assert.equal(host.dataset.flippahPremiumPct, '20');
  assert.equal(host.dataset.flippahEconomicsComplete, 'false');
  assert.deepEqual(JSON.parse(host.dataset.flippahEconomicsWarnings!), ['Shipping is unknown.']);
  publishLotPanelEconomics(host, record);
  assert.equal(updates, 1);
  publishLotPanelEconomics(host, { ...record, lot: { id: '323017950' } });
  assert.equal(host.dataset.flippahEconomicsLotId, '323017950');
  assert.equal(updates, 2);
  publishLotPanelEconomics(host, { ...record, currency: 'CAD' });
  assert.equal(host.dataset.flippahFixedFeeCents, '0');
  assert.equal(host.dataset.flippahPremiumPct, '');
  assert.equal(host.dataset.flippahEconomicsComplete, 'false');
  for (const flatFees of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    publishLotPanelEconomics(host, { ...record, economics: { flatFees, complete: true, warnings: [] } });
    assert.equal(host.dataset.flippahFixedFeeCents, '0');
    assert.equal(host.dataset.flippahEconomicsComplete, 'false');
  }
  dom.window.close();
});

test('Buda live notice publishes its calculated two-dollar fee to the lot-panel bridge', () => {
  const lot: any = {
    source: 'hibid-api', pageKind: 'lot', id: 'buda-live-fee', eventItemId: 'buda-live-fee', itemId: '', lot: '1',
    title: 'Buda test lot', lead: 'Buda test lot', url: '/lot/buda-live-fee/test', image: '', images: [],
    description: '', descriptionHtml: '', category: '', categories: [], currentBid: 2, nextBid: 2.50,
    bidCount: 0, status: 'OPEN', timeLeft: '', quantity: null, shippingOffered: false,
    auctionId: 'buda', auctionTitle: 'Buda', location: '', buyerPremium: '15%', rawText: '',
    auctionTerms: '', biddingNotice: 'Fees: 15% Buyer’s Premium + $2 per lot/item won',
    paymentInfo: '', shippingAndPickupInfo: '', descriptionFields: {},
  };
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, stateCode: '', taxPctOverride: 0, taxExempt: false });
  const [record] = buildAnalysisRecords([lot], new Map(), new Map(), new Map(), settings);
  assert.equal(record?.economics.knownSubtotal, 4.875);
  assert.equal(Math.round((record?.economics.knownSubtotal ?? 0) * 100) / 100, 4.88);
  assert.equal(record?.economics.flatFees, 2);

  const dom = new JSDOM('<div id="lotlens-root"></div>');
  const host = dom.window.document.getElementById('lotlens-root')!;
  publishLotPanelEconomics(host, record!);
  assert.equal(host.dataset.flippahFixedFeeCents, '200');
  assert.equal(host.dataset.flippahPremiumPct, '15');
  dom.window.close();
});

test('initial lot DOM supplies the visible bidding fee before GraphQL enrichment', () => {
  const dom = new JSDOM(`<h1>Lot # : 118 - Swash Eco Seat 102</h1>
    <div id="lot-details-323679824"><app-lot-details-subpanel>
      <div>High Bid: 7.50 USD</div><div>Time Remaining: 9h 11m</div>
      <button>Bid 10.00 USD</button>
    </app-lot-details-subpanel></div>
    <div class="notice card"><div class="card-header"><h2>Bidding Notice:</h2>
      <p>Fees: 15% Buyer's Premium + $2 per lot/item won</p></div></div>
    <div class="notice card"><div class="card-header"><h2>Auction Notice:</h2>
      <p>Shipping and handling may cost $20 per item.</p></div></div>
    <table><tr><th>Lot #</th><td>118</td></tr><tr><th>Lead</th><td>Swash Eco Seat 102</td></tr>
      <tr><th>Description</th><td>Accessory is $40 per item.</td></tr></table>
    <div id="lotlens-root"></div>`, { url: 'https://hibid.com/lot/323679824' });
  const lot = extractHibidLotDetail(dom.window.document, dom.window.location.href)!;
  assert.equal(lot.biddingNotice, "Fees: 15% Buyer's Premium + $2 per lot/item won");
  assert.equal(lot.currentBid, 7.5);
  assert.equal(lot.nextBid, 10);
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, taxExempt: true });
  const [record] = buildAnalysisRecords([lot], new Map(), new Map(), new Map(), settings);
  assert.equal(record?.economics.flatFees, 2);
  assert.equal(record?.economics.knownSubtotal, 13.5);
  const host = dom.window.document.getElementById('lotlens-root')!;
  publishLotPanelEconomics(host, record!);
  assert.equal(host.dataset.flippahFixedFeeCents, '200');
  dom.window.close();
});

test('live native bid changes recalculate costs and colors without losing hydrated terms or prices', () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, taxExempt: true });
  const lot: any = {
    id: '323017949', auctionId: '779483', title: 'Vicks Sinus Steam Inhaler', lead: 'Vicks Sinus Steam Inhaler',
    currentBid: 6, nextBid: 7, bidCount: 2, status: 'Winning', rawText: 'Winning USD',
    description: 'Condition: New', descriptionHtml: '<p>Condition: New</p>', descriptionFields: { Condition: 'New' },
    buyerPremium: '15%', auctionTerms: '$2 per lot', biddingNotice: '', paymentInfo: '', shippingAndPickupInfo: '',
    image: 'https://example.test/photo.jpg', images: ['https://example.test/photo.jpg'],
    category: '', categories: [], quantity: null,
  };
  const [record] = buildAnalysisRecords([lot], new Map(), new Map(), new Map(), settings);
  record!.amazon = { status: 'matched', query: record!.identity.query, fetchedAt: 1, cached: true, message: 'matched', candidates: [], match: { score: 100, candidate: { asin: 'B0TEST', title: lot.title, price: 30, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0TEST' } } } as any;
  refreshRecordIndicators(record!);
  assert.equal(record!.comparisonCost, 10.05);
  assert.equal(record!.amazonIndicator.cls, 'green');
  const redraw: any = { ...lot, auctionId: '', buyerPremium: '', auctionTerms: '', description: '', descriptionHtml: '', descriptionFields: {}, currentBid: 20, nextBid: 21, bidCount: 9, status: 'Outbid', images: [] };
  const next = refreshLiveAnalysisRecord(record!, redraw, settings, new Map());
  assert.equal(next.lot.nextBid, 21);
  assert.equal(next.lot.currentBid, 20);
  assert.equal(next.lot.bidCount, 9);
  assert.equal(next.lot.status, 'Outbid');
  assert.equal(next.economics.flatFees, 2);
  assert.equal(next.comparisonCost, 26.15);
  assert.equal(next.amazonIndicator.cls, 'red');
  assert.equal(next.amazon, record!.amazon);
  assert.equal(next.lot.description, 'Condition: New');
  assert.equal(next.lot.auctionId, '779483');
  assert.equal(record!.lot.nextBid, 7, 'prior snapshot is immutable');
  const corrected = refreshLiveAnalysisRecord(next, { ...redraw, auctionTerms: '$3 per lot' }, settings, new Map());
  assert.equal(corrected.economics.flatFees, 3);
  const closed = refreshLiveAnalysisRecord(next, { ...redraw, status: 'Closed', currentBid: 20, nextBid: null }, settings, new Map());
  assert.equal(closed.lot.nextBid, 0);
  assert.equal(closed.economics.hammer, 20);
  const foreign = { ...redraw, id: 'OTHER' };
  assert.equal(mergeRetainedLotDetails(foreign, lot), foreign);
  const foreignAuction = { ...redraw, auctionId: 'DIFFERENT' };
  assert.equal(mergeRetainedLotDetails(foreignAuction, lot), foreignAuction);
  record!.state.resaleEstimate = 100;
  record!.state.maxBid = 50;
  record!.state.queryOverride = 'Foreign query';
  record!.outcome = { lotId: lot.id } as any;
  const reset = refreshLiveAnalysisRecord(record!, foreignAuction, settings, new Map());
  assert.equal(reset.amazon, null);
  assert.equal(reset.state.resaleEstimate, null);
  assert.equal(reset.state.maxBid, null);
  assert.equal(reset.state.queryOverride, '');
  assert.equal(reset.outcome, null);
});

test('native text-node bid updates trigger repair but owned annotation text does not', () => {
  const dom = new JSDOM('<app-lot-tile id="lot-192"><span>Bid 7.00 USD</span><div data-flippah-owned="true">Amazon $30</div></app-lot-tile>');
  const tile = dom.window.document.querySelector('app-lot-tile')!;
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(tile, { characterData: true, subtree: true });
  tile.querySelector('span')!.firstChild!.textContent = 'Bid 21.00 USD';
  assert.deepEqual(mutationAffectedLotIds(observer.takeRecords() as any), ['192']);
  tile.querySelector('[data-flippah-owned]')!.firstChild!.textContent = 'Amazon $31';
  assert.deepEqual(mutationAffectedLotIds(observer.takeRecords() as any), []);
  observer.disconnect();
  dom.window.close();
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
  assert.match(source, /affectedIds\.filter\(\(id\) => !this\.records\.has\(id\)\)\.forEach\(\(id\) => reserveTileAnnotationSpace\(id, route\)\)/);
  assert.match(source, /if \(strip\) return;[\s\S]*applyTileAnnotation\(record, route\)/);
  assert.match(source, /flippahRenderSignature/);
  assert.match(source, /retailEvidence = new Map/);
  const locationHandler = source.match(/handleLocationChange\(\): void \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(locationHandler, /retailEvidence\.clear/);
  assert.match(source, /record\.state\.queryOverride === previous\.state\.queryOverride/);
});

test('list and live-account rows wait for hydration and cached evidence before their first annotation paint', async () => {
  for (const kind of ['lot', 'catalog', 'livecatalog', 'search', 'watchlist', 'currentbids-winning', 'currentbids-outbid']) {
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
  const page = await readFile('src/content/index.ts', 'utf8');
  const intelligence = await readFile('src/intelligence/us-deal-intelligence.ts', 'utf8');
  assert.match(content, /data-flippah-retail-host-for/);
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
  assert.match(content, /host\.attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(content, /mount\.prepend\(host\)/);
  assert.match(content, /if \(route\?\.kind === 'lot'\) return null/);
  assert.match(content, /\[\$\{TILE_ANNOTATION_HOST_ATTRIBUTE\}\]\[data-flippah-owned="true"\]/);
  assert.doesNotMatch(content, /a\[href\*="\/lot\/\$\{escaped\}\//);
  assert.doesNotMatch(content, /insertAdjacentElement\('beforebegin', strip\)|document\.documentElement\.append\(style\)/);
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
  assert.doesNotMatch(content, /style\.display\s*=|style\.opacity\s*=|replaceWith\(|outerHTML\s*=/);
  assert.doesNotMatch(content, /querySelectorAll\([^)]*\)\.forEach\([^)]*hidden/);
  assert.match(page, /attributes: true/);
  assert.match(page, /attributeFilter: \['id', 'href', 'data-event-item-id'\]/);
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
  assert.match(popup, /descriptions on \$\{payload\.audit\.fidelity\.metrics\.description\.percent\}%/);
  assert.match(popup, /image links on \$\{payload\.audit\.fidelity\.metrics\.images\.percent\}%/);
  assert.match(popup, /gallery total unverified/);
  assert.match(exports, /auditHibidRecordFidelity/);
});
