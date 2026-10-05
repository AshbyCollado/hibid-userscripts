import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseSellerHubProductResearch, verifyEbaySoldCompSet } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const sourceUrl = 'https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=receiver&offset=0&limit=50&tabName=SOLD';
const observedAt = '2026-09-30T12:00:00.000Z';

function documentFor(html: string): Document {
  return new JSDOM(html, { url: 'https://www.ebay.com/' }).window.document;
}

function sellerHubRow(title = 'Onkyo TX-SR304 Receiver'): string {
  return `<tr class="research-table-row">
    <td class="research-table-row__product-info">
      <a class="research-table-row__link-row-anchor" href="https://www.ebay.com/itm/123456789012"><span data-item-id="123456789012">${title}</span></a>
    </td>
    <td class="research-table-row__avgSoldPrice">$49.99</td>
    <td class="research-table-row__avgShippingCost">$0.00</td>
    <td class="research-table-row__totalSoldCount">1</td>
    <td class="research-table-row__totalSalesValue">$49.99</td>
  </tr>`;
}

function productResearchHtml(content = '', rows = sellerHubRow()): string {
  return `<!doctype html><html><body>
    <div role="tab" aria-selected="true">Sold</div>
    ${content}
    <table><tbody>${rows}</tbody></table>
  </body></html>`;
}

function parse(html: string) {
  return parseSellerHubProductResearch(documentFor(html), sourceUrl, observedAt);
}

test('stale visible Seller Hub query error does not override populated sold rows', () => {
  const result = parse(productResearchHtml('<h2>Our server failed to respond to your query. Please try again later.</h2>'));
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('visible Seller Hub query error is a parse failure even without rows', () => {
  const result = parse(productResearchHtml('<div role="alert">Our server failed to respond to your query. Please try again later.</div>', ''));
  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'seller-hub-query-server-error');
  assert.equal(result.records.length, 0);
});

test('empty Seller Hub Sold state without a query error is no-results', () => {
  const result = parse(productResearchHtml('<h2>No sold results found for "receiver"</h2>', ''));
  assert.equal(result.status, 'no-results');
  assert.equal(result.records.length, 0);
});

test('hidden Seller Hub query error with an empty state remains no-results', () => {
  const result = parse(productResearchHtml('<h2 hidden>Our server failed to respond to your query. Please try again later.</h2><h2>No sold results found for "receiver"</h2>', ''));
  assert.equal(result.status, 'no-results');
  assert.equal(result.records.length, 0);
});

test('visible Seller Hub query error with an unparseable stale table is a parse failure', () => {
  const result = parse(productResearchHtml(
    '<h2>Our server failed to respond to your query. Please try again later.</h2>',
    '<tr class="research-table-row"><td>stale row without a listing link</td></tr>',
  ));
  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'seller-hub-query-server-error');
  assert.equal(result.records.length, 0);
});

test('hidden Seller Hub query error does not override valid sold rows', () => {
  const result = parse(productResearchHtml('<h2 hidden>Our server failed to respond to your query. Please try again later.</h2>'));
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('query-error wording in a listing title does not fail the page', () => {
  const result = parse(productResearchHtml('', sellerHubRow('Our server failed to respond to your query. Please try again later.')));
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('normal Seller Hub sold table remains ok', () => {
  const result = parse(productResearchHtml());
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 1);
});

test('visible query error takes precedence over an empty-results heading', () => {
  const result = parse(productResearchHtml('<h2>Our server failed to respond to your query.</h2><h2>No sold results found</h2>', ''));
  assert.equal(result.status, 'parse-error');
  assert.equal(result.failureReason, 'seller-hub-query-server-error');
});

for (const [name, error] of [
  ['hidden descendant', '<div role="alert"><span hidden>Our server failed to respond to your query.</span></div>'],
  ['ARIA-hidden descendant', '<div role="alert"><span aria-hidden="true">Our server failed to respond to your query.</span></div>'],
  ['hidden ancestor', '<section hidden><h2>Our server failed to respond to your query.</h2></section>'],
  ['CSS-hidden ancestor', '<style>.concealed { display: none; }</style><section class="concealed"><h2>Our server failed to respond to your query.</h2></section>'],
  ['CSS-hidden descendant', '<style>.concealed { visibility: hidden; }</style><div role="alert"><span class="concealed">Our server failed to respond to your query.</span></div>'],
]) {
  test(`${name} does not override a visible empty-results state`, () => {
    const result = parse(productResearchHtml(`${error}<h2>No sold results found</h2>`, ''));
    assert.equal(result.status, 'no-results');
  });
}

test('visible query-error text split across inline elements is recognized', () => {
  const result = parse(productResearchHtml('<div role="alert">Our server <strong>failed to respond</strong> to your query.</div>', ''));
  assert.equal(result.status, 'parse-error');
});

test('repeated Seller Hub rows retain conflicting paid amounts until verification', () => {
  const result = parse(productResearchHtml('', sellerHubRow() + sellerHubRow().replaceAll('$49.99', '$999.00')));
  assert.equal(result.records.length, 2);
  const verified = verifyEbaySoldCompSet(extractProductIdentity('Onkyo TX-SR304 Receiver'), [result], { plannedQueries: ['receiver'], minimumSampleSize: 1 });
  assert.equal(verified.accepted.length, 0);
  assert.ok(verified.rejected[0]?.reasons.includes('duplicate-record-conflict'));
});

test('identical repeated Seller Hub rows count once after verification', () => {
  const result = parse(productResearchHtml('', sellerHubRow() + sellerHubRow()));
  assert.equal(result.records.length, 2);
  const verified = verifyEbaySoldCompSet(extractProductIdentity('Onkyo TX-SR304 Receiver'), [result], { plannedQueries: ['receiver'], minimumSampleSize: 1 });
  assert.equal(verified.accepted.length, 1);
  assert.deepEqual(verified.duplicateItemIds, ['123456789012']);
});

test('conflicting sold quantity, date or condition never collapses into accepted proof', () => {
  const original = sellerHubRow().replace('</tr>', '<td class="research-table-row__dateLastSold">Sep 20, 2026</td><td class="research-table-row__condition">Used</td></tr>');
  for (const changed of [
    original.replace('__totalSoldCount">1', '__totalSoldCount">3'),
    original.replace('Sep 20, 2026', 'Sep 21, 2026'),
    original.replace('__condition">Used', '__condition">For parts'),
  ]) {
    const result = parse(productResearchHtml('', original + changed));
    assert.equal(result.records.length, 2);
    const verified = verifyEbaySoldCompSet(extractProductIdentity('Onkyo TX-SR304 Receiver'), [result], { plannedQueries: ['receiver'], minimumSampleSize: 1 });
    assert.equal(verified.accepted.length, 0);
    assert.ok(verified.rejected[0]?.reasons.includes('duplicate-record-conflict'));
  }
});
