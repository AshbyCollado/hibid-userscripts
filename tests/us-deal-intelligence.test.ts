import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amazonIndicator,
  assessLotCondition,
  buildAccountVerdict,
  buildRetailLinks,
  calculateAllInCost,
  chooseAmazonMatch,
  detectComparisonCurrency,
  detectMixedLot,
  extractProductIdentity,
  formatUsd,
  isAccessoryListing,
  modelMatches,
  parseAmazonSearchHtml,
  parseStructuredDescription,
  scoreRetailCandidate,
  selectAuctionHammer,
  requiresQuantityConfirmation,
  trustedAmazonMarketValue,
} from '../src/intelligence/us-deal-intelligence.js';

test('structured descriptions normalize CR fields and keep labels out of free text', () => {
  const parsed = parseStructuredDescription('Est. Retail Price: 251.00\rCondition: BRAND NEW - OPEN BOX\rModel: NT-USB+\rIs Item Damaged? No');
  assert.equal(parsed.fields.condition, 'BRAND NEW - OPEN BOX');
  assert.equal(parsed.fields.model, 'NT-USB+');
  assert.equal(parsed.fields['is item damaged'], 'No');
  assert.equal(parsed.freeText, '');
});

test('condition assessment respects answers instead of scanning question labels', () => {
  const good = assessLotCondition({ title: 'RODE NT-USB+', description: 'Condition: BRAND NEW - OPEN BOX\nModel: NT-USB+\nIs Item Functional? Yes\nIs Item Damaged? No\nMissing Major Parts? No' });
  assert.equal(good.partsOnly, false);
  assert.equal(good.damaged, false);
  assert.equal(good.positive, true);
  assert.deepEqual(good.partsReasons, []);
  assert.ok(good.cautions.includes('open box'));

  const na = assessLotCondition({ description: 'Condition: EXCELLENT\nIs Item Functional? N/A\nIs Item Damaged? No\nMissing Major Parts? No' });
  assert.equal(na.partsOnly, false);
  assert.equal(na.damaged, false);
  assert.deepEqual(na.cautions, []);

  const bad = assessLotCondition({ description: 'Condition: FAIR\nIs Item Damaged? Yes\nDamage Desct: Fully stained' });
  assert.equal(bad.damaged, true);
  assert.ok(bad.damageReasons.some((reason) => reason.includes('Fully stained')));
  assert.equal(assessLotCondition({ description: 'Condition: FOR PARTS ONLY\nIs Item Damaged? No' }).partsOnly, true);
});

test('product identity preserves hyphenated plus models, capacities, and parenthesized models', () => {
  const rode = extractProductIdentity('RODE NT-USB+ USB CONDENSER MICROPHONE', 'Condition: BRAND NEW\nModel: NT-USB+');
  assert.equal(rode.query, 'rode nt-usb+ usb condenser microphone');
  assert.equal(rode.model, 'NT-USB+');

  const receiver = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.equal(receiver.query, 'onkyo tx-sr304 multi-channel av receiver');
  assert.equal(modelMatches('Onkyo TXSR304 AV Receiver', 'TX-SR304'), true);

  const mac = extractProductIdentity('Apple MacBook Pro (A2338) 13 inch');
  assert.equal(mac.model, 'A2338');
  assert.match(mac.query, /a2338/i);

  const ram = extractProductIdentity('$650 CORSAIR Vengeance DDR5 32GB (2x16GB) 6000MHz');
  assert.match(ram.query, /32gb/i);
  assert.ok(ram.capacities.includes('32GB'));

  const recordIdentity = extractProductIdentity({ title: 'Sony WF-1000XM5 Earbuds', statedRetail: 278 });
  assert.equal(recordIdentity.statedRetail, 278);
});

test('Magcubic projector title remains authoritative over longer marketing description prose', () => {
  const identity = extractProductIdentity({
    title: 'Magcubic 4K Smart Projector WiFi Bluetooth',
    description: 'Bring the cinema home with an immersive visual experience. This compact entertainment solution delivers vivid color, convenient connectivity, and automatic setup for movie nights, gaming, streaming, family presentations, and relaxing evenings in any room.',
  });
  assert.equal(identity.brand, 'Magcubic');
  assert.match(identity.name, /^Magcubic 4K Smart Projector/i);
  assert.equal(identity.query, 'magcubic 4k smart projector wifi bluetooth');
});

test('unrelated Samsung 4K monitor is rejected for a Magcubic projector identity', () => {
  const identity = extractProductIdentity('Magcubic 4K Smart Projector WiFi Bluetooth');
  assert.equal(scoreRetailCandidate('Samsung 4K Monitor 32 Inch UHD Display', identity), 0);
  assert.equal(scoreRetailCandidate('Samsung 4K Smart Monitor with HDMI and DisplayPort', identity), 0);
});

