import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  buildEbaySoldQueryVariants,
  parseEbayMoney,
  parsePublicEbaySoldSearch,
  parseSellerHubProductResearch,
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';
import { assessCondition, buildProductResearchQuery, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-08-30T12:00:00.000Z';

function documentFor(html: string): Document {
  return new JSDOM(html, { url: 'https://www.ebay.com/' }).window.document;
}

function sellerHubRow(input: {
  itemId: string;
  title: string;
  soldPrice: string;
  shipping: string;
  totalSold?: string;
  totalSales?: string;
  soldAt?: string;
}): string {
  return `<tr class="research-table-row">
    <td class="research-table-row__item research-table-row__product-info">
      <img src="https://i.ebayimg.com/images/g/example/s-l1200.jpg" alt="${input.title}">
      <a class="research-table-row__link-row-anchor" href="https://www.ebay.com/itm/${input.itemId}?orig_cvip=true">
        <span data-item-id="${input.itemId}">${input.title}</span>
      </a>
    </td>
    <td class="research-table-row__item research-table-row__avgSoldPrice"><div>${input.soldPrice}</div><div class="format">Fixed price</div></td>
    <td class="research-table-row__item research-table-row__avgShippingCost"><div>${input.shipping}</div></td>
    <td class="research-table-row__item research-table-row__totalSoldCount"><div>${input.totalSold ?? '1'}</div></td>
    <td class="research-table-row__item research-table-row__totalSalesValue"><div>${input.totalSales ?? input.soldPrice}</div></td>
    <td class="research-table-row__item research-table-row__dateLastSold"><div>${input.soldAt ?? 'Aug 19, 2026'}</div></td>
  </tr>`;
}

function productResearchHtml(rows: string, nextDisabled = true): string {
  return `<!doctype html><html><head><title>Product Research - eBay Seller Hub</title></head><body>
    <div role="tab" aria-selected="true">Sold</div>
    <table><tbody>${rows}</tbody></table>
    <button aria-label="Go to next page" ${nextDisabled ? 'disabled' : ''}>Next</button>
  </body></html>`;
}

function publicCard(input: {
  itemId: string;
  title: string;
  price: string;
  shipping: string;
  extra?: string;
}): string {
  return `<li class="s-item">
    <a class="s-item__link" href="https://www.ebay.com/itm/${input.itemId}?hash=item1"><span class="s-item__title">${input.title}</span></a>
    <span class="s-item__price">${input.price}</span>
    <span class="s-item__shipping">${input.shipping}</span>
    <span class="SECONDARY_INFO">Pre-Owned</span>
    <span class="s-item__caption--signal">Sold Aug 28, 2026</span>
    ${input.extra ?? ''}
  </li>`;
}

function record(input: Partial<EbaySoldRecord> & Pick<EbaySoldRecord, 'itemId' | 'title'>): EbaySoldRecord {
  const itemUrl = `https://www.ebay.com/itm/${input.itemId}`;
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=onkyo&tabName=SOLD',
    observedAt,
    itemId: input.itemId,
    itemUrl,
    title: input.title,
    imageUrl: null,
    soldPrice: { amount: 50, currency: 'USD' },
    shippingPrice: { amount: 10, currency: 'USD' },
    deliveredPrice: { amount: 60, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 50, currency: 'USD' },
    soldAt: 'Aug 28, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId: input.itemId },
    ...input,
  };
}

function attemptFor(query: string, records: EbaySoldRecord[], overrides: Partial<EbaySoldSearchAttempt> = {}): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
    ...overrides,
  };
}

test('money parsing preserves amount and marketplace currency', () => {
  assert.deepEqual(parseEbayMoney('$1,234.56'), { amount: 1234.56, currency: 'USD' });
  assert.deepEqual(parseEbayMoney('C $99.00'), { amount: 99, currency: 'CAD' });
  assert.deepEqual(parseEbayMoney('Free shipping'), null);
  assert.deepEqual(parseEbayMoney('-'), null);
});

