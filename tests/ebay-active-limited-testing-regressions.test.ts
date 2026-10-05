import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const title = 'Canon Pixma G6020 Printer';
function parse(candidateTitle: string, condition = 'Used', sourceDescription = 'The item turns on but has not been fully tested. The ink bottles will need to be replaced. All items are sold as is.', productTitle = title, extra: Record<string, unknown> = {}) {
  return parseEbayActiveResults({
    identity: extractProductIdentity(productTitle), query: productTitle,
    observedAt: '2026-10-01T12:00:00.000Z', sourceDescription,
    browseJson: { total: 3, offset: 0, itemSummaries: [1, 2, 3].map((number) => ({
      itemId: `17810009900${number}`, title: candidateTitle, condition,
      price: { value: '90', currency: 'USD' },
      shippingOptions: [{ shippingCost: { value: '10', currency: 'USD' } }],
      buyingOptions: ['FIXED_PRICE'],
      ...extra,
    })) },
  });
}

for (const phrase of ['Tested Working', 'Fully Functional', 'Working', 'New Sealed', 'Untested Fully Tested', 'Untested Brand New']) {
  test(`partial-test Canon cannot use ${phrase} active asks as a benchmark`, () => {
    const result = parse(`${title} ${phrase}`);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.benchmark, null);
    assert.ok(result.rejected.every((row) => row.rejectionReasons.includes('condition-mismatch:working-comp-for-untested-lot')));
  });
}
test('unspecified function is unresolved rather than a comparable or broken item', () => {
  const result = parse(title);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.every((row) => row.rejectionReasons.includes('condition-ambiguous:comp-function-unconfirmed')));
  assert.ok(result.rejected.every((row) => !row.rejectionReasons.some((reason) => reason.includes('repair-required'))));
});
for (const phrase of ['Untested', 'Not Fully Tested', 'Power-on Only', 'Not New; Untested', 'Functional?: Unknown; Untested']) {
  test(`explicit ${phrase} retains the comparable limited-testing state`, () => {
    const result = parse(`${title} ${phrase}`);
    assert.equal(result.accepted.length, 3);
    assert.equal(result.benchmark?.provisional, true);
  });
}
test('New in an actual product name is not condition evidence', () => {
  const result = parse('New Balance 990v6 Shoes Untested', 'Used', 'Notes: Untested', 'New Balance 990v6 Shoes');
  assert.equal(result.accepted.length, 3);
});
test('healthy source retains ordinary Used asks', () => {
  assert.equal(parse(title, 'Used', 'Condition: Used\nFunctional?: Yes\nDamaged?: No').accepted.length, 3);
});
test('auction boilerplate is not a per-item testing finding', () => {
  assert.equal(parse(title, 'Used', 'Condition: Used\nFunctional?: Yes\nAuction Terms: All items are untested and sold as is.').accepted.length, 3);
});

for (const damage of ['Broken hinge will be repaired', 'Broken hinge should be repaired', 'Bent pins will be straightened', 'Damaged screen needs to be fixed']) {
  test(`future repair does not erase current damage: ${damage}`, () => {
    const result = parse(`${title} Tested Working`, 'Used', `Notes: ${damage}`);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.benchmark, null);
    assert.ok(result.rejected.every((row) => row.rejectionReasons.includes('operability-mismatch:source-repair-required')));
  });
}
test('qualified negative bent pins retains a working comparison but not contrary damage', () => {
  assert.equal(parse(title, 'Used', 'Notes: No visibly bent pins; fully working').accepted.length, 3);
  assert.equal(parse(title, 'Used', 'Notes: No visibly bent pins, but the screen is broken').accepted.length, 0);
});
for (const field of ['shortDescription', 'description']) {
  test(`new-condition evidence in ${field} conflicts with limited testing`, () => {
    const result = parse(`${title} Untested`, 'Used', undefined, undefined, { [field]: 'Untested. Brand new sealed in box.' });
    assert.equal(result.accepted.length, 0);
    assert.equal(result.benchmark, null);
  });
  test(`candidate ${field} has not been fully tested is not affirmative testing`, () => {
    assert.equal(parse(title, 'Used', undefined, undefined, { [field]: 'The item turns on but has not been fully tested.' }).accepted.length, 3);
    assert.equal(parse(title, 'Used', undefined, undefined, { [field]: 'Has not been fully tested. However fully working.' }).accepted.length, 0);
  });
}
test('historical repaired title damage is not parts-only while explicit parts remain parts', () => {
  assert.equal(parse(`${title} Broken hinge repaired; fully working`, 'Used', 'Condition: Used\nFunctional?: Yes').accepted.length, 3);
  assert.equal(parse(`${title} Broken hinge repaired; for parts only`, 'Used', 'Condition: Used\nFunctional?: Yes').accepted.length, 0);
  assert.equal(parse(`${title} Broken hinge repaired; fully working`, 'For parts or not working', 'Condition: Used\nFunctional?: Yes').accepted.length, 0);
  assert.equal(parse(`${title} Broken hinge repaired; screen cracked`, 'Used', 'Condition: Used\nFunctional?: Yes').accepted.length, 0);
});
for (const description of ['Untested; needs new ink cartridges', 'Untested with brand new toner', 'Untested; new batteries installed']) {
  test(`new consumables do not imply a new product: ${description}`, () => {
    assert.equal(parse(`${title} Untested`, 'Used', undefined, undefined, { shortDescription: description }).accepted.length, 3);
  });
}
test('description condition explicitly calls the whole item new', () => {
  assert.equal(parse(`${title} Untested`, 'Used', undefined, undefined, { shortDescription: 'Condition: New; Untested' }).accepted.length, 0);
});
