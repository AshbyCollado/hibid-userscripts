import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  DealIntelligenceController,
  buildAnalysisRecords,
  canReuseRetailEvidence,
  retailEvidenceCaptureMatches,
  retailIdentityFingerprint,
  type RetailEvidenceCapture,
} from '../src/content/deal-intelligence.js';
import { extractProductIdentity, type ProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { normalizeSettings } from '../src/core/settings.js';
import { resolveHiBidRoute } from '../src/core/route.js';
import { extractHiBidVisibleLots } from '../src/hibid/dom.js';

const identity = (title = 'Acme Widget 2000', description = ''): ProductIdentity => extractProductIdentity(title, description);

const evidence = (product: ProductIdentity, override = '') => ({
  query: product.query, amazonOverrideAsin: override, identityFingerprint: retailIdentityFingerprint(product),
  result: { status: 'matched' as const, query: product.query, match: null, candidates: [], fetchedAt: 1, cached: true, message: 'cached' },
});

test('same-query component and frame changes reject retained evidence', () => {
  const base = identity('VEVOR pool pump motor', 'Uses a robust 56Y frame and operates at 115V. Includes a replacement pump.');
  const retained = evidence(base);
  assert.equal(canReuseRetailEvidence(retained, identity('VEVOR pool pump motor', 'Uses a robust 56Y frame and operates at 115V. Includes a replacement motor.'), null), false);
  assert.equal(canReuseRetailEvidence(retained, identity('VEVOR pool pump motor', 'Uses a robust 48Y frame and operates at 115V. Includes a replacement pump.'), null), false);
});

test('unchanged identity survives bid-only updates and canonical array order churn', () => {
  const base = identity('Acme Widget 2000', 'Includes pump. 16 oz capacity. 8 oz reservoir.');
  const reordered = identity('Acme Widget 2000', 'Includes pump. 8 oz reservoir. 16 oz capacity.');
  assert.equal(canReuseRetailEvidence(evidence(base), reordered, null), true);
  assert.equal(retailIdentityFingerprint(base), retailIdentityFingerprint(reordered));
});

test('override and request capture stay bound to the original identity', () => {
  const base = identity();
  const capture: RetailEvidenceCapture = { identityFingerprint: retailIdentityFingerprint(base), amazonOverrideAsin: 'B001' };
  assert.equal(canReuseRetailEvidence(evidence(base, 'B001'), base, 'B001'), true);
  assert.equal(canReuseRetailEvidence(evidence(base, 'B001'), base, 'B002'), false);
  assert.equal(retailEvidenceCaptureMatches(base, 'B001', capture), true);
  assert.equal(retailEvidenceCaptureMatches(identity('Acme Widget 2001'), 'B001', capture), false);
});

test('deferred peek result is discarded when same-query description identity changes', async (t) => {
  const dom = new JSDOM(`<app-lot-tile id="lot-192"><a class="title" href="/lot/192/acme-widget-2000">Acme Widget 2000</a><div class="lot-tile-content"></div></app-lot-tile>`, { url: 'https://hibid.com/livecatalog/779483/test' });
  const previousChrome = (globalThis as any).chrome;
  let resolvePeek!: (value: unknown) => void;
  (globalThis as any).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message: any, callback: (response: any) => void) => {
        if (message.type !== 'flippah:retail.peek') return callback({ ok: true, data: [] });
        new Promise((resolve) => { resolvePeek = resolve; }).then(() => callback({ ok: true, data: [{
          status: 'matched', query: 'Acme Widget 2000', match: null, candidates: [], fetchedAt: 1, cached: true, message: 'old result'
        }] }));
      },
    },
  };
  t.after(() => { (globalThis as any).chrome = previousChrome; dom.window.close(); });
  const route = resolveHiBidRoute(dom.window.location.href);
  const [lot] = extractHiBidVisibleLots(dom.window.document, route, dom.window.location.href);
  const settings = normalizeSettings({ taxExempt: true });
  const [record] = buildAnalysisRecords([lot!], new Map(), new Map(), new Map(), settings);
  const controller = new DealIntelligenceController(() => route, { graphql: async () => [], search: async () => [] } as any);
  const pending = (controller as any).restoreCachedEvidence([record], () => true);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  record.identity = extractProductIdentity('Acme Widget 2000', 'Includes replacement pump.');
  resolvePeek(undefined);
  await pending;
  assert.equal(record.amazon, null);
  assert.equal((controller as any).retailEvidence.size, 0);
});

