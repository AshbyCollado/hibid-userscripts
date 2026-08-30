import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEbaySoldQuery, patchLegacyEbayQueryModule, patchLegacyHibidPageModule, patchLegacyRemoveCatalogChips, patchLegacyRemoveShipping } from '../scripts/legacy-ebay-query.mjs';
import { buildProductResearchQuery } from '../src/intelligence/us-deal-intelligence.js';

test('eBay query preserves the complete Onkyo model and product type', () => {
  assert.equal(
    buildEbaySoldQuery('Onkyo TX-SR304 Multi-Channel AV Receiver'),
    'onkyo tx-sr304 multi-channel av receiver'
  );
});

test('model-less products retain their distinguishing specifications', () => {
  const title = 'MAGCUBIC 4K SMART PROJECTOR, WIFI BT';
  const expected = 'magcubic 4k smart projector wifi bt';
  assert.equal(buildEbaySoldQuery(title), expected);
  assert.equal(buildProductResearchQuery(title), expected);
  const url = new URL('https://www.ebay.com/sch/i.html');
  url.searchParams.set('_nkw', buildProductResearchQuery(title));
  url.searchParams.set('LH_Sold', '1');
  url.searchParams.set('LH_Complete', '1');
  assert.equal(url.searchParams.get('_nkw'), expected);
});

test('legacy and modern research queries stay identical across identity edge cases', () => {
  const titles = [
    'Onkyo TX-SR304 Multi-Channel AV Receiver',
    'Rode NT-USB+ Professional USB Microphone',
    'AV - ASUS GEFORCE RTX4060 8GB VIDEO CARD',
    'Samsung 55 inch 4K UHD Smart TV WiFi Bluetooth',
    'Lot #6 | Group of 3 - Apple MacBook Pro (A2338) 13 inch - Untested',
    'Seagate Backup Plus Hub 8TB External Drive USB 3.0',
    'Sony WH-1000XM5 Wireless Bluetooth Headphones',
    'Dell OptiPlex 7090 Micro i7-11700T 32GB 1TB SSD',
    'AV - PLAYSTATION 5 CONSOLE',
    'AV - SEAGATE 8TB EXTERNAL DRIVE',
  ];
  for (const title of titles) assert.equal(buildProductResearchQuery(title), buildEbaySoldQuery(title), title);
  assert.equal(buildProductResearchQuery(titles[1]), 'rode nt-usb+ professional usb microphone');
  assert.equal(buildProductResearchQuery(titles[2]), 'asus geforce rtx4060 8gb video card');
  assert.equal(buildProductResearchQuery(titles[3]), 'samsung 55 inch 4k uhd smart tv wifi bluetooth');
});

test('eBay query removes auction noise without dropping identifying edge cases', () => {
  assert.equal(
    buildEbaySoldQuery('Lot #6 | Group of 3 - Apple MacBook Pro (A2338) 13 inch - Untested'),
    'apple macbook pro a2338 13 inch'
  );
  assert.equal(
    buildEbaySoldQuery('Lot 12: Sony STR-DH790 7.2-Channel Dolby Atmos AV Receiver'),
    'sony str-dh790 7.2-channel dolby atmos av receiver'
  );
  assert.equal(
    buildProductResearchQuery('Lot 811 | Circon ACMI ALU-1B Light Source'),
    'circon acmi alu-1b light source'
  );
  assert.equal(
    buildProductResearchQuery('Lot Sony PlayStation 5 Console'),
    'sony playstation 5 console'
  );
  assert.equal(
    buildEbaySoldQuery('Lot Craftsman Drill Press'),
    'craftsman drill press'
  );
  assert.equal(buildProductResearchQuery('Lot (4/Case) Regal Ground Sage 2.75 lb.'), '4/case regal ground sage 2.75 lb');
  assert.equal(buildProductResearchQuery('Lot 3 Pack Pampers Swaddlers'), '3 pack pampers swaddlers');
  assert.equal(buildProductResearchQuery('Lot SKU: A17 | Regal Ground Cloves - 4.25 lb.'), 'regal ground cloves 4.25 lb');
  assert.equal(buildProductResearchQuery('Lot Kari-Out Company Panko Bread Crumbs - 20 lb.'), 'kari-out company panko bread crumbs 20 lb');
  assert.equal(buildProductResearchQuery('Lot 1927 Mercedes Mug Ship Grand Turk Salem 1786'), '1927 mercedes mug ship grand turk salem 1786');
  assert.equal(buildProductResearchQuery('Lot 32in Mini Pink Prelit Christmas Tree'), '32in mini pink prelit christmas tree');
});

test('warehouse shelf prefixes do not become product models', () => {
  const cases = [
    ['Vv2 6pack composition book', '6pack composition book'],
    ['Gg3 $86 VEVOR 10" Shutter Exhaust Fan', 'vevor 10 shutter exhaust fan'],
    ['Oo4 Pumpkin decoration 1pcs', 'pumpkin decoration 1pcs'],
  ] as const;
  for (const [title, expected] of cases) {
    assert.equal(buildProductResearchQuery(title), expected);
    assert.equal(buildEbaySoldQuery(title), expected);
  }
  assert.equal(buildProductResearchQuery('BMW X3 Cargo Liner'), 'bmw x3 cargo liner');
  assert.equal(buildProductResearchQuery('Soundcore T30 Wireless Earbuds'), 'soundcore t30 wireless earbuds');
});

