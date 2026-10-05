import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRetailIdentity } from '../src/background/retail-identity.js';
import { evaluateRetailCandidate, extractProductDiscriminators, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

function evaluateThroughTransport(candidate: string, title: string) {
  const source = extractProductIdentity(title);
  return evaluateRetailCandidate(candidate, validateRetailIdentity(JSON.parse(JSON.stringify(source))));
}

test('camera lens focal lengths normalize equivalent cm and mm notation, including ranges', () => {
  const source = extractProductIdentity('Yashica GSN 45mm rangefinder film camera');
  assert.deepEqual(source.discriminators.lensRanges, ['45mm']);
  assert.equal(evaluateRetailCandidate('Yashica GSN camera 4.5cm lens', source).accepted, true);
  assert.equal(evaluateThroughTransport('Yashica GSN camera 4.5cm lens', 'Yashica GSN 45mm rangefinder film camera').accepted, true);

  const range = extractProductDiscriminators('35-70mm camera lens');
  const centimetreRange = extractProductDiscriminators('3.5-7cm camera lens');
  assert.deepEqual(range.lensRanges, ['35-70mm']);
  assert.deepEqual(centimetreRange.lensRanges, ['35-70mm']);
  assert.deepEqual(extractProductDiscriminators('Yashica GSN camera 45mm lens 12cm wide').lensRanges, ['45mm']);
  assert.deepEqual(extractProductDiscriminators('Yashica GSN camera YASHINON 1:1.8 f=4.5cm').lensRanges, ['45mm']);
  assert.deepEqual(extractProductDiscriminators('Yashica GSN camera YASHINON 1:1.8 f=5cm').lensRanges, ['50mm']);
  assert.deepEqual(extractProductDiscriminators('Yashica GSN camera lens 4.5cm width: 12cm').lensRanges, ['45mm']);
  assert.deepEqual(extractProductDiscriminators('Yashica GSN camera 45mm lens 12mm wide').lensRanges, ['45mm']);
  assert.equal(evaluateRetailCandidate('Yashica GSN camera YASHINON 1:1.8 f=4.5cm', source).accepted, true);
  assert.equal(evaluateRetailCandidate('Yashica GSN camera YASHINON 1:1.8 f=5cm', source).accepted, false);
  assert.equal(evaluateThroughTransport('Yashica GSN camera lens 4.5cm', source.name).accepted, true);
  for (const title of [
    'Yashica GSN camera 12 x 8 x 4cm lens 45mm',
    'Yashica GSN camera 12cm x 8cm x 4cm lens 45mm',
    'Yashica GSN camera 120mm x 80mm x 40mm lens 45mm',
  ]) {
    assert.deepEqual(extractProductDiscriminators(title).lensRanges, ['45mm'], title);
    assert.equal(evaluateRetailCandidate('Yashica GSN camera 45mm lens', extractProductIdentity(title)).accepted, true);
    assert.equal(evaluateThroughTransport('Yashica GSN camera 45mm lens', title).accepted, true);
  }
});

test('centimetres outside camera and lens context do not become lens identity', () => {
  assert.deepEqual(extractProductDiscriminators('Mid-century cabinet package 4.5cm deep').lensRanges, []);
  assert.deepEqual(extractProductDiscriminators('Replacement watch band 20mm').lensRanges, []);
});

test('standalone remotes cannot inherit an exact player model, but complete players remain matchable', () => {
  for (const sourceTitle of [
    'Toshiba D-VR4SU DVD VHS player',
    'Samsung BD-E6500 Blu-ray player',
  ]) {
    const source = extractProductIdentity(sourceTitle);
    const model = source.model || '';
    const standalone = evaluateRetailCandidate(`${sourceTitle.replace(/\b(?:dvd\s+vhs|blu-ray)\s+player\b/i, '')} remote control`, source);
    assert.equal(standalone.accepted, false, `${sourceTitle} standalone remote`);
    assert.equal(evaluateRetailCandidate(`Replacement remote control for ${sourceTitle}`, source).accepted, false);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} with remote`, source).accepted, true);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} included remote`, source).accepted, true);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} - no remote`, source).accepted, true);
    assert.equal(evaluateRetailCandidate(`${sourceTitle.replace(model, model === 'D-VR4SU' ? 'D-VR4SX' : 'BD-E6501')} with remote`, source).accepted, false);

    assert.equal(evaluateThroughTransport(`${sourceTitle.replace(/\b(?:dvd\s+vhs|blu-ray)\s+player\b/i, '')} remote control`, sourceTitle).accepted, false);
    assert.equal(evaluateThroughTransport(`${sourceTitle} with remote`, sourceTitle).accepted, true);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} with remote codes`, source).accepted, false);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} service manual with remote`, source).accepted, false);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} empty box with remote`, source).accepted, false);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} replacement parts only with remote`, source).accepted, false);
    assert.equal(evaluateRetailCandidate(`${sourceTitle} replacement remote control`, source).accepted, false);
    assert.equal(evaluateThroughTransport(`${sourceTitle} empty box with remote`, sourceTitle).accepted, false);
  }
});

test('bundled remotes remain valid on non-player electronics', () => {
  for (const title of [
    'Samsung UN55TU7000 television with remote',
    'Epson EH-TW7100 projector included remote',
    'Denon AVR-X1700H receiver plus remote',
  ]) {
    const source = extractProductIdentity(title.replace(/\s+(?:with|included|plus)\s+remote$/i, ''));
    assert.equal(evaluateRetailCandidate(title, source).accepted, true, title);
    assert.equal(evaluateThroughTransport(title, source.name).accepted, true, title);
  }
});

test('a remote-control source remains matchable as an accessory product', () => {
  const sourceTitle = 'Samsung BD-E6500 Replacement Remote Control';
  const source = extractProductIdentity(sourceTitle);
  assert.equal(evaluateRetailCandidate(sourceTitle, source).accepted, true);
  assert.equal(evaluateThroughTransport(sourceTitle, sourceTitle).accepted, true);
});
