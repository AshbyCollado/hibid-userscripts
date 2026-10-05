import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parsePublicEbaySoldSearch } from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-09-30T12:00:00.000Z';
const originalQuery = 'pitch forks silage fork';
const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&LH_Sold=1&LH_Complete=1`;

function documentFor(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url }).window.document;
}

function card(): string {
  return `<ul class="srp-results"><li class="s-item">
    <a class="s-item__link" href="https://www.ebay.com/itm/123456789012"><span class="s-item__title">Pitch forks silage fork</span></a>
    <span class="s-item__price">$42.00</span><span class="s-item__shipping">Free shipping</span>
    <span class="SECONDARY_INFO">Used</span><span class="s-item__caption--signal">Sold Sep 1, 2026</span>
  </li></ul>`;
}

function correctionUi(options: { hidden?: string; heading?: string; link?: string; linkHidden?: string } = {}): string {
  const hidden = options.hidden || '';
  const heading = options.heading || '1,800+ results for pitch forks silver fork';
  const link = options.link || `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&LH_Sold=1&LH_Complete=1&_blrs=spell_auto_correct`;
  const linkHidden = options.linkHidden || '';
  return `<div class="srp-controls" ${hidden}><div class="srp-controls__row-cells"><div class="srp-controls__control srp-controls__count"><h1 id="srp-results-heading" class="srp-controls__count-heading">${heading}</h1></div></div></div>
    <span class="section-notice__main"><p>Including results for pitch forks silver fork. Search instead for <span ${linkHidden}><a href="${link}"><span class="PSEUDOLINK">pitch forks silage fork</span></a></span></p></span>`;
}

test('visible canonical correction rejects corrected cards as a parse error', () => {
  const result = parsePublicEbaySoldSearch(documentFor(`${correctionUi()}${card()}`), url, observedAt);
  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'sold-search-query-corrected');
  assert.deepEqual(result.records, []);
});

test('exact search-instead retry keeps parsing the original query', () => {
  const html = `<div class="srp-controls"><h1 id="srp-results-heading">14 results for ${originalQuery}</h1>
    <div>Search results for ${originalQuery}.</div></div>${card()}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.priceKind, 'public-visible');
});

test('observed retry URL and nested count spans retain all seven exact-query cards', () => {
  const retryUrl = 'https://www.ebay.com/sch/i.html?_nkw=pitch+forks+silage+fork&_sacat=0&_from=R40&LH_Complete=1&LH_Sold=1&_blrs=spell_auto_correct';
  const cards = Array.from({ length: 7 }, (_, index) => card().replaceAll('123456789012', String(123456789012 + index))).join('');
  const html = `<div class="srp-controls"><h1 id="srp-results-heading" class="srp-controls__count-heading"><span class="BOLD">7</span> results for <span class="BOLD">pitch forks silage fork</span></h1></div>${cards}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), retryUrl, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.sourceUrl, retryUrl);
  assert.equal(result.query, originalQuery);
  assert.equal(result.records.length, 7);
  assert.equal(new Set(result.records.map((record) => record.itemId)).size, 7);
  assert.ok(result.records.every((record) => record.priceKind === 'public-visible'));
});

test('hidden correction UI does not trigger, including hidden descendants and CSS ancestors', () => {
  for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility: hidden"']) {
    const result = parsePublicEbaySoldSearch(documentFor(`${correctionUi({ hidden })}${card()}`), url, observedAt);
    assert.equal(result.status, 'ok', hidden);
    assert.equal(result.records.length, 1, hidden);
  }
  const result = parsePublicEbaySoldSearch(documentFor(`<div style="display:none">${correctionUi()}</div>${card()}`), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
  const stylesheetHidden = parsePublicEbaySoldSearch(documentFor(`<style>.hidden-correction { display: none; }</style><div class="hidden-correction">${correctionUi()}</div>${card()}`), url, observedAt);
  assert.equal(stylesheetHidden.status, 'ok');
  assert.equal(stylesheetHidden.records.length, 1);
});

test('hidden correction descendants do not contribute visible correction text or links', () => {
  for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"']) {
    const html = correctionUi({ linkHidden: hidden }) + card();
    const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
    assert.equal(result.status, 'ok', hidden);
    assert.equal(result.records.length, 1, hidden);
  }
});

test('title and sidebar correction-like text are ignored without the canonical heading UI', () => {
  const html = `<aside><h2>Including results for pitch forks silver fork. <a href="/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}">Search instead for ${originalQuery}</a></h2></aside>
    <div class="s-item__title">14 results for pitch forks silver fork</div>${card()}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('marker-only cards and sidebar notices do not trigger correction detection', () => {
  const html = `<aside><div class="section-notice__main">Including results for pitch forks silver fork. <a href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&_blrs=spell_auto_correct">Search instead for ${originalQuery}</a></div></aside>
    <div class="s-item__title">1,800+ results for pitch forks silver fork</div>${card()}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('canonical mismatch ignores fake notices inside sidebar and result cards', () => {
  const fakeNotice = `<span class="section-notice__main">Including results for pitch forks silver fork. Search instead for <a href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&_blrs=spell_auto_correct">${originalQuery}</a></span>`;
  const html = `<div class="srp-controls"><h1 id="srp-results-heading">1,800+ results for pitch forks silver fork</h1></div>
    <aside>${fakeNotice}</aside>
    ${card().replace('<li class="s-item">', `<li class="s-item">${fakeNotice}`)}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('legacy co-located correction keeps accepting prefixed retry link text', () => {
  const link = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&LH_Sold=1&LH_Complete=1&_blrs=spell_auto_correct`;
  const html = `<div class="srp-controls"><h1 id="srp-results-heading">1,800+ results for pitch forks silver fork</h1>
    <div>Including results for pitch forks silver fork. <a href="${link}">Search instead for ${originalQuery}</a>.</div></div>${card()}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'sold-search-query-corrected');
});

test('untrusted or non-spell-correction retry links do not trigger correction detection', () => {
  for (const link of [
    `https://evil.example/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}&_blrs=spell_auto_correct`,
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(originalQuery)}`,
  ]) {
    const result = parsePublicEbaySoldSearch(documentFor(`${correctionUi({ link })}${card()}`), url, observedAt);
    assert.equal(result.status, 'ok', link);
    assert.equal(result.records.length, 1, link);
  }
});

test('ordinary headings normalize case and whitespace without becoming corrections', () => {
  const html = `<div class="srp-controls"><h1 id="srp-results-heading">14   RESULTS for  PITCH FORKS   SILAGE FORK</h1>
    <div>Search results.</div></div>${card()}`;
  const result = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});
