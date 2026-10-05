import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayActiveResults, type EbayActiveResultsInput } from '../src/intelligence/ebay-active-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
const base = (overrides: Record<string, unknown> = {}) => {
  const itemId = String(overrides.itemId ?? '100000000001');
  const legacyId = itemId.startsWith('v1|') ? itemId.split('|')[1] : itemId;
  return {
  itemId, title: 'Onkyo TX-SR304 Multi-Channel AV Receiver',
  itemWebUrl: `https://www.ebay.com/itm/${legacyId}`, price: { value: '50.00', currency: 'USD' },
  shippingOptions: [{ shippingCost: { value: '10.00', currency: 'USD' } }], buyingOptions: ['FIXED_PRICE'], condition: 'Used', ...overrides,
  };
};
const parse = (items: unknown[]) => parseEbayActiveResults({ query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', browseJson: { total: items.length, offset: 0, itemSummaries: items } });

test('parses a ten-result Browse shape and rejects accessory traps, wrong model, currency, price, and auction rows', () => {
  const result = parse([
    base(), base({ itemId: '100000000002', title: 'Onkyo TX-SR304 AV Receiver', price: { value: '60', currency: 'USD' } }),
    base({ itemId: '100000000003', title: 'Onkyo TX-SR304 Replacement Remote Control' }),
    base({ itemId: '100000000004', title: 'Onkyo TX-SR304 Remote Only' }),
    base({ itemId: '100000000005', title: 'Onkyo TX-SR304 Remote Control Genuine' }),
    base({ itemId: '100000000006', title: 'Onkyo TX-SR304 Receiver Faceplate' }),
    base({ itemId: '100000000007', title: 'Onkyo TX-SR305 Multi-Channel AV Receiver' }),
    base({ itemId: '100000000008', price: { value: '70', currency: 'CAD' } }),
    base({ itemId: '100000000009', price: { value: 'nope', currency: 'USD' } }),
    base({ itemId: '100000000010', buyingOptions: ['AUCTION'], shippingOptions: [] }),
  ]);
  assert.equal(result.records.length, 10);
  assert.equal(result.accepted.length, 2);
  assert.ok(result.rejected.some((record) => record.rejectionReasons.includes('non-usd-price')));
  assert.ok(result.rejected.some((record) => record.rejectionReasons.includes('auction-only-or-not-fixed-price')));
  assert.ok(result.rejected.some((record) => record.rejectionReasons.some((reason) => /accessory|non-comparable/.test(reason))));
});

test('Bosch GCM12SD part listings cannot form a whole-saw asking benchmark', () => {
  const sawIdentity = extractProductIdentity('Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw');
  const titles = [
    'Bosch 1609B02317 Guard for Slide Miter Saw GCM12SD',
    'NEW OEM Bosch GCM12SD Compound Miter Saw REPLACEMENT MOTOR',
    'Bosch GCM12SD Genuine OEM Replacement Fence, 1609B00242',
    'Bosch GCM12SD 12 in. Dual-Bevel Glide Miter Saw',
  ];
  const records = titles.map((title, index) => ({
    ...base({ itemId: String(100000000100 + index), title, price: { value: String(40 + index * 10), currency: 'USD' } }),
  }));
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD', identity: sawIdentity, observedAt: '2026-09-23T09:38:50.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1, destinationPostalCode: '78701',
    browseJson: { itemSummaries: records, total: 4, offset: 0 },
  });

  assert.equal(result.accepted.length, 1, JSON.stringify(result.records.map((record) => ({ title: record.title, reasons: record.rejectionReasons }))));
  assert.equal(result.benchmark, null);
  assert.ok(result.records.slice(0, 3).every((record) => record.matchDecision === 'rejected'));
});

test('a described zippered trading-card binder does not compare against standard portfolios', () => {
  const description = 'Brand: Ultra Pro\nModel: Elite Series Lucario 9-Pocket Zippered PRO-Binder for Pokemon\nThis binder stores up to 360 cards.';
  const binderIdentity = extractProductIdentity('$50 Ultra Pro Pokemon Binder 9-Pocket Lucario', description);
  const titles = [
    'Ultra Pro Pokemon Mega Evolution Official 9 Pocket Portfolio Binder 252 Cards',
    'Ultra Pro Pokemon 9 Pocket Binder Portfolio and Pages Lucario Mega Evolution',
    'Ultra Pro Pokemon 9-Pocket Portfolio MEGA LUCARIO EVOLUTION Holds 252 Cards New',
    'Ultra PRO Elite Series Lucario 9 Pocket Zippered Binder for Pokemon TCG',
    'Pokemon Ultra PRO LUCARIO 9-Pocket Zippered PRO-Binder Holds 360 Cards',
    'Ultra Pro Elite Series Mew 9 Pocket Zippered Binder',
  ];
  const result = parseEbayActiveResults({
    query: 'ultra pro pokemon binder 9-pocket lucario', identity: binderIdentity,
    sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
    browseJson: { total: titles.length, offset: 0,
      itemSummaries: titles.map((title, index) => base({ itemId: String(100000000700 + index), title })) },
  });
  assert.deepEqual(result.accepted.map((record) => record.title), titles.slice(3, 5), JSON.stringify(result.records.map((record) => ({ title: record.title, reasons: record.rejectionReasons }))));
  assert.equal(result.benchmark, null);
  assert.ok(result.records.slice(0, 3).every((record) => record.rejectionReasons.includes('product-form-mismatch:zippered-binder')));
  assert.ok(result.records[5]?.rejectionReasons.includes('product-variant-mismatch:lucario'));
});

test('binder capacity checks ordinary wording independently of the zippered form', () => {
  const description = 'Model: Elite Series Lucario 9-Pocket Zippered PRO-Binder\nCapacity of 360 cards.';
  const result = parseEbayActiveResults({
    query: 'ultra pro lucario binder', identity: extractProductIdentity('Ultra Pro Pokemon Binder 9-Pocket Lucario', description),
    sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
    browseJson: { itemSummaries: [
      base({ itemId: '100000000710', title: 'Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder Holds 252 Cards' }),
      base({ itemId: '100000000711', title: 'Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder Holds 360 Cards' }),
    ] },
  });
  assert.equal(result.records[0]?.matchDecision, 'rejected');
  assert.ok(result.records[0]?.rejectionReasons.includes('product-capacity-mismatch:360!=252'));
  assert.equal(result.records[1]?.matchDecision, 'accepted', JSON.stringify(result.records[1]?.rejectionReasons));
});