test('query variants preserve the precise title and back off through stable model identity', () => {
  const onkyo = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.deepEqual(buildEbaySoldQueryVariants(onkyo), [
    'onkyo tx-sr304 multi-channel av receiver',
    'Onkyo TX-SR304',
    'TX-SR304',
  ]);

  const book = extractProductIdentity('The Jesus Papers: Exposing the Greatest Cover-Up in History');
  const bookVariants = buildEbaySoldQueryVariants(book);
  assert.equal(bookVariants[0], 'the jesus papers exposing the greatest cover-up in history');
  assert.ok(bookVariants.length >= 2);
  assert.equal(new Set(bookVariants.map((value) => value.toLowerCase())).size, bookVariants.length);

  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('The Jesus Papers Book by Michael Baigent')), [
    'the jesus papers book by michael baigent',
    'The Jesus Papers',
    '"The Jesus Papers"',
  ]);

  const consoleIdentity = extractProductIdentity('Sony PlayStation 5 Disc Console');
  assert.ok(buildEbaySoldQueryVariants(consoleIdentity).every((value) => !/playstation\s+disc/i.test(value)));
  assert.ok(buildEbaySoldQueryVariants(extractProductIdentity('Magcubic 4K Smart Projector, WiFi/BT'))[1]?.includes('4k'));
});

test('model-less apparel uses a concise brand, pattern, garment, and size fallback', () => {
  const theory = extractProductIdentity('Theory Plaid Cotton Flannel Shirt Size L');
  assert.equal(theory.brand, 'Theory');
  assert.equal(theory.model, null);
  assert.deepEqual(buildEbaySoldQueryVariants(theory), [
    'theory plaid cotton flannel shirt size l',
    'Theory plaid shirt L',
    '"theory plaid cotton flannel shirt size l"',
  ]);

  const otherBrand = extractProductIdentity('J.Crew Floral Cotton Blouse Size M');
  assert.equal(buildEbaySoldQueryVariants(otherBrand)[1], 'J.Crew floral blouse M');

  const singleLetterSize = extractProductIdentity('Patagonia Striped Wool Sweater Size XL');
  assert.equal(buildEbaySoldQueryVariants(singleLetterSize)[1], 'Patagonia striped sweater XL');
});

test('apparel fallback preserves decimal and range sizes', () => {
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Nike Running Shoes Size 9.5'))[1], 'Nike shoes 9.5');
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Nike Running Shoes Size 8-10'))[1], 'Nike shoes 8-10');
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Nike Running Shoes Size 9.5-10'))[1], 'Nike shoes 9.5-10');
});

test('apparel fallback preserves complete mixed-fraction and letter-range sizes', () => {
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Nike Running Shoes Size 9 1/2'))[1], 'Nike shoes 9 1/2');
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Nike Shoes Size 10 1/2'))[1], 'Nike shoes 10 1/2');
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Theory Shirt Size L/XL'))[1], 'Theory shirt L/XL');
});

test('apparel fallback declines unsupported size continuations instead of truncating them', () => {
  for (const title of [
    'Nike Running Shoes Size 9 1/2X',
    'Theory Shirt Size L-XL',
    'Theory Shirt Size L/XXXL',
  ]) {
    const identity = extractProductIdentity(title);
    const variants = buildEbaySoldQueryVariants(identity);
    assert.ok(!variants.includes('Nike shoes 9') && !variants.includes('Theory shirt L'), title);
  }
});

test('every fallback preserves unfamiliar sizes instead of generic partial shortening', () => {
  for (const [title, completeSize] of [
    ['Nike Running Shoes Size 9 1/2 Blue', '9 1/2'],
    ['Nike Running Shoes Size 10 1/2X', '10 1/2x'],
    ['Theory Shirt Size L-XL Blue', 'l-xl'],
    ['Theory Shirt Size L/XXXL', 'l/xxxl'],
    ['Unbranded Running Shoes Size 9 1/2 Blue', '9 1/2'],
  ] as const) {
    const identity = extractProductIdentity(title);
    const variants = buildEbaySoldQueryVariants(identity);
    assert.equal(variants[0], identity.query, title);
    assert.ok(variants.every((query) => query.toLowerCase().includes(completeSize)),
      `${title}: ${variants.join(' | ')}`);
  }
});

