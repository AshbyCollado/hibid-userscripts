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
  evaluateRetailCandidate,
  extractProductDiscriminators,
  extractProductIdentity,
  formatUsd,
  hasSufficientRetailIdentity,
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

test('inventory prefixes do not become brands for consoles and storage', () => {
  const ps5 = extractProductIdentity('AV - PLAYSTATION 5 CONSOLE');
  assert.equal(ps5.query, 'playstation 5 console');
  assert.equal(ps5.brand.toLowerCase(), 'playstation');
  assert.equal(ps5.kind, 'game-console');
  assert.ok(scoreRetailCandidate('Sony PlayStation 5 Console Disc Edition', ps5) >= 3);
  assert.ok(scoreRetailCandidate('Sony PS5 Slim Console Disc Edition', ps5) >= 3);
  assert.equal(scoreRetailCandidate('Sony PlayStation 4 Pro Console 1TB', ps5), 0);
  assert.equal(scoreRetailCandidate('PlayStation 5 DualSense Wireless Controller', ps5), 0);
  assert.equal(scoreRetailCandidate('Sonic Racing: CrossWorlds Amazon Exclusive Edition - PlayStation 5', ps5), 0);
  assert.equal(scoreRetailCandidate('Starfield Standard Edition - PlayStation 5', ps5), 0);
  assert.equal(scoreRetailCandidate('Sports FC Digital Edition Game for PS5', ps5), 0);
  assert.equal(scoreRetailCandidate('PlayStation Disc Drive For PS5 Digital Edition Consoles (slim)', ps5), 0);
  assert.ok(scoreRetailCandidate('Sony PlayStation 5 Slim Console with DualSense Controller Bundle', ps5) >= 3);

  const seagate = extractProductIdentity('AV - SEAGATE 8TB EXTERNAL DRIVE');
  assert.equal(seagate.query, 'seagate 8tb external drive');
  assert.equal(seagate.brand.toLowerCase(), 'seagate');
  assert.equal(seagate.kind, 'storage');
  assert.deepEqual(seagate.capacities.map((value) => value.toLowerCase()), ['8tb']);
  assert.ok(scoreRetailCandidate('Seagate Expansion Desktop 8 TB External Hard Drive USB 3.0', seagate) >= 3);
  assert.equal(scoreRetailCandidate('Seagate Portable 4TB External Hard Drive', seagate), 0);
  assert.equal(scoreRetailCandidate('Western Digital 8TB External Hard Drive', seagate), 0);
});

test('product discriminator families generalize across capacities, resolutions, sizes, and platforms', () => {
  assert.deepEqual(extractProductDiscriminators('Samsung 55 inch 4K TV'), {
    capacities: [], resolutions: ['4k'], dimensions: ['55in'], platformVariants: [], memoryTypes: [],
    frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [],
  });
  assert.deepEqual(extractProductDiscriminators('Microsoft Xbox Series X 1TB Console'), {
    capacities: ['1tb'], resolutions: [], dimensions: [], platformVariants: ['xbox:seriesx'], memoryTypes: [],
    frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [],
  });
  const xbox = extractProductIdentity('Microsoft Xbox Series X 1TB Console');
  assert.ok(scoreRetailCandidate('Xbox Series X 1 TB All-Digital Console', xbox) > 0);
  assert.equal(scoreRetailCandidate('Xbox Series S 1TB Console', xbox), 0);

  const television = extractProductIdentity('Samsung 55 inch 4K Smart TV');
  assert.ok(scoreRetailCandidate('Samsung 55-Inch 4K UHD Smart Television', television) > 0);
  assert.equal(scoreRetailCandidate('Samsung 65-Inch 4K UHD Smart Television', television), 0);
  assert.equal(scoreRetailCandidate('Samsung 55-Inch 1080p Smart Television', television), 0);
});