test('binder character checks reordered and multiword series variants', () => {
  const description = 'Model: Mega Lucario Elite Series 9-Pocket Zippered PRO-Binder';
  const result = parseEbayActiveResults({
    query: 'ultra pro mega lucario binder', identity: extractProductIdentity('Ultra Pro Pokemon Binder 9-Pocket Mega Lucario', description),
    sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
    browseJson: { itemSummaries: [
      base({ itemId: '100000000712', title: 'Ultra PRO Elite Series Mew 9-Pocket Zippered Binder' }),
      base({ itemId: '100000000713', title: 'Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder' }),
      base({ itemId: '100000000714', title: 'Ultra PRO Elite Series Mega Lucario 9-Pocket Zippered Binder' }),
    ] },
  });
  assert.ok(result.records[0]?.rejectionReasons.includes('product-variant-mismatch:mega-lucario'));
  assert.ok(result.records[1]?.rejectionReasons.includes('product-variant-mismatch:mega-lucario'));
  assert.equal(result.records[2]?.matchDecision, 'accepted', JSON.stringify(result.records[2]?.rejectionReasons));
});

test('binder variant survives a generic source title when the model field is reordered', () => {
  const description = 'Model: Lucario Elite Series 9-Pocket Zippered PRO-Binder';
  const result = parseEbayActiveResults({
    query: 'ultra pro binder', identity: extractProductIdentity('Ultra Pro Pokemon 9-Pocket Binder', description),
    sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
    browseJson: { itemSummaries: [
      base({ itemId: '100000000715', title: 'Ultra PRO Elite Series Mew 9-Pocket Zippered Binder' }),
      base({ itemId: '100000000716', title: 'Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder' }),
    ] },
  });
  assert.ok(result.records[0]?.rejectionReasons.includes('product-variant-mismatch:lucario'));
  assert.equal(result.records[1]?.matchDecision, 'accepted', JSON.stringify(result.records[1]?.rejectionReasons));
});

test('a generic binder title cannot override a named structured model variant', () => {
  const description = 'Model: Elite Series Lucario 9-Pocket Zippered PRO-Binder';
  const result = parseEbayActiveResults({
    query: 'ultra pro binder', identity: extractProductIdentity('Ultra Pro Pokemon 9-Pocket Zippered Binder', description),
    sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
    browseJson: { itemSummaries: [
      base({ itemId: '100000000717', title: 'Ultra PRO Elite Series Mew 9-Pocket Zippered Binder' }),
      base({ itemId: '100000000718', title: 'Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder' }),
    ] },
  });
  assert.ok(result.records[0]?.rejectionReasons.includes('product-variant-mismatch:lucario'));
  assert.equal(result.records[1]?.matchDecision, 'accepted');
});

test('hyphenated card-capacity wording is compared on either side', () => {
  const title = 'Ultra Pro Pokemon Binder 9-Pocket Lucario';
  for (const [sourceCapacity, candidateCapacity] of [
    ['360 cards', '252-card capacity'],
    ['360-card capacity', '252 Cards'],
  ]) {
    const description = `Model: Elite Series Lucario 9-Pocket Zippered PRO-Binder\nCapacity: ${sourceCapacity}`;
    const result = parseEbayActiveResults({
      query: 'ultra pro lucario binder', identity: extractProductIdentity(title, description),
      sourceDescription: description, observedAt: '2026-09-27T02:00:00.000Z',
      browseJson: { itemSummaries: [base({ itemId: '100000000719',
        title: `Ultra PRO Elite Series Lucario 9-Pocket Zippered Binder ${candidateCapacity}` })] },
    });
    assert.ok(result.records[0]?.rejectionReasons.includes('product-capacity-mismatch:360!=252'));
  }
});

test('Generac LP5500 search does not price a whole generator from parts or adjacent models', () => {
  const generatorIdentity = extractProductIdentity('Generac LP5500 Generator w/ Tank');
  const titles = [
    'Generac LP5500 6001-0 Gas Engine Generator Recoil Starter',
    'Ignition Coil For Generac GP5500 GP6500 LP5500 Generator',
    'Generac GP5000 Portable Power Generator 5000W',
    'Generac RS5500 Portable Gasoline Generator 5500W',
    'Generac LP3250 Portable Propane Generator 3250W',
  ];
  const result = parseEbayActiveResults({
    query: 'Generac LP5500 generator', identity: generatorIdentity,
    observedAt: '2026-09-23T11:44:00.000Z',
    sourceQuantity: 1, destinationPostalCode: '17032',
    browseJson: {
      total: titles.length, offset: 0,
      itemSummaries: titles.map((title, index) => base({ itemId: String(100000000300 + index), title })),
    },
  });
  assert.equal(result.accepted.length, 0, JSON.stringify(result.records.map((record) => ({ title: record.title, reasons: record.rejectionReasons }))));
  assert.equal(result.benchmark, null);
});

test('whole generator with an included recoil starter remains comparable', () => {
  const generatorIdentity = extractProductIdentity('Generac LP5500 Generator w/ Tank');
  const result = parseEbayActiveResults({
    query: 'Generac LP5500 generator', identity: generatorIdentity,
    observedAt: '2026-09-23T11:44:00.000Z',
    browseJson: { itemSummaries: [base({ itemId: '100000000305', title: 'Generac LP5500 Generator with New Recoil Starter' })] },
  });
  assert.equal(result.records[0]?.matchDecision, 'accepted', JSON.stringify(result.records[0]?.rejectionReasons));
});

test('an included source starter does not make starter-only comps comparable', () => {
  const generatorIdentity = extractProductIdentity('Generac LP5500 Generator with New Recoil Starter');
  const titles = [
    'Generac LP5500 Generator Recoil Starter',
    'Generac LP5500 Generator w/ New Recoil Starter',
    'Generac LP5500 Generator Recoil Starter Included',
  ];
  const result = parseEbayActiveResults({
    query: 'Generac LP5500 generator', identity: generatorIdentity,
    observedAt: '2026-09-23T11:44:00.000Z',
    browseJson: { itemSummaries: titles.map((title, index) => base({ itemId: String(100000000310 + index), title })) },
  });
  assert.equal(result.records[0]?.matchDecision, 'rejected');
  assert.ok(result.records[0]?.rejectionReasons.includes('accessory-or-component'));
  assert.equal(result.records[1]?.matchDecision, 'accepted', JSON.stringify(result.records[1]?.rejectionReasons));
  assert.equal(result.records[2]?.matchDecision, 'accepted', JSON.stringify(result.records[2]?.rejectionReasons));
});

