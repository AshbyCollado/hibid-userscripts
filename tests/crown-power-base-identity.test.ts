import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity, scoreRetailCandidate } from '../src/intelligence/us-deal-intelligence.js';

const sourceTitle = 'Crown Power Base 2 - 2-Channel Power Amplifier - Rack Mount';
const sourceDescription = 'The Crown Power Base 2 is a rugged, 2-channel professional rackmount power amplifier. In Good Condition.';

test('extracts Crown Power Base 2 as a shared named-family identity and preserves the generation in the query', () => {
  const product = extractProductIdentity(sourceTitle, sourceDescription);
  assert.equal(product.brand, 'Crown');
  assert.equal(product.model, 'Power Base 2');
  assert.match(product.query, /power base 2/i);
  assert.doesNotMatch(product.query, /power base\s*$/i);
});

test('matches only Crown Power Base 2 aliases and rejects neighboring generations', () => {
  const product = extractProductIdentity(sourceTitle, sourceDescription);
  for (const title of [
    'Crown Power Base 2 2-Channel Professional Power Amplifier',
    'Crown PowerBase2 rackmount power amplifier',
    'Crown Power-Base II 2-channel amplifier',
    'Crown Power Base 2 amplifier - missing power cord - untested',
  ]) {
    const result = evaluateRetailCandidate(title, product);
    assert.equal(result.accepted, true, title);
    assert.ok(scoreRetailCandidate(title, product) > 0, title);
  }
  for (const title of [
    'Crown XLi 1500 2-Channel Professional Power Amplifier',
    'Crown XLS 1500 Power Amplifier',
    'Crown Power Base 1 2-Channel Power Amplifier',
    'Crown Power Base 3 2-Channel Power Amplifier',
  ]) {
    const result = evaluateRetailCandidate(title, product);
    assert.equal(result.accepted, false, title);
    assert.ok(result.rejectionReasons.includes('model-mismatch:Power Base 2'), title);
    assert.equal(scoreRetailCandidate(title, product), 0, title);
  }
});

test('rejects Crown Power Base accessories and compatibility-led ambiguity', () => {
  const product = extractProductIdentity(sourceTitle, sourceDescription);
  for (const title of [
    'Crown Power Base 2 instruction manual',
    'Crown Power Base 2 replacement power supply',
    'Crown Power Base 2 replacement board',
    'Power supply compatible with Crown Power Base 2',
    'Crown Power Base 2 compatible with Crown Power Base 3',
  ]) {
    const result = evaluateRetailCandidate(title, product);
    assert.equal(result.accepted, false, title);
    assert.ok(result.rejectionReasons.some((reason) => reason === 'accessory-or-component' || reason === 'identity-scope:crown-power-base-primary'), title);
    assert.equal(scoreRetailCandidate(title, product), 0, title);
  }
});

test('structured Crown generation conflicts block source identity instead of falling through to family overlap', () => {
  const product = extractProductIdentity(sourceTitle, 'Model: Power Base 3');
  assert.equal(product.model, null);
  assert.ok(product.discriminators.variantLabels.includes('crown-power-base:source-conflict'));
  const result = evaluateRetailCandidate(sourceTitle, product);
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.includes('identity-conflict:crown-power-base-source'));
  assert.equal(scoreRetailCandidate(sourceTitle, product), 0);
});

test('structured Crown model fields after missing-parts text bind and reject non-equivalent models', () => {
  const conflicting = extractProductIdentity(sourceTitle, 'Missing Parts: No. Model: Power Base 3');
  assert.equal(conflicting.model, null);
  assert.ok(conflicting.discriminators.variantLabels.includes('crown-power-base:source-conflict'));
  assert.equal(evaluateRetailCandidate(sourceTitle, conflicting).accepted, false);

  const differentCrownModel = extractProductIdentity(sourceTitle, 'Missing Parts: No. Model: XLS1500');
  assert.equal(differentCrownModel.model, null);
  assert.ok(differentCrownModel.discriminators.variantLabels.includes('crown-power-base:source-conflict'));
  assert.equal(evaluateRetailCandidate(sourceTitle, differentCrownModel).accepted, false);

  const compatibilityMention = extractProductIdentity(sourceTitle, 'Missing Parts: No. Compatible with Crown XLS1500.');
  assert.equal(compatibilityMention.model, 'Power Base 2');
  assert.equal(evaluateRetailCandidate(sourceTitle, compatibilityMention).accepted, true);
});

test('rejects Crown Power Base components but allows an included power cord suffix', () => {
  const product = extractProductIdentity(sourceTitle, sourceDescription);
  for (const title of [
    'Crown Power Base 2 cooling fan',
    'Crown Power Base 2 transformer',
  ]) {
    const result = evaluateRetailCandidate(title, product);
    assert.equal(result.accepted, false, title);
    assert.equal(scoreRetailCandidate(title, product), 0, title);
  }

  const includedCord = 'Crown Power Base 2 amplifier power cord included';
  assert.equal(evaluateRetailCandidate(includedCord, product).accepted, true);
  assert.ok(scoreRetailCandidate(includedCord, product) > 0);
});

test('structured Crown conflicts respect semicolon, pipe and newline field boundaries', () => {
  for (const delimiter of ['; ', ' | ', '\n', '\r\n']) {
    for (const model of ['XLS1500', 'Power Base 3']) {
      const description = `Missing Parts: No. Model: ${model}${delimiter}Condition: Good`;
      const product = extractProductIdentity(sourceTitle, description);
      assert.equal(product.model, null, description);
      assert.ok(product.discriminators.variantLabels.includes('crown-power-base:source-conflict'), description);
      assert.equal(evaluateRetailCandidate(sourceTitle, product).accepted, false, description);
    }
    const matching = extractProductIdentity(sourceTitle, `Model: Power Base 2${delimiter}Condition: Good`);
    assert.equal(matching.model, 'Power Base 2', delimiter);
    assert.equal(evaluateRetailCandidate(sourceTitle, matching).accepted, true, delimiter);
  }
});

test('unrelated Crown models remain canonical rather than selecting a conflict marker', () => {
  const title = 'Crown XLS1500 amplifier';
  for (const description of ['Model: XLS1500', 'Model: XLS1500; Condition: Good', 'Model: XLS1500\nCondition: Good']) {
    const product = extractProductIdentity(title, description);
    assert.equal(product.model, 'XLS1500', description);
    assert.equal(product.discriminators.variantLabels.includes('crown-power-base:source-conflict'), false, description);
    assert.equal(evaluateRetailCandidate(title, product).accepted, true, description);
    assert.ok(scoreRetailCandidate(title, product) > 0, description);
  }
});
