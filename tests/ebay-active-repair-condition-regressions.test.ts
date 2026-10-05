import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const identity = extractProductIdentity('Canon Pixma MG5420 Wireless Inkjet Printer');

const item = (overrides: Record<string, unknown> = {}) => {
  const itemId = String(overrides.itemId ?? '178100000001');
  return {
    itemId,
    title: 'Canon Pixma MG5420 Wireless Inkjet Printer',
    itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
    price: { value: '80.00', currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: '10.00', currency: 'USD' } }],
    buyingOptions: ['FIXED_PRICE'],
    condition: 'Used',
    ...overrides,
  };
};

const parse = (items: unknown[], overrides: Record<string, unknown> = {}) => parseEbayActiveResults({
  query: 'Canon Pixma MG5420',
  identity,
  observedAt: '2026-09-30T12:00:00.000Z',
  sourceCondition: { condition: 'Good' },
  sourceDescription: "Notes: Needs a new print head\nCondition: Good",
  browseJson: { total: items.length, offset: 0, itemSummaries: items },
  ...overrides,
});

test('live MG5420 repair note rejects ordinary and confirmed-working active asks', () => {
  const result = parse([
    item({ itemId: '178100000011', title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working', condition: 'Used' }),
    item({ itemId: '178100000012', title: 'Canon Pixma MG5420 Wireless Inkjet Printer', condition: 'Good' }),
    item({ itemId: '178100000013', title: 'Canon Pixma MG5420 Wireless Inkjet Printer', condition: 'Good', shortDescription: 'Needs a new print head' }),
  ]);

  assert.equal(result.records[0]?.matchDecision, 'rejected');
  assert.ok(result.records[0]?.rejectionReasons.includes('operability-mismatch:source-repair-required'));
  assert.equal(result.records[1]?.matchDecision, 'rejected');
  assert.equal(result.records[2]?.matchDecision, 'accepted');
  assert.equal(result.benchmark, null);
});

test('ordinary used source preserves simple missing consumables and negated repair language', () => {
  const result = parse([
    item({ itemId: '178100000021', title: 'Canon Pixma MG5420 Wireless Inkjet Printer', condition: 'Used' }),
    item({ itemId: '178100000022', title: 'Canon Pixma MG5420 Wireless Inkjet Printer', condition: 'Used' }),
    item({ itemId: '178100000023', title: 'Canon Pixma MG5420 Wireless Inkjet Printer', condition: 'Used' }),
  ], {
    sourceCondition: { condition: 'Used' },
    sourceDescription: 'Notes: No repair needed; may need ink.\nCondition: Used',
  });

  assert.equal(result.accepted.length, 3);
  assert.ok(result.records.every((record) => !record.rejectionReasons.some((reason) => reason.startsWith('operability-mismatch'))));
});

test('untested remains unknown rather than always-broken', () => {
  const result = parse([
    item({ itemId: '178100000031', title: 'Canon Pixma MG5420 Printer Tested Working', condition: 'Used' }),
  ], {
    sourceCondition: { condition: 'Used' },
    sourceDescription: 'Notes: Untested.\nCondition: Used',
  });

  assert.equal(result.accepted.length, 0);
  assert.ok(result.records[0]?.rejectionReasons.includes('condition-mismatch:working-comp-for-untested-lot'));
  assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason.includes('operability')), false);
});

test('mixed unknown and consumable notes retain explicit repair evidence', () => {
  for (const [index, sourceDescription] of [
    'Notes: Untested needs a new printhead.\nCondition: Used',
    'Notes: Needs ink and printhead.\nCondition: Used',
    'Notes: Does not need ink, needs a new printhead.\nCondition: Used',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000005${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription,
    });

    assert.equal(result.records[0]?.matchDecision, 'rejected');
    assert.ok(result.records[0]?.rejectionReasons.includes('operability-mismatch:source-repair-required'));
  }
});

test('negated repair without actual repair evidence remains ordinary used', () => {
  for (const [index, sourceDescription] of [
    'Notes: Untested, does not need a new printhead.\nCondition: Used',
    'Notes: Does not need ink and does not need printhead.\nCondition: Used',
    'Notes: No repair needed.\nCondition: Used',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000006${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription,
    });

    assert.equal(result.accepted.length, index === 0 ? 0 : 1);
    assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason.startsWith('operability-mismatch')), false);
  }
});

test('structured affirmative damage and repair notes reject working candidates', () => {
  for (const [index, sourceDescription] of [
    'Damaged: Yes\nFunctional: No\nCondition: Used',
    'Broken: Yes\nFunctional: No\nCondition: Used',
    'Notes: Untested, needs a new print head.\nCondition: Used',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000007${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription,
    });

    assert.equal(result.records[0]?.matchDecision, 'rejected');
    assert.ok(result.records[0]?.rejectionReasons.includes('operability-mismatch:source-repair-required'));
  }
});