test('a complete saw with its blade is not mistaken for an accessory listing', () => {
  const sawIdentity = extractProductIdentity('Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw');
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD', identity: sawIdentity, observedAt: '2026-09-23T09:38:50.000Z',
    browseJson: { itemSummaries: [base({ itemId: '100000000110', title: 'Bosch GCM12SD 12 in. Dual-Bevel Glide Miter Saw with blade' })] },
  });
  assert.equal(result.records[0]?.matchDecision, 'accepted', JSON.stringify(result.records[0]?.rejectionReasons));
});

test('Bambu P1S active results reject printer components while retaining complete bundles', () => {
  const printerIdentity = extractProductIdentity('Bambu Lab P1S 3D Printer AMS w/ Filament');
  const titles = [
    'Bambu Lab P1 Series Complete Hotend 0.4mm P1P P1S 3D Printer',
    'Bambu Lab P1S P1P 3D Printer Hotend Assembly 0.2mm Stainless Steel Nozzle',
    'Bambu Lab P1S 3D Printer Hotend Assembly',
    'Bambu Lab P1S 3D Printer Hotend Assembly - tools included',
    'Bambu Lab P1S 3D Printer Replacement Nozzle - printer not included',
    'BIQU Panda Lux LED Light For Bambu Lab P1S P1P X1C X1E 3D Printers',
    'Bambu Lab P1S P1P 3D Printer LED Light',
    'BIQU Panda Lux for Bambu Lab P1S P1P X1C X1E 3D Printers',
    'BIQU Panda Lux Bambu Lab P1S P1P X1C X1E',
    'Panda Lux Compatible with Bambu Lab P1S P1P X1C X1E',
    'Bambu Lab P1S Replacement Nozzle',
    'Bambu Lab P1S Extruder Replacement Kit',
    'Bambu Lab AMS 2 Pro - Auto Material System for X1C/P1S/P1P, 4-Color Printing',
    'Bambu Lab P1S 3D Printer',
    'Bambu Lab P1S 3D Printer AMS not included',
    'Bambu Lab P1S 3D Printer AMS sold separately',
    'Bambu Lab P1S AMS Combo 3D Printer',
    'Bambu Lab P1S with AMS 3D Printer',
    'Bambu Lab P1S 3D Printer with LED light',
    'Bambu Lab P1S with LED Light 3D Printer',
    'Bambu Lab P1S 3D Printer Combo with AMS',
  ];
  const result = parseEbayActiveResults({
    query: 'bambu lab p1s 3d printer ams with filament', identity: printerIdentity,
    observedAt: '2026-09-30T15:17:44.312Z',
    browseJson: {
      total: titles.length, offset: 0,
      itemSummaries: titles.map((title, index) => base({ itemId: String(100000001000 + index), title })),
    },
  });

  assert.deepEqual(result.accepted.map((record) => record.title), [
    'Bambu Lab P1S AMS Combo 3D Printer',
    'Bambu Lab P1S with AMS 3D Printer',
    'Bambu Lab P1S 3D Printer Combo with AMS',
  ]);
  assert.ok(result.records.slice(0, 16).every((record) => record.rejectionReasons.some((reason) => /accessory-or-component|bundle-component-missing:ams/.test(reason))));
  for (const source of ['Bambu Lab P1S AMS Combo 3D Printer', 'Bambu Lab P1S with AMS 3D Printer']) {
    const reordered = parseEbayActiveResults({
      query: source, identity: extractProductIdentity(source), observedAt: '2026-09-30T15:17:44.312Z',
      browseJson: { total: titles.length, offset: 0, itemSummaries: titles.map((title, index) => base({ itemId: String(100000001000 + index), title })) },
    });
    assert.deepEqual(reordered.accepted.map((record) => record.title), result.accepted.map((record) => record.title), source);
  }
});

test('part-only Bosch titles with bare or plural component nouns remain excluded', () => {
  const sawIdentity = extractProductIdentity('Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw');
  const titles = [
    'Bosch GCM12SD Compound Miter Saw Motor',
    'Bosch GCM12SD Compound Miter Saw Fence',
    'Bosch GCM12SD Compound Miter Saw Replacement Motors',
  ];
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD', identity: sawIdentity, observedAt: '2026-09-23T09:38:50.000Z',
    browseJson: { itemSummaries: titles.map((title, index) => base({ itemId: String(100000000120 + index), title })) },
  });
  assert.equal(result.benchmark, null);
  assert.ok(result.records.every((record) => record.rejectionReasons.includes('non-comparable-accessory')));
});

test('complete saw with an installed replacement part stays a whole-product candidate', () => {
  const sawIdentity = extractProductIdentity('Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw');
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD', identity: sawIdentity, observedAt: '2026-09-23T09:38:50.000Z',
    browseJson: { itemSummaries: [base({ itemId: '100000000130', title: 'Bosch GCM12SD 12 in. Dual-Bevel Glide Miter Saw with replacement motor' })] },
  });
  assert.equal(result.records[0]?.matchDecision, 'accepted', JSON.stringify(result.records[0]?.rejectionReasons));
});

test('a replacement motor lot can compare against the same replacement motor', () => {
  const motorIdentity = extractProductIdentity('Bosch GCM12SD Replacement Motor');
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD replacement motor', identity: motorIdentity, observedAt: '2026-09-23T09:38:50.000Z',
    browseJson: { itemSummaries: [base({ itemId: '100000000140', title: 'Bosch GCM12SD Replacement Motor' })] },
  });
  assert.equal(result.records[0]?.matchDecision, 'accepted', JSON.stringify(result.records[0]?.rejectionReasons));
});