test('apparel fallback rejects non-apparel contexts and placeholder brands', () => {
  for (const title of [
    'Simplicity Shirt Size L Sewing Pattern Book',
    'Simplicity Shirt Size L Pattern Book',
    'Generic Shirt Size M',
    'Unknown Shirt Size M',
    'Unbranded Shirt Size M',
    'No Brand Shirt Size M',
  ]) {
    const identity = extractProductIdentity(title);
    const variants = buildEbaySoldQueryVariants(identity);
    assert.ok(!variants.includes(`${identity.brand} shirt M`) && !variants.some((query) => /simplicity shirt l/i.test(query)), title);
  }
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('J.Crew Shirt Size M'))[1], 'J.Crew shirt M');
});

test('apparel fallback does not strip model or identity variants from non-apparel products', () => {
  for (const title of [
    'Sony WH-1000XM5 Wireless Headphones Size L',
    'DeWalt DCF887 20V Impact Driver Size L',
    'Introduction to Algorithms ISBN 9780262033848 Third Edition',
  ]) {
    const identity = extractProductIdentity(title);
    const variants = buildEbaySoldQueryVariants(identity);
    assert.ok(!variants.some((query) => /\b(?:shirt|blouse|sweater|jacket)\b/i.test(query)), title);
  }
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('Sony WH-1000XM5 Wireless Headphones Size L'))[1], 'Sony WH-1000XM5');
  assert.equal(buildEbaySoldQueryVariants(extractProductIdentity('DeWalt DCF887 20V Impact Driver Size L'))[1], 'DeWalt DCF887');
});

test('Apple SKU aliases reserve a model-free product-name fallback without dropping the exact query', () => {
  const identity = extractProductIdentity('Apple Pencil MXN43AM/A');
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [
    'apple pencil mxn43am/a',
    'apple pencil',
  ]);
  assert.ok(buildEbaySoldQueryVariants(identity).every((query) => query !== 'Apple' && query !== 'Pencil'));
});

test('SKU fallback retains generation words instead of inventing a wrong-generation query', () => {
  const identity = extractProductIdentity('Apple Pencil 2nd Generation A2051/MU8F2AM/A');
  const variants = buildEbaySoldQueryVariants(identity, 2);
  assert.equal(variants[0], 'apple pencil 2nd generation a2051/mu8f2am/a');
  assert.equal(variants[1], 'apple pencil 2nd generation');
  assert.ok(variants.every((query) => !/\b(?:1st|3rd)\s+generation\b/i.test(query)));
});

test('structured SKU aliases derive a generation-aware fallback when the title omits the SKU', () => {
  const identity = extractProductIdentity('$129 Apple Pencil for iPad 2nd gen (Renewed)', 'Model: mxn43am/a');
  assert.equal(identity.model, 'mxn43am/a');
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [
    'apple pencil for ipad 2nd gen renewed mxn43am/a',
    'apple pencil for ipad 2nd gen',
  ]);
});

test('regional and labeled SKU suffixes do not replace the true model in sold queries', () => {
  const identity = extractProductIdentity(
    '$280 NIU Trottinette KQi 100P EU-GY EWM035',
    'Model: KQi 100P\nSKU: EWM035\nUPC: 6972782769199\nCondition: Open Box - Tested\nMissing bolts',
  );
  assert.equal(identity.model, 'KQi 100P');
  assert.equal(identity.query, 'niu trottinette kqi 100p');
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [
    'niu trottinette kqi 100p',
    'NIU KQi 100P',
  ]);
});

test('a genuine model suffix remains part of the identity query', () => {
  const identity = extractProductIdentity('Sony WH-1000XM5 Wireless Headphones');
  assert.equal(identity.model, 'WH-1000XM5');
  assert.equal(identity.query, 'sony wh-1000xm5 wireless headphones');
});

test('long hyphenated seller SKUs fall back to brand and product after exact sold searches fail', () => {
  const identity = extractProductIdentity(
    '$130 KEMIMOTO Motorcycle Dog Carrier Bag, 28 lb',
    'Brand: KEMIMOTO\nModel: KM2F1801-01403\nCondition: Used\nDamaged?: Yes\nNotes: Head pocket is broken',
  );
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [
    'kemimoto motorcycle dog carrier bag 28 lb km2f1801-01403',
    'kemimoto motorcycle dog carrier bag',
  ]);
  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver'), 2), [
    'onkyo tx-sr304 multi-channel av receiver',
    'Onkyo TX-SR304',
  ]);
});

