import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DealIntelligenceController, applyTileAnnotation, buildAnalysisRecords, refreshRecordIndicators } from '../src/content/deal-intelligence.js';
import { normalizeSettings } from '../src/core/settings.js';
import { resolveHiBidRoute } from '../src/core/route.js';
import { extractHiBidVisibleLots } from '../src/hibid/dom.js';

test('real native mutation callback refreshes stored live costs without another network request', async (t) => {
  const dom = new JSDOM(`<app-lot-tile id="lot-192">
    <a class="title" href="/lot/192/vicks-steam-inhaler">Lot 192 | Vicks Sinus Steam Inhaler</a>
    <div class="lot-tile-content"></div>
    <div class="lot-high-bid">High Bid: 6.00 USD</div><span>2 Bids</span>
    <button>Bid <span class="TileDisplayMinBid">7.00 USD</span></button>
  </app-lot-tile>`, { url: 'https://hibid.com/livecatalog/779483/test' });
  const globals = { document: dom.window.document, window: dom.window, location: dom.window.location, CSS: { escape: (value: string) => value }, HTMLAnchorElement: dom.window.HTMLAnchorElement };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }));
  let observer: MutationObserver | undefined;
  t.after(() => {
    observer?.disconnect();
    dom.window.close();
    previous.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  });
  const route = resolveHiBidRoute(dom.window.location.href);
  const [visible] = extractHiBidVisibleLots(dom.window.document, route, dom.window.location.href);
  const settings = normalizeSettings({ taxExempt: true });
  const [record] = buildAnalysisRecords([{ ...visible!, auctionTerms: '$2 per lot', buyerPremium: '15%', description: 'Condition: New' }], new Map(), new Map(), new Map(), settings);
  record!.amazon = { status: 'matched', query: record!.identity.query, candidates: [], fetchedAt: 1, cached: true, message: 'retained', match: { score: 100, candidate: { asin: 'B0TEST', title: record!.lot.title, price: 30, url: 'https://www.amazon.com/dp/B0TEST', used: false, sponsored: false } } };
  refreshRecordIndicators(record!);
  let networkCalls = 0;
  const failNetwork = async () => { networkCalls += 1; throw new Error('Live repair must not refetch research'); };
  const controller = new DealIntelligenceController(() => route, { graphql: failNetwork, search: failNetwork } as any);
  Object.assign(controller, { records: new Map([['192', record]]), liveSettings: settings, liveAuctionPremiums: new Map(), visibleLotSignature: '192' });
  applyTileAnnotation(record!, route);
  observer = new dom.window.MutationObserver((mutations) => controller.handleMutations(mutations as any));
  observer.observe(dom.window.document.body, { characterData: true, childList: true, subtree: true });
  const bid = dom.window.document.querySelector('.TileDisplayMinBid')!;
  bid.firstChild!.textContent = '21.00 USD';
  dom.window.document.querySelector('.lot-high-bid')!.firstChild!.textContent = 'High Bid: 20.00 USD';
  const deadline = Date.now() + 2_000;
  while (record!.lot.nextBid !== 21 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(record!.lot.nextBid, 21, 'queue-held record sees the new native bid');
  assert.equal(record!.lot.currentBid, 20);
  assert.equal(record!.comparisonCost, 26.15);
  assert.equal(record!.economics.flatFees, 2);
  const host = dom.window.document.querySelector('[data-flippah-retail-host-for="192"]')!;
  const strip = host.shadowRoot!.querySelector('.flippah-deal-strip')!;
  assert.match(strip.textContent || '', /Amazon \$30\.00/);
  assert.match(strip.textContent || '', /Est\. \$26\.15 \+ costs/);
  assert.ok(strip.querySelector('a.red'));
  assert.equal(dom.window.document.querySelectorAll('[data-flippah-retail-host-for]').length, 1);
  assert.equal(bid.textContent, '21.00 USD');
  assert.equal((controller as any).records.get('192'), record);
  assert.equal(networkCalls, 0);
  let nativeClicks = 0;
  dom.window.document.querySelector('button')!.addEventListener('click', () => { nativeClicks += 1; });
  dom.window.document.querySelector('button')!.click();
  assert.equal(nativeClicks, 1);
});

