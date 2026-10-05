import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
  isAccessoryListing,
  scoreRetailCandidate,
} from '../src/intelligence/us-deal-intelligence.js';

test('finished furniture rejects replacement components but keeps a complete table and included parts', () => {
  const source = extractProductIdentity('Eileen Gray E1027 Side Table');

  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table Replacement Glass Top', source).accepted,
    false,
  );
  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table Adjustable Height', source).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table with Spare Replacement Glass Top', source).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table, No Replacement Top', source).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table Without Replacement Glass Top', source).accepted,
    true,
  );
  assert.equal(evaluateRetailCandidate('Eileen Gray E1027 Table Lamp', source).accepted, false);
});

test('finished rugs and desks reject raw material listings', () => {
  const rug = extractProductIdentity('Hand Knotted Wool Area Rug');
  assert.equal(evaluateRetailCandidate('Hand Wool Rug Material Raw Fiber', rug).accepted, false);
  assert.equal(evaluateRetailCandidate('Hand Knotted Wool Area Rug Finished 5x8', rug).accepted, true);

  const desk = extractProductIdentity('An Antique Macassar Wood Veneer Desk');
  assert.equal(evaluateRetailCandidate('An Macassar Ebony Veneer Sheets Raw Wood Veneer', desk).accepted, false);
  assert.equal(evaluateRetailCandidate('An Antique Macassar Wood Veneer Desk Finished Furniture', desk).accepted, true);
});

test('source accessory and material lots remain eligible for their own identity', () => {
  const replacementTop = extractProductIdentity('Eileen Gray E1027 Side Table Replacement Glass Top');
  assert.equal(isAccessoryListing('Eileen Gray E1027 Side Table Replacement Glass Top', replacementTop), false);
  assert.equal(
    evaluateRetailCandidate('Eileen Gray E1027 Side Table Replacement Glass Top', replacementTop).accepted,
    true,
  );

  const veneer = extractProductIdentity('Macassar Ebony Veneer Sheets Raw Wood Veneer');
  assert.equal(isAccessoryListing('Macassar Ebony Veneer Sheets Raw Wood Veneer', veneer), false);
  assert.equal(evaluateRetailCandidate('Macassar Ebony Veneer Sheets Raw Wood Veneer', veneer).accepted, true);
});

test('finish and material descriptors do not turn complete products into raw material lots', () => {
  const sofa = extractProductIdentity('Top Grain Leather Sofa');
  assert.equal(evaluateRetailCandidate('Top Grain Leather Sofa Solid Wood Frame', sofa).accepted, true);

  const table = extractProductIdentity('Modern Metal Side Table');
  assert.equal(evaluateRetailCandidate('Modern Metal Side Table Sheet Metal Finish', table).accepted, true);
});

test('article and descriptor-led titles do not invent brands, while explicit brands win', () => {
  assert.equal(extractProductIdentity('An Antique Macassar Wood Veneer Desk').brand, '');
  assert.equal(extractProductIdentity('Hand Knotted Wool Area Rug').brand, '');
  assert.equal(extractProductIdentity('The Antique Knotted Wool Rug').brand, '');

  const explicit = extractProductIdentity(
    'An Antique Macassar Wood Veneer Desk',
    'Brand: Baker\nProduct Name: Antique Macassar Wood Veneer Desk',
  );
  assert.equal(explicit.brand, 'Baker');
});

test('included or absent source components do not exempt standalone replacement candidates', () => {
  for (const sourceTitle of [
    'Eileen Gray E1027 Side Table with Spare Replacement Glass Top',
    'Eileen Gray E1027 Side Table Without Replacement Glass Top',
  ]) {
    const source = extractProductIdentity(sourceTitle);
    assert.equal(evaluateRetailCandidate('Eileen Gray E1027 Side Table Replacement Glass Top', source).accepted, false);
  }
});

test('manufacturing and finish claims do not promote stock into finished products', () => {
  const rug = extractProductIdentity('Hand Knotted Wool Area Rug');
  assert.equal(evaluateRetailCandidate('Hand Wool Rug Material Raw Fiber Made in USA', rug).accepted, false);
  const desk = extractProductIdentity('An Antique Macassar Wood Veneer Desk');
  for (const title of [
    'Macassar Wood Veneer Sheets Finished',
    'Macassar Wood Veneer Stock',
    'Macassar Wood Veneer Dining Table',
  ]) assert.equal(evaluateRetailCandidate(title, desk).accepted, false, title);
});

test('complete unfinished furniture and material attributes remain valid', () => {
  const desk = extractProductIdentity('An Antique Macassar Wood Veneer Desk');
  assert.equal(evaluateRetailCandidate('Macassar Wood Veneer Desk Material: Wood', desk).accepted, true);
  assert.equal(evaluateRetailCandidate('Antique Macassar Wood Veneer Desk Unfinished', desk).accepted, true);
  const rug = extractProductIdentity('Hand Knotted Wool Area Rug');
  assert.equal(evaluateRetailCandidate('Hand Knotted Wool Area Rug without raw fiber', rug).accepted, true);
});