test('sold-query variants use corroborated manufacturers instead of a title collection or category', () => {
  const rug = extractProductIdentity(
    '$275 Eternal Dinosaur Jungle Party Rug 8x10',
    'Brand: TOWN & COUNTRY PLAY\nModel: 1-69767-185\nThis Town & Country Play Dinosaur Jungle Party Kid\'s Area Rug is textured.',
  );
  assert.deepEqual(buildEbaySoldQueryVariants(rug, 2), [
    'town country play eternal dinosaur jungle party rug 8x10 1-69767-185',
    'TOWN & COUNTRY PLAY 1-69767-185',
  ]);

  const liner = extractProductIdentity(
    '$149 Cargo Liner: 18 Expedition, 2nd Row Folded',
    'Brand: Husky Liners\nModel: 23431\nOur Cargo Liners are made from a proprietary material blend.',
  );
  assert.deepEqual(buildEbaySoldQueryVariants(liner, 2), [
    'husky liners cargo liner 18 expedition 2nd row folded 23431',
    'Husky Liners 23431',
  ]);
});

test('sold-query fallback does not search temperature or tent capacity as a model', () => {
  for (const title of [
    '$60 VEVOR Wax Melter 6.5L, 9-Temp Control',
    '$160 VEVOR SUV Tent 8x8ft, Waterproof, 5-8P',
  ]) {
    const variants = buildEbaySoldQueryVariants(extractProductIdentity(title));
    assert.ok(variants.length >= 1, title);
    assert.ok(variants.every((query) => !/^\s*(?:vevor\s+)?(?:9-temp|5-8p|8x8ft)\s*$/i.test(query)), title);
  }
});

test('model-free power ratings stay attached to their units in sold-query fallback', () => {
  const motor = extractProductIdentity('$143 VEVOR 1 HP Pool Pump Motor, 56Y, 115/230V');
  assert.equal(motor.model, null);
  assert.deepEqual(buildEbaySoldQueryVariants(motor, 2), [
    'vevor 1 hp pool pump motor 56y 115/230v',
    'vevor 1hp pool pump motor 56y',
  ]);
});

test('McAllen welder, gas trimmer, and lighting queries keep identity without false models or generic accessories', () => {
  const welder = extractProductIdentity(
    '$370 VEVOR TIG Welder 200A 6 in 1 Aluminum Welder',
    'The package includes essential accessories.',
  );
  assert.equal(welder.model, null);
  assert.deepEqual(buildEbaySoldQueryVariants(welder, 2), [
    'vevor tig welder 200a 6 in 1 aluminum welder',
    'vevor tig welder 200a aluminum welder',
  ]);

  const trimmer = extractProductIdentity(
    '$176 VEVOR Cordless Trimmer, 52cc Gas Weed Eater',
    'The gas-powered 52cc engine includes cutting blades.',
  );
  assert.equal(trimmer.model, null);
  assert.deepEqual(buildEbaySoldQueryVariants(trimmer, 2), [
    'vevor trimmer 52cc gas weed eater',
    'VEVOR 52cc gas trimmer',
  ]);

  const light = extractProductIdentity('EAPUDUN Farmhouse Ceiling 13-inch Retro 2-Lamp', 'Bulbs not included.');
  assert.equal(light.brand, 'EAPUDUN');
  assert.equal(light.model, null);
  assert.equal(light.query, 'eapudun farmhouse ceiling 13-inch retro 2-lamp');
  assert.equal(extractProductIdentity('EA EAPUDUN Farmhouse Ceiling Light').brand, 'EAPUDUN');
});

