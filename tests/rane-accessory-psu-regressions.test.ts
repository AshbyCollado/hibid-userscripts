import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEbaySoldCompSet, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';
import {
  assessCondition,
  evaluateRetailCandidate,
  extractProductIdentity,
  getLimitedTestingCautions,
  isAccessoryListing,
  missingMajorComponents,
} from '../src/intelligence/us-deal-intelligence.js';

const hc6 = extractProductIdentity('Rane HC6');

function soldRecord(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=rane%20hc6&tabName=SOLD',
    observedAt: '2026-10-03T12:00:00.000Z',
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 125, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 125, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 125, currency: 'USD' },
    soldAt: 'Sep 28, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function soldAttempt(records: EbaySoldRecord[]): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=rane%20hc6&tabName=SOLD',
    query: 'rane hc6',
    observedAt: '2026-10-03T12:00:00.000Z',
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
}

test('Rane knob caps and rotary knobs do not pass as HC6 whole-unit comparables', () => {
  for (const title of [
    '12mm Black Knob Cap with Indicator Line for Rane HC6, SM26, PE-15',
    '12mm Gray Knob Cap with Line for Rane HC6 MP24 SM26 PE15 HC-6 MP-24 SM-26 PE-15',
    'Rane SM 26B. Rane Pro Audio, Rane HC6, Rane AC23B Rotary Knob',
  ]) {
    assert.equal(isAccessoryListing(title, hc6), true, title);
    assert.equal(evaluateRetailCandidate(title, hc6).accepted, false, title);
    assert.ok(evaluateRetailCandidate(title, hc6).rejectionReasons.includes('accessory-or-component'), title);
  }
});

test('whole consoles with replacement knobs and actual knob accessories remain distinguishable', () => {
  const bundled = evaluateRetailCandidate('Rane HC6 with replacement knobs', hc6);
  assert.equal(bundled.accepted, true);
  assert.equal(isAccessoryListing('Rane HC6 with replacement knobs', hc6), false);

  for (const title of [
    'Rane HC6 missing one knob',
    'Rane HC6 without knobs',
    'Rane HC6 w/ replacement knobs',
    'Rane HC6 complete all knobs present',
  ]) {
    assert.equal(isAccessoryListing(title, hc6), false, title);
    assert.equal(evaluateRetailCandidate(title, hc6).accepted, true, title);
  }
  assert.ok(assessCondition('Rane HC6 missing one knob').cautions.includes('missing knobs'));
  assert.ok(assessCondition('Rane HC6 needs replacement knobs').cautions.includes('needs replacement part'));

  assert.equal(
    isAccessoryListing('Rane HC6 knob caps with replacement knobs', hc6),
    true,
  );
  assert.equal(
    evaluateRetailCandidate('Rane HC6 knob caps with replacement knobs', hc6).accepted,
    false,
  );

  const knob = extractProductIdentity('Rane HC6 Rotary Knob');
  assert.equal(isAccessoryListing('Rane HC6 Rotary Knob', knob), false);
  assert.equal(evaluateRetailCandidate('Rane HC6 Rotary Knob', knob).accepted, true);
});

test('PSU absence is a missing major power-supply condition with conservative negation', () => {
  for (const title of [
    'Rane HC6 No Psu',
    'Rane HC6 NO POWER SUPPLY INCLUDED',
    'Rane HC6 without external PSU',
    'Rane HC6 no AC PSU included',
  ]) {
    assert.deepEqual(missingMajorComponents(title), ['power supply'], title);
  }
  for (const title of [
    'Rane HC6 no missing PSU/PSU included',
    'Rane HC6 PSU included',
    'Rane HC6 not without external PSU',
  ]) {
    assert.deepEqual(missingMajorComponents(title), [], title);
  }
});

