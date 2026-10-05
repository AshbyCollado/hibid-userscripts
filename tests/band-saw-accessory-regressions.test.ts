import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
  isAccessoryListing,
  scoreRetailCandidate,
} from '../src/intelligence/us-deal-intelligence.js';

const saw = extractProductIdentity('Jet JBS-14 Band Saw');
// Exact title strings from the retained production Browse response.
const reportedComponents = [
  ['263573255990', 'JET JBS-14 URETHANE BAND SAW TIRE SET  BLUE MAX HEAVY DUTY TIRES MADE IN USA!!'],
  ['355251337394', 'GENUINE OLSON COOL BLOCKS FOR JET JBS14  14" BAND SAW'],
  ['177739409825', 'Jet 14"  Band Saw Md JBS-14  Lower  Blade Guide  JET-11'],
  ['277577577194', '2 BLUE MAX ULTRA DUTY BAND SAW TIRES AND 2 THRUST BEARINGS FOR JET JBS-14 SAW'],
  ['187910858260', 'Jet 14"  Band Saw Md JBS-14 Table  Trunnion Support    JET-13'],
  ['273669133479', '2 BLUE MAX PRO SERIES .110 THICK BAND SAW TIRES FOR JET JBS-14 BAND SAW'],
  ['177739410662', 'Jet 14"  Band Saw Md JBS-14  Trunnion Brackets Assy   JET-12'],
  ['177739402038', 'Jet 14"  Band Saw Md JBS-14  On Off Push Button Switch JET-05'],
  ['187910898193', 'Jet 14"  Band Saw Md JBS-14  Plastic Blade Guard  JET-07'],
  ['389076318552', '14" Band Saw Upper Hinge Assy Fit For Delta Jet JWBS-14CS JBS-14 MW JWBS-14DXPRO'],
  ['187910859401', 'Jet 14"  Band Saw Md JBS-14 Three Case Covers   JET-14'],
  ['178001170303', 'Jet 14"  Band Saw Md JBS-14  Arbor Shaft Assy  JET-06'],
  ['187910859977', 'Jet 14"  Band Saw Md JBS-14 Bolt for Top  & Bottom Frame JET-15'],
  ['187900234318', 'Jet 14" Band Saw Md JBS-14   Motor HP 3/4  V 110/220  RPM 1725 EM-448'],
  ['273131059235', 'JET JBS-14 URETHANE BANDSAW TIRES ULTRA DUTY .125  THICKEST BEST QUALITY'],
  ['187910897765', 'Jet 14"  Band Saw Md JBS-14  Post Clamp Bracket & Screw JET-04'],
  ['187910852065', 'Jet 14"  Band Saw Md JBS-14 Knobs & Studs for Case  JET-02'],
] as const;

test('band saw equipment rejects the reported same-model component categories', () => {
  assert.equal(evaluateRetailCandidate('Jet JBS-14 Band Saw', saw).accepted, true);
  for (const [, title] of reportedComponents) {
    assert.equal(isAccessoryListing(title, saw), true, title);
    const result = evaluateRetailCandidate(title, saw);
    assert.equal(result.accepted, false, title);
    assert.ok(result.rejectionReasons.includes('accessory-or-component'), title);
    assert.equal(scoreRetailCandidate(title, saw), 0, title);
  }
});

test('synthetic band saw compound spelling and component placement do not depend on a brand', () => {
  for (const equipment of ['Acme BS-140 Band Saw', 'Acme BS-140 Bandsaw', 'Acme BS-140 Band-Saw']) {
    const identity = extractProductIdentity(equipment);
    assert.equal(evaluateRetailCandidate(equipment, identity).accepted, true, equipment);
    for (const title of [
      `${equipment} Blade Guide Assembly`,
      `${equipment} Tire with spare blade`,
      `${equipment} with upgraded. Motor`,
      `${equipment} with 1.5 HP. Motor`,
      'Motor for Acme BS-140 Band Saw',
      'Acme BS-140 Switch',
      'Acme BS-140 Replacement Tire',
      `${equipment} Cover with spare motor`,
      `${equipment} Mounting Bracket`,
      `${equipment} Table`,
      `${equipment} Tension Spring`,
      `${equipment} Table with upgraded motor`,
      `${equipment} Tension Spring with urethane tires`,
      `Table with ${equipment}`,
    ]) {
      const result = evaluateRetailCandidate(title, identity);
      assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
      assert.ok(result.rejectionReasons.includes('accessory-or-component'), title);
    }
  }
});