test('sold-query fallback drops generic modifiers and slash-form capacity specs', () => {
  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('$85 VEVOR Heavy Duty Kayak Cart, 450lb Capacity'))[1],
    'vevor kayak cart 450lb');
  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('$97 VEVOR Air Jack 3T/6600 lbs Pneumatic Jack'))[1],
    'vevor air jack pneumatic jack');
  assert.ok(buildEbaySoldQueryVariants(extractProductIdentity('$89 Ozark Trail 4-Person Dome Tent, 8x8'))
    .every((query) => !/^\s*(?:ozark\s+)?4-person\s*$/i.test(query)));
});

test('description-confirmed jack stands produce a bundle-aware sold query', () => {
  const identity = extractProductIdentity(
    'VEVOR 2 Ton Low-Profile Floor Jack, 5.1-12.2',
    'The accompanying jack stands enhance safety. The included stands reach 16.5 inches.',
  );
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'vevor 2 ton low-profile floor jack 5.1-12.2',
    'vevor 2 ton low-profile floor jack stand',
    'vevor 2 ton low-profile floor jack',
  ]);
});

test('model fallback retains the whole product before an accessory bundle', () => {
  const saw = extractProductIdentity('Husqvarna 445 Chain Saw w/ Extra Bar, Chains, Files, & Wrench');
  assert.deepEqual(buildEbaySoldQueryVariants(saw), [
    'husqvarna 445 chain saw with extra bar chains files wrench',
    'husqvarna 445 chain saw',
    'Husqvarna 445',
  ]);

  const microphone = extractProductIdentity('Rode NT-USB+ Microphone with Stand');
  const queries = buildEbaySoldQueryVariants(microphone);
  assert.equal(queries[1], 'rode nt-usb+ microphone');
  assert.ok(queries[0]?.includes('stand'));

  const backupPlus = extractProductIdentity('Seagate STEL8000100 Backup Plus Hub with Power Adapter');
  assert.equal(buildEbaySoldQueryVariants(backupPlus)[1], 'seagate stel8000100 backup plus hub');
});

test('captured GreatLakes WFE title normalizes w slash without a dangling w', () => {
  const title = 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 11';
  const identity = extractProductIdentity(title);
  assert.equal(buildProductResearchQuery(title), 'white farm equipment wfe field boss 31 with wfe 11');
  assert.equal(identity.query, 'white farm equipment wfe field boss 31 with wfe 11');
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'white farm equipment wfe field boss 31 with wfe 11',
    'farm equipment wfe field boss 31',
    '"white farm equipment wfe field boss 31 with wfe 11"',
  ]);
  assert.ok(buildEbaySoldQueryVariants(identity).every((query) => !/\bw\b/i.test(query)));
});

test('captured McAllen VEVOR pump keeps NPT adapters out of generic eBay fallback expansion', () => {
  const identity = extractProductIdentity(
    'VEVOR Hot Water Recirculating Pump, 10 GPM',
    'Includes NPT adapters for installation.',
  );
  assert.deepEqual(identity.includedComponents, [['adapter']]);
  const variants = buildEbaySoldQueryVariants(identity);
  assert.deepEqual(variants, [
    'vevor hot water recirculating pump 10 gpm',
    'vevor hot water recirculating pump 10gpm',
    '"vevor hot water recirculating pump 10 gpm"',
  ]);
  assert.ok(variants.every((query) => !/\badapter\b/i.test(query)));
});

test('Seller Hub Product Research parser extracts sold provenance and economics', () => {
  const html = productResearchHtml([
    sellerHubRow({ itemId: '276589785006', title: 'The Jesus Papers: Exposing the Greatest Cover-Up in History - VERY GOOD', soldPrice: '$4.06', shipping: '$0.00 100% Free shipping' }),
    sellerHubRow({ itemId: '198554957220', title: 'The Brick Bible: The New Testament', soldPrice: '$7.63', shipping: '$5.00', totalSold: '2', totalSales: '$15.26' }),
  ].join(''));
  const result = parseSellerHubProductResearch(
    documentFor(html),
    'https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=%22The+Jesus+Papers%22&offset=0&limit=50&tabName=SOLD',
    observedAt,
  );

  assert.equal(result.status, 'ok');
  assert.equal(result.query, '"The Jesus Papers"');
  assert.equal(result.records.length, 2);
  assert.equal(result.hasNextPage, false);
  assert.deepEqual(result.records[0]?.soldPrice, { amount: 4.06, currency: 'USD' });
  assert.deepEqual(result.records[0]?.shippingPrice, { amount: 0, currency: 'USD' });
  assert.deepEqual(result.records[0]?.deliveredPrice, { amount: 4.06, currency: 'USD' });
  assert.equal(result.records[0]?.provenance.source, 'seller-hub-sold-record');
  assert.equal(result.records[1]?.priceKind, 'average-actual');
  assert.equal(result.records[1]?.totalSold, 2);
});

