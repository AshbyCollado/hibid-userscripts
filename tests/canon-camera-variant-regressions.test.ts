import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

test('Canon AE-1 and AE-1 Program are bidirectionally distinct camera variants', () => {
  const base = extractProductIdentity('Vintage Canon AE-1 & Attachments');
  const program = extractProductIdentity('Canon AE-1 Program Camera');

  assert.equal(evaluateRetailCandidate('Canon AE-1 35mm Camera with lenses and flash', base).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon AE-1 Program 35mm Camera Lot Lenses Flash Bag Tested Working', base).accepted, false);
  assert.match(evaluateRetailCandidate('Canon AE-1 Program 35mm Camera', base).rejectionReasons.join(','), /variant-mismatch:canon-ae-1/);

  assert.equal(evaluateRetailCandidate('Canon AE-1 Program Camera with accessories', program).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon AE-1 Camera with accessories', program).accepted, false);
  assert.match(evaluateRetailCandidate('Canon AE-1 Camera', program).rejectionReasons.join(','), /variant-mismatch:canon-ae-1-program/);
});

test('Canon AE-1 variant matching tolerates punctuation and spacing but rejects Canon A-1', () => {
  const base = extractProductIdentity('Canon AE-1 Camera');
  const program = extractProductIdentity('Canon AE-1 Program Camera');

  for (const title of ['Canon AE 1 Camera', 'Canon AE-1 Camera', 'Canon AE-1-camera']) {
    assert.equal(evaluateRetailCandidate(title, base).accepted, true, title);
  }
  for (const title of ['Canon AE 1 Program Camera', 'Canon AE-1-Program Camera', 'Canon AE-1 Program Camera']) {
    assert.equal(evaluateRetailCandidate(title, base).accepted, false, title);
    assert.equal(evaluateRetailCandidate(title, program).accepted, true, title);
  }
  assert.equal(evaluateRetailCandidate('Canon A-1 35mm Camera', base).accepted, false);
});

test('Canon AE-1 Program punctuation stays a named variant in both directions', () => {
  const base = extractProductIdentity('Canon AE-1 Camera');
  const program = extractProductIdentity('Canon AE-1 Program Camera');
  for (const title of ['Canon AE-1 Program Camera', 'Canon AE-1 (Program) Camera', 'Canon AE-1 / Program Camera', 'Canon AE-1-Program Camera']) {
    assert.equal(evaluateRetailCandidate(title, base).accepted, false, title);
    assert.equal(evaluateRetailCandidate(title, program).accepted, true, title);
  }
  assert.equal(evaluateRetailCandidate('Canon AE-1 Camera', base).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon AE-1 Camera', program).accepted, false);
});

test('compatibility mentions and included accessories do not create a camera-variant conflict', () => {
  const base = extractProductIdentity('Canon AE-1 Camera');

  assert.equal(
    evaluateRetailCandidate('Canon AE-1 Camera compatible with Canon AE-1 Program flash accessory', base).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate('Canon AE-1 Camera with Program flash, case, and strap', base).accepted,
    true,
  );
  const flash = extractProductIdentity('Canon AE-1 Flash');
  assert.equal(evaluateRetailCandidate('Canon AE-1 Flash', flash).accepted, true);
  assert.equal(
    evaluateRetailCandidate('Flash accessory compatible with Canon AE-1', extractProductIdentity('Canon AE-1 Camera with flash accessory')).accepted,
    false,
  );
  assert.equal(evaluateRetailCandidate('Canon AE-1 Flash', base).accepted, false);
  assert.equal(
    evaluateRetailCandidate('Flash accessory compatible with Canon AE-1 Program', base).accepted,
    false,
  );
  assert.doesNotMatch(
    evaluateRetailCandidate('Flash accessory compatible with Canon AE-1 Program', base).rejectionReasons.join(','),
    /variant-mismatch/,
  );
  assert.match(
    evaluateRetailCandidate('Flash accessory compatible with Canon AE-1 Program', base).rejectionReasons.join(','),
    /accessory-or-component/,
  );
  assert.equal(evaluateRetailCandidate('Canon AE-1 Camera with built-in flash', base).accepted, true);
  assert.equal(evaluateRetailCandidate('Canon AE-1 Camera featuring flash', base).accepted, true);
  for (const title of [
    'Canon AE-1 Camera w/ flash',
    'Canon AE-1 Camera, flash included',
    'Canon AE-1 Camera without flash',
    'Canon AE-1 Camera, flash not included',
  ]) {
    assert.equal(evaluateRetailCandidate(title, base).accepted, true, title);
  }
  assert.equal(
    evaluateRetailCandidate('Flash accessory compatible with Canon AE-1', flash).accepted,
    true,
  );
  assert.equal(evaluateRetailCandidate('Flash kit for Canon AE-1 Camera', base).accepted, false);
});

test('flash subject classification stays photographic instead of matching storage and media jargon', () => {
  const samsung = extractProductIdentity('Samsung 980 Pro 1TB NVMe SSD');
  const sandisk = extractProductIdentity('SanDisk Ultra 128GB USB Drive');
  const flashMemory = extractProductIdentity('SanDisk 128GB Flash Memory');
  const flashGordon = extractProductIdentity('Flash Gordon Movie');

  assert.equal(evaluateRetailCandidate('Samsung 980 Pro 1TB NVMe SSD with Flash SSD', samsung).accepted, true);
  assert.equal(evaluateRetailCandidate('SanDisk Ultra 128GB USB Flash Drive', sandisk).accepted, true);
  assert.equal(evaluateRetailCandidate('SanDisk 128GB Flash Memory', flashMemory).accepted, true);
  assert.equal(evaluateRetailCandidate('Flash Gordon Movie', flashGordon).accepted, true);
});