test('synthetic whole band saws may include or exclude components without becoming accessory subjects', () => {
  for (const title of [
    'Jet JBS-14 Band Saw with replacement blade',
    'Jet JBS-14 Band Saw w/ spare blade',
    'Jet JBS-14 Band Saw with upper blade guide',
    'Jet JBS-14 Band Saw with 1 hp motor',
    'Jet JBS-14 Band Saw with 1.5 HP motor',
    'Jet JBS-14 Band Saw with 3/4 HP motor',
    'Jet JBS-14 Band Saw with upgraded motor',
    'Jet JBS-14 Band Saw with urethane tires',
    'Jet JBS-14 Band Saw with precision-ground table',
    'Jet JBS-14 Band Saw with heavy-duty tension spring',
    'Jet JBS-14 Band Saw blade installed',
    'Jet JBS-14 Band Saw without blade',
    'Jet JBS-14 Band Saw knobs not included',
  ]) {
    assert.equal(isAccessoryListing(title, saw), false, title);
    assert.equal(evaluateRetailCandidate(title, saw).accepted, true, title);
    assert.equal(isAccessoryListing('Jet JBS-14 Band Saw Tire', extractProductIdentity(title)), true, title);
  }
});

test('synthetic accessory-source blade, guide, and tire identities retain matching candidates', () => {
  for (const title of [
    'Jet JBS-14 Band Saw Blade',
    'Jet JBS-14 Band Saw Blade Guide',
    'Jet JBS-14 Band Saw Tire',
    'Blade Guide for Acme BS-140 Bandsaw',
    'Acme BS-140 Band Saw Table',
    'Acme BS-140 Band Saw Tension Spring',
  ]) {
    const source = extractProductIdentity(title);
    assert.equal(evaluateRetailCandidate(title, source).accepted, true, title);
    assert.equal(isAccessoryListing(title, source), false, title);
  }
});

test('synthetic Browse set with exact captured component titles preserves a whole saw control', () => {
  const titles = [...reportedComponents, ['100000000001', 'Jet JBS-14 Band Saw']];
  const result = parseEbayActiveResults({
    query: 'jet jbs-14', identity: saw, observedAt: '2026-10-03T12:00:00.000Z',
    browseJson: {
      total: titles.length, offset: 0,
      itemSummaries: titles.map(([itemId, title]) => ({
        itemId, title, itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
        price: { value: '100', currency: 'USD' },
        shippingOptions: [{ shippingCost: { value: '0', currency: 'USD' } }],
        buyingOptions: ['FIXED_PRICE'], condition: 'Used',
      })),
    },
  });
  assert.deepEqual(result.accepted.map((entry) => entry.title), ['Jet JBS-14 Band Saw']);
  assert.equal(result.rejected.length, reportedComponents.length);
  assert.ok(result.rejected.every((entry) => entry.rejectionReasons.includes('accessory-or-component')));
  assert.equal(result.benchmark, null);
});

test('synthetic Browse component attachment preserves saw subjects but not standalone tables or springs', () => {
  const wholeTitles = [
    'Acme BS-140 Band Saw with 1.5 HP motor',
    'Acme BS-140 Band Saw with 3/4 HP motor',
    'Acme BS-140 Band Saw with upgraded motor',
    'Acme BS-140 Band Saw with urethane tires',
    'Acme BS-140 Band Saw with precision-ground table',
    'Acme BS-140 Band Saw with heavy-duty tension spring',
  ];
  const componentTitles = [
    'Acme BS-140 Band Saw tire with spare blade',
    'Acme BS-140 Band Saw with upgraded. Motor',
    'Acme BS-140 Band Saw with 1.5 HP. Motor',
    'Acme BS-140 Band Saw Table',
    'Acme BS-140 Band Saw Tension Spring',
    'Acme BS-140 Band Saw Table with upgraded motor',
    'Acme BS-140 Band Saw Tension Spring with urethane tires',
    'Table with Acme BS-140 Band Saw',
  ];
  const identity = extractProductIdentity('Acme BS-140 Band Saw');
  const parse = (titles: string[], source = identity) => parseEbayActiveResults({
    query: 'acme bs-140', identity: source, observedAt: '2026-10-03T12:00:00.000Z',
    browseJson: {
      total: titles.length, offset: 0,
      itemSummaries: titles.map((title, index) => ({
        itemId: String(100000000100 + index), title,
        itemWebUrl: `https://www.ebay.com/itm/${100000000100 + index}`,
        price: { value: '100', currency: 'USD' },
        buyingOptions: ['FIXED_PRICE'], condition: 'Used',
      })),
    },
  });
  const result = parse([...wholeTitles, ...componentTitles]);
  assert.deepEqual(result.accepted.map((entry) => entry.title), wholeTitles);
  assert.equal(result.rejected.length, componentTitles.length);
  assert.ok(result.rejected.every((entry) => entry.rejectionReasons.includes('accessory-or-component')));
  for (const title of wholeTitles) {
    const source = extractProductIdentity(title);
    const tire = parse(['Acme BS-140 Band Saw Tire'], source);
    assert.equal(tire.accepted.length, 0, title);
    assert.ok(tire.rejected[0]?.rejectionReasons.includes('accessory-or-component'), title);
  }
});