test('retains shipping-unknown rows but blocks the active lower-end benchmark', () => {
  const result = parse([
    base({ itemId: '100000000011', price: { value: '10', currency: 'USD' }, shippingOptions: [] }),
    base({ itemId: '100000000012', price: { value: '20', currency: 'USD' } }),
    base({ itemId: '100000000013', price: { value: '30', currency: 'USD' } }),
    base({ itemId: '100000000014', price: { value: '40', currency: 'USD' } }),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark, null);
  assert.equal(result.accepted[0]?.deliveredTotal, null);
});

test('excludes candidate-only accessories and included-remote bundles from comparable benchmark rows', () => {
  const result = parse([
    base({ itemId: '100000000015', title: 'Onkyo TX-SR304 AV Receiver Bundle with Remote', price: { value: '15', currency: 'USD' } }),
    base({ itemId: '100000000016', title: 'Onkyo TX-SR304 Receiver', price: { value: '30', currency: 'USD' } }),
    base({ itemId: '100000000017', title: 'Onkyo TX-SR304 Receiver', price: { value: '40', currency: 'USD' } }),
    base({ itemId: '100000000018', title: 'Onkyo TX-SR304 Receiver', price: { value: '50', currency: 'USD' } }),
  ]);
  const bundle = result.records.find((record) => record.itemId === '100000000015');
  assert.equal(bundle?.matchDecision, 'rejected');
  assert.ok(bundle?.rejectionReasons.includes('non-comparable-bundle'));
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.lowerQuartile, 45);
});

test('requires three distinct comparable fixed-price rows and marks conflicting duplicates', () => {
  const result = parse([
    base({ itemId: '100000000021', price: { value: '20', currency: 'USD' } }),
    base({ itemId: '100000000021', price: { value: '21', currency: 'USD' } }),
    base({ itemId: '100000000022', price: { value: '30', currency: 'USD' } }),
  ]);
  assert.deepEqual(result.duplicateItemIds, ['100000000021']);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.benchmark, null);
  assert.ok(result.records.every((record) => record.matchDecision === 'rejected' || record.itemId === '100000000022'));
});

test('duplicate canonical identities cannot reconcile provider totals or benchmark remaining rows', () => {
  for (const duplicateId of ['100000000021', 'v1|100000000021|0']) {
    const result = parse([
      base({ itemId: '100000000021' }),
      base({ itemId: duplicateId }),
      base({ itemId: '100000000022' }),
      base({ itemId: '100000000023' }),
      base({ itemId: '100000000024' }),
    ]);
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.coverage, { providerTotal: 5, returnedCount: 5, offset: 0, hasNextPage: false, complete: false });
    assert.equal(result.records.length, 5);
    assert.deepEqual(result.duplicateItemIds, ['100000000021']);
    assert.equal(result.rejected.length, 2);
    assert.ok(result.rejected.every((record) => record.rejectionReasons.includes('duplicate-item-id')));
    assert.equal(result.accepted.length, 3);
    assert.equal(result.sampleCount, 3);
    assert.equal(result.benchmark, null);
  }
});

test('malformed next metadata cannot verify complete or empty Browse coverage', () => {
  for (const next of [{ href: 'more' }, [], ['more'], 0, 1, false, true, null]) {
    for (const items of [[], [1, 2, 3].map((index) => base({ itemId: String(100000000025 + index) }))]) {
      const result = parseEbayActiveResults({
        query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
        browseJson: { total: items.length, offset: 0, next, itemSummaries: items },
      });
      assert.equal(result.status, 'partial', JSON.stringify(next));
      assert.equal(result.coverage.complete, null);
      assert.equal(result.records.length, items.length);
      assert.equal(result.accepted.length, items.length);
      assert.equal(result.sampleCount, items.length);
      assert.equal(result.benchmark, null);
    }
  }
});

test('matches the Browse runner string contract for next-page markers', () => {
  for (const next of [undefined, '', '   ', 'more', 'https://api.ebay.com/buy/browse/v1/item_summary/search?offset=3']) {
    const result = parseEbayActiveResults({
      query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
      browseJson: { total: 3, offset: 0, next,
        itemSummaries: [1, 2, 3].map((index) => base({ itemId: String(100000000025 + index) })) },
    });
    const hasNextPage = Boolean(next?.trim());
    assert.equal(result.coverage.hasNextPage, hasNextPage);
    assert.equal(result.coverage.complete, !hasNextPage);
    assert.equal(result.status, hasNextPage ? 'partial' : 'ok');
    assert.equal(result.benchmark?.sampleCount ?? null, hasNextPage ? null : 3);
  }
});

test('returns no records and no benchmark for an empty Browse response', () => {
  const input: EbayActiveResultsInput = { query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', browseJson: { total: 0, offset: 0, itemSummaries: [] } };
  const result = parseEbayActiveResults(input);
  assert.equal(result.status, 'no-results');
  assert.deepEqual(result.records, []);
  assert.equal(result.benchmark, null);
  assert.equal(result.sampleCount, 0);
});

test('does not benchmark unknown or unreconciled Browse coverage and retains rows', () => {
  const items = [base({ itemId: '100000000190' }), base({ itemId: '100000000191' }), base({ itemId: '100000000192' })];
  const unknownTotal = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { itemSummaries: items },
  });
  assert.equal(unknownTotal.status, 'partial');
  assert.deepEqual(unknownTotal.coverage, { providerTotal: null, returnedCount: 3, offset: null, hasNextPage: false, complete: null });
  assert.equal(unknownTotal.accepted.length, 3);
  assert.equal(unknownTotal.benchmark, null);

  for (const browseJson of [
    { total: 3, itemSummaries: items },
    { total: 3, offset: 'invalid', itemSummaries: items },
  ]) {
    const result = parseEbayActiveResults({
      query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', browseJson,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.coverage.complete, null);
    assert.equal(result.accepted.length, 3);
    assert.equal(result.benchmark, null);
  }

  const emptyUnknown = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { itemSummaries: [] },
  });
  assert.equal(emptyUnknown.status, 'partial');
  assert.equal(emptyUnknown.coverage.complete, null);
  assert.equal(emptyUnknown.benchmark, null);
});

test('reports partial Browse result coverage without treating a first page as a complete market', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: {
      total: 75, offset: 0, next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?offset=3',
      itemSummaries: [base({ itemId: '100000000191' }), base({ itemId: '100000000192' }), base({ itemId: '100000000193' })],
    },
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.coverage, { providerTotal: 75, returnedCount: 3, offset: 0, hasNextPage: true, complete: false });
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark, null);
});