test('Seller Hub parser fails closed outside the selected Sold tab and detects challenges', () => {
  const active = parseSellerHubProductResearch(
    documentFor('<html><body><div role="tab" aria-selected="true">Active</div></body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=ACTIVE',
    observedAt,
  );
  assert.equal(active.status, 'not-sold-context');

  const challenge = parseSellerHubProductResearch(
    documentFor('<html><head><title>Pardon Our Interruption...</title></head><body>Verify you are human</body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=SOLD',
    observedAt,
  );
  assert.equal(challenge.status, 'challenge');
  assert.equal(challenge.failureReason, 'ebay-challenge');

  const noResults = parseSellerHubProductResearch(
    documentFor('<html><body><section role="tabpanel"><h2>No sold results found for "receiver"</h2></section></body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=SOLD',
    observedAt,
  );
  assert.equal(noResults.status, 'no-results');
  assert.equal(noResults.records.length, 0);
});

test('public Sold and Completed parser treats accepted Best Offers as price-unknown', () => {
  const html = `<html><body><ul class="srp-results">
    ${publicCard({ itemId: '123456789012', title: 'Onkyo TX-SR304 AV Receiver', price: '$49.99', shipping: '+$12.00 shipping' })}
    ${publicCard({ itemId: '123456789013', title: 'Onkyo TX-SR304 Receiver', price: '$99.99', shipping: 'Free shipping', extra: '<span>Best offer accepted</span>' })}
  </ul></body></html>`;
  const result = parsePublicEbaySoldSearch(
    documentFor(html),
    'https://www.ebay.com/sch/i.html?_nkw=Onkyo+TX-SR304&LH_Sold=1&LH_Complete=1',
    observedAt,
  );

  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0]?.deliveredPrice, { amount: 61.99, currency: 'USD' });
  assert.equal(result.records[1]?.priceKind, 'best-offer-unknown');
  assert.equal(result.records[1]?.soldPrice, null);
  assert.equal(result.records[1]?.deliveredPrice, null);
});

test('public search parser rejects an active or ambiguously filtered result page', () => {
  const result = parsePublicEbaySoldSearch(
    documentFor(`<html><body>${publicCard({ itemId: '123456789012', title: 'Onkyo TX-SR304 Receiver', price: '$49.99', shipping: 'Free shipping' })}</body></html>`),
    'https://www.ebay.com/sch/i.html?_nkw=Onkyo+TX-SR304&LH_Sold=1',
    observedAt,
  );
  assert.equal(result.status, 'not-sold-context');
  assert.equal(result.records.length, 0);
});

test('a public Sold card price alone cannot verify the historical paid amount', () => {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=VEVOR+folding+hand+truck+110+lb&LH_Sold=1&LH_Complete=1';
  const html = `<html><body><div>Completed listings Sold listings</div><ul class="srp-results">
    ${publicCard({ itemId: '366416129048', title: 'VEVOR Folding Hand Truck 110 lbs Platform Cart Dolly Trolley Cart for Moving', price: '$25.90', shipping: 'Free shipping' })}
  </ul></body></html>`;
  const attempt = parsePublicEbaySoldSearch(documentFor(html), url, observedAt);
  assert.equal(attempt.status, 'ok');
  assert.equal(attempt.records[0]?.priceKind, 'public-visible');
  const verification = verifyEbaySoldCompSet(extractProductIdentity('VEVOR Portable Hand Truck'), [attempt], {
    plannedQueries: [attempt.query], minimumSampleSize: 1,
  });
  assert.equal(verification.accepted.length, 0);
  assert.equal(verification.marketValueReady, false);
  assert.ok(verification.rejected[0]?.reasons.includes('public-visible-price-unconfirmed'));
});

test('verification keeps the exact book comp and rejects eBay related-result drift', () => {
  const identity = extractProductIdentity('The Jesus Papers Book by Michael Baigent');
  const query = '"The Jesus Papers"';
  const exact = record({ itemId: '276589785006', title: 'The Jesus Papers: Exposing the Greatest Cover-Up in History - VERY GOOD', soldPrice: { amount: 4.06, currency: 'USD' }, shippingPrice: { amount: 0, currency: 'USD' }, deliveredPrice: { amount: 4.06, currency: 'USD' } });
  const drift = record({ itemId: '198554957220', title: 'The Brick Bible: The New Testament: A New Spin on the Story of Jesus - paperback' });
  const poster = record({ itemId: '278217492948', title: 'Peter Max Early Art - Jesus paper poster 21h x 30w' });
  const result = verifyEbaySoldCompSet(identity, [attemptFor(query, [exact, drift, poster])], {
    plannedQueries: [query],
    minimumSampleSize: 1,
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.matchConfidence, 'title-family');
  assert.equal(result.marketValueReady, true);
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['276589785006']);
  assert.deepEqual(result.rejected.map((entry) => entry.itemId).sort(), ['198554957220', '278217492948']);
  assert.equal(result.statistics.salePriceMedian, 4.06);
});

test('verification rejects accessories, wrong models, parts-only comps, quantities, and duplicates', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const exact = record({ itemId: '123456789001', title: 'Onkyo TX-SR304 5.1 Channel AV Receiver Tested Working' });
  const accessory = record({ itemId: '123456789002', title: 'Replacement Remote Control for Onkyo TX-SR304 Receiver' });
  const wrongModel = record({ itemId: '123456789003', title: 'Onkyo TX-SR505 AV Receiver' });
  const parts = record({ itemId: '123456789004', title: 'Onkyo TX-SR304 Receiver For Parts or Repair' });
  const pair = record({ itemId: '123456789005', title: 'Lot of 2 Onkyo TX-SR304 AV Receivers' });
  const manual = record({ itemId: '123456789006', title: 'Onkyo TX-SR304 Service Manual Digital PDF' });
  const packaging = record({ itemId: '123456789007', title: 'Onkyo TX-SR304 Original Box and Manual' });
  const trailingQuantity = record({ itemId: '123456789008', title: 'Onkyo TX-SR304 AV Receiver Tested Qty 2' });
  const duplicate = { ...exact };
  const result = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', [exact, accessory, wrongModel, parts, pair, manual, packaging, trailingQuantity, duplicate])], {
    plannedQueries: ['Onkyo TX-SR304'],
    minimumSampleSize: 1,
    sourceCondition: assessCondition('Condition: Used - Very Good\nFunctional: Yes\nDamaged: No'),
    sourceQuantity: 1,
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.matchConfidence, 'exact-model');
  assert.equal(result.marketValueReady, true);
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['123456789001']);
  assert.equal(result.rejected.length, 7);
  assert.deepEqual(result.duplicateItemIds, ['123456789001']);
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789002')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789003')?.reasons.includes('model-mismatch:TX-SR304'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789004')?.reasons.includes('condition-mismatch:parts-only-comp'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789005')?.reasons.includes('quantity-mismatch:1:2'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789006')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789007')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789008')?.reasons.includes('quantity-mismatch:1:2'));
});

