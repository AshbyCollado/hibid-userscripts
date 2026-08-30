import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyEbaySoldCompSet,
  type EbaySoldCompVerification,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';
import {
  assessCondition,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-08-30T12:00:00.000Z';

function soldRecord(itemId: string, title: string, condition = 'Used'): EbaySoldRecord {
  const itemUrl = `https://www.ebay.com/itm/${itemId}`;
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=adversarial&tabName=SOLD',
    observedAt,
    itemId,
    itemUrl,
    title,
    imageUrl: null,
    soldPrice: { amount: 100, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 100, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 100, currency: 'USD' },
    soldAt: 'Aug 30, 2026',
    condition,
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function soldAttempt(query: string, titles: readonly string[]): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt,
    status: 'ok',
    records: titles.map((title, index) => soldRecord(String(390000000001 + index), title)),
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
}

function verifyTitles(
  sourceTitle: string,
  candidateTitles: readonly string[],
  options: { sourceConditionText?: string; sourceQuantity?: number | null } = {},
): EbaySoldCompVerification {
  const identity = extractProductIdentity(sourceTitle);
  const query = identity.query || sourceTitle;
  return verifyEbaySoldCompSet(identity, [soldAttempt(query, candidateTitles)], {
    plannedQueries: [query],
    minimumSampleSize: 1,
    sourceCondition: options.sourceConditionText == null
      ? null
      : assessCondition(options.sourceConditionText),
    sourceQuantity: options.sourceQuantity ?? 1,
  });
}

function acceptedFlags(result: EbaySoldCompVerification, titles: readonly string[]): boolean[] {
  const accepted = new Set(result.accepted.map((record) => record.title));
  return titles.map((title) => accepted.has(title));
}

test('medical replacement lamps and camera heads cannot comp complete equipment', () => {
  const lamp = 'Circon ACMI ALU-1B Replacement Lamp Bulb 300W';
  const cameraHead = 'Stryker 1288 HD Camera Head';
  assert.deepEqual(
    [
      acceptedFlags(verifyTitles('Circon ACMI ALU-1B Light Source', [lamp]), [lamp])[0],
      acceptedFlags(verifyTitles('Stryker 1288 HD Camera System', [cameraHead]), [cameraHead])[0],
    ],
    [false, false],
  );
});

test('Pair, 2 Pack, and Qty forms cannot comp a single auction unit', () => {
  const candidates = [
    'Pair of Seagate 8TB External Hard Drives',
    '2 Pack Seagate 8TB External Hard Drives',
    'Qty 2 Seagate 8TB External Hard Drives',
  ];
  const result = verifyTitles('Seagate 8TB External Hard Drive', candidates, { sourceQuantity: 1 });
  assert.deepEqual(acceptedFlags(result, candidates), [false, false, false]);
});

test('tested equipment cannot use untested, as-is, or activation-locked comps', () => {
  const untested = 'GE Dinamap Pro 400 Vital Signs Monitor Untested As-Is';
  const locked = 'Apple iPhone 15 Pro 256GB iCloud Locked';
  assert.deepEqual(
    [
      acceptedFlags(verifyTitles(
        'GE Dinamap Pro 400 Vital Signs Monitor Tested Working',
        [untested],
        { sourceConditionText: 'Condition: Used - Tested Working\nFunctional: Yes' },
      ), [untested])[0],
      acceptedFlags(verifyTitles(
        'Apple iPhone 15 Pro 256GB Unlocked Tested Working',
        [locked],
        { sourceConditionText: 'Condition: Used - Tested Working\nFunctional: Yes' },
      ), [locked])[0],
    ],
    [false, false],
  );
});

test('model generations and extended suffixes remain distinct', () => {
  const markTwo = 'Canon EOS R6 Mark II Mirrorless Camera';
  const extendedSuffix = 'Circon ACMI ALU-1B-2 Light Source';
  assert.deepEqual(
    [
      acceptedFlags(verifyTitles('Canon EOS R6 Mirrorless Camera', [markTwo]), [markTwo])[0],
      acceptedFlags(verifyTitles('Circon ACMI ALU-1B Light Source', [extendedSuffix]), [extendedSuffix])[0],
    ],
    [false, false],
  );
});

test('candidate-only material bundles cannot price a standalone console', () => {
  const bundle = 'Nintendo Switch OLED Console Bundle with Zelda Game, Pro Controller, and Carry Case';
  const result = verifyTitles('Nintendo Switch OLED Console', [bundle]);
  assert.deepEqual(acceptedFlags(result, [bundle]), [false]);
});

test('generic PS5 edition, capacity, and region mixtures are not market-ready', () => {
  const candidates = [
    'Sony PlayStation 5 Slim Digital Edition Console 1TB',
    'Sony PlayStation 5 Disc Edition Console 825GB',
    'Sony PlayStation 5 Digital Edition Japanese Import Console 825GB',
  ];
  const result = verifyTitles('Sony PlayStation 5 Console', candidates);
  assert.equal(result.marketValueReady, false);
  assert.notEqual(result.matchConfidence, 'title-family');
});

test('storage families stay distinct while equivalent capacity units match', () => {
  const wrongFamily = 'WD Purple 4TB Surveillance Hard Drive';
  const equivalentCapacity = 'Samsung T7 1000GB Portable SSD';
  assert.deepEqual(
    [
      acceptedFlags(verifyTitles('Western Digital My Passport 4TB Portable Hard Drive', [wrongFamily]), [wrongFamily])[0],
      acceptedFlags(verifyTitles('Samsung T7 1TB Portable SSD', [equivalentCapacity]), [equivalentCapacity])[0],
    ],
    [false, true],
  );
});

test('book media and regional formats stay distinct while equivalent ISBNs match', () => {
  const audiobook = 'The Jesus Papers: Exposing the Greatest Cover-Up in History Audiobook 6-CD Set';
  const internationalPaperback = 'Introduction to Algorithms 3rd Edition International Paperback';
  const equivalentIsbn = 'Introduction to Algorithms ISBN 9780262033848 3rd Edition Hardcover';
  assert.deepEqual(
    [
      acceptedFlags(verifyTitles(
        'The Jesus Papers: Exposing the Greatest Cover-Up in History Hardcover',
        [audiobook],
      ), [audiobook])[0],
      acceptedFlags(verifyTitles(
        'Introduction to Algorithms 3rd Edition Hardcover',
        [internationalPaperback],
      ), [internationalPaperback])[0],
      acceptedFlags(verifyTitles(
        'Introduction to Algorithms ISBN 0262033844 Third Edition Hardcover',
        [equivalentIsbn],
      ), [equivalentIsbn])[0],
    ],
    [false, false, true],
  );
});

test('retail packaging and carton-only listings cannot comp the contained product', () => {
  const candidates = [
    'Nintendo Switch OLED Console Original Retail Packaging Only',
    'Nintendo Switch OLED Console OEM Carton Only',
  ];
  const result = verifyTitles('Nintendo Switch OLED Console', candidates);
  assert.deepEqual(acceptedFlags(result, candidates), [false, false]);
});

test('punctuated brands and established initialisms retain brand identity', () => {
  const cases = [
    ['B. Braun Perfusor Space Infusion Pump', 'B Braun Perfusor Space Infusion Pump'],
    ['Bowers & Wilkins PX7 S2 Headphones', 'B&W PX7 S2 Headphones'],
    ['Bang & Olufsen Beoplay H95 Headphones', 'B&O Beoplay H95 Headphones'],
  ] as const;
  assert.deepEqual(
    cases.map(([source, candidate]) => acceptedFlags(verifyTitles(source, [candidate]), [candidate])[0]),
    [true, true, true],
  );
});