test('rejects contradictory result totals and retains zero-result pages with a next link as partial', () => {
  const contradictory = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { total: 2, offset: 0, itemSummaries: [base({ itemId: '100000000194' }), base({ itemId: '100000000195' }), base({ itemId: '100000000196' })] },
  });
  assert.equal(contradictory.status, 'parse-error');
  assert.equal(contradictory.benchmark, null);

  const emptyPage = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { total: 20, offset: 10, next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?offset=20', itemSummaries: [] },
  });
  assert.equal(emptyPage.status, 'partial');
  assert.equal(emptyPage.coverage.complete, false);
  assert.equal(emptyPage.benchmark, null);

  const contradictoryEmpty = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { total: 0, next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?offset=10', itemSummaries: [] },
  });
  assert.equal(contradictoryEmpty.status, 'partial');
});

test('marks a fully returned Browse set as complete only when the provider count agrees', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { total: 3, offset: 0, itemSummaries: [base({ itemId: '100000000197' }), base({ itemId: '100000000198' }), base({ itemId: '100000000199' })] },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.coverage, { providerTotal: 3, returnedCount: 3, offset: 0, hasNextPage: false, complete: true });
  assert.equal(result.benchmark?.provisional, true);
});

test('keeps a complete fully specified multi-pack asking benchmark provisional', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 2, destinationPostalCode: '10001',
    browseJson: {
      total: 3, offset: 0,
      itemSummaries: [1, 2, 3].map((index) => base({
        itemId: String(100000000650 + index),
        title: 'Onkyo TX-SR304 Receiver 2 Pack',
        condition: 'Used', conditionId: '3000',
        itemEndDate: '2026-10-01T00:00:00.000Z',
        shippingOptions: [{
          shipToLocationUsedForEstimate: { country: 'US', postalCode: '10001' },
          shippingCost: { value: '0', currency: 'USD' },
        }],
      })),
    },
  });
  assert.equal(result.coverage.complete, true);
  assert.equal(result.accepted.length, 3);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.provisional, true);
});

test('reports malformed Browse payloads separately and rejects zero-dollar asking prices', () => {
  const malformed = parseEbayActiveResults({ query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', browseJson: {} });
  assert.equal(malformed.status, 'parse-error');
  const zero = parse([base({ itemId: 'v1|297649659999|0', price: { value: '0', currency: 'USD' } })]);
  assert.equal(zero.status, 'ok');
  assert.equal(zero.records[0]?.matchDecision, 'rejected');
  assert.ok(zero.records[0]?.rejectionReasons.includes('invalid-or-missing-price'));
});

test('accepts Browse v1 IDs, canonicalizes URLs, and rejects URL identity mismatches', () => {
  const result = parse([
    base({ itemId: 'v1|297649659805|1', itemWebUrl: 'https://www.ebay.com/itm/297649659805?var=1' }),
    base({ itemId: 'v1|297649659805|2', itemWebUrl: 'https://www.ebay.com/itm/297649659805?var=1' }),
    base({ itemId: '297649659807', itemWebUrl: 'https://www.ebay.com/itm/297649659999?bad=1' }),
  ]);
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0]?.itemId, 'v1|297649659805|1');
  assert.equal(result.records[0]?.legacyItemId, '297649659805');
  assert.equal(result.records[0]?.variantId, '1');
  assert.equal(result.records[0]?.itemUrl, 'https://www.ebay.com/itm/297649659805?var=1');
  assert.deepEqual(result.duplicateItemIds, []);
  assert.ok(result.records[1]?.rejectionReasons.includes('variant-unverified'));
  assert.ok(result.records[2]?.rejectionReasons.includes('item-url-id-mismatch'));
});

test('preserves free USD shipping and includes it in the active benchmark', () => {
  const result = parse([
    base({ itemId: 'v1|297649659921|0', price: { value: '20.00', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }] }),
    base({ itemId: 'v1|297649659922|0', price: { value: '30.00', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }] }),
    base({ itemId: 'v1|297649659923|0', price: { value: '40.00', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }] }),
  ]);
  assert.equal(result.accepted.length, 3);
  assert.deepEqual(result.accepted[0]?.shippingPrice, { amount: 0, currency: 'USD' });
  assert.deepEqual(result.accepted[0]?.deliveredTotal, { amount: 20, currency: 'USD' });
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.lowerQuartile, 25);
});

test('uses a real US delivery option instead of a cheaper pickup or foreign estimate', () => {
  const result = parse([
    base({ itemId: '100000000331', shippingOptions: [
      { type: 'Local Pickup', shippingCost: { value: '0', currency: 'USD' } },
      { type: 'Standard Shipping', shipToLocationUsedForEstimate: { country: 'US' }, shippingCost: { value: '14', currency: 'USD' } },
    ] }),
    base({ itemId: '100000000332', shippingOptions: [
      { type: 'Standard Shipping', shipToLocationUsedForEstimate: { country: 'CA' }, shippingCost: { value: '2', currency: 'USD' } },
      { type: 'Standard Shipping', shipToLocationUsedForEstimate: { country: 'US' }, shippingCost: { value: '16', currency: 'USD' } },
    ] }),
    base({ itemId: '100000000333', shippingOptions: [
      { type: 'Expedited Shipping', shippingCost: { value: '25', currency: 'USD' } },
      { type: 'Standard Shipping', shippingCost: { value: '12', currency: 'USD' } },
    ] }),
  ]);
  assert.deepEqual(result.accepted.map((record) => record.deliveredTotal?.amount), [64, 66, 62]);
  assert.equal(result.benchmark?.lowerQuartile, 63);
});

test('does not call pickup-only or foreign-only listings delivered-price evidence', () => {
  const result = parse([
    base({ itemId: '100000000341', shippingOptions: [{ type: 'Local Pickup', shippingCost: { value: '0', currency: 'USD' } }] }),
    base({ itemId: '100000000342', shippingOptions: [{ shipToLocationUsedForEstimate: { country: 'CA' }, shippingCost: { value: '5', currency: 'USD' } }] }),
    base({ itemId: '100000000343', shippingOptions: [{ type: 'Local Pick-up', shippingCost: { value: '0', currency: 'USD' } }] }),
  ]);
  assert.equal(result.accepted.length, 3);
  assert.ok(result.accepted.every((record) => record.deliveredTotal === null));
  assert.equal(result.sampleCount, 0);
  assert.equal(result.benchmark, null);
});