test('repeated HiBid title identities collapse before Amazon or eBay search', () => {
  const cases = [
    [
      'Circon ACMI ALU-1B Light Source Circon ACMI ALU-1B Light Source',
      'circon acmi alu-1b light source',
    ],
    [
      'Smith+Nephew Dyonics Intelijet Suction Supply Unit Smith+Nephew Dyonics Intelijet Suction Supply Unit',
      'smith+nephew dyonics intelijet suction supply unit',
    ],
    [
      '“Vv3 $56 Skechers Vigor 3.0 Men\'s Athletic Shoes Vv3 $56 Skechers Vigor 3.0 Men\'s Athletic Shoes - No Reserve - Pickup Only”',
      'skechers vigor 3.0 mens athletic shoes',
    ],
  ];
  for (const [title, expected] of cases) {
    assert.equal(buildProductResearchQuery(title), expected);
    assert.equal(buildEbaySoldQuery(title), expected);
  }
  assert.equal(buildProductResearchQuery('New York New York Movie Poster'), 'new york new york movie poster');
});

test('repeated HiBid boundary fragments collapse without deleting meaningful middle identity', () => {
  const cases = [
    ['1 oz SILVER BAR 999 Fine Silver-Random Mints 1 oz', '1 oz silver bar 999 fine silver-random mints'],
    ['1 Pound Bag of Unsearched WORLD Coins 1 Pound Bag', '1 pound bag of unsearched world coins'],
    ['10 Carats + of Diamonds Rough Stones 10 Carats + o', '10 carats of diamonds rough stones'],
  ] as const;
  for (const [title, expected] of cases) {
    assert.equal(buildProductResearchQuery(title), expected);
    assert.equal(buildEbaySoldQuery(title), expected);
  }
});

test('partial HiBid headings and detached plural suffixes cannot corrupt resale searches', () => {
  const cases = [
    ['Lot of 3 GE Dinamap Vital Signs Monitor s', 'ge dinamap vital signs monitors'],
    ['Lot # : S - Covidien Endo Clip III Auto Suture', 'covidien endo clip iii auto suture'],
    ['Xbox Series S Console', 'xbox series s console'],
  ] as const;
  for (const [title, expected] of cases) {
    assert.equal(buildProductResearchQuery(title), expected);
    assert.equal(buildEbaySoldQuery(title), expected);
  }
  assert.equal(buildProductResearchQuery('Lot s'), '');
  assert.equal(buildEbaySoldQuery('Lot s'), '');
  assert.equal(buildProductResearchQuery('Samsung Galaxy S 24 Ultra Smartphone'), 'samsung galaxy s 24 ultra smartphone');
  assert.equal(buildProductResearchQuery('Audi S 5 Grille Assembly'), 'audi s 5 grille assembly');
  assert.equal(buildProductResearchQuery('BB30 Bottom Bracket Bearing Kit'), 'bb30 bottom bracket bearing kit');
});

test('eBay query uses a word-boundary character cap instead of dropping trailing identity tokens', () => {
  const query = buildEbaySoldQuery(
    'Pioneer Elite VSX-LX305 9.2 Channel Network AV Receiver Dolby Atmos Bluetooth WiFi Black With Remote Tested Working'
  );
  assert.ok(query.length <= 120);
  assert.match(query, /receiver/);
  assert.doesNotMatch(query, /working/);
  assert.ok(query.split(' ').length > 6);
});

test('legacy calculator bundle receives the maintained eBay query builder', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js', 'utf8');
  const patched = patchLegacyEbayQueryModule(source);
  assert.match(patched, /function w\(title\)/);
  assert.doesNotMatch(patched, /slice\(0,6\)/);
  assert.match(patched, /const capTokens/);
});

test('legacy calculator build patch removes shipping UI and ignores persisted shipping costs', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js', 'utf8');
  const patched = patchLegacyRemoveShipping(source);
  assert.doesNotMatch(patched, /<label for="lotlens-shipping">Shipping<\/label>/);
  assert.doesNotMatch(patched, /shipCents:i\.shipCents|shipCents:wi\.shipCents|Budget is below shipping/);
  assert.match(patched, /shipCents:0/);
});

test('legacy catalog-chip controller is disabled', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js', 'utf8');
  const patched = patchLegacyRemoveCatalogChips(source);
  assert.match(patched, /async function y\(e\)\{b\(\)\}function b\(\)/);
  assert.doesNotMatch(patched, /lotlens-catalog-chip|True cost \$\{/);
});

test('legacy lot parser recognizes closed prices and recovers transient headings from the URL', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/parseLotPage-B-8HdUYU.js', 'utf8');
  const patched = patchLegacyHibidPageModule(source);
  assert.match(patched, /\.lot-price-realized-container/);
  assert.match(patched, /decodeURIComponent/);
});