test('negative structured flags and packaging damage do not force repair matching', () => {
  for (const [index, candidateDescription] of [
    'Damaged: No\nFunctional: Yes',
    'Broken: No\nFunctional: Yes',
    'Working printer with damaged packaging',
    'Printer with LCD display',
    'New printhead installed; working',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000008${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
        shortDescription: candidateDescription,
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription: 'Condition: Used\nNotes: Working printer',
    });

    assert.equal(result.records[0]?.matchDecision, 'accepted');
    assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason.startsWith('operability-mismatch')), false);
  }
});

test('captured healthy Buda lots with question-mark flags do not require repair', () => {
  for (const [index, fixture] of [
    {
      itemId: '178100000091',
      title: 'Apple Pencil for iPad 2nd gen',
      condition: 'New',
      sourceCondition: 'New',
      sourceDescription: 'Brand: Apple\nCondition: New\nIn Packaging?: Yes\nAssembly Required?: No\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: No\nModel: mxn43am/a',
    },
    {
      itemId: '178100000092',
      title: 'Ninja SLUSHi 5-in-1 88 oz Frozen Drink Maker',
      condition: 'New',
      sourceCondition: 'New',
      sourceDescription: 'Brand: Ninja\nCondition: New\nIn Packaging?: Yes\nAssembly Required?: No\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: Unknown\nNotes: New - not in original packaging. Machine and cord only!',
    },
    {
      itemId: '178100000093',
      title: 'Ninja Blast Max Portable Blender, 22oz, Navy',
      condition: 'Open Box - Tested',
      sourceCondition: 'Open Box - Tested',
      sourceDescription: 'Brand: Ninja\nCondition: Open Box - Tested\nIn Packaging?: No\nAssembly Required?: No\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: No\nModel: BC251NV\nNotes: Not in box',
    },
  ].entries()) {
    const result = parseEbayActiveResults({
      query: fixture.title,
      identity: extractProductIdentity(fixture.title),
      observedAt: '2026-09-30T12:00:00.000Z',
      sourceCondition: { condition: fixture.sourceCondition },
      sourceDescription: fixture.sourceDescription,
      browseJson: { total: 1, offset: 0, itemSummaries: [item({
        itemId: fixture.itemId,
        title: fixture.title,
        condition: fixture.condition,
      })] },
    });

    assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason === 'operability-mismatch:source-repair-required'), false, `fixture ${index + 1}`);
  }
});

test('question-mark flag formatting and unknown statuses stay non-repair evidence', () => {
  for (const [index, candidateDescription] of [
    'DAMAGED ? : No\nFUNCTIONAL ? : Yes',
    'Damaged? : No Functional? : Yes',
    'Damaged?&nbsp;: No<br>Functional? : Unable to Test',
    'Damaged?: Unknown\nFunctional?: Unavailable',
    'Damaged?: N/A\nFunctional?: Not Applicable',
    'Damaged?: N.A.\nFunctional?: Unknown',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000010${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
        shortDescription: candidateDescription,
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription: 'Condition: Used\nNotes: Working printer',
    });

    assert.equal(result.records[0]?.matchDecision, 'accepted', `fixture ${index + 1}`);
  }
});

test('structured negative flags do not swallow contradictory damage notes', () => {
  for (const [index, candidateDescription] of [
    'Damaged?: No\nNotes: hinge is broken',
    'Functional?: Yes\nNotes: bent pin prevents operation and needs repair',
    'Damaged?: No\nNotes: headband broken and missing parts',
  ].entries()) {
    const result = parse([
      item({
        itemId: `17810000011${index}`,
        title: 'Canon Pixma MG5420 Wireless Inkjet Printer Tested Working',
        condition: 'Used',
        shortDescription: candidateDescription,
      }),
    ], {
      sourceCondition: { condition: 'Used' },
      sourceDescription: 'Condition: Used\nNotes: Working printer',
    });

    assert.equal(result.records[0]?.rejectionReasons.includes('operability-mismatch:candidate-repair-required'), true, `fixture ${index + 1}`);
  }
});

test('repair-only source and repair-only candidate can match when both are explicit', () => {
  const result = parse([
    item({
      itemId: '178100000041',
      title: 'Canon Pixma MG5420 Wireless Inkjet Printer',
      condition: 'For parts or not working',
      conditionId: '7000',
    }),
  ], {
    sourceCondition: { condition: 'For parts or not working' },
    sourceDescription: 'Notes: Needs a new print head.\nCondition: For parts or not working',
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason.startsWith('operability-mismatch')), false);
});

