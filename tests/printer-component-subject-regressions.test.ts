import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
  isAccessoryListing,
} from '../src/intelligence/us-deal-intelligence.js';

const printer = extractProductIdentity('Canon Pixma MG5420 Inkjet Printer');

test('MG5420 component-subject titles cannot inherit whole-printer retail matches', () => {
  const componentTitles = [
    'Canon Pixma MG5420 Printer Control Panel with Display Screen CF',
    'Canon Pixma MG5420 iP7220 Printer Carriage Belt Drive Motor Unit QK1-8408',
    'Canon Pixma MG5420 Inkjet Printer Front Control Panel',
    'Qy6-0082 Full Color Printhead For Canon PIXMA MG5420',
  ];

  for (const title of componentTitles) {
    assert.equal(isAccessoryListing(title, printer), true, title);
    const result = evaluateRetailCandidate(title, printer);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(','), /accessory-or-component/);
  }
});

test('whole MG5420 printers retain legitimate included-component and cord wording', () => {
  for (const title of [
    'Canon Pixma MG5420 Inkjet Printer with display',
    'Canon Pixma MG5420 Printer with ink',
    'Canon Pixma MG5420 Printer with ink cartridges included',
    'Canon Pixma MG5420 Printer with power cord and USB cable',
  ]) {
    assert.equal(evaluateRetailCandidate(title, printer).accepted, true, title);
  }
});

test('ink jet printer technology is not mistaken for a bare ink component', () => {
  const inkJet = extractProductIdentity('Canon Pixma MG5420 Ink Jet Printer');
  assert.equal(evaluateRetailCandidate('Canon Pixma MG5420 Printer Control Panel', inkJet).accepted, false);
  assert.match(
    evaluateRetailCandidate('Canon Pixma MG5420 Printer Control Panel', inkJet).rejectionReasons.join(','),
    /accessory-or-component/,
  );

  const inkjet = extractProductIdentity('Canon Pixma MG5420 Inkjet Printer');
  assert.equal(evaluateRetailCandidate('Canon Pixma MG5420 Ink Jet Printer', inkjet).accepted, true);
});

test('missing consumables do not turn a whole printer into a component listing', () => {
  for (const title of [
    'Canon Pixma MG5420 Printer without ink',
    'Canon Pixma MG5420 Printer with no ink',
    'Canon Pixma MG5420 Printer, missing ink',
  ]) {
    assert.equal(isAccessoryListing(title, printer), false, title);
    assert.equal(evaluateRetailCandidate(title, printer).accepted, true, title);
  }
});

test('component lots remain eligible when the source itself is the component', () => {
  const printhead = extractProductIdentity('Qy6-0082 Full Color Printhead For Canon PIXMA MG5420');
  const panel = extractProductIdentity('Canon Pixma MG5420 Printer Control Panel');
  const ink = extractProductIdentity('Canon Pixma MG5420 Ink Cartridge');

  assert.equal(evaluateRetailCandidate('Qy6-0082 Full Color Printhead For Canon PIXMA MG5420', printhead).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon Pixma MG5420 Front Control Panel', panel).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon Pixma MG5420 Ink Cartridge', ink).accepted, true);
});

test('component detection covers compatibility lists before and after the model', () => {
  for (const title of [
    'Printhead compatible with Canon PIXMA MG5420',
    'Canon PIXMA MG5420 compatible replacement control panel',
    'Ink cartridge for Canon Pixma MG5420 printer',
  ]) {
    const result = evaluateRetailCandidate(title, printer);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(','), /accessory-or-component/);
  }
});