test('Powers On remains positive only when the source also claims good working condition', () => {
  const serializedSource = assessCondition('Rane HC6 6-Channel Headphone Amplifier Rackmount. In Good Working Condition.');
  assert.equal(serializedSource.positive, true);
  assert.deepEqual(serializedSource.cautions, []);
  for (const text of [
    'Rane HC6 is not in good working condition.',
    'Unknown if Rane HC6 is in good working condition.',
    'Rane HC6 is currently not in working order.',
    'Rane HC6 was in good working condition.',
    'All items are in working order.',
    'Another unit is in good working condition.',
  ]) {
    assert.equal(assessCondition(text).positive, false, text);
  }

  const barePowerOn = assessCondition('Condition: Good\nNotes: Powers On');
  assert.equal(barePowerOn.positive, false);
  assert.ok(barePowerOn.cautions.includes('power-on only'));

  const claimedWorking = assessCondition('Condition: Good\nFunctional?: Yes\nNotes: Powers On');
  assert.equal(claimedWorking.positive, true);
  assert.deepEqual(claimedWorking.cautions, []);

  const contradictoryExplicitOnly = assessCondition('Condition: Good\nFunctional?: Yes\nNotes: Powers On only');
  assert.equal(contradictoryExplicitOnly.positive, false);
  assert.ok(contradictoryExplicitOnly.cautions.includes('power-on only'));

  for (const text of [
    'Condition: Good\nNotes: Powers On\nUnknown if working.',
    'Condition: Good\nNotes: Powers On\nNot fully working.',
    'Condition: Good\nNotes: Powers On\nAnother unit working.',
  ]) {
    const assessment = assessCondition(text);
    assert.equal(assessment.positive, false, text);
    assert.ok(assessment.cautions.includes('power-on only'), text);
  }

  const powerOnly = assessCondition('Condition: Good\nNotes: Powers On only');
  assert.equal(powerOnly.positive, false);
  assert.ok(powerOnly.cautions.includes('power-on only'));
});

test('a bare Powers On Sold row does not match the serialized Rane working-condition claim', () => {
  const sourceCondition = assessCondition('Rane HC6 6-Channel Headphone Amplifier Rackmount. In Good Working Condition.');
  const verification = verifyEbaySoldCompSet(
    extractProductIdentity('Rane HC6'),
    [soldAttempt([soldRecord('458812401', 'Rane HC6 Powers On')])],
    { plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition },
  );
  assert.equal(verification.accepted.length, 0);
  assert.ok(verification.rejected[0]?.reasons.includes('condition-mismatch:untested-comp-for-working-lot'));
});

test('Sold power-on rows require a current same-unit working claim', () => {
  const sourceCondition = assessCondition('Rane HC6 Rackmount. In Good Working Condition.');
  const rejectedTitles = [
    'Rane HC6 Powers On. Was in good working condition.',
    'Rane HC6 Powers On. All items are in working order.',
    'Rane HC6 Powers On. Working condition unknown.',
    'Rane HC6 Powers On. Unknown if working.',
    'Rane HC6 Powers On. Not fully working.',
    'Rane HC6 Powers On. Another unit working.',
    'Rane HC6 Powers On. The other amplifier is fully functional.',
    'Rane HC6 Powers On. Seller says all items are in working order.',
    'Rane HC6 Powers On. It had been in good working condition.',
  ];
  for (const [index, title] of rejectedTitles.entries()) {
    assert.ok(getLimitedTestingCautions(title).includes('power-on only'), title);
    const result = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812410 + index), title)])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition,
    });
    assert.equal(result.accepted.length, 0, title);
    assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:untested-comp-for-working-lot'), title);
  }
  for (const [index, adverb] of ['currently', 'presently', 'now'].entries()) {
    const title = `Rane HC6 ${adverb} in good working condition.`;
    const currentSource = assessCondition(title);
    assert.equal(currentSource.positive, true, title);
    const powerOnly = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812420 + index), 'Rane HC6 Powers On')])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition: currentSource,
    });
    assert.ok(powerOnly.rejected[0]?.reasons.includes('condition-mismatch:untested-comp-for-working-lot'), title);
    const working = `Rane HC6 Powers On. ${adverb} in good working condition.`;
    assert.deepEqual(getLimitedTestingCautions(working), [], working);
    const accepted = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812430 + index), working)])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition,
    });
    assert.equal(accepted.accepted.length, 1, working);
  }
});