test('parts condition ID is repair-aligned with a parts source', () => {
  const result = parse([
    item({
      itemId: '178100000051',
      title: 'Canon Pixma MG5420 Wireless Inkjet Printer',
      condition: 'Used',
      conditionId: '7000',
    }),
  ], {
    sourceCondition: { condition: 'For parts only' },
    sourceDescription: 'Condition: For parts only',
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.records[0]?.rejectionReasons.some((reason) => reason.startsWith('operability-mismatch')), false);
});

for (const [label, description, repairRequired] of [
  ['damage boolean true', 'Damaged?: True', true],
  ['functional boolean false', 'Functional?: False', true],
  ['inline damage boolean true', 'Condition: Used Damaged?: True Functional?: Yes', true],
  ['inline functional boolean false', 'Damaged?: No Functional?: False', true],
  ['prefixed functional boolean false', 'Tested printer Functional?: False', true],
  ['prefixed negative damage flag', 'Tested printer Damaged?: No Functional?: Yes', false],
  ['repeated contradictory damage flags', 'Damaged?: True Damaged?: No', true],
  ['repeated contradictory functional flags', 'Functional?: False Functional?: Yes', true],
  ['repair negation before damage field', 'Notes: No repair needed\nDamage: hinge broken', true],
  ['packaging before damage notes', 'In box\nNotes: damaged screen', true],
  ['HTML repair negation before damage field', 'Notes: No repair needed<br>Damage: hinge broken', true],
  ['HTML packaging before damage notes', 'In box<br/>Notes: damaged screen', true],
  ['inline repair negation before damage notes', 'Notes: No repair needed Damage Details: hinge broken', true],
  ['auction and manufacturer boilerplate', 'Damaged?: No\nAuction Terms: Items may be damaged or defective\nManufacturer Description: Do not operate with a damaged cord', false],
  ['consumable need before manufacturer description', 'Notes: Needs ink\nManufacturer Description: LCD display', false],
  ['inline boilerplate', 'Damaged?: No Auction Terms: Items may be damaged or defective Manufacturer Description: Do not operate with a damaged cord', false],
  ['multiline manufacturer boilerplate', 'Damaged?: No\nManufacturer Description: LCD display\nDo not operate with a damaged cord', false],
  ['unknown field retains actual damage', 'Seller Observation: hinge broken', true],
  ['failure negation', 'Notes: No damage, not broken; fully working', false],
  ['failure negation with question-mark flags', 'Damaged?: No Functional?: Yes Notes: No damage, not broken; fully working', false],
  ['negated failure before actual damage field', 'Notes: No damage, not broken; fully working\nDamage: hinge broken', true],
  ['negated failure before actual damage notes', 'Notes: No damage, not broken; fully working\nNotes: screen damaged', true],
  ['negated failure with same-field contradiction', 'Notes: not broken, but screen is damaged', true],
  ['negated repair with same-field damage', 'Notes: No repair needed, hinge broken', true],
  ['damage after excluded section', 'Manufacturer Description: LCD display\nNotes: screen damaged', true],
  ['damaged packaging only', 'Notes: box is damaged', false],
  ['box containing actual damage', 'Notes: box contains damaged screen', true],
  ['possible repairs', 'Notes: May need repairs', true],
  ['negated plural repairs', 'Notes: Does not need repairs; fully working', false],
  ['fixed and no longer broken', 'Notes: Fixed; no longer broken; fully working', false],
  ['repaired and no longer defective', 'Notes: Repaired; no longer defective; fully working', false],
  ['resolved failure before actual damage', 'Notes: Fixed; no longer broken\nDamage: screen damaged', true],
  ['historical socket failure repaired', 'Socket was broken but has been repaired; fully working', false],
  ['broken hinge repaired', 'Broken hinge repaired; fully working', false],
  ['affirmative bent socket pins', 'Notes: Socket has bent pins; untested', true],
  ['negated bent pins', 'Notes: No bent pins; fully working', false],
  ['negated apparent bends', 'Notes: No pins appear slightly bent; fully working', false],
  ['bent pins repaired', 'Bent pins repaired; tested fully working', false],
  ['repaired bent pins', 'Repaired bent pins; tested fully working', false],
  ['repaired socket and currently damaged screen', 'Socket was broken but has been repaired; screen is damaged', true],
  ['repaired hinge and currently bent pins', 'Broken hinge repaired; socket has bent pins', true],
  ['repaired bent pins and currently damaged headband', 'Bent pins repaired; headband broken', true],
  ['different subject repair cannot resolve damage', 'Socket was broken but hinge has been repaired; fully working', true],
  ['partial socket repair', 'Socket was broken but has been partially repaired; fully working', true],
  ['partial repair after damage assertion', 'Broken hinge repaired partially; fully working', true],
  ['repair completed only in part', 'Broken hinge repaired in part; fully working', true],
  ['negated repair', 'Broken hinge not repaired; fully working', true],
  ['negated completed repair prefix', 'Not repaired bent pins; fully working', true],
  ['partial completed repair prefix', 'Partially repaired bent pins; fully working', true],
  ['attempted repair', 'Bent pins repair attempted; still bent', true],
  ['some bent pins remain', 'Bent pins repaired but some pins are still bent', true],
  ['broken hinge remains after repair', 'Broken hinge repaired but still broken', true],
  ['further repairs remain necessary', 'Broken hinge repaired but still needs repairs', true],
  ['same sentence different damaged part', 'Broken hinge and damaged screen repaired; fully working', true],
  ['repaired damage before current damage field', 'Notes: Broken hinge repaired\nDamage: screen damaged', true],
] as const) {
  for (const side of ['source', 'candidate', 'candidate-description'] as const) {
    test(`${side} repair evidence: ${label}`, () => {
      const result = parse([item({
        ...(side === 'candidate' ? { shortDescription: description } : {}),
        ...(side === 'candidate-description' ? { description } : {}),
      })], {
        sourceCondition: { condition: 'Used' },
        sourceDescription: side === 'source' ? description : 'Notes: fully working',
      });

      assert.equal(result.records[0]?.matchDecision, repairRequired ? 'rejected' : 'accepted');
      assert.deepEqual(result.records[0]?.rejectionReasons, repairRequired
        ? [`operability-mismatch:${side === 'source' ? 'source' : 'candidate'}-repair-required`] : []);
    });
  }
}

test('real Buda 323017948 uncertain bent-pin source cannot benchmark working or repaired asks', () => {
  const title = 'ASUS B850-A Motherboard';
  const sourceDescription = "Condition: Open Box - Not Tested\nDamaged?: Unknown\nFunctional?: Unable to Test\nNotes: Some pins appear slightly bent - May need repairs but I'm unsure - Otherwise brand new.";
  const result = parseEbayActiveResults({
    query: title,
    identity: extractProductIdentity(title),
    observedAt: '2026-09-30T12:00:00.000Z',
    sourceCondition: { condition: 'Open Box - Not Tested' },
    sourceDescription,
    browseJson: { total: 4, offset: 0, itemSummaries: [
      item({ itemId: '178100000121', title, condition: 'Open Box', shortDescription: 'Fully tested and working' }),
      item({ itemId: '178100000122', title, condition: 'Open Box', shortDescription: 'Notes: Fully functional' }),
      item({ itemId: '178100000123', title, condition: 'Open Box', shortDescription: 'Notes: Repaired bent pins; no longer broken; fully working' }),
      item({ itemId: '178100000124', title, condition: 'Open Box', shortDescription: 'Notes: Fixed; no longer broken; fully working' }),
    ] },
  });

  assert.equal(result.records.length, 4);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.benchmark, null);
  for (const record of result.records) {
    assert.deepEqual(record.rejectionReasons, ['operability-mismatch:source-repair-required']);
  }
});