test('deferred provider lookup reruns the current identity without false completion', async (t) => {
  const dom = new JSDOM(`<main><h1>Acme Widget 2000</h1><div id="lot-description">Includes replacement motor.</div><span>Lot #192</span><span>Minimum Next Bid: $7.00</span></main>`, { url: 'https://hibid.com/lot/192/acme-widget-2000' });
  const previousGlobals = new Map(['document', 'window', 'location', 'CSS'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ document: dom.window.document, window: dom.window, location: dom.window.location, CSS: { escape: (value: string) => value }, HTMLAnchorElement: dom.window.HTMLAnchorElement })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const previousChrome = (globalThis as any).chrome;
  const lookupIdentities: ProductIdentity[] = [];
  const lookupResolvers: Array<(value: unknown) => void> = [];
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
          if (peekCount <= 2) {
            new Promise((resolve) => peekResolvers.push(resolve)).then((result) => callback({ ok: true, data: result }));
          } else callback({ ok: true, data: [null] });
          return;
        }
        if (message.type === 'flippah:retail.lookup') {
          lookupIdentities.push(message.payload.identity);
          new Promise((resolve) => lookupResolvers.push(resolve)).then((result) => callback({ ok: true, data: result }));
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
  const controller = new DealIntelligenceController(() => route, { hydrateLots: async () => { throw new Error('use lot-page snapshot'); } } as any);
  const firstRun = (controller as any).run();
  for (let attempt = 0; attempt < 20 && peekResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peekResolvers.length, 1, 'controller reached the first cached-evidence peek');
  peekResolvers.shift()!([null]);
  for (let attempt = 0; attempt < 20 && peekResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peekResolvers.length, 1, 'controller reached the hydrated cached-evidence peek');
  const liveRecord = (controller as any).records.get('192');
  assert.ok(liveRecord, 'controller published the live record between peek phases');
  liveRecord.identity = extractProductIdentity('Acme Widget 2000', 'Includes replacement pump.');
  liveRecord.lot.description = 'Includes replacement pump.';
  liveRecord.lot.descriptionHtml = 'Includes replacement pump.';
  dom.window.document.querySelector('#lot-description')!.textContent = 'Includes replacement pump.';
  peekResolvers.shift()!([{
    status: 'matched', query: 'acme widget 2000', match: null, candidates: [], fetchedAt: 1, cached: true, message: 'stale peek'
  }]);
  for (let attempt = 0; attempt < 20 && lookupResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(lookupResolvers.length, 1, 'controller reached the real provider lookup');
  assert.deepEqual(lookupIdentities[0]!.includedComponents, [['pump']]);
  liveRecord.identity = extractProductIdentity('Acme Widget 2000', 'Includes replacement bag.');
  liveRecord.lot.description = 'Includes replacement bag.';
  liveRecord.lot.descriptionHtml = 'Includes replacement bag.';
  dom.window.document.querySelector('#lot-description')!.textContent = 'Includes replacement bag.';
  lookupResolvers.shift()!({ status: 'matched', query: 'acme widget 2000', match: null, candidates: [], fetchedAt: 1, cached: false, message: 'stale result' });
  await firstRun;
  assert.notEqual(controller.summary().phase, 'complete', 'discarded work cannot report a false complete phase');
  assert.equal(liveRecord.amazon, null, 'stale provider evidence never attaches');
  assert.equal((controller as any).retailEvidence.size, 0);
  for (let attempt = 0; attempt < 20 && lookupResolvers.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(lookupResolvers.length, 1, 'bounded rerun re-entered provider lookup');
  assert.deepEqual(lookupIdentities[1]!.includedComponents, [['bag']]);
  lookupResolvers.shift()!({ status: 'no_match', query: 'acme widget 2000', match: null, candidates: [], fetchedAt: 2, cached: false, message: 'current result' });
  for (let attempt = 0; attempt < 40 && controller.summary().phase !== 'complete'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(controller.summary().phase, 'complete');
  assert.equal(controller.summary().analyzed, 1, 'final progress counts the current lookup exactly once');
});

test('full controller keeps hydrated description after both cache peeks miss', async (t) => {
  const dom = new JSDOM(`<app-lot-tile id="lot-192"><a class="title" href="/lot/192/vevor-mini-scuba-tank-0-5l">VEVOR Mini Scuba Tank 0.5L</a><div class="lot-tile-content"></div></app-lot-tile>`, { url: 'https://hibid.com/catalog/779483/test' });
  const previousGlobals = new Map(['document', 'window', 'location', 'CSS'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ document: dom.window.document, window: dom.window, location: dom.window.location, CSS: { escape: (value: string) => value } })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const previousChrome = (globalThis as any).chrome;
  const lookupIdentities: ProductIdentity[] = [];
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
          callback({ ok: true, data: [null] });
          return;
        }
        if (message.type === 'flippah:retail.lookup') {
          lookupIdentities.push(message.payload.identity);
          callback({ ok: true, data: {
            status: 'no_match', query: message.payload.identity.query, match: null, candidates: [],
            fetchedAt: 1, cached: false, message: 'no current match'
          } });
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
    searchLots: async () => { throw new Error('search should not be used'); },
    hydrateLots: async () => ({ data: { lotSearch: { pagedResults: {
      pageNumber: 1, pageLength: 1, totalCount: 1, filteredCount: 1,
      results: [{ id: '192', lead: 'VEVOR Mini Scuba Tank 0.5L', description: 'Includes hand pump, bag and lanyard.', auction: { id: '779483', currencyAbbreviation: 'USD' }, lotState: {} }]
    } } } }),
  } as any);
  await (controller as any).run();
  assert.equal(peekCount, 2, 'both cache peeks miss');
  const record = (controller as any).records.get('192');
  assert.ok(record);
  assert.match(record.lot.description, /Includes hand pump, bag and lanyard/);
  assert.deepEqual(lookupIdentities[0]!.includedComponents, [['pump'], ['bag'], ['lanyard']]);
});
