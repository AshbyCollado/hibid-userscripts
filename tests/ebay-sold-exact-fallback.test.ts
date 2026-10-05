import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parsePublicEbaySoldSearch } from '../src/intelligence/ebay-sold-results.js';

const sourceUrl = 'https://www.ebay.com/sch/i.html?_nkw=West+Elm+Cozy+Plush+rug+9x12&LH_Sold=1&LH_Complete=1';

function soldCard(itemId: string, title: string, price: string): string {
  return `<li class="s-card" id="item${itemId}">
    <a class="s-card__link" href="https://www.ebay.com/itm/${itemId}">
      <span class="s-card__title">${title}</span>
    </a>
    <span class="s-card__caption">Sold Sep 13, 2026</span>
    <span class="s-card__price">${price}</span>
    <span class="s-card__subtitle">New</span>
  </li>`;
}

test('explicit zero exact matches without a rewrite boundary produce no results', () => {
  const html = `<h1 id="srp-results-heading">No exact matches found</h1>
    <h2>Results matching fewer words</h2>
    <div id="srp-river-results"><ul class="srp-results">${soldCard('111111111111', 'West Elm Karima Reversible Rug 6x9 Ft Copper New!', '$360.00')}</ul></div>`;
  const document = new JSDOM(html, { url: sourceUrl }).window.document;
  const result = parsePublicEbaySoldSearch(document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'no-results');
  assert.deepEqual(result.records, []);
});

test('normal result cards remain parseable without a zero-exact heading', () => {
  const html = `<h1 id="srp-results-heading">Sold results</h1>
    <div id="srp-river-results"><ul class="srp-results">
      ${soldCard('111111111111', 'West Elm Cozy Plush Rug 9x12', '$360.00')}
    </ul></div>`;
  const document = new JSDOM(html, { url: sourceUrl }).window.document;
  const result = parsePublicEbaySoldSearch(document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.records.map((record) => record.itemId), ['111111111111']);
});

test('hidden, sidebar, and card headings cannot erase a valid result', () => {
  const html = `<h1 id="srp-results-heading">1 result</h1>
    <aside hidden><h2 id="sidebar-status">0 results</h2></aside>
    <aside><h2 class="srp-controls__count-heading">0 results</h2></aside>
    <div id="srp-river-results"><ul class="srp-results">
      <li class="s-card" id="item111111111111"><h2>0 results</h2>
        <a class="s-card__link" href="https://www.ebay.com/itm/111111111111"><span class="s-card__title">West Elm Cozy Plush Rug 9x12</span></a>
        <span class="s-card__caption">Sold Sep 13, 2026</span><span class="s-card__price">$360.00</span>
      </li>
    </ul></div>`;
  const result = parsePublicEbaySoldSearch(new JSDOM(html, { url: sourceUrl }).window.document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.records.map((record) => record.itemId), ['111111111111']);
});

test('a hidden canonical count heading does not erase a valid result', () => {
  const html = `<h1 id="srp-results-heading" hidden>0 results</h1>
    <div id="srp-river-results"><ul class="srp-results">
      ${soldCard('111111111111', 'West Elm Cozy Plush Rug 9x12', '$360.00')}
    </ul></div>`;
  const result = parsePublicEbaySoldSearch(new JSDOM(html, { url: sourceUrl }).window.document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.records.map((record) => record.itemId), ['111111111111']);
});

test('loading zero-exact pages remain parse errors', () => {
  const html = `<h1 id="srp-results-heading">No exact matches found</h1>
    <div id="srp-river-results" aria-busy="true"><ul class="srp-results">
      ${soldCard('111111111111', 'West Elm Karima Reversible Rug 6x9 Ft Copper New!', '$360.00')}
    </ul></div>`;
  const document = new JSDOM(html, { url: sourceUrl }).window.document;
  const result = parsePublicEbaySoldSearch(document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'sold-search-still-loading');
  assert.deepEqual(result.records, []);
});

test('a busy results list is not final zero-result evidence', () => {
  const html = `<h1 id="srp-results-heading">No exact matches found</h1>
    <div id="srp-river-results"><ul class="srp-results" aria-busy="true">
      ${soldCard('111111111111', 'West Elm Karima Reversible Rug 6x9', '$360.00')}
    </ul></div>`;
  const result = parsePublicEbaySoldSearch(new JSDOM(html, { url: sourceUrl }).window.document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'sold-search-still-loading');
  assert.deepEqual(result.records, []);
});

test('a rewrite boundary before every card confirms zero exact results', () => {
  const html = `<h1 id="srp-results-heading">0 results for exact query</h1>
    <div id="srp-river-results"><div class="srp-river-answer--REWRITE_START"><h2>Results matching fewer words</h2>
      <ul class="srp-results">${soldCard('111111111111', 'West Elm Karima Reversible Rug 6x9', '$360.00')}</ul>
    </div></div>`;
  const result = parsePublicEbaySoldSearch(new JSDOM(html, { url: sourceUrl }).window.document, sourceUrl, '2026-09-22T12:00:00.000Z');

  assert.equal(result.status, 'no-results');
  assert.deepEqual(result.records, []);
});
