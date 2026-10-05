import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCondition,
  buildProductResearchQuery,
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const sourceTitle = "Vintage Carvin Pro Bass 150 Amplifier Head - 1980's";

test('Carvin Pro Bass 150 source keeps the decade as time context and has a family-scoped model', () => {
  const product = extractProductIdentity(sourceTitle, 'Untested, missing some knobs.');
  assert.equal(product.model, 'Carvin Pro Bass 150');
  assert.equal(buildProductResearchQuery(sourceTitle), 'vintage carvin pro bass 150 amplifier head 1980s');
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head', product).accepted, true);
});

test('Carvin primary-family matching rejects nearby numeric and wrong-family variants', () => {
  const product = extractProductIdentity(sourceTitle);
  for (const title of [
    'Carvin Pro Bass 100 Amplifier Head',
    'Carvin Pro Bass 200 Amplifier Head',
    'Carvin BX150 Amplifier Head',
    'Carvin 150 Watt Bass Amplifier Head',
    'Other Brand Pro Bass 150 Amplifier Head',
    'Carvin Pro Bass 150 / Carvin Pro Bass 200 Amplifier Head',
    'Carvin Pro Bass 150 / Carvin BX150 Amplifier Head',
    'Carvin Pro Bass 150 & 200 Amplifier Head',
    'Carvin Pro Bass 150 and 200 Amplifier Head',
    'Carvin PB150 Pro Bass Head / BX150',
    'Carvin Pro Bass 150 / 200 / 250 Amplifier Head',
  ]) {
    assert.equal(evaluateRetailCandidate(title, product).accepted, false, title);
  }
});

test('PB150 Pro Bass Head is a corroborated Carvin spelling alias only', () => {
  const product = extractProductIdentity(sourceTitle);
  assert.equal(evaluateRetailCandidate('Carvin PB150 Pro Bass Head', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Carvin PB150 Pro Bass Head compatible with a BX150', product).accepted, false);
});

test('Carvin source conflicts fail closed, including structured model disagreement', () => {
  const conflicting = extractProductIdentity({
    title: sourceTitle,
    description: 'Model: 200\nUntested, missing some knobs.',
  });
  assert.equal(conflicting.model, null);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head', conflicting).accepted, false);

  const corroboratedAlias = extractProductIdentity({
    title: sourceTitle,
    description: 'Model: PB150\nUntested, missing some knobs.',
  });
  assert.equal(corroboratedAlias.model, 'Carvin Pro Bass 150');
  assert.equal(evaluateRetailCandidate('Carvin PB150 Pro Bass Head', corroboratedAlias).accepted, true);

  const multiple = extractProductIdentity('Carvin Pro Bass 150 / Carvin Pro Bass 200 Amplifier Head');
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head', multiple).accepted, false);
});

test('measurements and explicit non-Carvin models do not become a Carvin identity', () => {
  const product = extractProductIdentity('Carvin Pro Bass Amplifier Head, 19 x 8 x 3 inches');
  assert.notEqual(product.model, 'Carvin Pro Bass 150');
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head', product).accepted, true);

  const explicit = extractProductIdentity(sourceTitle, 'Model: 1980S');
  assert.equal(explicit.model, null);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head', explicit).accepted, false);
});

test('accessory-scoped Carvin listings do not satisfy the amplifier identity', () => {
  const product = extractProductIdentity(sourceTitle);
  for (const title of [
    'Carvin Pro Bass 150 Amplifier Head replacement knobs',
    'Carvin Pro Bass 150 Head knob set',
    'Carvin Pro Bass 150 Amplifier Head knobs only',
  ]) assert.equal(evaluateRetailCandidate(title, product).accepted, false, title);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head with knobs', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head with replacement knobs', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head w/ replacement knobs', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Carvin Pro Bass 150 Amplifier Head without replacement knobs', product).accepted, true);
  for (const measurement of ['200 watts', '19 inches wide', '19 x 8 x 3 inches', '20 lbs']) {
    const title = `Carvin Pro Bass 150 Amplifier Head, ${measurement}`;
    assert.equal(extractProductIdentity(title).model, 'Carvin Pro Bass 150', title);
    assert.equal(evaluateRetailCandidate(title, product).accepted, true, title);
  }
});

test('missing knobs stays a specific caution instead of parts-only or major-component failure', () => {
  for (const note of ['missing all knobs', 'missing 3 knobs', 'without knobs', 'knobs not included']) {
    const assessment = assessCondition(`Condition: Used\nFunctional?: Yes\nNotes: Untested, ${note}.`);
    assert.equal(assessment.partsOnly, false, note);
    assert.equal(assessment.damaged, false, note);
    assert.ok(assessment.cautions.includes('untested'), note);
    assert.ok(assessment.cautions.includes('missing knobs'), note);
    assert.ok(!assessment.cautions.some((value) => value.includes('missing major component')), note);
  }
});

test('negated missing-knob and included-knob wording stays protected', () => {
  for (const text of [
    'Condition: Used\nFunctional?: Yes\nNotes: No missing knobs.',
    'Condition: Used\nFunctional?: Yes\nNotes: Not missing knobs.',
    'Condition: Used\nFunctional?: Yes\nNotes: Without missing knobs.',
    'Condition: Used\nFunctional?: Yes\nNotes: Knobs are not missing.',
    'Condition: Used\nFunctional?: Yes\nNotes: Knobs included and present.',
  ]) {
    const assessment = assessCondition(text);
    assert.equal(assessment.partsOnly, false, text);
    assert.ok(!assessment.cautions.includes('missing knobs'), text);
  }
});

test('missing-knob assertions stay clause-local', () => {
  for (const note of [
    'Some knobs included, but three knobs missing.',
    'Some knobs included, three knobs missing.',
    'No missing knobs on spare unit; this amplifier missing 3 knobs.',
    'No missing knobs on spare unit;this amplifier missing 3 knobs.',
  ]) {
    const assessment = assessCondition(`Condition: Used\nFunctional?: Yes\nNotes: ${note}`);
    assert.equal(assessment.partsOnly, false, note);
    assert.ok(assessment.cautions.includes('missing knobs'), note);
  }
});

test('bare decades are not inferred models, while explicit model fields remain authoritative', () => {
  assert.equal(extractProductIdentity('Vintage Carvin Amplifier Head 1980s').model, null);
  assert.equal(extractProductIdentity('Vintage Carvin Amplifier Head', 'Model: 1980S').model, '1980S');
});