test('current bent-pin uncertainty remains repair evidence after an earlier fixed note', () => {
  const result = parse([item()], {
    sourceCondition: { condition: 'Used' },
    sourceDescription: 'Notes: Fixed; no longer broken\nNotes: Some pins appear slightly bent - May need repairs',
  });

  assert.deepEqual(result.records[0]?.rejectionReasons, ['operability-mismatch:source-repair-required']);
});

for (const [label, sourceDescription, candidateDescription] of [
  ['real tentative bends versus repaired historical socket damage', "Damaged?: Unknown\nFunctional?: Unable to Test\nNotes: Some pins appear slightly bent - May need repairs but I'm unsure - Otherwise brand new.", 'Socket was broken but has been repaired; fully working'],
  ['affirmative bends versus working asks', 'Notes: Socket has bent pins; untested', 'Fully tested and working'],
] as const) {
  test(`${label} cannot produce a normal-working benchmark`, () => {
    const result = parse([1, 2, 3].map((index) => item({
      itemId: `17810000013${index}`,
      shortDescription: candidateDescription,
      price: { value: '85.00', currency: 'USD' },
    })), {
      sourceCondition: { condition: 'Used' },
      sourceDescription,
    });

    assert.equal(result.accepted.length, 0);
    assert.equal(result.benchmark, null);
    for (const record of result.records) {
      assert.deepEqual(record.rejectionReasons, ['operability-mismatch:source-repair-required']);
    }
  });
}
