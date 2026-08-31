import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amazonIndicator,
  assessLotCondition,
  buildAccountVerdict,
  buildConditionPresentation,
  buildRetailIndicatorTooltip,
  buildRetailLinks,
  buildRetailSearchPresentation,
  buildAmazonFallbackQuery,
  canAmazonDetailEnrichmentResolve,
  calculateAllInCost,
  chooseAmazonMatch,
  detectComparisonCurrency,
  detectProductKind,
  detectMixedLot,
  explainHibidStatus,
  evaluateAmazonCandidateEvidence,
  evaluateRetailCandidate,
  extractLotQuantityFromTitle,
  extractProductDiscriminators,
  extractProductIdentity,
  extractStatedRetail,
  formatUsd,
  hasSufficientRetailIdentity,
  isAccessoryListing,
  matchAmazonCandidates,
  modelMatches,
  parseAmazonSearchHtml,
  parseStructuredDescription,
  scoreRetailCandidate,
  selectAuctionHammer,
  requiresQuantityConfirmation,
  trustedAmazonMarketValue,
} from '../src/intelligence/us-deal-intelligence.js';
import { enrichAmazonCandidateFromDetail, parseAmazonDocumentCandidates } from '../src/intelligence/amazon-document-parser.js';

test('auctioneer retail claims remain parseable metadata but are not verified pricing evidence', () => {
  assert.deepEqual(
    extractStatedRetail('Widget', 'Est. Retail Price: $129.99\nCondition: New', ''),
    { value: 129.99, source: 'stated in listing ("Est. Retail Price: $129.99")' }
  );
  assert.deepEqual(
    extractStatedRetail('Widget', '', '$80.00 - $120.00'),
    { value: 120, source: 'auctioneer estimate high ($80.00 - $120.00)' }
  );
});

test('condition pills summarize structured evidence without treating negative questions as damage', () => {
  const sealed = buildConditionPresentation(assessLotCondition({
    description: 'Condition: New - Factory Sealed\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: No'
  }));
  assert.deepEqual({ label: sealed.label, tone: sealed.tone }, { label: 'New · sealed', tone: 'good' });
  assert.match(sealed.title, /Damaged: No/);
  assert.match(sealed.title, /Functional: Yes/);

  const untested = buildConditionPresentation(assessLotCondition({ description: 'Condition: Used\nNotes: Untested' }));
  assert.deepEqual({ label: untested.label, tone: untested.tone }, { label: 'Used · untested', tone: 'warning' });

  const damaged = buildConditionPresentation(assessLotCondition({ description: 'Condition: Fair\nDamaged?: Yes' }));
  assert.deepEqual({ label: damaged.label, tone: damaged.tone }, { label: 'Damaged', tone: 'danger' });

  const normalWear = buildConditionPresentation(assessLotCondition({ description: 'Condition: Expected wear & tear for age' }));
  assert.deepEqual({ label: normalWear.label, tone: normalWear.tone }, { label: 'Normal age wear', tone: 'warning' });
  assert.match(normalWear.title, /Expected wear & tear for age/);
});

test('Amazon matching ignores auctioneer-stated retail price floors', () => {
  const identity = extractProductIdentity({ title: 'Onkyo TX-SR304 Multi-Channel AV Receiver', statedRetail: 9999 });
  const match = chooseAmazonMatch(identity, [{
    asin: 'B0EXACT001', title: 'Onkyo TX-SR304 Multi Channel AV Receiver', price: 79.99,
    used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0EXACT001'
  }]);
  assert.equal(match?.candidate.asin, 'B0EXACT001');
});

test('structured descriptions normalize CR fields and keep labels out of free text', () => {
  const parsed = parseStructuredDescription('Est. Retail Price: 251.00\rCondition: BRAND NEW - OPEN BOX\rModel: NT-USB+\rIs Item Damaged? No');
  assert.equal(parsed.fields.condition, 'BRAND NEW - OPEN BOX');
  assert.equal(parsed.fields.model, 'NT-USB+');
  assert.equal(parsed.fields['is item damaged'], 'No');
  assert.equal(parsed.freeText, '');
});

test('inline HiBid condition streams retain every field and numeric HTML spacing', () => {
  const used = parseStructuredDescription('Shelf Location: G3 Condition: Used - Very Good In Packaging?: No Assembly Required?: No Damaged?: No Functional?: Unable to Test Missing Parts?: Yes &#x20;');
  assert.equal(used.fields['shelf location'], 'G3');
  assert.equal(used.fields.condition, 'Used - Very Good');
  assert.equal(used.fields['in packaging'], 'No');
  assert.equal(used.fields.functional, 'Unable to Test');
  assert.equal(used.fields['missing parts'], 'Yes');
  assert.equal(used.freeText, '');
  const usedPresentation = buildConditionPresentation(assessLotCondition({ description: 'Shelf Location: G3 Condition: Used - Very Good In Packaging?: No Assembly Required?: No Damaged?: No Functional?: Unable to Test Missing Parts?: Yes &#x20;' }));
  assert.deepEqual({ label: usedPresentation.label, tone: usedPresentation.tone }, { label: 'Used · very good · parts missing', tone: 'danger' });
  assert.match(usedPresentation.title, /Functional: Unable to Test/);
  assert.match(usedPresentation.title, /Missing parts: Yes/);

  const flawed = buildConditionPresentation(assessLotCondition({
    description: 'Shelf Location: G2 Condition: New - Packaging Flawed In Packaging?: Yes Assembly Required?: No Damaged?: No Functional?: Yes'
  }));
  assert.deepEqual({ label: flawed.label, tone: flawed.tone }, { label: 'New · packaging flawed', tone: 'warning' });
});

