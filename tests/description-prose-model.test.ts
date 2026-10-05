import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('recovers Sony CFD-S28 from corroborating primary product prose', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder',
    'A sony CD Radio Cassette-corder CFD-S28. Untested. Local pick up',
  );

  assert.equal(identity.name, 'Sony CD Radio Cassette-corder');
  assert.equal(identity.model, 'CFD-S28');
  assert.match(identity.query, /cfd-s28/i);
  assert.equal(evaluateRetailCandidate('Sony CD Radio Cassette-corder CFD-S28', identity).accepted, true);
  assert.match(evaluateRetailCandidate('Sony CD Radio Cassette-corder CFD-S29', identity).rejectionReasons.join(' '), /model-mismatch:CFD-S28/);
});

test('recovers Yamaha K-420 from the primary product sentence', () => {
  const identity = extractProductIdentity(
    'Yamaha Stereo Cassette Deck',
    'Lot contains a Yamaha Natural Sound Stereo Cassette Deck K-420. See photos for details. Untested. Local pickup or client-arranged shipping.',
  );

  assert.equal(identity.name, 'Yamaha Stereo Cassette Deck');
  assert.equal(identity.model, 'K-420');
  assert.match(identity.query, /k-420/i);
  assert.match(evaluateRetailCandidate('Yamaha Stereo Cassette Deck K-430', identity).rejectionReasons.join(' '), /model-mismatch:K-420/);
});

test('does not recover a same-brand accessory model', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder',
    'A Sony CD Radio Cassette-corder with remote RM-D29. Local pickup.',
  );

  assert.equal(identity.model, null);
});

test('does not treat inventory boilerplate as a product model', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder',
    'A Sony CD Radio Cassette-corder. SKU: CFD-S28. Untested.',
  );

  assert.equal(identity.model, null);
});

test('keeps an explicit title model ahead of conflicting description prose', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder CFD-S27',
    'A Sony CD Radio Cassette-corder CFD-S28. Untested.',
  );

  assert.equal(identity.model, 'CFD-S27');
});

test('rejects ambiguous prose models instead of choosing one', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder',
    'A Sony CD Radio Cassette-corder, models CFD-S28 and CFD-S29 are shown. Untested.',
  );

  assert.equal(identity.model, null);
});

test('ignores capacities, years, and generic model references', () => {
  const identity = extractProductIdentity(
    'Sony CD Radio Cassette-corder',
    'A Sony CD Radio Cassette-corder supports 64GB storage and is a 2020 model. Model not available.',
  );

  assert.equal(identity.model, null);
});

test('does not let a toaster slice count displace a structured model', () => {
  const identity = extractProductIdentity(
    '$449 GE 6-Slice Black Wi Fi Smart Toaster Oven',
    'Model: P9OIAAS6TBB',
  );

  assert.equal(identity.model, 'P9OIAAS6TBB');
});

const sonyTitle = 'Sony CD Radio Cassette-corder';
const secondaryReferences = [
  'alongside a Sony receiver STR-DH190',
  'alongside a Yamaha receiver RX-V385',
  ', not the CFD-S28',
  '; our inventory reference is INV-1234',
  '; auction reference AU-1234 applies to all lots',
  'works with RM-D29',
  'with speakers SS-100',
  'plus a Sony receiver STR-DH190',
  'includes a Sony remote RM-D29',
  'with Sony battery NP-F550',
  'compatible with a Sony remote RM-D29',
  'designed for a Sony receiver STR-DH190',
  'and a Sony receiver STR-DH190',
  ', a Yamaha receiver RX-V385 is also offered',
  'inventory reference INV-1234',
  'auction reference AU-1234',
  'is not model CFD-S28',
  'instead of the CFD-S28',
  'is a reference to another Sony CFD-S28',
  'Yamaha RX-V385',
  'remote RM-D29',
  'battery NP-F550',
];

for (const reference of secondaryReferences) {
  test(`does not borrow a code from secondary prose: ${reference}`, () => {
    const identity = extractProductIdentity(sonyTitle, `A ${sonyTitle} ${reference}. Untested.`);
    assert.equal(identity.name, sonyTitle);
    assert.equal(identity.model, null);
    assert.equal(identity.model2, null);
    assert.equal(identity.query, extractProductIdentity(sonyTitle).query);
  });
}