test('candidate evaluation rejects near matches generically across unrelated product families', () => {
  const cases = [
    {
      source: 'Lot 41 | Apple iPhone 15 Pro Max 256GB Phone',
      accepted: 'Apple iPhone 15 Pro Max 256GB Unlocked Smartphone',
      rejected: 'Apple iPhone 14 Pro Max 256GB Unlocked Smartphone',
      reason: /seriesSignatures/,
    },
    {
      source: 'Google Pixel 8 Pro 128GB Phone',
      accepted: 'Google Pixel 8 Pro 128GB Unlocked Smartphone',
      rejected: 'Google Pixel 7 Pro 128GB Unlocked Smartphone',
      reason: /seriesSignatures/,
    },
    {
      source: 'Corsair Vengeance DDR5 32GB 6000MHz Memory Kit',
      accepted: 'Corsair Vengeance DDR5 32GB 6000MHz RAM Kit',
      rejected: 'Corsair Vengeance DDR4 32GB 3200MHz RAM Kit',
      reason: /memoryTypes|frequencies/,
    },
    {
      source: 'Samsung 27 inch 1440p 144Hz Monitor',
      accepted: 'Samsung 27-Inch 1440p 144Hz Gaming Monitor',
      rejected: 'Samsung 27-Inch 1080p 75Hz Monitor',
      reason: /resolutions|refreshRates/,
    },
    {
      source: 'Sony PlayStation 5 Digital Edition Console',
      accepted: 'Sony PS5 Slim Digital Edition Console 1TB',
      rejected: 'Sony PS5 Disc Version Gaming Console 825GB',
      reason: /editions/,
    },
    {
      source: 'DeWalt 20V 5Ah Cordless Impact Driver',
      accepted: 'DEWALT 20V MAX Impact Driver with 5Ah Battery',
      rejected: 'DEWALT 12V MAX Impact Driver with 2Ah Battery',
      reason: /voltages|batteryCapacities/,
    },
    {
      source: 'Canon RF 24-70mm Camera Lens',
      accepted: 'Canon RF 24-70mm Standard Zoom Camera Lens',
      rejected: 'Canon RF 24-105mm Standard Zoom Camera Lens',
      reason: /lensRanges/,
    },
    {
      source: 'ASUS GeForce RTX 4070 Graphics Card',
      accepted: 'ASUS Dual GeForce RTX 4070 OC Edition Graphics Card',
      rejected: 'ASUS TUF Gaming GeForce RTX 4070 Ti Super Graphics Card',
      reason: /gpuModels/,
    },
    {
      source: 'ZOTAC GeForce RTX 4070 Ti 16GB Graphics Card',
      accepted: 'ZOTAC Gaming GeForce RTX 4070 Ti 16GB Graphics Card',
      rejected: 'ZOTAC Gaming GeForce RTX 4070 Ti Super 16GB Graphics Card',
      reason: /gpuModels/,
    },
    {
      source: 'AMD Ryzen 7 5800X Processor',
      accepted: 'AMD Ryzen 7 5800X Desktop Processor',
      rejected: 'AMD Ryzen 7 5700X Desktop Processor',
      reason: /cpuModels/,
    },
    {
      source: 'Apple M3 Pro MacBook Pro 18GB',
      accepted: 'Apple M3 Pro MacBook Pro with 18GB Unified Memory',
      rejected: 'Apple M3 Max MacBook Pro with 18GB Unified Memory',
      reason: /cpuModels/,
    },
  ];

  for (const entry of cases) {
    const identity = extractProductIdentity(entry.source);
    const good = evaluateRetailCandidate(entry.accepted, identity);
    const bad = evaluateRetailCandidate(entry.rejected, identity);
    assert.equal(good.accepted, true, `${entry.source}: ${good.rejectionReasons.join(', ')}`);
    assert.equal(bad.accepted, false, entry.source);
    assert.match(bad.rejectionReasons.join(' '), entry.reason);
  }
});

test('candidate evaluation distinguishes a complete product from accessories without product-specific bypasses', () => {
  const consoleIdentity = extractProductIdentity('AV - PLAYSTATION 5 CONSOLE');
  const bundle = evaluateRetailCandidate('Sony PlayStation 5 Slim Console with DualSense Controller Bundle', consoleIdentity);
  const controller = evaluateRetailCandidate('DualSense Wireless Controller for Sony PlayStation 5', consoleIdentity);
  const drive = evaluateRetailCandidate('PlayStation Disc Drive For PS5 Digital Edition Consoles (slim)', consoleIdentity);
  assert.equal(bundle.accepted, true);
  assert.ok(bundle.matchedEvidence.some((value) => value === 'kind:game-console'));
  assert.equal(controller.accepted, false);
  assert.ok(controller.rejectionReasons.includes('accessory-or-component'));
  assert.equal(drive.accepted, false);
  assert.ok(drive.rejectionReasons.includes('accessory-or-component'));
});

test('underidentified source titles fail closed instead of inheriting a plausible retail price', () => {
  const vagueCases = [
    ['Custom computer', 'CyberPowerPC Gamer Xtreme Desktop Computer Intel Core i7 RTX 4060'],
    ['Workstation Computer', 'Dell Precision 5820 Workstation Computer'],
    ['Toast Touchscreen POS System', 'Toast Flex Touchscreen POS System Terminal'],
    ['Oculus VR Headset', 'Meta Quest 2 Advanced All-In-One VR Headset 128GB'],
  ] as const;

  for (const [source, candidate] of vagueCases) {
    const identity = extractProductIdentity(source);
    assert.equal(hasSufficientRetailIdentity(identity), false, source);
    const evaluation = evaluateRetailCandidate(candidate, identity);
    assert.equal(evaluation.accepted, false, source);
    assert.ok(evaluation.rejectionReasons.includes('insufficient-source-identity'), source);
  }
});

test('model-free products remain matchable when brand, kind, and hard attributes establish identity', () => {
  const cases = [
    ['AV - PLAYSTATION 5 CONSOLE', 'Sony PlayStation 5 Slim Console with DualSense Controller Bundle'],
    ['SEAGATE 8TB EXTERNAL DRIVE', 'Seagate 8TB Expansion Desktop External Hard Drive'],
    ['Magcubic 4K Smart Projector WiFi Bluetooth', 'Magcubic 4K Smart Projector WiFi Bluetooth'],
    ['ASUS GEFORCE RTX4070 12GB GRAPHICS CARD', 'ASUS Dual GeForce RTX 4070 OC Edition 12GB Graphics Card'],
  ] as const;

  for (const [source, candidate] of cases) {
    const identity = extractProductIdentity(source);
    assert.equal(hasSufficientRetailIdentity(identity), true, source);
    const evaluation = evaluateRetailCandidate(candidate, identity);
    assert.equal(evaluation.accepted, true, `${source}: ${evaluation.rejectionReasons.join(', ')}`);
  }
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
    { asin: 'B000000005', title: 'Renewed Sony WF-1000XM5 Wireless Earbuds', price: 129, used: true, sponsored: false, url: '' },
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