test('retail indicator tooltips explain exact values and every color threshold', () => {
  const cases = [
    { allIn: 49, cls: 'green', phrase: 'below 50%' },
    { allIn: 50, cls: 'yellow', phrase: '50% to 64%' },
    { allIn: 65, cls: 'orange', phrase: '65% to 74%' },
    { allIn: 75, cls: 'red', phrase: '75% or more' },
  ] as const;
  for (const entry of cases) {
    const indicator = amazonIndicator(entry.allIn, 100);
    assert.equal(indicator.cls, entry.cls);
    const title = buildRetailIndicatorTooltip({
      providerName: 'Amazon', indicator, allIn: entry.allIn, marketPrice: 100, evidenceSource: 'Exact Model 123'
    });
    assert.match(title, /Amazon: \$100\.00 reference from Exact Model 123/);
    assert.match(title, new RegExp(entry.phrase.replace('%', '\\%')));
  }
});

test('missing retail evidence creates branded search actions with normalized queries', () => {
  const amazon = buildRetailSearchPresentation('amazon', '  Onkyo   TX-SR304  ');
  assert.equal(amazon.label, 'Amazon \u2197');
  assert.equal(new URL(amazon.href).searchParams.get('k'), 'Onkyo TX-SR304');
  assert.match(amazon.title, /No verified Amazon price/);

  const ebay = buildRetailSearchPresentation('ebay', 'Magcubic 4K Projector');
  const url = new URL(ebay.href);
  assert.equal(ebay.label, 'eBay \u2197');
  assert.equal(url.searchParams.get('_nkw'), 'Magcubic 4K Projector');
  assert.equal(url.searchParams.get('LH_Sold'), '1');
  assert.equal(url.searchParams.get('LH_Complete'), '1');
  assert.match(ebay.title, /Sold and Completed/);
});

