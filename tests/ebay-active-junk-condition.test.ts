import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const sourceTitle = 'Alesis Midiverb III 16-Bit Digital Multi-Effect Processor Studio Guitar';
const identity = extractProductIdentity(sourceTitle);

const item = (title: string, itemId: string, overrides: Record<string, unknown> = {}) => ({
  itemId,
  title,
  itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
  price: { value: '100.00', currency: 'USD' },
  shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
  buyingOptions: ['FIXED_PRICE'],
  condition: 'Used',
  ...overrides,
});

const parse = (items: unknown[], overrides: Record<string, unknown> = {}) => parseEbayActiveResults({
  query: 'alesis midiverb iii digital multi-effect processor',
  identity,
  observedAt: '2026-10-04T23:38:28.191Z',
  browseJson: { total: items.length, offset: 0, itemSummaries: items },
  ...overrides,
});

test('rejects the captured Used Junk Condition electronics listing from a normal source benchmark', () => {
  const junkTitle = 'Alesis Midiverb III 16-Bit Digital Multi-Effect Processor Used Junk Condition';
  const result = parse([
    item(junkTitle, '157264373478'),
    item(sourceTitle, '157264373479'),
    item(`${sourceTitle} Tested Working`, '157264373480'),
    item(`${sourceTitle} Fully Functional`, '157264373481'),
  ]);

  assert.equal(result.records[0]?.matchDecision, 'rejected');
  assert.ok(result.records[0]?.rejectionReasons.includes('operability-mismatch:candidate-repair-required'));
  assert.equal(result.accepted.length, 3);
  assert.equal(result.benchmark?.sampleCount, 3);
});

test('allows explicit junk or Japanese-style repair labels only for an equivalent repair-required source', () => {
  const result = parse([
    item(`${sourceTitle} Used Junk Condition`, '157264373482'),
    item(`${sourceTitle} ジャンク品`, '157264373483'),
  ], {
    sourceCondition: { condition: 'Used' },
    sourceDescription: 'Condition: Used\nNotes: Needs repair; sold as a repair-required unit.',
  });

  assert.equal(result.accepted.length, 2, JSON.stringify(result.records.map((record) => record.rejectionReasons)));
  assert.equal(result.records.every((record) => record.rejectionReasons.length === 0), true);
});

test('does not add an operability mismatch for an explicit junk/for-parts label with a parts source', () => {
  const result = parse([item(`${sourceTitle} JUNK / FOR PARTS`, '157264373484')], {
    sourceCondition: { condition: 'For parts or not working' },
    sourceDescription: 'Condition: For parts or not working',
  });

  assert.equal(result.records[0]?.rejectionReasons.includes('operability-mismatch:candidate-repair-required'), false);
  assert.equal(result.records[0]?.rejectionReasons.includes('condition-mismatch:parts-only-comp'), false);
});

test('does not treat unrelated or explicitly resolved junk wording as repair-required', () => {
  const result = parse([
    item('Vintage Junk Journal Electronic Music Notes', '157264373485'),
    item('Junk Drawer Lot with Electronic Parts', '157264373486'),
    item(`${sourceTitle} Not Junk`, '157264373487'),
    item(`${sourceTitle} No Longer Junk Condition - Fully Working`, '157264373488'),
    item(`${sourceTitle} Not in Junk Condition; Fully Repaired and Working`, '157264373489'),
  ]);

  assert.equal(result.records.some((record) => record.rejectionReasons.includes('operability-mismatch:candidate-repair-required')), false);
  assert.equal(result.records.find((record) => record.itemId === '157264373485')?.matchDecision, 'rejected');
  assert.equal(result.records.find((record) => record.itemId === '157264373486')?.matchDecision, 'rejected');
  assert.equal(result.records.find((record) => record.itemId === '157264373487')?.matchDecision, 'accepted');
  assert.equal(result.records.find((record) => record.itemId === '157264373488')?.matchDecision, 'accepted');
  assert.equal(result.records.find((record) => record.itemId === '157264373489')?.matchDecision, 'accepted');
});

const currentJunkEvidence = [
  'Junk Condition - Not Repaired',
  'Serviced but still Junk Condition',
  'Junk Condition - No Repair Required',
  'Junk Condition - Partially Repaired',
  'Junk Condition, Fully Repaired and Working',
  'Not junk condition, but still Junk Condition',
  'No longer junk condition; Junk Condition',
  'Junk Condition is not repaired',
  'Previously in junk condition; now not repaired and working',
  'Previously in junk condition; now partially repaired and working',
  'Previously in junk condition; now serviced and working',
  'Previously in junk condition; now the screen is fully repaired and working',
  'Previously in junk condition; now fully repaired and working; still junk condition',
  'Previously in junk condition; now fully repaired and working; not repaired',
  'Junk Condition; previously in junk condition; now fully repaired and working',
  'Junk Condition',
  '\u30b8\u30e3\u30f3\u30af\u54c1',
] as const;