test('plural replacement components and unrelated included hardware remain accessories', () => {
  const table = extractProductIdentity('Eileen Gray E1027 Side Table');
  for (const title of [
    'Eileen Gray E1027 Side Table Replacement Glass Tops',
    'Eileen Gray E1027 Side Table Replacement Glass Top with mounting hardware included',
    'Eileen Gray E1027 Side Table Replacement Legs',
  ]) assert.equal(evaluateRetailCandidate(title, table).accepted, false, title);
});

test('furniture nouns do not match tablet substrings', () => {
  const tablet = extractProductIdentity('Acme T100 Tablet');
  assert.equal(evaluateRetailCandidate('Acme T100 Tablet Raw Aluminum', tablet).accepted, true);
});

test('finished object heads and material construction descriptions remain aligned', () => {
  const desk = extractProductIdentity('An Antique Macassar Wood Veneer Desk');
  assert.equal(evaluateRetailCandidate('Macassar Wood Veneer Writing Table', desk).accepted, true);
  const rug = extractProductIdentity('Hand Knotted Wool Area Rug');
  assert.equal(evaluateRetailCandidate('Hand Knotted Wool Area Carpet Made from Raw Wool Fiber', rug).accepted, true);
});

test('missing covers do not change the source from complete table into accessory', () => {
  const table = extractProductIdentity('Eileen Gray E1027 Side Table without cover');
  assert.equal(evaluateRetailCandidate('Eileen Gray E1027 Side Table Replacement Glass Top', table).accepted, false);
});

test('timber construction descriptions do not exempt source or reject complete furniture', () => {
  const table = extractProductIdentity('Acme Oak Dining Table');
  assert.equal(evaluateRetailCandidate('Acme Oak Dining Table made from reclaimed timber', table).accepted, true);
  const timberTable = extractProductIdentity('Acme Timber Dining Table');
  assert.equal(evaluateRetailCandidate('Acme Timber Dining Table Replacement Legs', timberTable).accepted, false);
});

test('desk-chair compounds refer to chairs, not desks in either direction', () => {
  const deskChair = extractProductIdentity('Acme Oak Desk Chair');
  assert.equal(evaluateRetailCandidate('Acme Oak Desk', deskChair).accepted, false);
  assert.equal(evaluateRetailCandidate('Acme Oak Chair', deskChair).accepted, true);
  assert.equal(evaluateRetailCandidate('Acme Oak Desk Chair', extractProductIdentity('Acme Oak Chair')).accepted, true);
});

test('suffix exclusion of a spare preserves complete furniture identity', () => {
  const table = extractProductIdentity('Eileen Gray E1027 Side Table');
  for (const suffix of ['not included', 'excluded', 'is not supplied']) {
    assert.equal(evaluateRetailCandidate(`Eileen Gray E1027 Side Table, spare replacement glass top ${suffix}`, table).accepted, true, suffix);
  }
});

test('source components cannot inherit complete-product or other component prices', () => {
  const veneer = extractProductIdentity('Macassar Ebony Veneer Sheets');
  assert.equal(evaluateRetailCandidate('Macassar Ebony Veneer Desk', veneer).accepted, false);
  assert.equal(evaluateRetailCandidate('Macassar Ebony Veneer Stock', veneer).accepted, true);
  const top = extractProductIdentity('Eileen Gray E1027 Side Table Replacement Glass Top');
  assert.equal(evaluateRetailCandidate('Eileen Gray E1027 Side Table', top).accepted, false);
  assert.equal(evaluateRetailCandidate('Eileen Gray E1027 Side Table Replacement Legs', top).accepted, false);
});

test('described replacement components stay distinct from full furniture in both directions', () => {
  const completeTitle = 'Eileen Gray E1027 Side Table';
  for (const modifier of ['Tempered Glass', 'Toughened Glass', 'Clear Acrylic', 'Solid Wood']) {
    const partTitle = `${completeTitle} Replacement ${modifier} Top`;
    for (const [sourceTitle, candidateTitle] of [[completeTitle, partTitle], [partTitle, completeTitle]]) {
      const source = extractProductIdentity(sourceTitle!);
      assert.equal(evaluateRetailCandidate(candidateTitle!, source).accepted, false, candidateTitle);
      assert.equal(scoreRetailCandidate(candidateTitle!, source), 0, candidateTitle);
    }
    const part = extractProductIdentity(partTitle);
    assert.equal(evaluateRetailCandidate(partTitle, part).accepted, true);
    assert.ok(scoreRetailCandidate(partTitle, part) > 0);
    const complete = extractProductIdentity(completeTitle);
    assert.equal(evaluateRetailCandidate(`${completeTitle} with Replacement ${modifier} Top`, complete).accepted, true);
  }
});

test('dining table chairs retain their chair head in both matching directions', () => {
  for (const [sourceTitle, candidateTitle] of [
    ['Acme T100 Dining Chair', 'Acme T100 Dining Table Chair'],
    ['Acme T100 Dining Table Chair', 'Acme T100 Dining Chair'],
  ]) {
    const source = extractProductIdentity(sourceTitle!);
    assert.equal(evaluateRetailCandidate(candidateTitle!, source).accepted, true);
    assert.ok(scoreRetailCandidate(candidateTitle!, source) > 0);
  }
  assert.equal(evaluateRetailCandidate('Acme T100 Dining Table', extractProductIdentity('Acme T100 Dining Table Chair')).accepted, false);
});