const productionFixturePath = new URL('./fixtures/ebay-active-jet-bandsaw-production-20261003.json', import.meta.url);

test('production Browse fixture body matches its declared transformed-body integrity', () => {
  const fixture = JSON.parse(readFileSync(productionFixturePath, 'utf8'));
  const metadata = fixture.sourceHashMetadata;
  const bodySHA = createHash('sha256').update(JSON.stringify(fixture.body), 'utf8').digest('hex');
  assert.equal(bodySHA, '8717889e152f407a90fde1d58f12289fc2305485c738e2a9ddc2ca01f3c118b3');
  assert.equal(bodySHA, metadata.fixtureBodySHA);
  assert.equal(metadata.receiptContentSHA, '9ff46041dffb42cdadf4648b5ddb260062a3e376a1045bb6d560575919ec6e3f');
  assert.notEqual(bodySHA, metadata.receiptContentSHA);
  assert.equal(metadata.bodyHashEncoding, 'SHA-256 of UTF-8 JSON.stringify(body), preserving property order.');
  assert.deepEqual(metadata.bodyTransformation, {
    field: 'body.itemSummaries[*].itemWebUrl',
    operation: 'Remove every query parameter except var; serialize with URL.toString().',
    changedItemWebUrlCount: 75,
  });
  for (const row of fixture.body.itemSummaries) {
    const url = new URL(row.itemWebUrl);
    assert.ok([...url.searchParams.keys()].every((key) => key === 'var'), row.itemId);
  }
});

test('tracked 75-row production Browse fixture excludes every prior band saw accessory accept', () => {
  const fixture = JSON.parse(readFileSync(productionFixturePath, 'utf8'));
  assert.equal(fixture.sourceHashMetadata.httpStatus, 200);
  assert.equal(fixture.sourceHashMetadata.receiptContentSHA, '9ff46041dffb42cdadf4648b5ddb260062a3e376a1045bb6d560575919ec6e3f');
  assert.equal(fixture.body.total, 75);
  assert.equal(fixture.body.itemSummaries.length, 75);
  assert.equal(fixture.sourceTitle, 'Jet JBS-14 Band Saw - LIKE NEW');
  assert.equal(fixture.sourceDescription, 'Jet JBS-14 Band Saw - LIKE NEW');
  assert.equal(fixture.sourceHashMetadata.priorAcceptedItemIds.length, 17);
  assert.deepEqual(
    fixture.sourceHashMetadata.priorAcceptedItemIds,
    reportedComponents.map(([itemId]) => `v1|${itemId}|0`),
  );
  for (const [itemId, title] of reportedComponents) {
    assert.equal(fixture.body.itemSummaries.find((entry: { itemId: string }) => entry.itemId === `v1|${itemId}|0`)?.title, title);
  }

  const result = parseEbayActiveResults({
    query: fixture.query,
    identity: extractProductIdentity(fixture.sourceTitle, fixture.sourceDescription),
    sourceDescription: fixture.sourceDescription,
    observedAt: fixture.observedAt,
    browseJson: fixture.body,
  });
  assert.equal(result.records.length, 75);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.accepted.length, 0, JSON.stringify(result.accepted));
  assert.equal(result.rejected.length, 75);
  assert.equal(result.benchmark, null);
  for (const [itemId, title] of reportedComponents) {
    const record = result.records.find((entry) => entry.legacyItemId === itemId);
    assert.equal(record?.matchDecision, 'rejected', title);
    assert.ok(record?.rejectionReasons.includes('accessory-or-component'), title);
  }
});