test('calculated shipping needs a matching US destination estimate', () => {
  const options = [
    { type: 'Standard Shipping', shippingCostType: 'CALCULATED', shippingCost: { value: '0', currency: 'USD' } },
    { type: 'Standard Shipping', shippingCostType: 'CALCULATED', shipToLocationUsedForEstimate: { country: 'US', postalCode: '90210' }, shippingCost: { value: '6', currency: 'USD' } },
    { type: 'Standard Shipping', shippingCostType: 'CALCULATED', shipToLocationUsedForEstimate: { country: 'US', postalCode: '10001' }, shippingCost: { value: '14', currency: 'USD' } },
  ];
  const withoutDestination = parse([base({ itemId: '100000000351', shippingOptions: options })]);
  assert.equal(withoutDestination.records[0]?.deliveredTotal, null);

  const withDestination = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    destinationPostalCode: '10001', browseJson: { itemSummaries: [base({ itemId: '100000000351', shippingOptions: options })] },
  });
  assert.equal(withDestination.records[0]?.deliveredTotal?.amount, 64);
});

test('filters condition and explicit quantity mismatches and marks unknown comparability provisional', () => {
  const result = parse([
    base({ itemId: 'v1|297649659901|0', condition: 'New', title: 'Onkyo TX-SR304 Receiver 2 Pack' }),
    base({ itemId: 'v1|297649659902|0', condition: 'Used', title: 'Onkyo TX-SR304 Receiver 2 Pack' }),
    base({ itemId: 'v1|297649659903|0', condition: 'Used', title: 'Onkyo TX-SR304 Receiver' }),
    base({ itemId: 'v1|297649659904|0', condition: 'Used', title: 'Onkyo TX-SR304 Receiver' }),
  ]);
  const withSource = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { itemSummaries: result.records.map((record) => ({ itemId: record.itemId, title: record.title, itemWebUrl: record.itemUrl, price: record.askingPrice && { value: String(record.askingPrice.amount), currency: record.askingPrice.currency }, shippingOptions: [{ shippingCost: { value: '10', currency: 'USD' } }], buyingOptions: ['FIXED_PRICE'], condition: record.condition })) },
  });
  assert.ok(withSource.rejected.some((record) => record.rejectionReasons.includes('condition-mismatch')));
  assert.ok(withSource.rejected.some((record) => record.rejectionReasons.includes('quantity-mismatch')));

  const unknown = parse([
    base({ itemId: 'v1|297649659911|0', condition: 'Used' }),
    base({ itemId: 'v1|297649659912|0', condition: 'Used' }),
    base({ itemId: 'v1|297649659913|0', condition: 'Used' }),
  ]);
  assert.equal(unknown.benchmark?.provisional, true);
});

test('rejects parts or nonworking candidates from a used benchmark', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', sourceCondition: { condition: 'Used' },
    browseJson: { total: 4, offset: 0, itemSummaries: [
      base({ itemId: '100000000101', condition: 'For parts or not working', price: { value: '1', currency: 'USD' } }),
      base({ itemId: '100000000102', price: { value: '20', currency: 'USD' } }),
      base({ itemId: '100000000103', price: { value: '30', currency: 'USD' } }),
      base({ itemId: '100000000104', price: { value: '40', currency: 'USD' } }),
    ] },
  });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.benchmark?.lowerQuartile, 35);
  assert.ok(result.rejected[0]?.rejectionReasons.includes('condition-mismatch:parts-only-comp'));
});

test('rejects broken, defective, and repair-only titles despite a seller Used condition', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { total: 6, offset: 0, itemSummaries: [
      base({ itemId: '100000000221', condition: 'Used', conditionId: '3000', title: 'Onkyo TX-SR304 Receiver BROKEN - DOES NOT POWER ON', price: { value: '1', currency: 'USD' } }),
      base({ itemId: '100000000222', condition: 'Used', conditionId: '3000', title: 'Onkyo TX-SR304 Receiver FOR REPAIR', price: { value: '2', currency: 'USD' } }),
      base({ itemId: '100000000223', condition: 'Used', conditionId: '3000', title: 'Onkyo TX-SR304 Receiver DEFECTIVE', price: { value: '3', currency: 'USD' } }),
      base({ itemId: '100000000224', title: 'Onkyo TX-SR304 Receiver', price: { value: '20', currency: 'USD' } }),
      base({ itemId: '100000000225', title: 'Onkyo TX-SR304 Receiver', price: { value: '30', currency: 'USD' } }),
      base({ itemId: '100000000226', title: 'Onkyo TX-SR304 Receiver', price: { value: '40', currency: 'USD' } }),
    ] },
  });
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.lowerQuartile, 35);
  assert.ok(result.records.slice(0, 3).every((record) => record.rejectionReasons.includes('condition-mismatch:parts-only-comp')));

  const partsSource = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Broken' }, sourceQuantity: 1,
    browseJson: { itemSummaries: [base({ itemId: '100000000227', condition: 'Used - Broken', conditionId: '3000', title: 'Onkyo TX-SR304 Receiver FOR REPAIR' })] },
  });
  assert.equal(partsSource.accepted.length, 1);
});

test('rejects eBay parts-only condition ID even when condition text is absent', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { total: 4, offset: 0, itemSummaries: [
      base({ itemId: '100000000105', condition: '', conditionId: '7000', price: { value: '1', currency: 'USD' } }),
      base({ itemId: '100000000106', price: { value: '20', currency: 'USD' } }),
      base({ itemId: '100000000107', price: { value: '30', currency: 'USD' } }),
      base({ itemId: '100000000108', price: { value: '40', currency: 'USD' } }),
    ] },
  });
  assert.equal(result.records[0]?.conditionId, '7000');
  assert.ok(result.records[0]?.rejectionReasons.includes('condition-mismatch:parts-only-comp'));
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.lowerQuartile, 35);
});

test('requires strict shipping decimals and rejects asking prices that round to zero', () => {
  const result = parse([
    base({ itemId: '100000000111', price: { value: '0.004', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '', currency: 'USD' } }] }),
    base({ itemId: '100000000112', price: { value: '20', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }] }),
  ]);
  assert.equal(result.records[0]?.askingPrice, null);
  assert.equal(result.records[0]?.shippingPrice, null);
  assert.deepEqual(result.records[1]?.shippingPrice, { amount: 0, currency: 'USD' });
});