test('parts-only sold rows are rejected even when source condition was unavailable', () => {
  const identity = extractProductIdentity('ASUS GeForce RTX4060 8GB Video Card');
  const working = record({ itemId: '123456789001', title: 'ASUS GeForce RTX 4060 8GB Graphics Card Tested' });
  const parts = record({ itemId: '123456789002', title: 'For Parts ASUS GeForce RTX 4060 8GB Graphics Card' });
  const packaging = record({ itemId: '123456789003', title: 'ASUS GeForce RTX 4060 8GB Box and Cooler' });
  const result = verifyEbaySoldCompSet(identity, [attemptFor('ASUS RTX4060', [working, parts, packaging])], {
    plannedQueries: ['ASUS RTX4060'],
    minimumSampleSize: 1,
  });
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['123456789001']);
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789002')?.reasons.includes('condition-mismatch:parts-only-comp'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789003')?.reasons.includes('accessory-or-component'));
  assert.deepEqual(result.variantModels, ['RTX4060']);
});

test('insufficient-data is emitted only after every planned search and page is complete', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const exact = record({ itemId: '123456789001', title: 'Onkyo TX-SR304 AV Receiver' });
  const oneAttempt = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', [exact])], {
    plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'],
    minimumSampleSize: 3,
  });
  assert.equal(oneAttempt.status, 'incomplete');
  assert.equal(oneAttempt.allPlannedQueriesAttempted, false);

  const paged = verifyEbaySoldCompSet(identity, [
    attemptFor('Onkyo TX-SR304', [exact]),
    attemptFor('Onkyo TX-SR304 receiver', [], { hasNextPage: true }),
  ], { plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'], minimumSampleSize: 3 });
  assert.equal(paged.status, 'incomplete');
  assert.equal(paged.completePages, false);

  const complete = verifyEbaySoldCompSet(identity, [
    attemptFor('Onkyo TX-SR304', [exact]),
    attemptFor('Onkyo TX-SR304 receiver', [], { status: 'no-results' }),
  ], { plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'], minimumSampleSize: 3 });
  assert.equal(complete.status, 'insufficient');
  assert.equal(complete.allPlannedQueriesAttempted, true);
  assert.equal(complete.completePages, true);
  assert.ok(complete.insufficiencyReasons.includes('verified-sample-below-minimum:1/3'));
});

test('a sample threshold cannot override incomplete result pagination', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const records = [
    record({ itemId: '123456789001', title: 'Onkyo TX-SR304 AV Receiver Tested' }),
    record({ itemId: '123456789002', title: 'Onkyo TX-SR304 5.1 Channel Receiver' }),
    record({ itemId: '123456789003', title: 'Onkyo TX-SR304 AV Receiver with Remote' }),
  ];
  const result = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', records, { hasNextPage: true })], {
    plannedQueries: ['Onkyo TX-SR304', 'TX-SR304'],
    minimumSampleSize: 3,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.allPlannedQueriesAttempted, false);
  assert.equal(result.completePages, false);
  assert.equal(result.marketValueReady, false);
  assert.ok(result.insufficiencyReasons.includes('result-pagination-incomplete'));
});

