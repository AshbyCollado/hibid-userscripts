import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductResearchQuery, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('recovers Canon FT QL from the primary camera prose', () => {
  const identity = extractProductIdentity(
    'Vintage Canon FT SLR Camera',
    'Canon FT QL 35mm film camera with standard lens and case. Untested. Good condition.',
  );

  assert.equal(identity.model, 'FTQL');
  assert.match(identity.query, /canon.*ftql/i);
});

test('recovers bare Canon FT from an affirmative primary camera declaration', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT camera. Untested.');

  assert.equal(identity.model, 'FT');
});

test('covers the reproduced Canon FT QL lot wording', () => {
  const identity = extractProductIdentity(
    'Vintage Canon FT SLR Camera',
    'Canon FT QL 35mm film camera with standard lens and case. Untested. Good condition.',
  );

  assert.equal(identity.model, 'FTQL');
});

test('keeps a concrete Canon FTb title ahead of conflicting FT QL prose', () => {
  const identity = extractProductIdentity(
    'Canon FTb SLR Camera',
    'Canon FT QL 35mm film camera. Untested.',
  );

  assert.equal(identity.model, 'FTb');
  assert.doesNotMatch(identity.query, /ftql/i);
});

test('keeps a concrete Canon FT QL title ahead of conflicting FTb prose', () => {
  const identity = extractProductIdentity(
    'Canon FT QL SLR Camera',
    'Canon FTb 35mm film camera. Untested.',
  );

  assert.equal(identity.model, 'FTQL');
  assert.doesNotMatch(identity.query, /ftb/i);
});

test('does not invent a Canon camera model without primary model evidence', () => {
  const identity = extractProductIdentity(
    'Canon SLR Camera',
    'Vintage Canon SLR camera. Untested. Good condition.',
  );

  assert.equal(identity.model, null);
});

test('does not recover a lens model from a camera attachment', () => {
  const identity = extractProductIdentity(
    'Canon SLR Camera',
    'Canon FL 50mm lens included. Camera is untested.',
  );

  assert.equal(identity.model, null);
});

test('does not treat a Canon FT QL lens cap as the primary camera model', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL lens cap included. Camera is untested.');

  assert.equal(identity.model, null);
});

test('does not treat a Canon FT QL instruction manual as the primary camera model', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL instruction manual included.');

  assert.equal(identity.model, null);
});

test('does not treat a compatible Canon FT QL lens as the primary camera model', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL compatible lens included.');

  assert.equal(identity.model, null);
});

test('does not recover an excluded Canon FT QL reference', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL camera is not included; reference only.');

  assert.equal(identity.model, null);
});

test('does not recover Canon USA warranty boilerplate', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon USA warranty applies to all cameras.');

  assert.equal(identity.model, null);
});

test('rejects competing alphabetic Canon primary camera models', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL or FTb camera, exact model unknown.');

  assert.equal(identity.model, null);
});

test('rejects competing alphabetic and numeric Canon primary camera models', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL camera. Canon AE-1 camera.');

  assert.equal(identity.model, null);
});

test('retains a competing title-matching FT declaration instead of selecting TL', () => {
  const identity = extractProductIdentity('Vintage Canon FT SLR Camera', 'Canon FT camera. Canon TL camera.');

  assert.equal(identity.model, null);
  assert.doesNotMatch(identity.query, /\btl\b/i);
});

test('does not replace an FT title with an unrelated TL description', () => {
  const identity = extractProductIdentity('Vintage Canon FT SLR Camera', 'Canon TL camera.');

  assert.equal(identity.model, null);
  assert.doesNotMatch(identity.query, /\btl\b/i);
});

test('does not recover a camera instruction manual model', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL camera instruction manual included.');

  assert.equal(identity.model, null);
});

test('does not recover a camera compatibility target from a lens cap', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon lens cap for FT QL camera included.');

  assert.equal(identity.model, null);
});

test('does not recover an accessory subject merely because it mentions a camera', () => {
  for (const description of [
    'Canon FT QL mirror for camera included.',
    'Canon FT QL focusing screen for camera included.',
  ]) {
    assert.equal(extractProductIdentity('Canon SLR Camera', description).model, null);
  }
});

test('counts lowercase numeric Canon declarations when checking ambiguity', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon FT QL camera. Canon ae-1 camera.');

  assert.equal(identity.model, null);
});

test('does not recover DSLR as a Canon model', () => {
  const identity = extractProductIdentity('Canon SLR Camera', 'Canon DSLR camera. Untested.');

  assert.equal(identity.model, null);
});

test('leaves manual FT QL query normalization unchanged', () => {
  assert.equal(buildProductResearchQuery('Canon FT QL 35mm film camera'), 'canon ft ql 35mm film camera');
});
