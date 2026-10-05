import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('audio equipment cover listings do not satisfy the whole amplifier identity', () => {
  const product = extractProductIdentity('Rivera BM-100 Guitar Tube Combo Amplifier');
  const cover = evaluateRetailCandidate(
    'Rivera BM-100 2x12 Combo Amp - Black Vinyl Cover, Water Resistant, USA (rive078)',
    product,
  );

  assert.equal(cover.accepted, false, JSON.stringify(cover));
  assert.ok(cover.rejectionReasons.includes('accessory-or-component'));
});

test('an amplifier with an explicitly included cover remains matchable', () => {
  const product = extractProductIdentity('Rivera BM-100 Guitar Tube Combo Amplifier');
  for (const title of [
    'Rivera BM-100 Guitar Tube Combo Amplifier with Black Vinyl Cover',
    'Rivera BM-100 Guitar Tube Combo Amplifier w/ Black Vinyl Cover',
    'Rivera BM-100 Guitar Tube Combo Amplifier plus Black Vinyl Cover',
  ]) assert.equal(evaluateRetailCandidate(title, product).accepted, true, title);
});

test('equipment cover bundle wording remains positive across kinds', () => {
  const cases = [
    ['Acme MD100 Printer', 'Acme MD100 Printer - Dust Cover Included'],
    ['Canon EOS R50 Camera', 'Canon EOS R50 Camera w/ Protective Cover'],
    ['JBL EON Speaker', 'JBL EON Speaker plus Dust Cover'],
  ] as const;
  for (const [sourceTitle, candidateTitle] of cases) {
    assert.equal(evaluateRetailCandidate(candidateTitle, extractProductIdentity(sourceTitle)).accepted, true, candidateTitle);
  }
});

test('trailing included covers are part of the source product and remain required', () => {
  for (const [sourceTitle, completeTitle, incompleteTitle, coverOnlyTitle] of [
    [
      'Rivera BM-100 Guitar Tube Combo Amplifier - Black Vinyl Cover Included',
      'Rivera BM-100 Guitar Tube Combo Amplifier - Black Vinyl Cover Included',
      'Rivera BM-100 Guitar Tube Combo Amplifier',
      'Rivera BM-100 Black Vinyl Cover - Amplifier Not Included',
    ],
    [
      'Acme MD100 Printer - Dust Cover Included',
      'Acme MD100 Printer - Dust Cover Included',
      'Acme MD100 Printer',
      'Acme MD100 Dust Cover - Printer Not Included',
    ],
  ] as const) {
    const product = extractProductIdentity(sourceTitle);
    assert.equal(evaluateRetailCandidate(completeTitle, product).accepted, true, completeTitle);
    assert.equal(evaluateRetailCandidate(incompleteTitle, product).accepted, false, incompleteTitle);
    assert.equal(evaluateRetailCandidate(coverOnlyTitle, product).accepted, false, coverOnlyTitle);
  }
});

test('cover grammar does not promote an included handle to an included cover', () => {
  const product = extractProductIdentity('Rivera BM-100 Guitar Tube Combo Amplifier');
  const result = evaluateRetailCandidate(
    'Rivera BM-100 2x12 Combo Amp Black Vinyl Cover - Handle Included',
    product,
  );
  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.ok(result.rejectionReasons.includes('accessory-or-component'));
});

test('an explicitly excluded optional cover does not disqualify the whole amp', () => {
  const ampOnly = extractProductIdentity('Rivera BM-100 Guitar Tube Combo Amplifier');
  const title = 'Rivera BM-100 2x12 Combo Amp Black Vinyl Cover Not Included';
  assert.equal(evaluateRetailCandidate(title, ampOnly).accepted, true);

  const coverRequired = extractProductIdentity('Rivera BM-100 Guitar Tube Combo Amplifier - Black Vinyl Cover Included');
  const result = evaluateRetailCandidate(title, coverRequired);
  assert.equal(result.accepted, false, JSON.stringify(result));
});

test('cover-only equipment listings remain negative without affirmative inclusion', () => {
  for (const [sourceTitle, candidateTitle] of [
    ['Canon EOS R50 Camera', 'Canon EOS R50 Camera Protective Cover'],
    ['JBL EON Speaker', 'JBL EON Speaker Dust Cover'],
  ] as const) {
    const result = evaluateRetailCandidate(candidateTitle, extractProductIdentity(sourceTitle));
    assert.equal(result.accepted, false, `${candidateTitle}: ${JSON.stringify(result)}`);
    assert.ok(result.rejectionReasons.includes('accessory-or-component'));
  }
});

test('a cover product can match another cover product', () => {
  const product = extractProductIdentity('Rivera BM-100 Black Vinyl Amp Cover');
  assert.equal(
    evaluateRetailCandidate('Rivera BM-100 Black Vinyl Amp Cover, Water Resistant', product).accepted,
    true,
  );
});
