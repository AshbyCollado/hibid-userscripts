import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('adds a corroborated model for a concrete Pixma Canon printer title', () => {
  const identity = extractProductIdentity(
    'Pixma Canon Printer',
    'Lot contains a Pixma Canon Printer MG5420. Turns on! Local pickup only.\nNotes: Says it needs a new print head.\nCondition: Good',
  );

  assert.equal(identity.name, 'Pixma Canon Printer');
  assert.equal(identity.brand, 'Pixma');
  assert.equal(identity.model, 'MG5420');
  assert.match(identity.query, /pixma canon printer mg5420/i);
});

test('supports another manufacturer and product line without changing the source name', () => {
  const identity = extractProductIdentity(
    'Epson Photo Scanner',
    'This Epson Photo Scanner J252A powers on. Local pickup only.',
  );

  assert.equal(identity.name, 'Epson Photo Scanner');
  assert.equal(identity.model, 'J252A');
  assert.match(identity.query, /epson photo scanner j252a/i);
});

for (const label of ['model', 'model number', 'MPN']) {
  test(`accepts one leading ${label} label with a corroborated code`, () => {
    const identity = extractProductIdentity(
      'Pixma Canon Printer',
      `Lot contains a Pixma Canon Printer ${label}: MG5420. Turns on!`,
    );

    assert.equal(identity.model, 'MG5420');
    assert.match(identity.query, /mg5420/i);
  });
}

test('keeps a primary model when an accessory is explicitly included', () => {
  const identity = extractProductIdentity(
    'Pixma Canon Printer',
    'Lot contains a Pixma Canon Printer MG5420 with ink cartridges included.',
  );

  assert.equal(identity.model, 'MG5420');
});

test('keeps an explicit title model ahead of a conflicting description model', () => {
  const identity = extractProductIdentity(
    'Pixma Canon Printer MG5320',
    'Lot contains a Pixma Canon Printer MG5420. Local pickup only.',
  );

  assert.equal(identity.model, 'MG5320');
  assert.doesNotMatch(identity.query, /mg5420/i);
});

test('does not choose between multiple primary model declarations', () => {
  const identity = extractProductIdentity(
    'Pixma Canon Printer',
    'Lot contains a Pixma Canon Printer MG5420 or MG5320. Local pickup only.',
  );

  assert.equal(identity.model, null);
  assert.doesNotMatch(identity.query, /mg5320|mg5420/i);
});

test('does not harvest a camera lens component model', () => {
  const identity = extractProductIdentity(
    'Canon EOS Camera',
    'Lot contains a Canon EOS Camera with lens EF 50mm. Local pickup only.',
  );

  assert.equal(identity.model, null);
  assert.doesNotMatch(identity.query, /ef|50mm/i);
});

test('does not harvest shipping or auctioneer value boilerplate', () => {
  const identity = extractProductIdentity(
    'Pixma Canon Printer',
    'Lot contains a Pixma Canon Printer. Suggested retail value is $200. Shipping model is buyer arranged.',
  );

  assert.equal(identity.model, null);
});

for (const description of [
  'Lot contains a Pixma Canon Printer MG5420 replacement print head.',
  'Lot contains a Pixma Canon Printer MG5420 ink cartridges.',
  'Lot contains a Pixma Canon Printer MG5420 compatible with this lot.',
  'Lot contains a Pixma Canon Printer MG5420 works with this item.',
]) {
  test(`rejects a trailing accessory or compatibility assertion: ${description}`, () => {
    const identity = extractProductIdentity('Pixma Canon Printer', description);
    assert.equal(identity.model, null);
  });
}

for (const description of [
  'Lot contains a Pixma Canon Printer MG5420 or possibly MG5320.',
  'Lot contains a Pixma Canon Printer MG5420 or model number MG5320.',
  'Lot contains a Pixma Canon Printer MG5420 and perhaps MG5320.',
  'Lot contains a Pixma Canon Printer MG5420, model MG5320.',
]) {
  test(`rejects an ambiguous alternative model: ${description}`, () => {
    const identity = extractProductIdentity('Pixma Canon Printer', description);
    assert.equal(identity.model, null);
  });
}