test('exact Magcubic projector candidate is accepted', () => {
  const identity = extractProductIdentity({
    title: 'Magcubic 4K Smart Projector WiFi Bluetooth',
    description: 'Bring the cinema home with an immersive visual experience and convenient automatic setup for movie nights.',
  });
  const match = chooseAmazonMatch(identity, [
    {
      asin: 'B0MAGCUBIC1',
      title: 'Magcubic 4K Smart Projector WiFi Bluetooth with Auto Keystone',
      price: 89.99,
      used: false,
      sponsored: false,
      url: 'https://www.amazon.com/dp/B0MAGCUBIC1',
    },
  ]);
  assert.equal(match?.candidate.asin, 'B0MAGCUBIC1');
});

test('model-less matching rejects same-brand wrong product kinds', () => {
  const projector = extractProductIdentity('Magcubic 4K Smart Projector WiFi Bluetooth');
  assert.equal(scoreRetailCandidate('MAGCUBIC Android TV Stick 4K with WiFi', projector), 0);
  const television = extractProductIdentity('Samsung 55 Inch Smart TV');
  assert.equal(scoreRetailCandidate('Samsung 32 Inch 4K Smart Monitor', television), 0);
});

test('description brand cannot override a credible title brand', () => {
  const identity = extractProductIdentity('Magcubic 4K Smart Projector', 'Brand: Samsung\nModel: Unknown\nLong marketing description');
  assert.equal(identity.brand, 'Magcubic');
  assert.equal(identity.kind, 'projector');
});

test('low-confidence Amazon evidence cannot become a retail value', () => {
  const match = {
    candidate: { asin: 'B000000010', title: 'Ambiguous Product', price: 349.99, used: false, sponsored: false, url: '' },
    score: 2.5,
  };
  assert.equal(trustedAmazonMarketValue('low_confidence', match, 1), null);
  assert.equal(trustedAmazonMarketValue('matched', match, 2), 699.98);
  assert.equal(trustedAmazonMarketValue('matched', { ...match, candidate: { ...match.candidate, price: 0 } }, 1), null);
});

test('multi-unit and mixed lots require an explicit confirmed quantity', () => {
  assert.equal(requiresQuantityConfirmation(2, false, null), true);
  assert.equal(requiresQuantityConfirmation(1, true, null), true);
  assert.equal(requiresQuantityConfirmation(12, false, 12), false);
  assert.equal(requiresQuantityConfirmation(1, false, null), false);
});

test('genuine Canadian evidence blocks USD comparison', () => {
  assert.equal(detectComparisonCurrency('High Bid: 20.00 CAD', ''), 'CAD');
  assert.equal(detectComparisonCurrency('High Bid: 20.00 Can', ''), 'CAD');
  assert.equal(detectComparisonCurrency('High Bid: 20.00 USD', '15%'), 'USD');
});

test('mixed-lot detection identifies bundles and returns component text', () => {
  const mixed = detectMixedLot('Group of 3 - Apple MacBook Pro (A2338) - Sony WH-1000XM4', 'Includes chargers and cases');
  assert.equal(mixed.mixed, true);
  assert.ok(mixed.reasons.length > 0);
  assert.ok(mixed.components.some((component) => /Apple MacBook/i.test(component)));
  assert.equal(detectMixedLot('Sony WH-1000XM4 headphones').mixed, false);
});

test('ordinary single-product marketing prose does not trigger mixed-lot review', () => {
  const tv = detectMixedLot('Samsung The Frame 55" QLED TV LS03FAF', 'With Samsung Vision AI, enjoy optimized picture and sound quality.');
  const projector = detectMixedLot('Magcubic 4K Smart Projector, WiFi/BT', 'Projector with autofocus and automatic keystone correction.');
  assert.equal(tv.mixed, false);
  assert.equal(projector.mixed, false);
});

test('US all-in math applies premium and tax without a shipping adjustment', () => {
  const result = calculateAllInCost({ hammer: 100, buyerPremiumPct: 15, salesTaxPct: 8.25 });
  assert.equal(result.currency, 'USD');
  assert.equal(result.premium, 15);
  assert.equal(result.taxableSubtotal, 115);
  assert.ok(Math.abs(result.tax - 9.4875) < 1e-10);
  assert.ok(Math.abs(result.total - 124.4875) < 1e-10);
  assert.equal(formatUsd(result.total), '$124.49');
  const legacyShipping = calculateAllInCost({ hammer: 100, buyerPremiumPct: 15, salesTaxPct: 8.25, shipping: 99 } as never);
  assert.equal(legacyShipping.total, result.total);
  const untaxedPremium = calculateAllInCost({ hammer: 100, buyerPremiumPct: 15, salesTaxPct: 10, taxOnPremium: false });
  assert.equal(untaxedPremium.taxableSubtotal, 100);
  assert.equal(untaxedPremium.total, 125);
});

