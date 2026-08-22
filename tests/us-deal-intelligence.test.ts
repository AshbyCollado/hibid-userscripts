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
  extractStatedRetail,
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
import { enrichAmazonCandidateFromDetail, parseAmazonDocumentCandidates } from '../src/intelligence/amazon-document-parser.js';

test('auctioneer retail claims provide the donor-compatible provisional value', () => {
  assert.deepEqual(
    extractStatedRetail('Widget', 'Est. Retail Price: $129.99\nCondition: New', ''),
    { value: 129.99, source: 'stated in listing ("Est. Retail Price: $129.99")' }
  );
  assert.deepEqual(
    extractStatedRetail('Widget', '', '$80.00 - $120.00'),
    { value: 120, source: 'auctioneer estimate high ($80.00 - $120.00)' }
  );
});

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
    packageCounts: [], colors: [], materials: [], productFamilies: [], variantLabels: [], volumes: [], modeCounts: [], featureCounts: [],
  });
  assert.deepEqual(extractProductDiscriminators('Microsoft Xbox Series X 1TB Console'), {
    capacities: ['1tb'], resolutions: [], dimensions: [], platformVariants: ['xbox:seriesx'], memoryTypes: [],
    frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [],
    packageCounts: [], colors: [], materials: [], productFamilies: [], variantLabels: [], volumes: [], modeCounts: [], featureCounts: [],
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

test('descriptive hyphenated prose cannot impersonate a model and match a different product', () => {
  const identity = extractProductIdentity('Snorkeling Gear for Adults: Anti-Fog Mask 2-Pack');
  const spray = evaluateRetailCandidate(
    'STREAM 2 SEA Reef Safe Anti-Fog Spray for Swim Goggles, Snorkel, Scuba & Ski Masks - Defogger for Diving, Snorkeling - 2Fl Oz',
    identity,
  );
  assert.equal(identity.model, null);
  assert.equal(spray.accepted, false);
  assert.ok(spray.rejectionReasons.some((reason) => /brand-mismatch|kind-mismatch|weak-title-overlap|accessory/.test(reason)));
});

test('underidentified source titles fail closed instead of inheriting a plausible retail price', () => {
  const vagueCases = [
    ['Custom computer', 'CyberPowerPC Gamer Xtreme Desktop Computer Intel Core i7 RTX 4060'],
    ['Workstation Computer', 'Dell Precision 5820 Workstation Computer'],
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

test('ordinary Amazon liquidation products do not require a model or a narrow product taxonomy', () => {
  const cases = [
    ['Mr. Coffee Mug Warmer for Coffee & Tea Black', 'Mr. Coffee Mug Warmer for Coffee and Tea, Black'],
    ['NERF Mega Ball 20 Outdoor Kickball Toy', 'NERF Mega Ball 20 Inch Outdoor Kickball Toy for Kids'],
    ['XUANGUO Woven Rope Baskets 3 Pack Dark Green', 'XUANGUO Woven Rope Storage Baskets, 3 Pack, Dark Green'],
    ['LISEN 15W MagSafe Car Mount Charger', 'LISEN 15W MagSafe Car Mount Charger for iPhone'],
    ['ErGear Dual Monitor Arm 13 32 VESA 100x100', 'ErGear Dual Monitor Arm for 13 to 32 Inch Screens VESA 100x100'],
    ['Toast Touchscreen POS System', 'Toast Flex Touchscreen POS System Terminal'],
  ] as const;
  for (const [source, candidate] of cases) {
    const identity = extractProductIdentity(source);
    assert.equal(hasSufficientRetailIdentity(identity), true, source);
    const evaluation = evaluateRetailCandidate(candidate, identity);
    assert.equal(evaluation.accepted, true, `${source}: ${evaluation.rejectionReasons.join(', ')}`);
  }
});

test('missing marketing attributes do not reject an otherwise corroborated product', () => {
  const identity = extractProductIdentity('LISEN 15W MagSafe Car Mount Charger');
  const evaluation = evaluateRetailCandidate('LISEN MagSafe Car Mount Charger for iPhone', identity);
  assert.equal(evaluation.accepted, true, evaluation.rejectionReasons.join(', '));
});

test('exact source attributes outrank a cheaper candidate that omits them', () => {
  const identity = extractProductIdentity('Vancasso Slow Feeder Dog Bowl, 1.5 Cup Pink');
  const match = chooseAmazonMatch(identity, [
    { asin: 'B0F8BX8CB6', title: 'vancasso Ceramic Slow Feeder Dog Bowl, 1.5 Cup Puzzle Dish for Medium Breed', price: 20.88, used: false, sponsored: false, url: '' },
    { asin: 'B0FF9WP8RF', title: 'vancasso Slow Feeder Dog Bowl, 1.5 Cup Ceramic Slow Feeding Food Dish for Small and Medium Breed, Pink', price: 25.99, used: false, sponsored: false, url: '' },
  ]);
  assert.equal(match?.candidate.asin, 'B0FF9WP8RF');
  assert.equal(match?.candidate.price, 25.99);
});

test('Amazon liquidation matching rejects wrong package, color, material, family, and labeled variants', () => {
  const cases = [
    ['Pampers Swaddlers Newborn Diapers, 84 ct', 'Pampers Swaddlers Diapers Size 3, 168 Count'],
    ['Citicr 10000mAh PD20W Portable Charger, Green', 'citicr Portable Charger 10000mAh PD20W Purple'],
    ['MALACASA 10 Inch Pasta Bowls, Set of 4', 'MALACASA 12 Pcs Porcelain Plates and Bowls Dinnerware Set'],
    ['Bedsure White Cozy Blanket - GentleSoft Sherpa', 'Bedsure GentleSoft White Fleece Bubble Blanket'],
    ['Sensationnel Bare Lace 13x6 Wig-Unit 17', 'Sensationnel Bare Lace 13x6 Wig-Unit 19'],
    ['Steam Cleaner Handheld Steamer + 16 Accs', '16 Pack Microfiber Cloths for Handheld Steam Cleaner'],
    ['Solar Automatic Drip Irrigation Kit with Timer', 'Solar Drip Irrigation Replacement Parts Only'],
    ['JISULIFE Neck Fan 4000mAh', 'JISULIFE Portable Handheld Turbo Fan 4000mAh'],
  ] as const;
  for (const [source, candidate] of cases) {
    const identity = extractProductIdentity(source);
    assert.equal(scoreRetailCandidate(candidate, identity), 0, `${source} -> ${candidate}`);
  }
});

test('live catalog edge cases preserve package count, volume aliases, and color identity', () => {
  const baskets = extractProductIdentity('XUANGUO Woven Rope Baskets, 3 Pack, Dark Green');
  const basketMatch = chooseAmazonMatch(baskets, [
    { asin: 'B0DRJD5V7J', title: 'XUANGUO Small Woven Storage Baskets for Shelves, 12 x 8 x 5, Dark Green', price: 22.87, used: false, sponsored: false, url: '' },
    { asin: 'B0BW5RL8ZC', title: 'XUANGUO Woven Cotton Rope Storage Baskets 15x10x9.3 3 Pack Dark Green', price: 35.87, used: false, sponsored: false, url: '' },
  ]);
  assert.equal(basketMatch?.candidate.asin, 'B0BW5RL8ZC');

  const tovolo = extractProductIdentity('Tovolo Insulated 2 Qt Food Traveler Thermos');
  assert.equal(
    evaluateRetailCandidate('Tovolo Insulated Food Container 2 Quart Food Traveler Thermos for Hot and Cold Food', tovolo).accepted,
    true
  );

  const glasses = extractProductIdentity('ZMOWIPDL 6x12oz Clear Blue Hobnail Glass Cups Set');
  assert.deepEqual(glasses.discriminators.packageCounts, ['6']);
  assert.deepEqual(glasses.discriminators.volumes, ['12oz']);
  assert.deepEqual(glasses.discriminators.colors, ['blue']);
  assert.equal(
    evaluateRetailCandidate('ZMOWIPDL Drinking Glasses Set of 6, 12oz Lake Blue Hobnail Glass Cups', glasses).accepted,
    true
  );
});

test('missing bundle quantity cannot price a smaller or incomplete variant', () => {
  const pyrex = extractProductIdentity('NEW Pyrex Portables 9 Piece Bakeware Carrier Set');
  const baskets = extractProductIdentity('XUANGUO Woven Rope Baskets, 3 Pack, Dark Green');
  assert.equal(scoreRetailCandidate('Pyrex 3-Qt Portables Black Red Insulated Casserole Carry Tote', pyrex), 0);
  assert.equal(scoreRetailCandidate('XUANGUO Small Woven Storage Basket, Dark Green', baskets), 0);
});

test('Amazon result URL slug can restore a brand omitted from the visible title', () => {
  const html = `
    <div data-asin="B0GC3RRTB1">
      <a href="/Leebein-Electric-Cordless-Cleaning-Barbecue/dp/B0GC3RRTB1">
        <img class="s-image" alt="Electric Grill Brush, High Torque Rechargeable BBQ Grill Cleaner, 3-in-1" />
      </a>
      <span class="a-price"><span class="a-offscreen">$46.79</span></span>
    </div>`;
  const [candidate] = parseAmazonSearchHtml(html);
  assert.match(candidate?.matchText || '', /Leebein/i);
  const identity = extractProductIdentity('Leebein Electric Grill Brush 3-in-1');
  assert.equal(chooseAmazonMatch(identity, candidate ? [candidate] : [])?.candidate.asin, 'B0GC3RRTB1');
});

test('catalog corpus rejects wrong sports, container, bowl-size, and speed variants', () => {
  const cases = [
    ['NERF Mega Ball 20" Outdoor Kickball & Toy', 'Hasbro NERF Turbo Jr. Kids Foam Football - Classic Foam Football for Kids'],
    ['NERF Mega Ball 20" Outdoor Kickball & Toy', 'Nerf Franklin Sports Proshot Mini Foam Soccer Ball'],
    ['NERF Mega Ball 20" Outdoor Kickball & Toy', 'Nerf Sports Bash Ball, Blue'],
    ['Pink Vintage Floral Vase - Chinoiserie Decor', 'Ninehaoou Ceramic Scroll Planter 6.5 Inch, Pink Floral | Chinoiserie Floral Vase with Drainage Holes Vintage Flower Pot'],
    ['MALACASA 10" Large Pasta Bowls, Set of 4', 'MALACASA 8.85" Large Pasta Bowls, 42 OZ White Salad Bowls Soup Bowls, Porcelain Serving Bowls Set of 4'],
    ['JISULIFE Neck Fan - 4000mAh, USB, 3 Speeds', 'JISULIFE Portable Neck Fan, Hands-Free Bladeless, 5 Speeds, 4000 mAh'],
    ['ORICO 9-in-1 USB-C Hub with NVMe Enclosure', 'ORICO USB-C Hub with M.2 SSD Enclosure, 8-in-1 USB C Docking Station'],
  ] as const;
  for (const [source, candidate] of cases) {
    const identity = extractProductIdentity(source);
    assert.equal(scoreRetailCandidate(candidate, identity), 0, `${source} must reject ${candidate}: ${JSON.stringify(evaluateRetailCandidate(candidate, identity))}`);
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

test('retail package counts are not mixed lots', () => {
  const products = [
    'Pampers Swaddlers Newborn Diapers, 84 ct',
    'DaQin 10-Pack Bands for Galaxy Watch 20mm',
    'SAMYUCHOLED Cake Stand, 2 pcs, 6x4, 10x4',
    '24 Pack Mini Scented Candles: 2.5 oz Tin',
    'Crystal Glass Apothecary Jars with Lids (4)',
  ];
  for (const product of products) assert.equal(detectMixedLot(product, 'Quantity: 1\nCondition: New').mixed, false, product);
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

test('Amazon document parser keeps nested result titles paired with their own prices', () => {
  const html = `
    <div data-asin="B0FF9WP8RF" class="organic">
      <div data-asin="B0FF9WP8RF">
        <a href="/vancasso-Feeder-Ceramic-Feeding-Medium/dp/B0FF9WP8RF">
          <img class="s-image" alt="vancasso Slow Feeder Dog Bowl, 1.5 Cup, Pink" />
        </a>
        <span class="a-price"><span class="a-offscreen">$25.99</span></span>
      </div>
    </div>
    <div data-asin="B0F8BYCWQ2" class="organic">
      <a href="/vancasso-Ceramic-Feeder-Puzzle-Floral/dp/B0F8BYCWQ2">
        <img class="s-image" alt="vancasso Slow Feeder Dog Bowl, 1.5 Cup, Purple" />
      </a>
      <span class="a-price"><span class="a-offscreen">$19.79</span></span>
    </div>`;
  const candidates = parseAmazonDocumentCandidates(html);
  assert.equal(candidates.find((item) => item.asin === 'B0FF9WP8RF')?.price, 25.99);
  assert.match(candidates.find((item) => item.asin === 'B0FF9WP8RF')?.title || '', /Pink/);
  assert.equal(candidates.find((item) => item.asin === 'B0F8BYCWQ2')?.price, 19.79);
  assert.match(candidates.find((item) => item.asin === 'B0F8BYCWQ2')?.title || '', /Purple/);
});

test('Amazon parser prefers a complete heading that exposes renewed condition', () => {
  const candidates = parseAmazonSearchHtml(`
    <div data-asin="B0BLTCBSQF">
      <img alt="SteelSeries Arctis Nova 7X Wireless Headset — 38Hr Battery — Xbox..." />
      <h2><span>SteelSeries Arctis Nova 7X Wireless Headset - Black (Renewed)</span></h2>
      <span class="a-price"><span class="a-offscreen">$99.99</span></span>
    </div>`);
  assert.match(candidates[0]?.title || '', /Renewed/);
  assert.equal(candidates[0]?.used, true);
});

test('Amazon detail enrichment restores hard attributes omitted by a search card', () => {
  const source = { asin: 'B0DETAIL001', title: 'DaQin Bands for Galaxy Watch', matchText: 'DaQin Bands for Galaxy Watch', price: 15.99, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0DETAIL001' };
  const enriched = enrichAmazonCandidateFromDetail(source, `
    <span id="productTitle">DaQin 10 Pack Bands Compatible with Galaxy Watch 20mm</span>
    <div id="feature-bullets">Ten colors, 20 mm replacement sport straps</div>
  `);
  assert.equal(enriched.price, 15.99);
  assert.match(enriched.matchText, /10 Pack/);
  assert.match(enriched.matchText, /20 mm/);
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

test('Amazon matching accepts an exact accessory when the auction lot is itself that accessory', () => {
  const product = extractProductIdentity('JSAUX 4ft Aux to RCA Male Male Y Cord Grey');
  const result = evaluateRetailCandidate('RCA to 3.5mm Cable 4ft by JSAUX, Aux to RCA Male Y Splitter Grey', product);
  assert.equal(result.accepted, true);
  assert.doesNotMatch(result.rejectionReasons.join(' '), /accessory-or-component/);
});

test('Amazon matching tolerates a concatenated LED feature suffix on an inferred brand', () => {
  const product = extractProductIdentity('SAMYUCHOLED Cake Stand, 2 pcs, 6x4, 10x4');
  const result = evaluateRetailCandidate('SAMYUCHO Acrylic Cake Stand with Led Lights, 2 PCS Round Cake Riser', product);
  assert.equal(result.accepted, true);
  assert.doesNotMatch(result.rejectionReasons.join(' '), /brand-mismatch/);
});

test('numeric manufacturer models reject a same-brand but different product', () => {
  const product = extractProductIdentity('Lot 9 | Pelican 1490 Protector Laptop Case');
  assert.equal(product.model, '1490');
  assert.equal(evaluateRetailCandidate('Pelican Adventurer Laptop Bag Case 14.2 Inch Black', product).accepted, false);
  assert.equal(evaluateRetailCandidate('Pelican 1490 Protector Laptop Case, Black', product).accepted, true);
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
