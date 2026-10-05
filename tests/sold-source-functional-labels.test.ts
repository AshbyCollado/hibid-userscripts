import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseSellerHubProductResearch, verifyEbaySoldCompSet } from '../src/intelligence/ebay-sold-results.js';
import { assessCondition, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const identity = extractProductIdentity('Rane HC6');
const url = 'https://www.ebay.com/sh/research?keywords=rane%20hc6&tabName=SOLD';
const dom = new JSDOM(`<div role="tab" aria-selected="true">Sold</div><table><tbody>
  <tr class="research-table-row">
    <td class="research-table-row__product-info"><a class="research-table-row__link-row-anchor" href="https://www.ebay.com/itm/123456789012">Rane HC6 Tested Working</a></td>
    <td class="research-table-row__avgSoldPrice"><div>$50.00</div><div class="format">Fixed price</div></td>
    <td class="research-table-row__avgShippingCost">$10.00</td>
    <td class="research-table-row__totalSoldCount">1</td>
    <td class="research-table-row__totalSalesValue">$50.00</td>
    <td class="research-table-row__dateLastSold">Sep 28, 2026</td>
  </tr></tbody></table><button aria-label="Go to next page" disabled>Next</button>`, { url });
const attempt = parseSellerHubProductResearch(dom.window.document, url, '2026-10-03T12:00:00.000Z');
dom.window.close();
assert.equal(attempt.records.length, 1);

test('Sold comparison preserves structured affirmative functional evidence alongside Powers On', () => {
  const sourceCondition = assessCondition('Condition: Good\nFunctional?: Yes\nNotes: Powers On');
  assert.equal(sourceCondition.positive, true);
  const result = verifyEbaySoldCompSet(identity, [attempt], {
    sourceCondition, plannedQueries: ['rane hc6'], minimumSampleSize: 1,
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.status, 'verified');
});

test('functional No and N/A never become an affirmative working claim', () => {
  for (const value of ['No', 'N/A', 'Unable to Test']) {
    const sourceCondition = assessCondition(`Condition: Good\nFunctional?: ${value}\nNotes: Powers On`);
    assert.equal(sourceCondition.positive, false, value);
    const result = verifyEbaySoldCompSet(identity, [attempt], {
      sourceCondition, plannedQueries: ['rane hc6'], minimumSampleSize: 1,
    });
    assert.equal(result.accepted.length, 0, value);
  }
});

test('Functional Yes does not remove explicit Powers On only uncertainty', () => {
  const sourceCondition = assessCondition('Condition: Good\nFunctional?: Yes\nNotes: Powers On only');
  const result = verifyEbaySoldCompSet(identity, [attempt], {
    sourceCondition, plannedQueries: ['rane hc6'], minimumSampleSize: 1,
  });
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:working-comp-for-untested-lot'));
});