test('deferred second peek reconciles an unchanged-identity bid increase', async (t) => {
  const dom = new JSDOM(`<app-lot-tile id="lot-192">
    <a class="title" href="/lot/192/vicks-steam-inhaler">Lot 192 | Vicks Sinus Steam Inhaler</a>
    <div class="lot-tile-content"></div>
    <div class="lot-high-bid">High Bid: 6.00 USD</div><span>2 Bids</span>
    <button>Bid <span class="TileDisplayMinBid">7.00 USD</span></button>
  </app-lot-tile>`, { url: 'https://hibid.com/catalog/779483/test' });
  const previousGlobals = new Map(['document', 'window', 'location', 'CSS', 'HTMLAnchorElement'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ document: dom.window.document, window: dom.window, location: dom.window.location, CSS: { escape: (value: string) => value }, HTMLAnchorElement: dom.window.HTMLAnchorElement })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const previousChrome = (globalThis as any).chrome;
  const peekResolvers: Array<(value: unknown) => void> = [];
  let peekCount = 0;
  (globalThis as any).chrome = {
    storage: {
      sync: { get: (_keys: unknown, callback: (value: unknown) => void) => callback({ taxExempt: true, amazonAutoLookup: true }) },
      local: { get: (_keys: unknown, callback: (value: unknown) => void) => callback({}) },
    },
    runtime: {
      lastError: undefined,
      sendMessage: (message: any, callback: (response: any) => void) => {
        if (message.type === 'flippah:retail.peek') {
          peekCount += 1;
          new Promise((resolve) => peekResolvers.push(resolve)).then((result) => callback({ ok: true, data: result }));
          return;
        }
        if (message.type === 'flippah:retail.lookup') {
          callback({ ok: true, data: { status: 'no_match', query: message.payload.identity.query, match: null, candidates: [], fetchedAt: 2, cached: false, message: 'current result' } });
          return;
        }
        callback({ ok: true, data: undefined });
      },
    },
  };
  t.after(() => {
    (globalThis as any).chrome = previousChrome;
    previousGlobals.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    dom.window.close();
  });
  const route = resolveHiBidRoute(dom.window.location.href);
  const controller = new DealIntelligenceController(() => route, {
    hydrateLots: async () => ({ data: { lotSearch: { pagedResults: {
      pageNumber: 1, pageLength: 1, totalCount: 1, filteredCount: 1,
      results: [{ id: '192', lead: 'Vicks Sinus Steam Inhaler', description: 'Condition: New', auction: { id: '779483', currencyAbbreviation: 'USD' }, lotState: {} }]
    } } } }),
  } as any);
  const run = (controller as any).run();
  for (let attempt = 0; attempt < 40 && peekResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peekResolvers.length, 1, 'controller reached the first cached-evidence peek');
  peekResolvers.shift()!([null]);
  for (let attempt = 0; attempt < 40 && peekResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peekResolvers.length, 1, 'controller reached the deferred second cached-evidence peek');
  const bid = dom.window.document.querySelector('.TileDisplayMinBid')!;
  bid.firstChild!.textContent = '21.00 USD';
  dom.window.document.querySelector('.lot-high-bid')!.firstChild!.textContent = 'High Bid: 20.00 USD';
  controller.handleMutations([{ addedNodes: [], removedNodes: [], target: bid, type: 'characterData' } as any]);
  await new Promise((resolve) => setTimeout(resolve, 160));
  peekResolvers.shift()!([null]);
  await run;
  assert.equal(peekCount, 2);
  const record = (controller as any).records.get('192');
  assert.ok(record);
  assert.equal(record.lot.nextBid, 21);
  assert.equal(record.lot.currentBid, 20);
  assert.equal(record.comparisonCost, 21);
  assert.equal(record.economics.hammer, 21);
});