test('keeps variant IDs distinct and accepts a nonzero variant only with matching URL var', () => {
  const result = parse([
    base({ itemId: 'v1|100000000121|1', itemWebUrl: 'https://www.ebay.com/itm/100000000121?var=1' }),
    base({ itemId: 'v1|100000000121|2', itemWebUrl: 'https://www.ebay.com/itm/100000000121?var=1' }),
  ]);
  assert.equal(result.records[0]?.matchDecision, 'accepted');
  assert.equal(result.records[1]?.matchDecision, 'rejected');
  assert.ok(result.records[1]?.rejectionReasons.includes('variant-unverified'));
  assert.deepEqual(result.duplicateItemIds, []);
});

test('rejects URL-selected variants that a bare or zero-variant item ID does not identify', () => {
  const result = parse([
    base({ itemId: '100000000123', itemWebUrl: 'https://www.ebay.com/itm/100000000123?var=99' }),
    base({ itemId: 'v1|100000000124|0', itemWebUrl: 'https://www.ebay.com/itm/100000000124?var=99' }),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.records.every((record) => record.rejectionReasons.includes('variant-unverified')));
  assert.equal(result.records[0]?.itemUrl, 'https://www.ebay.com/itm/100000000123?var=99');
});

test('deduplicates bare and v1 zero-variant IDs as one unvaried listing', () => {
  const result = parse([
    base({ itemId: '100000000125', price: { value: '20', currency: 'USD' } }),
    base({ itemId: 'v1|100000000125|0', price: { value: '21', currency: 'USD' } }),
    base({ itemId: 'v1|100000000125|1', itemWebUrl: 'https://www.ebay.com/itm/100000000125?var=1', price: { value: '22', currency: 'USD' } }),
  ]);
  assert.deepEqual(result.duplicateItemIds, ['100000000125']);
  assert.equal(result.records[0]?.matchDecision, 'rejected');
  assert.equal(result.records[1]?.matchDecision, 'rejected');
  assert.equal(result.records[2]?.matchDecision, 'accepted');
  assert.equal(result.sampleCount, 1);
});

test('excludes unknown candidate quantities when the source is a multi-item lot', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', sourceQuantity: 2,
    browseJson: { itemSummaries: [
      base({ itemId: '100000000131', title: 'Onkyo TX-SR304 Receiver', price: { value: '10', currency: 'USD' } }),
      base({ itemId: '100000000132', title: 'Onkyo TX-SR304 Receiver 2 Pack', price: { value: '20', currency: 'USD' } }),
      base({ itemId: '100000000133', title: 'Onkyo TX-SR304 Receiver 2 Pack', price: { value: '30', currency: 'USD' } }),
    ] },
  });
  assert.equal(result.accepted.length, 2);
  assert.equal(result.sampleCount, 2);
  assert.ok(result.records[0]?.rejectionReasons.some((reason) => reason.startsWith('quantity-ambiguous')));
});

test('accepts a whole receiver marked No Remote but rejects accessory-only remote titles', () => {
  const result = parse([
    base({ itemId: '100000000141', title: 'Onkyo TX-SR304 AV Receiver No Remote' }),
    base({ itemId: '100000000142', title: 'Onkyo TX-SR304 Remote Only' }),
  ]);
  assert.equal(result.records[0]?.matchDecision, 'accepted');
  assert.equal(result.records[1]?.matchDecision, 'rejected');
  assert.ok(result.records[1]?.rejectionReasons.includes('non-comparable-accessory'));
});

test('reports malformed nonempty arrays as parse-error or partial', () => {
  const malformed = parse([null, { title: 'missing id' }]);
  assert.equal(malformed.status, 'parse-error');
  assert.equal(malformed.skippedCount, 2);
  const partial = parse([base({ itemId: '100000000151' }), null, { itemId: 'bad' }]);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.skippedCount, 2);
  assert.equal(partial.benchmark, null);
});

test('does not benchmark eligible rows when malformed rows make coverage partial', () => {
  const result = parse([
    base({ itemId: '100000000155', price: { value: '20', currency: 'USD' } }),
    base({ itemId: '100000000156', price: { value: '30', currency: 'USD' } }),
    base({ itemId: '100000000157', price: { value: '40', currency: 'USD' } }),
    null,
  ]);
  assert.equal(result.status, 'partial');
  assert.equal(result.skippedCount, 1);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark, null);
});

test('keeps new, open-box, and like-new listings out of the wrong condition benchmark', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'New' }, sourceQuantity: 1,
    browseJson: { itemSummaries: [
      base({ itemId: '100000000161', condition: 'Open box', conditionId: '1500' }),
      base({ itemId: '100000000162', condition: 'Like New', conditionId: '2750' }),
      base({ itemId: '100000000163', condition: 'New', conditionId: '1000' }),
    ] },
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.sampleCount, 1);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.includes('condition-mismatch')));
});

test('hyphenated open-box source condition does not match new or used candidates', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Open-box' }, sourceQuantity: 1,
    browseJson: { itemSummaries: [
      base({ itemId: '100000000181', condition: 'New', conditionId: '1000' }),
      base({ itemId: '100000000182', condition: 'Used', conditionId: '3000' }),
      base({ itemId: '100000000183', condition: 'Open box', conditionId: '1500' }),
    ] },
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.sampleCount, 1);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.includes('condition-mismatch')));
});

test('accepts eBay used grades 4000, 5000, and 6000 without treating ungraded cards as used', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    browseJson: { total: 4, offset: 0, itemSummaries: [
      base({ itemId: '100000000211', condition: 'Very Good', conditionId: '4000' }),
      base({ itemId: '100000000212', condition: 'Good', conditionId: '5000' }),
      base({ itemId: '100000000213', condition: 'Acceptable', conditionId: '6000' }),
      base({ itemId: '100000000214', condition: 'Ungraded', conditionId: '4000' }),
    ] },
  });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.benchmark?.lowerQuartile, 60);
  assert.ok(result.records[3]?.rejectionReasons.includes('condition-grading-status-only'));
  assert.ok(result.records[3]?.rejectionReasons.includes('condition-unknown'));

  const unknownSource = parse([base({ itemId: '100000000215', condition: 'Ungraded', conditionId: '4000' })]);
  assert.equal(unknownSource.accepted.length, 0);
  assert.ok(unknownSource.records[0]?.rejectionReasons.includes('condition-grading-status-only'));
});