test('HiBid status hover text explains known states and safely handles unknown ones', () => {
  assert.match(explainHibidStatus('POSTED'), /published.*does not confirm/i);
  assert.match(explainHibidStatus('OPEN'), /open for bidding/i);
  assert.match(explainHibidStatus('UPCOMING'), /has not opened/i);
  assert.match(explainHibidStatus('CLOSING'), /closing sequence/i);
  assert.match(explainHibidStatus('CLOSED'), /bidding has ended/i);
  assert.match(explainHibidStatus('WINNING'), /currently lead/i);
  assert.match(explainHibidStatus('OUTBID'), /another bidder currently leads/i);
  assert.match(explainHibidStatus('WON'), /you won/i);
  assert.match(explainHibidStatus('PAUSED BY AUCTIONEER'), /HiBid's current lot status/);
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

test('structured brand and model fields disambiguate warehouse batch prefixes', () => {
  const grille = extractProductIdentity({
    title: 'J3 18 x 18 in. Steel Return Air Grille, White',
    description: 'Brand: Everbilt\nModel: E17018X18\nTitle: J3 18 x 18 in. Steel Return Air Grille, White',
  });
  assert.equal(grille.name, '18 x 18 in. Steel Return Air Grille, White');
  assert.equal(grille.brand, 'Everbilt');
  assert.equal(grille.model, 'E17018X18');
  assert.match(grille.query, /^everbilt 18 x 18 in steel return air grille white e17018x18$/);
  assert.doesNotMatch(grille.query, /\bj3\b/i);

  const wrench = extractProductIdentity({
    title: 'V6 VEVOR Torque Wrench 3/8" Drive 10-150ft.lb',
    description: 'Brand: VEVOR\nModel: 17080FTLB',
  });
  assert.equal(wrench.name, 'VEVOR Torque Wrench 3/8" Drive 10-150ft.lb');
  assert.equal(wrench.model, '17080FTLB');
  assert.match(wrench.query, /17080ftlb$/);
  assert.doesNotMatch(wrench.query, /\bv6\b/i);

  const genuineModel = extractProductIdentity({
    title: 'BMW X3 Cargo Liner',
    description: 'Brand: BMW\nModel: X3',
  });
  assert.equal(genuineModel.name, 'BMW X3 Cargo Liner');
  assert.equal(genuineModel.model, 'X3');
  assert.match(genuineModel.query, /\bx3\b/);
});

test('product discriminator families generalize across capacities, resolutions, sizes, and platforms', () => {
  assert.deepEqual(extractProductDiscriminators('Samsung 55 inch 4K TV'), {
    capacities: [], cubicCapacities: [], weightLimits: [], resolutions: ['4k'], dimensions: ['55in'], platformVariants: [], memoryTypes: [],
    frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [],
    packageCounts: [], colors: [], materials: [], productFamilies: [], variantLabels: [], volumes: [], modeCounts: [], featureCounts: [],
  });
  assert.deepEqual(extractProductDiscriminators('Microsoft Xbox Series X 1TB Console'), {
    capacities: ['1tb'], cubicCapacities: [], weightLimits: [], resolutions: [], dimensions: [], platformVariants: ['xbox:seriesx'], memoryTypes: [],
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

test('equal-capacity memory kits retain their module count configuration', () => {
  const kit = extractProductIdentity('Corsair Vengeance DDR5 2x16GB 6000MHz Memory Kit');
  assert.deepEqual(kit.discriminators.capacities, ['32gb']);
  assert.deepEqual(kit.discriminators.packageCounts, ['2']);
  assert.equal(evaluateRetailCandidate('Corsair Vengeance DDR5 32GB (2x16GB) 6000MHz Memory Kit', kit).accepted, true);

  const oneModule = evaluateRetailCandidate('Corsair Vengeance DDR5 32GB (1x32GB) 6000MHz Memory Module', kit);
  assert.equal(oneModule.accepted, false);
  assert.match(oneModule.rejectionReasons.join(' '), /packageCounts/);

  const unspecifiedModules = evaluateRetailCandidate('Corsair Vengeance DDR5 32GB 6000MHz Memory Kit', kit);
  assert.equal(unspecifiedModules.accepted, false);
  assert.match(unspecifiedModules.rejectionReasons.join(' '), /attribute-missing:packageCounts:2/);
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
      accepted: 'ZOTAC Gaming GeForce RTX 4070 Ti Super 16GB Graphics Card',
      rejected: 'ZOTAC Gaming GeForce RTX 4070 Ti 12GB Graphics Card',
      reason: /gpuModels|capacities/,
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

  const printerIdentity = extractProductIdentity('Ender 3 S1 Plus 3D Printer');
  const buildPlate = evaluateRetailCandidate('Ender 3 S1 Plus PEI Flexi Steel Magnetic Build Plate 310 x 315mm', printerIdentity);
  assert.equal(buildPlate.accepted, false);
  assert.ok(buildPlate.rejectionReasons.includes('accessory-or-component'));
});

test('single-lens camera kits cannot inherit a dual-lens package price', () => {
  const identity = extractProductIdentity('Nikon D5300 18-55 VR II Kit Camera New In Box');
  const dual = evaluateRetailCandidate('Nikon D5300 Digital SLR Camera Dual Lens Kit', identity);
  assert.equal(dual.accepted, false);
  assert.ok(dual.rejectionReasons.includes('attribute-conflict:lensCount:1!=2'));
});

test('numeric-leading manufacturer models reject same-brand tool accessories', () => {
  const identity = extractProductIdentity('Bosch SDS-Max 14-Amp 1-9/16 Demolition Hammer 11316EVS BRAND NEW');
  assert.equal(identity.model, '11316EVS');
  const chisel = evaluateRetailCandidate('Bosch HS19R2PK 2 pc. SDS-max R-Tec Self-Sharpening Chisel Set', identity);
  assert.equal(chisel.accepted, false);
  assert.ok(chisel.rejectionReasons.some((reason) => /model-mismatch|accessory-or-component/.test(reason)));
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
    ['Tower Workstation Computers', 'Dell 2026 Edition Tower Desktop Computer Intel Core i3'],
    ['Custom Workstation Computer', 'Adamant Custom 16-Core Workstation Computer PC Ryzen 9'],
    ['Oculus VR Headset', 'Meta Quest 2 Advanced All-In-One VR Headset 128GB'],
    ['GeForce RTX GPUs', 'GIGABYTE GeForce RTX 3050 WINDFORCE OC 6GB Graphics Card'],
  ] as const;

  for (const [source, candidate] of vagueCases) {
    const identity = extractProductIdentity(source);
    assert.equal(hasSufficientRetailIdentity(identity), false, source);
    const evaluation = evaluateRetailCandidate(candidate, identity);
    assert.equal(evaluation.accepted, false, source);
    assert.ok(evaluation.rejectionReasons.includes('insufficient-source-identity'), source);
    assert.equal(matchAmazonCandidates([{
      asin: 'B0VAGUE001', title: candidate, price: 999, used: false, sponsored: false,
      url: 'https://www.amazon.com/dp/B0VAGUE001'
    }], identity), null, source);
  }
});

test('GPU matching rejects conflicting extra models and preserves exact manufacturer part numbers', () => {
  const identity = extractProductIdentity('PNY RTX 4600 900-5G132-1760-000 GPU');
  assert.equal(identity.model, '900-5G132-1760-000');
  assert.equal(
    evaluateRetailCandidate('PNY RTX 4600 900-5G132-1760-000 Professional GPU', identity).accepted,
    true
  );
  const contaminated = evaluateRetailCandidate(
    'PNY RTX 4600 900-5G132-1760-000 GPU PNY NVIDIA GeForce RTX 5050 Dual-Fan Graphics Card 8GB GDDR6',
    identity
  );
  assert.equal(contaminated.accepted, false);
  assert.match(contaminated.rejectionReasons.join(','), /gpuModels:unexpected-nvidia:rtx:5050:base/);
  assert.equal(matchAmazonCandidates([{
    asin: 'B0WRONG5050',
    title: 'PNY NVIDIA GeForce RTX 5050 Dual-Fan Graphics Card 8GB GDDR6',
    matchText: 'PNY RTX 4600 900-5G132-1760-000 GPU PNY NVIDIA GeForce RTX 5050 Dual-Fan Graphics Card 8GB GDDR6',
    price: 349.99,
    used: false,
    sponsored: false,
    url: 'https://www.amazon.com/dp/B0WRONG5050',
  }], identity), null);
});

test('less-specific duplicate GPU evidence does not reject the exact Ti Super variant', () => {
  const identity = extractProductIdentity('ZOTAC GeForce RTX 4070 Ti 16GB Graphics Card');
  const candidate = evaluateRetailCandidate(
    'ZOTAC GeForce RTX 4070 Ti Graphics Card ZOTAC GAMING GeForce RTX 4070 Ti SUPER 16GB GDDR6X',
    identity
  );
  assert.equal(candidate.accepted, true, candidate.rejectionReasons.join(','));
  const match = matchAmazonCandidates([{
    asin: 'B0EXACT4070',
    title: 'ZOTAC GAMING GeForce RTX 4070 Ti SUPER Trinity Black Edition 16GB GDDR6X',
    matchText: 'ZOTAC GAMING GeForce RTX 4070 Ti SUPER Trinity Black Edition 16GB GDDR6X GIGABYTE GeForce RTX 5070 Ti 16GB',
    price: 1359,
    used: false,
    sponsored: false,
    url: 'https://www.amazon.com/dp/B0EXACT4070',
  }], identity);
  assert.equal(match?.candidate.asin, 'B0EXACT4070');
});

test('replacement bowls and remotes cannot impersonate the primary appliance or stereo', () => {
  const processor = extractProductIdentity('Robot Coupe R2 3 Qt Food Processor');
  assert.equal(
    evaluateRetailCandidate('112204S Food Processor Gray Bowl 3 Qt Compatible with Robot Coupe R2', processor).accepted,
    false
  );
  const stereo = extractProductIdentity('Vtg Sony Component Stereo System w/ Remote');
  assert.equal(
    evaluateRetailCandidate('RM-AMU009 Replacement Remote Control fit for Sony Mini Hi-Fi Component Audio Stereo System', stereo).accepted,
    false
  );
  const remote = extractProductIdentity('Sony RM-AMU009 Replacement Remote Control');
  assert.equal(
    evaluateRetailCandidate('Sony RM-AMU009 Replacement Remote Control', remote).accepted,
    true
  );
});

test('exact-model documentation cannot impersonate the physical product', () => {
  const receiver = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const manual = evaluateRetailCandidate('Onkyo TX-SR304 Service Manual Digital PDF', receiver);
  assert.equal(manual.accepted, false);
  assert.ok(manual.rejectionReasons.includes('accessory-or-component'));
  assert.equal(evaluateRetailCandidate('Onkyo TX-SR304 AV Receiver Tested Working', receiver).accepted, true);
});

test('console editions, platform brands, and headset series stay distinct', () => {
  const playstation = extractProductIdentity('Sony PlayStation 5 Disc Console');
  assert.equal(evaluateRetailCandidate('Sony PlayStation 5 Disc Edition Console', playstation).accepted, true);
  assert.equal(evaluateRetailCandidate('Sony PlayStation 5 Digital Edition Console', playstation).accepted, false);

  const headset = extractProductIdentity('SteelSeries Arctis Nova 7 Wireless Xbox');
  assert.equal(evaluateRetailCandidate('SteelSeries Arctis Nova 7X Wireless Gaming Headset for Xbox', headset).accepted, true);
  assert.equal(evaluateRetailCandidate('SteelSeries Arctis Nova 7 Wireless Gaming Headset for Xbox Series X', headset).accepted, true);
  assert.equal(evaluateRetailCandidate('SteelSeries Arctis Nova 5X Wireless Gaming Headset for Xbox', headset).accepted, false);
  assert.equal(evaluateRetailCandidate('SteelSeries Arctis Nova Pro Wireless Headset', headset).accepted, false);
});

test('equivalent plus, ampersand, and and spellings preserve compound brands', () => {
  const identity = extractProductIdentity('Smith+Nephew Dyonics InteliJet Suction Supply Unit');
  assert.equal(evaluateRetailCandidate('Smith & Nephew Dyonics IntelliJet Suction Supply Unit', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Smith and Nephew Dyonics IntelliJet Suction Supply Unit', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Dyonics Power II Control Unit', identity).accepted, false);
});

test('trim kits and wall plates cannot impersonate the primary thermostat', () => {
  const identity = extractProductIdentity('Google Nest Thermostat (Charcoal, Model: GA02081-US)', '');
  const accessory = evaluateRetailCandidate(
    'Nest Thermostat Trim Kit - Wall Plate for Google Nest Thermostat 2020 (Fits GA01334-US, GA02082-US, GA02081-US)',
    identity,
  );
  assert.equal(accessory.accepted, false);
  assert.ok(accessory.rejectionReasons.includes('accessory-or-component'));
});

test('connector counts are hard product attributes', () => {
  const inverter = extractProductIdentity('POTEK 3000W Power Inverter 4 USB Black');
  assert.equal(
    evaluateRetailCandidate('POTEK 3000W Power Inverter with 4 USB Ports Black', inverter).accepted,
    true
  );
  assert.equal(
    evaluateRetailCandidate('POTEK 3000W Power Inverter with 4 AC Outlets and 2 USB Ports Black', inverter).accepted,
    false
  );
});

test('ordinary Amazon liquidation products do not require a model or a narrow product taxonomy', () => {
  const cases = [
    ['Mr. Coffee Mug Warmer for Coffee & Tea Black', 'Mr. Coffee Mug Warmer for Coffee and Tea, Black'],
    ['NERF Mega Ball 20 Outdoor Kickball Toy', 'NERF Mega Ball 20 Inch Outdoor Kickball Toy for Kids'],
    ['XUANGUO Woven Rope Baskets 3 Pack Dark Green', 'XUANGUO Woven Rope Storage Baskets, 3 Pack, Dark Green'],
    ['LISEN 15W MagSafe Car Mount Charger', 'LISEN 15W MagSafe Car Mount Charger for iPhone'],
    ['ErGear Dual Monitor Arm 13 32 VESA 100x100', 'ErGear Dual Monitor Arm for 13 to 32 Inch Screens VESA 100x100'],
    ['Toast Touchscreen POS System', 'Toast Flex Touchscreen POS System Terminal'],
    ['Keurig K-Compact Single-Serve Coffee Maker, New In Box', 'Keurig K-Compact Single-Serve K-Cup Pod Coffee Maker, Black'],
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

test('lot quantities embedded in titles require confirmation', () => {
  assert.equal(extractLotQuantityFromTitle('LOT OF 3: WESTERN DIGITAL 2 TB HARD DRIVES'), 3);
  assert.equal(extractLotQuantityFromTitle('(4) x SPORTS CARDS'), 4);
  assert.equal(extractLotQuantityFromTitle('Seagate Backup Plus Hub 8TB External Hard Drive Tested Qty 2'), 2);
  assert.equal(extractLotQuantityFromTitle('GE Dinamap Vital Signs Monitor 3 units'), 3);
  assert.equal(extractLotQuantityFromTitle('4K HDMI Cable 10 ft'), null);
  assert.equal(extractLotQuantityFromTitle('Seagate Backup Plus Hub 8TB External Hard Drive'), null);
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
  assert.equal(
    detectMixedLot('GeForce RTX GPUs', 'Lot of (2) consisting of: GeForce RTX 3060 Ti; GeForce RTX 4070').mixed,
    true
  );
  assert.equal(detectMixedLot('PNY RTX 4500 Ada', 'Lot of (1) consisting of: PNY RTX 4500 Ada').mixed, false);
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
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B0BLTCBSQF">
      <img alt="SteelSeries Arctis Nova 7X Wireless Headset — 38Hr Battery — Xbox..." />
      <h2><span>SteelSeries Arctis Nova 7X Wireless Headset - Black (Renewed)</span></h2>
      <span class="a-price"><span class="a-offscreen">$99.99</span></span>
    </div>`);
  assert.match(candidates[0]?.title || '', /Renewed/);
  assert.equal(candidates[0]?.used, true);
});

test('Amazon parser ignores a brand-only first heading and preserves the full product identity', () => {
  const html = `
    <div data-asin="B0WEP982VI">
      <h2><span>WEP</span></h2>
      <a href="/WEP-982-VI-Cordless-Soldering-Station/dp/B0WEP982VI">
        <img class="s-image" alt="WEP 982-VI 1 Cordless Soldering Station for Dewalt 20V Battery" />
      </a>
      <div data-cy="title-recipe"><span>982-VI 1 Cordless Soldering Station for Dewalt 20V Battery</span></div>
      <span class="a-price"><span class="a-offscreen">$59.99</span></span>
    </div>`;
  const candidate = parseAmazonDocumentCandidates(html)[0];
  assert.match(candidate?.title || '', /982-VI.*Cordless Soldering Station/i);
  assert.equal(candidate?.price, 59.99);
  const identity = extractProductIdentity('WEP 982-VI Cordless Soldering Station');
  assert.equal(matchAmazonCandidates(candidate ? [candidate] : [], identity)?.candidate.price, 59.99);

  const legacy = parseAmazonSearchHtml(html)[0];
  assert.match(legacy?.title || '', /982-VI.*Cordless Soldering Station/i);
});

test('RTX 4070 Ti 16GB auction shorthand resolves to the uniquely matching Ti Super variant', () => {
  const identity = extractProductIdentity('AV - ZOTAC GEFORCE RTX4070 Ti 16GB GRAPHICS CARD');
  assert.deepEqual(identity.discriminators.gpuModels, ['nvidia:rtx:4070:ti-super']);
  const candidateAttributes = extractProductDiscriminators('ZOTAC GAMING GeForce RTX 4070 Ti 16GB GDDR6X');
  assert.deepEqual(candidateAttributes.capacities, ['16gb']);
  assert.deepEqual(candidateAttributes.gpuModels, ['nvidia:rtx:4070:ti-super']);
  assert.match(identity.query, /rtx4070 ti super/i);
  assert.equal(evaluateRetailCandidate('ZOTAC Gaming GeForce RTX 4070 Ti SUPER 16GB GDDR6X Graphics Card', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('ZOTAC Gaming GeForce RTX 4070 Ti 12GB GDDR6X Graphics Card', identity).accepted, false);
  assert.match(
    evaluateRetailCandidate('ASUS TUF Gaming GeForce RTX 4070 Ti SUPER 16GB GDDR6X Graphics Card', identity).rejectionReasons.join(','),
    /brand-mismatch:zotac/
  );
});

test('identity extraction handles per-item markers and manufacturer model suffixes', () => {
  const inkbird = extractProductIdentity('{each} Inkbird ISV-200W Precision Cooker');
  assert.equal(inkbird.brand, 'Inkbird');
  assert.equal(inkbird.query, 'inkbird isv-200w precision cooker');
  assert.equal(evaluateRetailCandidate('Inkbird 2.4G WiFi Sous Vide Cooker ISV-200W 1000W', inkbird).accepted, true);

  const breville = extractProductIdentity('Breville CSV700 PSS HydroPro Immersion Circulator');
  assert.equal(breville.model, 'CSV700PSS');
  assert.equal(evaluateRetailCandidate('Breville Commercial CSV700PSS HydroPro Sous Vide Immersion Circulator', breville).accepted, true);
  assert.equal(evaluateRetailCandidate('Breville Commercial CSV750PSS HydroPro Plus Sous Vide Immersion Circulator', breville).accepted, false);
});

test('brand matching is accent-insensitive without weakening model identity', () => {
  const identity = extractProductIdentity('Mahlkönig X54 Coffee Grinder');
  assert.equal(evaluateRetailCandidate('Mahlkonig X54 Allround Electric Coffee Grinder', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Mahlkonig E64 Electric Coffee Grinder', identity).accepted, false);
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

test('Amazon detail enrichment can prove a model omitted from the search card', () => {
  const identity = extractProductIdentity('Google Nest Thermostat Charcoal Model GA02081-US');
  const source = {
    asin: 'B08HRPDBFF', title: 'Google Nest Thermostat - Smart Thermostat for Home, Charcoal',
    matchText: 'Google Nest Thermostat - Smart Thermostat for Home, Charcoal', price: 89.99,
    used: false, sponsored: false, url: 'https://www.amazon.com/dp/B08HRPDBFF',
  };
  assert.equal(matchAmazonCandidates([source], identity), null);
  const enriched = enrichAmazonCandidateFromDetail(source, `
    <span id="productTitle">Google Nest Thermostat - Smart Thermostat for Home, Charcoal</span>
    <div id="detailBullets_feature_div">Item model number: GA02081-US</div>
  `);
  const detailEvaluation = evaluateRetailCandidate(enriched.matchText, identity);
  assert.equal(detailEvaluation.accepted, true, JSON.stringify(detailEvaluation));
  assert.equal(matchAmazonCandidates([enriched], identity)?.candidate.asin, 'B08HRPDBFF');
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

test('Amazon matching keeps bundled accessories from disabling primary-product guards', () => {
  const earbuds = extractProductIdentity('Sony WF-1000XM5 Earbuds with Charging Case');
  const caseListing = evaluateRetailCandidate('Spigen Case for Sony WF-1000XM5 Earbuds', earbuds);
  assert.equal(caseListing.accepted, false);
  assert.match(caseListing.rejectionReasons.join(' '), /accessory-or-component/);

  const tool = extractProductIdentity('DeWalt DCF887 20V Impact Driver');
  const battery = evaluateRetailCandidate('DeWalt DCF887 20V Replacement Battery for Impact Driver', tool);
  assert.equal(battery.accepted, false);
  assert.match(battery.rejectionReasons.join(' '), /accessory-or-component/);

  const modelBrandedBattery = evaluateRetailCandidate('DeWalt DCF887 20V Battery', tool);
  assert.equal(modelBrandedBattery.accepted, false);
  assert.match(modelBrandedBattery.rejectionReasons.join(' '), /accessory-or-component/);

  const batteryPoweredTool = extractProductIdentity('DeWalt DCD791 Battery Powered Cordless Drill');
  const replacementPack = evaluateRetailCandidate('DeWalt DCD791 Replacement Battery Pack', batteryPoweredTool);
  assert.equal(replacementPack.accepted, false);
  assert.match(replacementPack.rejectionReasons.join(' '), /accessory-or-component/);
});

test('Amazon matching uses a relevant used offer only when the strongest band has no new offer', () => {
  const identity = extractProductIdentity('PlayStation 5 Pro Console');
  const used = {
    asin: 'B0USEDPS5P', title: 'PlayStation 5 Pro with 2TB SSD Console (Renewed)', price: 699.99,
    used: true, sponsored: false, url: 'https://www.amazon.com/dp/B0USEDPS5P'
  };
  assert.equal(matchAmazonCandidates([used], identity)?.candidate.asin, used.asin);

  const fresh = {
    asin: 'B0NEWPS5PR', title: 'PlayStation 5 Pro with 2TB SSD Console', price: 749.99,
    used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0NEWPS5PR'
  };
  assert.equal(matchAmazonCandidates([used, fresh], identity)?.candidate.asin, fresh.asin);
});

test('complete desktop systems outrank incidental RAM, storage, and CPU specifications', () => {
  assert.equal(detectProductKind('Dell OptiPlex 3070 Desktop PC Intel i5 16GB RAM 500GB SSD'), 'desktop');
  assert.equal(detectProductKind('Dell OptiPlex 7060 Micro PC Intel i7 32GB DDR4 1TB SSD'), 'desktop');
  assert.equal(detectProductKind('Crucial 32GB DDR4 Desktop Memory Kit'), 'memory');

  const identity = extractProductIdentity('Dell OptiPlex Compact Desktop');
  const candidate = 'Dell OptiPlex 3070 Micro PC Intel i5-9500 16GB RAM 500GB SSD Mini Desktop Computer';
  assert.equal(evaluateRetailCandidate(candidate, identity).accepted, true);
});

test('standardized GPU fallback accepts only the exact chip and VRAM across board partners', () => {
  const identity = extractProductIdentity('ZOTAC GeForce RTX 4060 8GB Graphics Card');
  assert.equal(buildAmazonFallbackQuery(identity), 'geforce rtx 4060 8gb graphics card');
  const match = matchAmazonCandidates([
    { asin: 'B0RTX50600', title: 'ZOTAC GeForce RTX 5060 8GB Graphics Card', price: 399, used: false, sponsored: false, url: '' },
    { asin: 'B0RTX406TI', title: 'ZOTAC GeForce RTX 4060 Ti 8GB Graphics Card', price: 449, used: false, sponsored: false, url: '' },
    { asin: 'B0RTX40608', title: 'Gigabyte GeForce RTX 4060 8GB Graphics Card', price: 479, used: false, sponsored: false, url: '' },
  ], identity);
  assert.equal(match?.candidate.asin, 'B0RTX40608');
  assert.equal(match?.referenceKind, 'equivalent');

  const partNumbered = extractProductIdentity('ZOTAC GeForce RTX 4060 8GB ZT-D40600H-10M Graphics Card');
  assert.equal(buildAmazonFallbackQuery(partNumbered), null);
  assert.equal(matchAmazonCandidates([{
    asin: 'B0RTX40608', title: 'Gigabyte GeForce RTX 4060 8GB Graphics Card', price: 479,
    used: false, sponsored: false, url: ''
  }], partNumbered), null);
});

test('Amazon detail enrichment accepts only failures that richer item evidence can resolve', () => {
  assert.equal(canAmazonDetailEnrichmentResolve(['identity-code-missing:abc']), true);
  assert.equal(canAmazonDetailEnrichmentResolve(['identity-missing:isbn:9780262033848']), true);
  assert.equal(canAmazonDetailEnrichmentResolve(['bundle-component-missing:charging-cable']), true);
  assert.equal(canAmazonDetailEnrichmentResolve(['accessory-or-component']), false);
  assert.equal(canAmazonDetailEnrichmentResolve(['brand-mismatch:sony']), false);
  assert.equal(canAmazonDetailEnrichmentResolve(['identity-conflict:isbn:9780262033848']), false);
});

test('feature specifications cannot outrank a real model token', () => {
  const mouse = extractProductIdentity('Logitech M100 Optical Mouse 1200DPI');
  assert.equal(mouse.model, 'M100');
  assert.equal(evaluateRetailCandidate('Logitech M100 USB Optical Mouse', mouse).accepted, true);

  const appliance = extractProductIdentity('Ninja X500 3-in-1 Food Processor');
  assert.equal(appliance.model, 'X500');
});

test('marketing features after with are not mandatory bundle components', () => {
  const headphones = extractProductIdentity('Sony WH-1000XM5 Headphones with Bluetooth and Alexa Voice Control');
  const candidate = evaluateRetailCandidate('Sony WH-1000XM5 Wireless Noise Canceling Headphones', headphones);
  assert.equal(candidate.accepted, true, JSON.stringify(candidate));
  assert.doesNotMatch(candidate.rejectionReasons.join(' '), /bundle-component-missing/);
});

test('strict book and collectible identities tolerate equivalent marketplace formatting', () => {
  const book = extractProductIdentity('Introduction to Algorithms ISBN 9780262033848 Third Edition');
  assert.equal(
    evaluateRetailCandidate('Introduction to Algorithms 978-0-262-03384-8 3rd Edition', book).accepted,
    true,
  );

  const card = extractProductIdentity('1986 Topps #161 Jerry Rice PSA 9 Rookie Card');
  assert.equal(evaluateRetailCandidate('1986 Topps No. 161 Jerry Rice Rookie Card PSA 9', card).accepted, true);

  const coin = extractProductIdentity('1881-S Morgan Dollar PCGS MS64');
  assert.equal(evaluateRetailCandidate('1881 S Morgan Silver Dollar PCGS MS 64', coin).accepted, true);
});

test('truncated title recovery requires ordered whole-token agreement', () => {
  const unrelated = extractProductIdentity({
    title: 'GE...',
    description: 'Large antique oak table with carved legs',
  });
  assert.doesNotMatch(unrelated.query, /large|antique|table/);

  const recovered = extractProductIdentity({
    title: 'GE Dinamap Vital...',
    description: 'GE Dinamap Vital Signs Monitor Model 8100',
  });
  assert.match(recovered.query, /^ge dinamap vital signs monitor/);
});

test('Amazon matching requires identity-defining capacities and lens kits', () => {
  const phone = extractProductIdentity('Apple iPhone 15 Pro 256GB');
  const missingCapacity = evaluateRetailCandidate('Apple iPhone 15 Pro Smartphone', phone);
  assert.equal(missingCapacity.accepted, false);
  assert.match(missingCapacity.rejectionReasons.join(' '), /attribute-missing:capacities:256gb/);

  const camera = extractProductIdentity('Nikon D5300 18-55mm Camera Kit');
  const bodyOnly = evaluateRetailCandidate('Nikon D5300 Camera Body Only', camera);
  assert.equal(bodyOnly.accepted, false);
  assert.match(bodyOnly.rejectionReasons.join(' '), /attribute-missing:lensRanges:18-55mm/);
});

test('Amazon visible-title conflicts cannot be hidden by contaminated match text', () => {
  const cases = [
    {
      source: 'Red JBL Endurance Peak Wireless Sport Headphones',
      title: 'Sony MDR-XB50AP Extra Bass In-Ear Headphones',
      matchText: 'Red JBL Endurance Peak Wireless Sport Headphones Sony MDR-XB50AP Extra Bass In-Ear Headphones',
    },
    {
      source: 'KitchenAid KSM3311 Artisan Mini Stand Mixer',
      title: 'Dust Cover Compatible with KitchenAid KSM3311 Stand Mixer',
      matchText: 'KitchenAid KSM3311 Artisan Mini Stand Mixer Dust Cover Compatible with KitchenAid KSM3311',
    },
    {
      source: 'Keurig K-Slim Single Serve Coffee Maker',
      title: 'Descaler Cleaning Tablets Compatible with Keurig K-Slim Coffee Makers',
      matchText: 'Keurig K-Slim Single Serve Coffee Maker Descaler Cleaning Tablets Compatible with Keurig K-Slim',
    },
    {
      source: 'Breville BOV845 Smart Oven Pro',
      title: 'Nonstick Pizza Pan Compatible with Breville BOV845 Smart Oven Pro',
      matchText: 'Breville BOV845 Smart Oven Pro Nonstick Pizza Pan Compatible with Breville BOV845',
    },
  ] as const;
  for (const item of cases) {
    const identity = extractProductIdentity(item.source);
    assert.equal(matchAmazonCandidates([{
      asin: 'B0BADMATCH1', title: item.title, matchText: item.matchText, price: 19.99,
      used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0BADMATCH1',
    }], identity), null, item.source);
  }
});

test('Amazon matching treats cubic capacity, weight limits, and canonical brands as hard evidence', () => {
  const safe = extractProductIdentity('Amazon Basics Steel Home Security Safe with Keypad, 1.52 Cubic Feet');
  assert.equal(
    evaluateRetailCandidate('Amazon Basics Steel Home Security Safe with Keypad, 1.2 Cubic Feet', safe).accepted,
    false,
  );

  const scale = extractProductIdentity('Amazon Basics Luggage Scale, 65 lb Max');
  assert.equal(
    evaluateRetailCandidate('Amazon Basics Digital Kitchen Scale, 11 lb Max', scale).accepted,
    false,
  );

  const patioCover = extractProductIdentity('Amazon Basics Patio Chair Cover');
  assert.equal(
    evaluateRetailCandidate('Easy-Going Waterproof Patio Chair Cover', patioCover).accepted,
    false,
  );
});

test('Amazon matching accepts an exact accessory when the auction lot is itself that accessory', () => {
  const product = extractProductIdentity('JSAUX 4ft Aux to RCA Male Male Y Cord Grey');
  const result = evaluateRetailCandidate('RCA to 3.5mm Cable 4ft by JSAUX, Aux to RCA Male Y Splitter Grey', product);
  assert.equal(result.accepted, true);
  assert.doesNotMatch(result.rejectionReasons.join(' '), /accessory-or-component/);
});

test('primary products reject belts and vague brand-only identities', () => {
  const turntable = extractProductIdentity('Yamaha Full Automatic Turntable Model YP-B4');
  assert.equal(evaluateRetailCandidate('Turntable Belt for Yamaha Model YP-B4', turntable).accepted, false);

  const vagueSpeaker = extractProductIdentity('JBL Portable Speaker');
  assert.equal(hasSufficientRetailIdentity(vagueSpeaker), false);
  assert.equal(evaluateRetailCandidate('JBL Go 4 Portable Bluetooth Speaker', vagueSpeaker).accepted, false);
});

test('separate amplifier and tuner titles require mixed-component review', () => {
  const result = detectMixedLot('Yamaha Natural Sound Direct DC Stereo Amp, Yamaha Natural Sound Stereo Tuner');
  assert.equal(result.mixed, true);
  assert.ok(result.reasons.includes('separate audio components'));
});

test('explicit catalog model numbers reject same-brand but different Amazon products', () => {
  const cases = [
    {
      source: '1991 Nutcracker Musical Ballerina Barbie (model 5472)',
      model: '5472',
      wrong: 'Barbie Signature 2025 Holiday Doll, Model JBJ96',
    },
    {
      source: 'Melissa & Doug Fold & Go Fire Station (#1847)',
      model: '1847',
      wrong: 'Melissa & Doug Fire Chief Role Play Costume Set',
    },
    {
      source: 'Vintage Rivarossi Model Train 2409 - Item 209',
      model: '2409',
      wrong: 'Rivarossi HR2888 HO Scale Steam Locomotive',
    },
  ] as const;
  for (const item of cases) {
    const identity = extractProductIdentity(item.source);
    assert.equal(identity.model, item.model, item.source);
    assert.equal(evaluateRetailCandidate(item.wrong, identity).accepted, false, item.source);
  }
});

test('AeroGarden systems reject consumable plant-food listings', () => {
  const identity = extractProductIdentity('AeroGarden Harvest Indoor Garden System');
  const candidate = 'AeroGarden Liquid Plant Food Nutrients for Indoor Gardens, 3 oz';
  assert.equal(evaluateRetailCandidate(candidate, identity).accepted, false);
});

test('same-brand and same-size evidence cannot substitute for a different named product', () => {
  const identity = extractProductIdentity('EuroGraphics Manarola, Cinque-Terre - Mediterranean Oasis, Italy 1000-Piece Jigsaw Puzzle');
  const candidate = 'EuroGraphics Map of Europe Puzzle (1000 Piece)';
  const result = evaluateRetailCandidate(candidate, identity);
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.some((reason) => reason.startsWith('weak-title-overlap:')));
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

test('hash-prefixed numeric models remain mandatory after Amazon detail enrichment', () => {
  const product = extractProductIdentity('Oster 2-Slice Toaster #6325. In Box, Not Tested, Used');
  assert.equal(product.model, '6325');

  const candidate = enrichAmazonCandidateFromDetail({
    asin: 'B00F5NUOH6',
    title: 'Oster 2 Slice Bread Bagel Toaster Metallic Grey',
    matchText: 'Oster 2 Slice Bread Bagel Toaster Metallic Grey',
    price: 39.87,
    used: false,
    sponsored: false,
    url: 'https://www.amazon.com/dp/B00F5NUOH6',
  }, `
    <span id="productTitle">Oster 2 Slice Bread Bagel Toaster Metallic Grey</span>
    <div id="feature-bullets">Extra-wide slots and seven shade settings.</div>
  `);

  assert.equal(evaluateAmazonCandidateEvidence(candidate, product).accepted, false);
  assert.match(evaluateAmazonCandidateEvidence(candidate, product).rejectionReasons.join(','), /model-mismatch:6325/);
});

test('family-number-suffix models reject a larger variant in the same product series', () => {
  const product = extractProductIdentity('KEF Kube Series Powered Subwoofer - Kube 8 MIE');
  assert.equal(product.model, 'Kube8MIE');
  assert.equal(evaluateRetailCandidate('KEF Kube 8 MIE 8 Inch Powered Subwoofer', product).accepted, true);
  assert.equal(evaluateRetailCandidate('KEF Kube 12 MIE 12 Inch Powered Subwoofer', product).accepted, false);
  assert.match(
    evaluateRetailCandidate('KEF Kube 12 MIE 12 Inch Powered Subwoofer', product).rejectionReasons.join(','),
    /model-mismatch:Kube8MIE/,
  );
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