test('closed lots ignore a zero next bid and use the realized/current amount', () => {
  assert.equal(selectAuctionHammer(0, 365), 365);
  assert.equal(selectAuctionHammer(6, 5), 6);
  assert.equal(selectAuctionHammer(null, null), null);
});

test('Amazon candidate parsing deduplicates ASINs and records sponsored, used, price, and title', () => {
  const html = `
    <div data-asin="B000000001" class="organic">
      <img class="s-image" alt="Sony WF-1000XM5 Wireless Earbuds" />
      <span class="a-price"><span class="a-offscreen">$278.00</span></span>
    </div>
    <div data-asin="B000000001" data-component-type="sp-sponsored-result">
      <img class="s-image" alt="Sony WF-1000XM5 Wireless Earbuds" />
      <span class="a-price"><span class="a-offscreen">$250.00</span>
    </div>
    <div data-asin="B000000002" class="organic">
      <img class="s-image" alt="Open Box Sony WF-1000XM5 Earbuds" />
      <span class="a-price-whole">199</span><span class="a-price-fraction">99</span>
    </div>`;
  const candidates = parseAmazonSearchHtml(html, 'Sony WF-1000XM5');
  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((candidate) => candidate.asin === 'B000000001')?.sponsored, false);
  assert.equal(candidates.find((candidate) => candidate.asin === 'B000000001')?.price, 278);
  assert.equal(candidates.find((candidate) => candidate.asin === 'B000000002')?.used, true);
  assert.equal(candidates.find((candidate) => candidate.asin === 'B000000002')?.price, 199.99);
});

test('Amazon matching rejects accessories and unrelated models while retaining the real product', () => {
  const product = extractProductIdentity('Sony WF-1000XM5 Earbuds');
  const badTitles = [
    'Spigen Rugged Armor Designed for Sony WF-1000XM5 Case',
    'Replacement Ear Tips for Sony WF-1000XM5',
    'JBL Tune 520BT Wireless Headphones',
  ];
  for (const title of badTitles) assert.equal(scoreRetailCandidate(title, product), 0);
  assert.equal(isAccessoryListing('Sony WF-1000XM5 Wireless Earbuds with Charging Case', product), false);
  const match = chooseAmazonMatch(product, [
    { asin: 'B000000003', title: badTitles[0]!, price: 26.99, used: false, sponsored: false, url: '' },
    { asin: 'B000000004', title: 'Sony WF-1000XM5 Wireless Earbuds with Charging Case', price: 278, used: false, sponsored: false, url: '' },
  ], product);
  assert.equal(match?.candidate.asin, 'B000000004');
});

test('Amazon indicator shares the donor thresholds in USD', () => {
  assert.equal(amazonIndicator(40, 100).cls, 'green');
  assert.equal(amazonIndicator(50, 100).cls, 'yellow');
  assert.equal(amazonIndicator(65, 100).cls, 'orange');
  assert.equal(amazonIndicator(75, 100).cls, 'red');
  assert.equal(amazonIndicator(40, null).cls, 'na');
});

test('account verdict precedence handles parts, winning, and outbid states', () => {
  assert.equal(buildAccountVerdict({ partsOnly: true, status: 'Winning', nextHammer: 10, allIn: 10, maxBid: 100, retail: 200 }).kind, 'parts_only');
  assert.equal(buildAccountVerdict({ status: 'Outbid', nextHammer: 110, allIn: 150, maxBid: 100, retail: 200 }).kind, 'let_go');
  assert.equal(buildAccountVerdict({ status: 'Outbid', nextHammer: 90, allIn: 120, maxBid: 100, retail: 200 }).kind, 'raise');
  assert.equal(buildAccountVerdict({ status: 'Winning', nextHammer: 90, allIn: 210, maxBid: 100, retail: 200 }).kind, 'winning_above_retail');
  assert.equal(buildAccountVerdict({ status: 'Winning', nextHammer: 90, allIn: 120, maxBid: 100, retail: 200 }).kind, 'hold');
  assert.equal(buildAccountVerdict({ status: 'Winning', nextHammer: 90, allIn: 120, maxBid: null, retail: 200 }).kind, 'hold');
  assert.equal(buildAccountVerdict({ status: 'Outbid', nextHammer: 90, allIn: 120, maxBid: null, retail: null }).kind, 'manual');
});

test('retail links are pure, encoded, and limited to Amazon and eBay', () => {
  const links = buildRetailLinks('Sony WF-1000XM5');
  assert.match(links.amazon, /amazon\.com\/s\?k=Sony%20WF-1000XM5/);
  assert.equal(links.amazonUrl, links.amazon);
  assert.equal(links.ebayUrl, links.ebay);
  assert.match(links.ebay, /ebay\.com\/sch\/i\.html/);
  assert.doesNotMatch(JSON.stringify(links), /bestbuy/i);
});