test('excludes ambiguous bundles, pairs, and mixed auction formats from active statistics', () => {
  const result = parse([
    base({ itemId: '100000000171', title: 'Onkyo TX-SR304 Multi-Channel AV Receiver Bundle' }),
    base({ itemId: '100000000172', title: 'Onkyo TX-SR304 Multi-Channel AV Receiver Pair' }),
    base({ itemId: '100000000173', buyingOptions: ['AUCTION', 'FIXED_PRICE'] }),
    base({ itemId: '100000000174' }),
  ]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.sampleCount, 1);
  assert.ok(result.records[0]?.rejectionReasons.includes('non-comparable-bundle'));
  assert.ok(result.records[1]?.rejectionReasons.includes('non-comparable-bundle'));
  assert.ok(result.records[2]?.rejectionReasons.includes('auction-only-or-not-fixed-price'));
});

test('vehicle-and-figure lots require both components in active asking comparisons', () => {
  const source = extractProductIdentity('WWE Wrekkin Slamcycle Vehicle W/Undertaker Figure');
  const titles = [
    'WWE Wrekkin Slamcycle Motorcycle w/The Undertaker Figure',
    'Mattel WWE Wrekkin Action Figure & Toy Vehicle Set, Undertaker with Slamcycle',
    "WWE UNDERTAKER WREKKIN SLAMCYCLE (ONLY)",
    'WWE Undertaker Figure Wrekkin Slamcycle Mattel Action Figure No Motorcycle',
    'Mattel WWE The Undertaker Wrekkin Slamcycle Figure',
    'WWE Wrekkin Slamcycle Motorcycle Only',
  ];
  const result = parseEbayActiveResults({
    query: source.query, identity: source, observedAt: '2026-09-27T14:00:00.000Z', sourceQuantity: 1,
    browseJson: { total: titles.length, offset: 0,
      itemSummaries: titles.map((title, index) => base({ itemId: String(100000000800 + index), title })) },
  });
  assert.deepEqual(result.accepted.map((record) => record.title), titles.slice(0, 2),
    JSON.stringify(result.records.map((record) => ({ title: record.title, reasons: record.rejectionReasons }))));
  assert.ok(result.rejected.every((record) => record.rejectionReasons.some((reason) => reason.startsWith('component-'))));
});

test('rejects Bosch motor, fence, and guard OEM parts while preserving the complete saw', () => {
  const sawIdentity = extractProductIdentity('Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw');
  const titles = [
    'Bosch GCM12SD Miter Saw Motor Assembly OEM',
    'Bosch GCM12SD Miter Saw Fence Left Side',
    'Bosch GCM12SD Miter Saw Guard Genuine OEM',
    'Bosch GCM12SD 12-inch Dual-Bevel Glide Miter Saw with included motor',
  ];
  const result = parseEbayActiveResults({
    query: 'Bosch GCM12SD', identity: sawIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { itemSummaries: titles.map((title, index) => base({ itemId: String(100000000600 + index), title })) },
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.title, titles[3]);
  assert.ok(result.records.slice(0, 3).every((record) => record.rejectionReasons.includes('non-comparable-accessory')));
});

test('does not infer US delivery from free USD shipping when ship-to eligibility excludes US', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z', destinationPostalCode: '10001',
    browseJson: { itemSummaries: [
      base({ itemId: '100000000610', shipToLocations: ['CA'], shippingOptions: [{ shippingCost: { value: '0', currency: 'USD' } }] }),
      base({ itemId: '100000000611', shippingOptions: [{ shippingCost: { value: '0', currency: 'USD' } }] }),
    ] },
  });
  assert.equal(result.records[0]?.deliveredTotal, null);
  assert.equal(result.records[1]?.deliveredTotal, null);
  assert.equal(result.sampleCount, 0);
});

test('counts variant records once per legacy listing in the asking benchmark', () => {
  const end = '2026-10-01T00:00:00.000Z';
  const shippingOptions = [{ shipToLocationUsedForEstimate: { country: 'US', postalCode: '10001' }, shippingCost: { value: '0', currency: 'USD' } }];
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1, destinationPostalCode: '10001',
    browseJson: { total: 3, offset: 0, itemSummaries: [1, 2, 3].map((variant) => base({
      itemId: `v1|100000000620|${variant}`, itemWebUrl: `https://www.ebay.com/itm/100000000620?var=${variant}`,
      price: { value: String(20 + variant), currency: 'USD' }, shippingOptions, itemEndDate: end,
    })) },
  });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.benchmark, null);
});

test('excludes listings that ended before observation and marks missing lifecycle evidence provisional', () => {
  const ended = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { itemSummaries: [base({ itemId: '100000000630', itemEndDate: '2026-09-23T11:59:59.000Z' })] },
  });
  assert.equal(ended.accepted.length, 0);
  assert.ok(ended.records[0]?.rejectionReasons.includes('expired-listing'));

  const missing = parse([
    base({ itemId: '100000000631' }), base({ itemId: '100000000632' }), base({ itemId: '100000000633' }),
  ]);
  assert.equal(missing.sampleCount, 3);
  assert.equal(missing.benchmark?.provisional, true);
});

test('does not calculate an asking benchmark without a valid observation time', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: 'not-a-timestamp',
    sourceCondition: { condition: 'Used' }, sourceQuantity: 1,
    destinationPostalCode: '10001',
    browseJson: {
      total: 3, offset: 0,
      itemSummaries: [1, 2, 3].map((index) => base({
        itemId: String(100000000640 + index),
        itemEndDate: '2026-10-01T00:00:00.000Z',
        shippingOptions: [{
          shipToLocationUsedForEstimate: { country: 'US', postalCode: '10001' },
          shippingCost: { value: '0', currency: 'USD' },
        }],
      })),
    },
  });
  assert.equal(result.status, 'parse-error');
  assert.equal(result.benchmark, null);
  assert.equal(result.records.length, 3);
});

test('retains rows but rejects future observation times for benchmarks', () => {
  const result = parseEbayActiveResults({
    query: 'Onkyo TX-SR304', identity, observedAt: '2999-09-23T12:00:00.000Z',
    browseJson: {
      total: 3, offset: 0,
      itemSummaries: [1, 2, 3].map((index) => base({ itemId: String(100000000670 + index) })),
    },
  });
  assert.equal(result.status, 'parse-error');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.accepted.length, 3);
  assert.equal(result.benchmark, null);
});
