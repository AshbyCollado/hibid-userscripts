import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeSettings } from '../src/core/settings.js';
import { buildAnalysisRecords, refreshRecordIndicators, renderLotPanel } from '../src/content/deal-intelligence.js';

test('pending lot-panel provider links retain keyboard focus when a matched price arrives', () => {
  const dom = new JSDOM('<div id="lotlens-root"></div>', { url: 'https://hibid.com/lot/900/camera' });
  const globals = { document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser, Event: dom.window.Event };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, configurable: true }));
  try {
    const shadow = dom.window.document.getElementById('lotlens-root')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div class="lotlens-panel"><div class="lotlens-actions"></div></div>';
    const [record] = buildAnalysisRecords([{ id: '900', auctionId: '42', title: 'Canon camera', lead: 'Canon camera',
      currentBid: 5, nextBid: 6, description: 'Condition: New', descriptionFields: {}, buyerPremium: '15%',
      images: [], rawText: '6 USD' } as any], new Map(), new Map(), new Map(), normalizeSettings({ taxExempt: true }));
    assert.ok(renderLotPanel(record!, () => undefined));
    shadow.querySelector<HTMLAnchorElement>('[data-provider="amazon"]')!.focus();
    const outcomeInput = shadow.querySelector<HTMLInputElement>('#flippah-outcome-sold')!;
    outcomeInput.value = '123';
    const details = shadow.querySelector<HTMLDetailsElement>('details')!;
    details.open = true;
    record!.amazon = { status: 'matched', query: record!.identity.query, candidates: [], fetchedAt: 1, cached: true, message: 'Matched',
      match: { score: 100, candidate: { asin: 'B0TEST', title: 'Canon camera', price: 30, url: 'https://www.amazon.com/dp/B0TEST', used: false, sponsored: false } } };
    refreshRecordIndicators(record!);
    renderLotPanel(record!, () => undefined);
    assert.equal((shadow.activeElement as HTMLElement)?.dataset.provider, 'amazon');
    assert.equal(shadow.activeElement?.tagName, 'A');
    assert.match(shadow.activeElement?.textContent || '', /30\.00/);
    assert.equal(shadow.querySelector<HTMLInputElement>('#flippah-outcome-sold')!.value, '123');
    assert.equal(shadow.querySelector<HTMLDetailsElement>('details')!.open, true);
  } finally {
    previous.forEach((descriptor, key) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    dom.window.close();
  }
});