test('model-less source retains mixed variant evidence without inventing one market value', () => {
  const identity = extractProductIdentity('Magcubic 4K Smart Projector, WiFi/BT');
  const records = [
    record({ itemId: '123456789001', title: 'Magcubic HY300 Pro 4K Smart Projector', soldPrice: { amount: 35, currency: 'USD' } }),
    record({ itemId: '123456789002', title: 'Magcubic HY350 Max 4K Smart Projector', soldPrice: { amount: 65, currency: 'USD' } }),
    record({ itemId: '123456789003', title: 'Magcubic HY300 Pro 4K WiFi Projector', soldPrice: { amount: 40, currency: 'USD' } }),
  ];
  const result = verifyEbaySoldCompSet(identity, [attemptFor('magcubic 4k projector', records)], {
    plannedQueries: ['magcubic 4k projector'],
    minimumSampleSize: 3,
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.matchConfidence, 'variant-ambiguous');
  assert.equal(result.marketValueReady, false);
  assert.ok(result.insufficiencyReasons.includes('variant-ambiguous'));
  assert.deepEqual(result.variantModels.sort(), ['HY300', 'HY350']);
  assert.equal(result.accepted.length, 3);
});

test('challenge state is blocked rather than mislabeled as insufficient data', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const challenge = attemptFor('Onkyo TX-SR304', [], { status: 'challenge', failureReason: 'ebay-challenge' });
  const result = verifyEbaySoldCompSet(identity, [challenge], { plannedQueries: ['Onkyo TX-SR304'] });
  assert.equal(result.status, 'blocked');
  assert.ok(result.insufficiencyReasons.includes('ebay-challenge'));
});