for (const evidence of currentJunkEvidence) {
  for (const field of ['title', 'condition', 'shortDescription', 'description'] as const) {
    test(`candidate ${field} retains current ${evidence}`, () => {
      const result = parse([item(sourceTitle, '157264373490', {
        [field]: field === 'title' ? `${sourceTitle} ${evidence}`
          : field === 'condition' ? `Used ${evidence}` : evidence,
      })]);

      assert.equal(result.accepted.length, 0);
      assert.equal(result.benchmark, null);
      assert.deepEqual(result.records[0]?.rejectionReasons, ['operability-mismatch:candidate-repair-required']);
    });
  }

  for (const field of ['title', 'condition', 'description'] as const) {
    test(`source ${field} retains current ${evidence} and matches equivalent junk only`, () => {
      const result = parse([
        item(`${sourceTitle} Used Junk Condition`, '157264373491'),
        item(`${sourceTitle} Tested Working`, '157264373492'),
      ], {
        identity: field === 'title' ? { ...identity, name: `${sourceTitle} ${evidence}` } : identity,
        sourceCondition: { condition: field === 'condition' ? `Used ${evidence}` : 'Used' },
        sourceDescription: field === 'description' ? evidence : '',
      });

      assert.deepEqual(result.records[0]?.rejectionReasons, []);
      assert.equal(result.records[0]?.matchDecision, 'accepted');
      assert.deepEqual(result.records[1]?.rejectionReasons, ['operability-mismatch:source-repair-required']);
      assert.equal(result.benchmark, null);
    });
  }
}

for (const evidence of [
  'No longer junk condition - fully working',
  'Not in junk condition; fully repaired and working',
  'Not junk condition, no repair required',
  'Previously in junk condition; now fully repaired and working',
  'Formerly in junk condition; now the unit is fully repaired and working',
  'Was in junk condition; now fully repaired and fully working',
  'No repair required; fully working',
  'Junk',
  'Junk journal',
  'Junk drawer lot',
] as const) {
  for (const field of ['title', 'condition', 'shortDescription', 'description'] as const) {
    test(`candidate ${field} does not infer current junk from ${evidence}`, () => {
      const result = parse([item(sourceTitle, '157264373493', {
        [field]: field === 'title' ? `${sourceTitle} ${evidence}`
          : field === 'condition' ? `Used ${evidence}` : evidence,
      })]);
      assert.deepEqual(result.records[0]?.rejectionReasons, []);
      assert.equal(result.records[0]?.matchDecision, 'accepted');
    });
  }
  for (const field of ['title', 'condition', 'description'] as const) {
    test(`source ${field} does not infer current junk from ${evidence}`, () => {
      const result = parse([item(sourceTitle, '157264373493')], {
        identity: field === 'title' ? { ...identity, name: `${sourceTitle} ${evidence}` } : identity,
        sourceCondition: { condition: field === 'condition' ? `Used ${evidence}` : 'Used' },
        sourceDescription: field === 'description' ? evidence : '',
      });
      assert.deepEqual(result.records[0]?.rejectionReasons, []);
      assert.equal(result.records[0]?.matchDecision, 'accepted');
    });
  }
}

test('affirmative junk in a separate field survives another fields local negation', () => {
  const result = parse([item(`${sourceTitle} Not Junk Condition`, '157264373494', {
    condition: 'Used Junk Condition',
    description: 'No longer junk condition - fully working',
  })]);

  assert.deepEqual(result.records[0]?.rejectionReasons, ['operability-mismatch:candidate-repair-required']);
});

test('excludes auction and manufacturer junk boilerplate from item condition', () => {
  const description = 'Condition: Used\nAuction Terms: Electronics may be sold in junk condition\nManufacturer Description: Avoid junk condition units';
  const result = parse([item(sourceTitle, '157264373495', { description })], {
    sourceCondition: { condition: 'Used' }, sourceDescription: description,
  });

  assert.deepEqual(result.records[0]?.rejectionReasons, []);
});

test('source junk condition survives an excluded description section in another field', () => {
  const result = parse([item(sourceTitle, '157264373495')], {
    sourceCondition: { condition: 'Used Junk Condition' },
    sourceDescription: 'Manufacturer Description: Works with digital equipment',
  });

  assert.deepEqual(result.records[0]?.rejectionReasons, ['operability-mismatch:source-repair-required']);
});

test('rejecting a junk row preserves unknown shipping and blocks the delivered benchmark', () => {
  const result = parse([
    item(`${sourceTitle} Used Junk Condition`, '157264373496'),
    item(sourceTitle, '157264373497', { shippingOptions: [] }),
    item(sourceTitle, '157264373498'),
    item(sourceTitle, '157264373499'),
  ]);

  assert.equal(result.accepted.length, 3);
  assert.equal(result.accepted[0]?.shippingPrice, null);
  assert.equal(result.accepted[0]?.deliveredTotal, null);
  assert.equal(result.benchmark, null);
});