for (const suffix of [
  'with remote included',
  'with Sony remote RM-D29',
  'with speakers SS-100',
  'plus a Yamaha receiver RX-V385',
  'alongside a Sony receiver STR-DH190',
  'works with RM-D29',
  '; our inventory reference is INV-1234',
  '; auction reference AU-1234 applies to all lots',
  'and a Sony receiver STR-DH190',
]) {
  test(`retains the primary code before secondary prose: ${suffix}`, () => {
    const identity = extractProductIdentity(sonyTitle, `A ${sonyTitle} CFD-S28 ${suffix}.`);
    assert.equal(identity.name, sonyTitle);
    assert.equal(identity.model, 'CFD-S28');
    assert.equal(identity.model2, null);
    assert.match(identity.query, /cfd-s28/i);
    assert.doesNotMatch(identity.query, /rm-d29|ss-100|rx-v385|str-dh190|inv-1234|au-1234/i);
  });
}

for (const description of [
  `A ${sonyTitle} CFD-S28 or CFD-S29.`,
  `A ${sonyTitle} CFD-S28. A ${sonyTitle} CFD-S29.`,
  `A ${sonyTitle} CFD-S28 is not included.`,
  `Not a ${sonyTitle} CFD-S28.`,
  `A Yamaha CD Radio Cassette-corder CFD-S28.`,
  `Compatible with a ${sonyTitle} CFD-S28.`,
  `For example, a ${sonyTitle} CFD-S28.`,
  `A Sony receiver STR-DH190. This ${sonyTitle} has no model stated.`,
  `A Sony remote for CD Radio Cassette-corder RM-D29.`,
  `A Sony receiver and CD Radio Cassette-corder STR-DH190.`,
  `A Sony adapter for CD Radio Cassette-corder AC-1234.`,
  `A Sony battery for CD Radio Cassette-corder NP-F550.`,
]) {
  test(`requires a single affirmative primary model: ${description}`, () => {
    assert.equal(extractProductIdentity(sonyTitle, description).model, null);
  });
}

for (const suffix of [
  'pictured for reference only.',
  'sold separately.',
  'is compatible with this item.',
  'with remote is not included.',
  'is not included, remote is included.',
  ', not included in this lot.',
]) {
  test(`rejects an excluded primary declaration after the model: ${suffix}`, () => {
    const identity = extractProductIdentity(sonyTitle, `A ${sonyTitle} CFD-S28 ${suffix}`);
    assert.equal(identity.model, null);
    assert.equal(identity.query, extractProductIdentity(sonyTitle).query);
  });
}

for (const suffix of [
  'without remote.',
  ', no remote.',
  'untested, no returns.',
  ', remote is not included.',
  ', remote and speakers not included.',
  'is included, remote is not included.',
  'is included; the Sony remote RM-D29 is not included.',
  'with a remote which is not included.',
  'with Sony remote RM-D29 that is not included.',
  ', battery not included.',
  'is not tested, no returns.',
  'with remote included; batteries are sold separately.',
  'plus a Sony remote RM-D29 sold separately.',
]) {
  test(`retains the primary model when an accessory or transaction is excluded: ${suffix}`, () => {
    const identity = extractProductIdentity(sonyTitle, `A ${sonyTitle} CFD-S28 ${suffix}`);
    assert.equal(identity.model, 'CFD-S28');
    assert.match(identity.query, /cfd-s28/i);
    assert.doesNotMatch(identity.query, /rm-d29/i);
  });
}

test('preserves multiline primary declaration ambiguity without sentence punctuation', () => {
  for (const separator of ['\n', '\r\n']) {
    const description = `A ${sonyTitle} CFD-S28${separator}A ${sonyTitle} CFD-S29`;
    const identity = extractProductIdentity(sonyTitle, description);
    assert.equal(identity.model, null);
    assert.equal(identity.query, extractProductIdentity(sonyTitle).query);
  }
});

test('retains a repeated identical primary declaration across lines', () => {
  const identity = extractProductIdentity(sonyTitle, `A ${sonyTitle} CFD-S28\nA ${sonyTitle} CFD-S28`);
  assert.equal(identity.model, 'CFD-S28');
});

for (const description of [
  'A Sony CD Radio Cassette-corder CFD-S28, remote not included and the unit is sold separately.',
  'A Sony CD Radio Cassette-corder CFD-S28 is NOT for sale.',
]) {
  test(`rejects an explicit primary exclusion: ${description}`, () => {
    const identity = extractProductIdentity(sonyTitle, description);
    assert.equal(identity.model, null);
    assert.equal(identity.query, extractProductIdentity(sonyTitle).query);
  });
}