test('Sold power-on rows reject historical and unverified working-claim suffixes', () => {
  const sourceCondition = assessCondition('Rane HC6 Rackmount. In Good Working Condition.');
  for (const [index, title] of [
    'Rane HC6 Powers On. In good working condition before storage.',
    'Rane HC6 Powers On. Fully functional when last used.',
    'Rane HC6 Powers On. In good working condition, not verified.',
    'Rane HC6 Powers On. In good working condition but not verified.',
  ].entries()) {
    assert.ok(getLimitedTestingCautions(title).includes('power-on only'), title);
    assert.equal(assessCondition(title).positive, false, title);
    const result = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812460 + index), title)])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition,
    });
    assert.equal(result.accepted.length, 0, title);
    assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:untested-comp-for-working-lot'), title);
  }
  assert.deepEqual(getLimitedTestingCautions('Rane HC6 Powers On. In good working condition, verified today.'), []);
  assert.deepEqual(getLimitedTestingCautions('Rane HC6 Powers On. Fully functional when last used. Currently in good working condition.'), []);
});

test('operational source claims without Powers On require current sentence-scoped evidence', () => {
  for (const [index, claim] of [
    'Fully functional when last used.',
    'Fully functional, not verified.',
  ].entries()) {
    for (const text of [
      `Rane HC6 ${claim}`,
      `Condition: Used\nNotes: ${claim}`,
      `Condition: ${claim}`,
    ]) {
      const sourceCondition = assessCondition(text);
      assert.equal(sourceCondition.positive, false, text);
      const result = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812470 + index), 'Rane HC6 Powers On')])], {
        plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition,
      });
      assert.equal(result.accepted.length, 1, `${text}: ${JSON.stringify(result.rejected)}`);
      assert.ok(!result.rejected.some((entry) => entry.reasons.includes('condition-mismatch:untested-comp-for-working-lot')), text);
    }
  }
  for (const text of [
    'Rane HC6 Fully functional.',
    'Condition: Used\nNotes: Currently fully functional.',
    'Condition: Fully functional.',
  ]) assert.equal(assessCondition(text).positive, true, text);

  for (const condition of ['New', 'Like New']) {
    const text = `Condition: ${condition}\nNotes: Fully functional when last used.`;
    assert.equal(assessCondition(text).positive, true, text);
  }
  for (const [answer, expected] of [['Yes', true], ['No', false], ['N/A', false]] as const) {
    const text = `Condition: Used\nFunctional?: ${answer}\nNotes: Fully functional when last used.`;
    assert.equal(assessCondition(text).positive, expected, text);
  }
});

test('Sold knob sets are accessories while missing and replacement needs describe whole units', () => {
  const accessory = 'Rane HC6 complete set of replacement knobs';
  const rejected = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord('458812440', accessory)])], {
    plannedQueries: ['rane hc6'], minimumSampleSize: 1,
  });
  assert.equal(rejected.accepted.length, 0);
  assert.ok(rejected.rejected[0]?.reasons.includes('accessory-or-component'));
  for (const [index, title] of [
    'Rane HC6 knobs are missing',
    'Rane HC6 knobs not included',
    'Rane HC6 needs replacement knobs',
    'Rane HC6 missing a knob',
    'Rane HC6 with all original knobs',
    'Rane HC6 with full set of replacement knobs',
  ].entries()) {
    assert.equal(isAccessoryListing(title, hc6), false, title);
    assert.equal(isAccessoryListing(accessory, extractProductIdentity(title)), true, title);
    const condition = assessCondition(title);
    if (index < 4) assert.ok(condition.cautions.includes(index === 2 ? 'needs replacement part' : 'missing knobs'), title);
    const accepted = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812441 + index), title)])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1,
    });
    assert.equal(accepted.accepted.length, 1, `${title}: ${JSON.stringify(accepted.rejected)}`);
  }
});

test('nonaffirmative structured functional answers cannot upgrade power-on sources', () => {
  for (const [index, answer] of ['No', 'N/A', 'Unable to Test'].entries()) {
    const text = `Condition: Good\nFunctional?: ${answer}\nNotes: Powers On`;
    const sourceCondition = assessCondition(text);
    assert.equal(sourceCondition.positive, false, answer);
    assert.ok(sourceCondition.cautions.includes('power-on only'), answer);
    const result = verifyEbaySoldCompSet(hc6, [soldAttempt([soldRecord(String(458812450 + index), 'Rane HC6 Tested Working')])], {
      plannedQueries: ['rane hc6'], minimumSampleSize: 1, sourceCondition,
    });
    assert.equal(result.accepted.length, 0, answer);
    assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:working-comp-for-untested-lot'), answer);
  }
});
