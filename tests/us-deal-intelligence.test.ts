import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amazonIndicator,
  assessCondition,
  assessLotCondition,
  buildAccountVerdict,
  buildProductResearchQuery,
  buildConditionPresentation,
  buildRetailIndicatorTooltip,
  buildRetailLinks,
  buildRetailSearchPresentation,
  canAmazonDetailEnrichmentResolve,
  calculateAllInCost,
  chooseAmazonMatch,
  detectComparisonCurrency,
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
  looksLikeModel,
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
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';

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

test('condition presentation ignores shipping-policy untested text but preserves lot warnings', () => {
  const shippingAssessment = assessLotCondition({
    description: 'Condition: Good\nShipping Policy: Items are untested before shipping.',
  });
  assert.equal(shippingAssessment.cautions.includes('untested'), false);
  const shippingPolicy = buildConditionPresentation(shippingAssessment);
  assert.deepEqual({ label: shippingPolicy.label, tone: shippingPolicy.tone }, { label: 'Good', tone: 'good' });

  const lotWarning = buildConditionPresentation(assessLotCondition({
    description: 'Condition: Good\nNotes: Item is untested before listing.',
  }));
  assert.deepEqual({ label: lotWarning.label, tone: lotWarning.tone }, { label: 'Good · untested', tone: 'warning' });
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

test('provisional costs keep reference comparisons explicit without claiming complete costs', () => {
  const title = buildRetailIndicatorTooltip({
    providerName: 'Amazon', indicator: amazonIndicator(16.375, 42.98),
    allIn: 16.375, marketPrice: 42.98, evidenceSource: 'Exact product',
    costLabel: 'Provisional bid cost', costCaveat: 'Excludes unverified tax and shipping.',
  });
  assert.match(title, /Provisional bid cost \$16\.38 is 38%/);
  assert.match(title, /provisional bid cost is below 50%/);
  assert.match(title, /Excludes unverified tax and shipping/);
  assert.doesNotMatch(title, /All-in|all-in/);
  const noCost = buildRetailIndicatorTooltip({
    providerName: 'Amazon', indicator: amazonIndicator(null, 42.98),
    allIn: null, marketPrice: 42.98, evidenceSource: 'Exact product',
  });
  assert.match(noCost, /\$42\.98 reference/);
  assert.match(noCost, /Bid-cost comparison is unavailable/);
  assert.doesNotMatch(noCost, /no saved or verified value/i);
});

test('HiBid no-UPC sentinel is metadata, not a product identity', () => {
  const description = 'Condition: New(other)\nDamaged?: Unknown\nIn Packaging?: Yes\nAssembly Required?: No\nUPC: NOUPC{20203109}\n\nEnhance your outdoor space with the VEVOR Gazebo Netting Replacement.';
  const parsed = parseStructuredDescription(description);
  assert.equal(parsed.fields.upc, 'NOUPC{20203109}');
  assert.doesNotMatch(parsed.freeText, /NOUPC/);
  const identity = extractProductIdentity('VEVOR Portable Hand Truck', description);
  assert.match(identity.query, /vevor portable hand truck/i);
  assert.doesNotMatch(identity.query, /NOUPC|gazebo/i);
});

test('unverified costs retain saved ceiling warnings without recommending a profitable raise', () => {
  const input = { status: 'Outbid', nextHammer: 90, maxBid: 100, allIn: 120, retail: 200, costsProvisional: true };
  const below = buildAccountVerdict(input);
  assert.equal(below.kind, 'manual');
  assert.match(below.advice, /no profit or raise recommendation/);
  for (const nextHammer of [100, 110]) {
    const ceiling = buildAccountVerdict({ ...input, nextHammer });
    assert.equal(ceiling.kind, 'at_ceiling');
    assert.match(ceiling.advice, /saved \$100\.00 hammer ceiling/);
    assert.match(ceiling.advice, /costs remain unverified/);
  }
  assert.equal(buildAccountVerdict({ ...input, status: 'Winning' }).kind, 'manual');
  assert.equal(buildAccountVerdict({ ...input, partsOnly: true }).kind, 'parts_only');
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

test('unknown structured condition prose remains scannable without auction boilerplate', () => {
  const parsed = parseStructuredDescription('Printer Time: 565 hours. calibration tested good. calibrated; needs a new nozzle.\nShipping: Not working');
  assert.equal(parsed.fields['printer time'], '565 hours. calibration tested good. calibrated; needs a new nozzle.');
  assert.match(parsed.freeText, /needs a new nozzle/i);
  const assessment = assessCondition('Printer Time: 565 hours. calibration tested good. calibrated; needs a new nozzle.\nShipping: Not working');
  assert.equal(assessment.partsOnly, false);
  assert.ok(assessment.cautions.includes('needs replacement part'));
  assert.ok(!assessment.cautions.includes('stated not working'));
  assert.equal(assessCondition('Printer Time: 565 hours. Does not need a new nozzle.').cautions.includes('needs replacement part'), false);
});

test('component failures do not become whole-item parts-only when operation is affirmed', () => {
  const partial = assessCondition('Troy-Bilt 21-inch Self-Propelled Push Mower - Owner Stated the Self-Propelled Function Does NOT Work Correctly, but the Mower Still Runs & Mows');
  assert.equal(partial.partsOnly, false);
  assert.ok(partial.cautions.includes('partial component defect'));

  assert.equal(assessCondition('The mower does not work and does not mow.').partsOnly, true);
  assert.equal(assessCondition('Condition: FOR PARTS ONLY\nFunctional: No').partsOnly, true);
  assert.equal(assessCondition('The self-propelled function does not work, but the mower still runs and mows.').partsOnly, false);

  const independent = assessCondition('Self-propelled function does not work correctly, but mower runs. The engine does not work / item does not power on.');
  assert.equal(independent.partsOnly, true);
  assert.ok(independent.partsReasons.includes('does not work / power on'));
  assert.equal(assessCondition('The printer does not work. It never runs.').partsOnly, true);
  assert.equal(assessCondition('The printer does not work. The fan still runs.').partsOnly, true);
  assert.equal(assessCondition('Self-propelled function does not work correctly, but the mower never runs or mows.').partsOnly, true);
});

test('condition boilerplate suffixes stay out of fault evidence while fields remain available', () => {
  for (const description of [
    'Condition: Used\nAuction Terms: Items may be damaged or broken. All sales final.',
    'Shipping Policy: No returns for damaged items.',
  ]) {
    const parsed = parseStructuredDescription(description);
    const assessment = assessCondition(description);
    assert.equal(assessment.partsOnly, false, description);
    assert.ok(Object.keys(parsed.fields).some((key) => /(?:auction terms|shipping policy)/i.test(key)), description);
  }
  const mixed = detectMixedLot('Assorted electronics bundle', 'Mixed components: receiver; headphones');
  assert.deepEqual(mixed.components, ['Assorted electronics bundle']);
});

test('mixed-component metadata preserves named values but not manual-review narrative', () => {
  const named = detectMixedLot(
    'Assorted electronics bundle',
    'Mixed components: Onkyo TX-SR304 receiver; Sony WH-1000XM4 headphones',
  );
  assert.deepEqual(named.components, [
    'Assorted electronics bundle',
    'Onkyo TX-SR304 receiver',
    'Sony WH-1000XM4 headphones',
  ]);

  const narrative = detectMixedLot('Assorted electronics bundle', 'Mixed components: requires manual review of photos.');
  assert.deepEqual(narrative.components, ['Assorted electronics bundle']);

  const lowercase = detectMixedLot(
    'Assorted electronics bundle',
    'Mixed components: onkyo tx-sr304 receiver; sony wh-1000xm4 headphones',
  );
  assert.deepEqual(lowercase.components, [
    'Assorted electronics bundle',
    'onkyo tx-sr304 receiver',
    'sony wh-1000xm4 headphones',
  ]);

  const mixedNarrative = detectMixedLot(
    'Assorted electronics bundle',
    'Mixed components: Onkyo TX-SR304 receiver; remaining components require manual review.',
  );
  assert.deepEqual(mixedNarrative.components, ['Assorted electronics bundle', 'Onkyo TX-SR304 receiver']);

  const photos = detectMixedLot('Assorted electronics bundle', 'Mixed components: See photos for details.');
  assert.deepEqual(photos.components, ['Assorted electronics bundle']);

  const descriptive = detectMixedLot('Assorted decor bundle', 'Mixed components: red bowl; blue vase');
  assert.deepEqual(descriptive.components, ['Assorted decor bundle', 'red bowl', 'blue vase']);

  const auctionNinjaWeatherNotice = detectMixedLot(
    '24 Vintage LP Albums - Rock/Folk/Blues - Stevie Nicks, Monkees, John Lennon, Spiro Gyra, Etc',
    'DUE TO POTENTIAL NOR\u2019EASTER RAIN & WIND CONDITIONS, PICKUP DATES ARE NOW OCTOBER 3 (MA) AND OCTOBER 4 (CT).\n24 Vintage LP Albums - Mostly Rock, Blues, and Folk. Includes albums from Stevie Nicks, The Monkees, John Lennon, Spiro Gyra, Linda Ronstadt, Chuck Mangione, and others. In Good Condition.',
  );
  assert.equal(auctionNinjaWeatherNotice.mixed, true);
  assert.ok(auctionNinjaWeatherNotice.components.some((component) => /Stevie Nicks/i.test(component)));
  assert.ok(!auctionNinjaWeatherNotice.components.some((component) => /pickup dates|nor\u2019?easter|rain.*wind/i.test(component)));

  const legitimateMixedDescription = detectMixedLot(
    'Assorted stereo components',
    'Mixed components: Onkyo TX-SR304 receiver; Sony WH-1000XM4 headphones. Local pickup only.',
  );
  assert.deepEqual(legitimateMixedDescription.components, ['Assorted stereo components', 'Onkyo TX-SR304 receiver', 'Sony WH-1000XM4 headphones']);

  const inlineNotice = detectMixedLot(
    'Assorted stereo components',
    'Onkyo TX-SR304 receiver and Sony WH-1000XM4 headphones. Pickup dates are now October 4. Yamaha CD player included.',
  );
  assert.ok(inlineNotice.components.some((component) => /Onkyo TX-SR304/i.test(component)));
  assert.ok(inlineNotice.components.some((component) => /Yamaha CD player/i.test(component)));
  assert.ok(!inlineNotice.components.some((component) => /Pickup dates/i.test(component)));
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

test('research query removes AuctionNinja price and marketing tails without losing mixer identity', () => {
  const title = 'Peavey XR696F 8-channel, 1,200-watt Portable Powered Mixer - Live Shows / Rehearsals ($900)';
  const identity = extractProductIdentity(title);
  assert.equal(identity.model, 'XR696F');
  assert.equal(identity.query, 'peavey xr696f 8-channel 1200-watt portable powered mixer');
  assert.doesNotMatch(identity.query, /live|shows|rehearsals|900/);
});

test('research query controls preserve meaningful parentheticals and model-less suffixes', () => {
  assert.equal(buildProductResearchQuery('Widget Pro (1200W Version) Portable Mixer'), 'widget pro 1200w version portable mixer');
  assert.equal(buildProductResearchQuery('Sony Wireless Headphones - Studio Monitoring'), 'sony wireless headphones studio monitoring');
  assert.equal(buildProductResearchQuery("Vintage Carvin Pro Bass 150 Amplifier Head - 1980's"), 'vintage carvin pro bass 150 amplifier head 1980s');
  assert.equal(buildProductResearchQuery('Vintage stoneware from the 1970’s'), 'vintage stoneware from the 1970s');
  assert.equal(buildProductResearchQuery('Carhartt Long-Sleeve Shirt Size S'), 'carhartt long-sleeve shirt size s');
});

test('research query strips currency at either boundary and collapses duplicated titles', () => {
  assert.equal(buildProductResearchQuery('$900 Peavey XR696F Mixer'), 'peavey xr696f mixer');
  assert.equal(buildProductResearchQuery('Peavey XR696F Mixer ($900)'), 'peavey xr696f mixer');
  assert.equal(buildProductResearchQuery('Peavey XR696F Mixer Peavey XR696F Mixer'), 'peavey xr696f mixer');
});

test('collectible deck descriptions recover only known named variants', () => {
  const title = '$57 MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-';
  const description = (variant: string) => [variant, 'Condition: New', 'UPC: 195166205052'].join('\n');
  const host = extractProductIdentity({ title, description: description('The Host Of Mordor') });
  const riders = extractProductIdentity({ title, description: description('RIDERS OF ROHAN') });
  const typo = extractProductIdentity({ title, description: description('EVLVEN COUNCIL') });

  assert.notEqual(host.query, riders.query);
  assert.match(host.query, /the host of mordor/);
  assert.match(riders.query, /riders of rohan/);
  assert.match(typo.query, /elven council/);
  assert.doesNotMatch(typo.query, /evlven council/);

  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor', host).accepted,
    true,
  );
  const wrongDeck = evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck Riders of Rohan', host);
  assert.equal(wrongDeck.accepted, false);
  assert.match(wrongDeck.rejectionReasons.join(','), /variantLabels:named-deck:the host of mordor/);
  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck ELVEN COUNCIL', typo).accepted,
    true,
  );
});

test('captured Commander Deck lots require one positive exact named-deck candidate', () => {
  const source = extractProductIdentity({
    title: '$57 MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-',
    description: 'The Host of Mordor\nLot 323200524\nCondition: New\nUPC: 195166205052',
  });
  assert.deepEqual(source.discriminators.variantLabels, ['named-deck:the host of mordor']);

  for (const candidate of [
    'MTG LOTR Tales of Middle Earth Commander Deck',
    'MTG LOTR Tales of Middle Earth Commander Deck Food and Fellowship',
    'MTG LOTR Tales of Middle Earth Commander Deck not The Host of Mordor',
    'MTG LOTR Tales of Middle Earth Commander Deck Riders of Rohan not The Host of Mordor',
    'MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor and Riders of Rohan',
  ]) {
    const result = evaluateRetailCandidate(candidate, source);
    assert.equal(result.accepted, false, `${candidate}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(','), /variantLabels:named-deck:the host of mordor/);
  }

  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor', source).accepted,
    true,
  );
  assert.equal(
    scoreRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck Riders of Rohan', source),
    0,
  );
  assert.equal(
    scoreRetailCandidate('Magic The Gathering Commander Deck Draconic Destruction', source),
    0,
  );
  const fallback = evaluateAmazonCandidateEvidence({
    asin: 'B0NAMEDDECK',
    title: 'MTG LOTR Tales of Middle Earth Commander Deck Riders of Rohan',
    matchText: 'MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor',
    price: 59.99,
    used: false,
    sponsored: false,
    url: 'https://www.amazon.com/dp/B0NAMEDDECK',
    detailEnriched: true,
  }, source);
  assert.equal(fallback.accepted, false, JSON.stringify(fallback));
});

test('the LOTR deck guard does not reject an unrelated exact Commander deck', () => {
  const source = extractProductIdentity('Magic The Gathering Commander Deck Draconic Destruction');
  const exact = evaluateRetailCandidate('Magic The Gathering Commander Deck Draconic Destruction', source);
  assert.equal(exact.accepted, true, JSON.stringify(exact));
  assert.doesNotMatch(exact.rejectionReasons.join(','), /variantLabels:named-deck/);
});

test('LOTR abbreviation still recognizes an exact named Commander deck', () => {
  const title = 'LOTR Commander Deck The Host of Mordor';
  const source = extractProductIdentity(title);
  assert.deepEqual(source.discriminators.variantLabels, ['named-deck:the host of mordor']);
  const exact = evaluateRetailCandidate(title, source);
  assert.equal(exact.accepted, true, JSON.stringify(exact));
});

test('Food and Fellowship uses narrow and/& equivalence, while unknown lots stay unresolved', () => {
  const food = extractProductIdentity({
    title: 'MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-',
    description: 'Food and Fellowship\nCondition: New\nUPC: 195166205052',
  });
  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck Food & Fellowship', food).accepted,
    true,
  );
  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor', food).accepted,
    false,
  );

  const unknown = extractProductIdentity({
    title: '$57 MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-',
    description: 'Variant unknown\nLot 323200552\nCondition: New\nUPC: 195166205052',
  });
  assert.deepEqual(unknown.discriminators.variantLabels, []);
  assert.equal(
    evaluateRetailCandidate('MTG LOTR Tales of Middle Earth Commander Deck The Host of Mordor', unknown).accepted,
    false,
  );
});

test('eBay sold Commander Deck titles may omit MTG when Lord of the Rings identity is explicit', () => {
  const source = extractProductIdentity({
    title: 'MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-',
    description: 'Elven Council\nCondition: New',
  });
  for (const candidate of [
    'Lord of the Rings Tales of Middle Earth Elven Council Commander Deck',
    'Elven Council Commander Deck MTG Lord of the Rings Tales of Middle Earth',
  ]) {
    const result = evaluateRetailCandidate(candidate, source);
    assert.equal(result.accepted, true, `${candidate}: ${JSON.stringify(result)}`);
  }
  const bare = evaluateRetailCandidate('Elven Council Commander Deck', source);
  assert.equal(bare.accepted, false, JSON.stringify(bare));
  const wrongVariant = evaluateRetailCandidate('Lord of the Rings Tales of Middle Earth The Host of Mordor Commander Deck', source);
  assert.equal(wrongVariant.accepted, false, JSON.stringify(wrongVariant));
});

test('named deck recovery leaves non-deck leading lines and unrelated products unchanged', () => {
  const nonDeck = extractProductIdentity({
    title: 'MTG LOTR TALES OF MIDDLE EARTH BOOSTER BOX',
    description: 'Factory sealed product with assorted cards',
  });
  assert.equal(nonDeck.query, 'mtg lotr tales of middle earth booster box');

  const unrelated = extractProductIdentity({
    title: 'Sony Wireless Headphones',
    description: 'The Host Of Mordor',
  });
  assert.equal(unrelated.query, 'sony wireless headphones');
});

test('redacted seller model fields do not contaminate product research queries', () => {
  for (const placeholder of ['PA***5', 'AB?12', 'PA***5, PA***5-2']) {
    assert.equal(looksLikeModel(placeholder), false);
  }
  const identity = extractProductIdentity(
    'Vaygway Ride-on Inflatable Banana Pool Float',
    'Condition: New(other)\nBrand: VaygWay\nModel: PA***5, PA***5-2',
  );
  assert.equal(identity.model, null);
  assert.equal(identity.query, 'vaygway ride-on inflatable banana pool float');
  assert.ok(buildEbaySoldQueryVariants(identity).every((query) => !/\bpa\s*5\b/i.test(query)));
  const titleModel = extractProductIdentity(
    'Onkyo TX-SR304 Multi-Channel AV Receiver',
    'Brand: Onkyo\nModel: PA***5, PA***5-2',
  );
  assert.equal(titleModel.model, 'TX-SR304');
  assert.equal(titleModel.query, 'onkyo tx-sr304 multi-channel av receiver');
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

test('descriptor-led jewelry title retains the explicitly labeled manufacturer', () => {
  const identity = extractProductIdentity(
    '$130 Rotatable Jewelry Cabinet Armoire with Mirror',
    'Retail Price: $130\nBrand: MASMIRE\nModel: HR4001-T02',
  );
  assert.equal(identity.brand, 'MASMIRE');
  assert.equal(identity.model, 'HR4001-T02');
  assert.match(identity.query, /^masmire rotatable jewelry cabinet armoire with mirror hr4001-t02$/i);

  const conflicting = extractProductIdentity('Smart Magcubic Projector', 'Brand: Samsung\nModel: Unknown');
  assert.equal(conflicting.brand, 'Magcubic');
  assert.match(conflicting.query, /^smart magcubic projector$/i);
});

test('corroborated structured brands replace misleading title lead words in sold queries', () => {
  const rug = extractProductIdentity(
    '$275 Eternal Dinosaur Jungle Party Rug 8x10',
    'Retail Price: $275\nBrand: TOWN & COUNTRY PLAY\nModel: 1-69767-185\nThis Town & Country Play Dinosaur Jungle Party Kid\'s Area Rug is textured.',
  );
  assert.equal(rug.brand, 'TOWN & COUNTRY PLAY');
  assert.equal(rug.model, '1-69767-185');
  assert.match(rug.query, /^town country play eternal dinosaur jungle party rug 8x10 1-69767-185$/i);

  const liner = extractProductIdentity(
    '$149 Cargo Liner: 18 Expedition, 2nd Row Folded',
    'Brand: Husky Liners\nModel: 23431\nCargo Liner. Our Cargo Liners are made from a proprietary material blend.',
  );
  assert.equal(liner.brand, 'Husky Liners');
  assert.equal(liner.model, '23431');
  assert.match(liner.query, /^husky liners cargo liner 18 expedition 2nd row folded 23431$/i);

  const rack = extractProductIdentity('Sorbus 75-Bottle Freestanding Rack Black', 'Brand: Sorbus\nLarge 75-bottle wine rack.');
  assert.equal(rack.model, null);
  assert.match(rack.query, /^sorbus 75-bottle freestanding rack black$/i);
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

test('ladder dimensions compare actual height separately from reach', () => {
  const source = extractProductIdentity('Werner 10 ft Aluminum Step Ladder');

  const wrongHeight = evaluateRetailCandidate('Werner 6 ft Aluminum Step Ladder 10 ft Reach', source);
  assert.equal(wrongHeight.accepted, false);
  assert.match(wrongHeight.rejectionReasons.join(' '), /actual-height/);

  assert.equal(
    evaluateRetailCandidate('Werner 10 ft Aluminum Step Ladder 14 ft Reach', source).accepted,
    true,
  );
  assert.equal(evaluateRetailCandidate("Werner 10' Step Ladder 14 feet Reach", source).accepted, true);
  assert.equal(
    evaluateRetailCandidate('Werner Aluminum Step Ladder 10 ft Reach', source).accepted,
    false,
  );
  assert.equal(evaluateRetailCandidate('Werner Aluminum Step Ladder 10 ft', source).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner 6208 Fiberglass Step Ladder, 8 ft, 12 ft maximum reach', source).accepted, false);
  assert.equal(evaluateRetailCandidate('Werner 10-ft Aluminum Step Ladder', source).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner Aluminum Step Ladder, Reach 12ft', source).accepted, false);
  assert.equal(evaluateRetailCandidate('Werner Aluminum Step Ladder 6 ft / 8 ft / 10 ft compatible', source).accepted, false);

  const compact = extractProductIdentity('Werner 8 ft Aluminum Step Ladder');
  assert.equal(evaluateRetailCandidate('Werner 8ftActual12ftReach Aluminum Step Ladder', compact).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner 6 feet Step Ladder 12 ft Reach', compact).accepted, false);
});

test('ladder height handling retains independent platform dimensions', () => {
  const source = extractProductIdentity('Werner 8 ft Aluminum Step Ladder 20 inch Platform');
  const wrongWidth = evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder 10 inch Platform', source);
  assert.equal(wrongWidth.accepted, false);
  assert.match(wrongWidth.rejectionReasons.join(' '), /dimensions:20in/);
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder 20 inch Platform 12-ft Reach', source).accepted, true);
  const fiberglass = extractProductIdentity('Werner 8 ft Fiberglass Step Ladder');
  assert.equal(evaluateRetailCandidate('Werner 8-ft Fiberglass Step Ladder 12-ft Reach', fiberglass).accepted, true);
});

test('ladder roles bind reach labels without erasing actual height or accessory measurements', () => {
  const source = extractProductIdentity('Werner 8 ft Aluminum Step Ladder Reach 12 ft');
  assert.equal(evaluateRetailCandidate('Werner 6 ft Aluminum Step Ladder 12 ft Reach', source).accepted, false);
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder 12 ft Reach', source).accepted, true);
  const tenFoot = extractProductIdentity('Werner 10 ft Aluminum Step Ladder');
  assert.equal(evaluateRetailCandidate('Werner 6 ft Aluminum Stepladder 10 ft Reach', tenFoot).accepted, false);
  const eightFoot = extractProductIdentity('Werner 8 ft Aluminum Step Ladder');
  assert.equal(evaluateRetailCandidate('Werner 8 ft 12-ft Reach Aluminum Step Ladder', eightFoot).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder 8 ft Height', eightFoot).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder with 6 ft cord', eightFoot).accepted, true);
  const withCord = extractProductIdentity('Werner 8 ft Aluminum Step Ladder with 6 ft cord');
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder with 12 ft cord', withCord).accepted, false);
});

test('exact ladder model and actual height do not require a redundant reach claim', () => {
  const source = extractProductIdentity('Werner 6208 8 ft 300 lb Fiberglass Step Ladder 12 ft Reach');
  assert.equal(evaluateRetailCandidate('Werner 6208 8 ft 300 lb Fiberglass Step Ladder', source).accepted, true);
  assert.equal(evaluateRetailCandidate('Werner 6208 8 ft 300 lb Fiberglass Step Ladder 10 ft Reach', source).accepted, false);
  assert.equal(evaluateRetailCandidate('Werner 6206 6 ft 300 lb Fiberglass Step Ladder 12 ft Reach', source).accepted, false);
});

test('ladder roles retain same-valued accessory lengths, source ambiguity, and punctuated reach labels', () => {
  const withCord = extractProductIdentity('Werner 8 ft Aluminum Step Ladder with 8 ft cord');
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder with 12 ft cord', withCord).accepted, false);
  assert.equal(evaluateRetailCandidate('Werner 8 ft Aluminum Step Ladder with 8 ft cord', withCord).accepted, true);
  const ambiguous = extractProductIdentity('Werner 8 ft / 10 ft Aluminum Step Ladder');
  assert.equal(evaluateRetailCandidate('Werner 10 ft Aluminum Step Ladder', ambiguous).accepted, false);
  const source = extractProductIdentity('Werner 8 ft Aluminum Step Ladder 12 ft Reach');
  for (const prefix of ['Reach:', 'Reach -', 'Maximum Reach:']) {
    assert.equal(evaluateRetailCandidate(`Werner 8 ft Aluminum Step Ladder ${prefix} 12 ft`, source).accepted, true, prefix);
  }
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
  const bella = extractProductIdentity('Bella PRO 8-qt Touchscreen Air Fryer',
    'Brand: Jhonawil\nModel: PRO 8QT Touchscreen Air Fryer\nCondition: Open Box - Tested');
  assert.equal(bella.brand, 'Bella');
});

test('platform names do not establish the maker of an accessory', () => {
  const title = '$55 Fire HD 10 Bluetooth Keyboard Case (13th Gen)';
  const description = 'UPC: 840173916605\nCompatible only with Amazon Fire HD 10, 13th Gen.';
  const unbranded = extractProductIdentity(title, description);
  const tunkarmor = { asin: 'B0TUNKARM0', title: 'TUNKARMOR Case Keyboard for Amazon Fire HD 10 13th Gen', price: 25.99, used: false, sponsored: false, url: '' };
  const fintie = { asin: 'B0FINTIE00', title: 'Fintie Wireless Keyboard Case for Fire HD 10 2023 13th Gen', price: 30, used: false, sponsored: false, url: '' };
  assert.equal(unbranded.brand, '');
  assert.equal(unbranded.query, 'fire hd 10 bluetooth keyboard case 13th gen');
  assert.equal(hasSufficientRetailIdentity(unbranded), false);
  assert.equal(chooseAmazonMatch(unbranded, [tunkarmor, fintie]), null);

  const stated = extractProductIdentity(title, `Brand: Fintie\n${description}`);
  assert.equal(stated.brand, 'Fintie');
  assert.equal(hasSufficientRetailIdentity(stated), true);
  assert.equal(chooseAmazonMatch(stated, [tunkarmor, fintie])?.candidate.asin, fintie.asin);

  const amazon = extractProductIdentity(title, `Brand: Amazon\n${description}`);
  const amazonCase = { asin: 'B0AMAZON00', title: 'Amazon Bluetooth Keyboard Case for Fire HD 10 13th Gen', price: 55, used: false, sponsored: false, url: '' };
  assert.equal(amazon.brand, 'Amazon');
  assert.equal(chooseAmazonMatch(amazon, [tunkarmor]), null, 'for Amazon is compatibility, not TUNKARMOR maker evidence');
  assert.equal(chooseAmazonMatch(amazon, [amazonCase])?.candidate.asin, amazonCase.asin);

  const sonyController = extractProductIdentity('PlayStation 5 DualSense Wireless Controller', 'Brand: Sony');
  assert.equal(evaluateRetailCandidate('PDP DualSense Wireless Controller for Sony PlayStation 5', sonyController).accepted, false);
  assert.equal(evaluateRetailCandidate('Sony DualSense Wireless Controller for PlayStation 5', sonyController).accepted, true);
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

test('structured product name completes a visibly cut-off title word without replacing model codes', () => {
  const ecovacs = extractProductIdentity(
    '$455 ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum & Mo',
    'Condition: Open Box - Tested\nTitle: $455 ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum & Mo\nProduct Name: ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum and Mop, 10000Pa Suction\nModel #: N30 PRO OMNI',
  );
  assert.match(ecovacs.query, /\brobot vacuum (?:and )?mop\b/);
  assert.doesNotMatch(ecovacs.query, /\bmo\b/);

  const inline = extractProductIdentity(
    '$455 ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum & Mo',
    'Title: $455 ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum & Mo\nHighlights: Hot water mop washing. Specifications: Dimensions (Overall): 4.09 inches. Product Name: ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum and Mop, 10000Pa Suction, TruEdge Mopping Cleaning Path Width: 10.71 inches Model #: N30 PRO OMNI',
  );
  assert.match(inline.query, /\brobot vacuum (?:and )?mop\b/);
  assert.doesNotMatch(inline.query, /\bmo\b/);

  const completeCode = extractProductIdentity(
    'Sony Camera XR',
    'Product Name: Sony Camera XRS with Lens Kit',
  );
  assert.equal(completeCode.query, 'sony camera xr');

  const completeWord = extractProductIdentity(
    'Apple iPhone 13 mini',
    'Product Name: Apple iPhone 13 minimalist case',
  );
  assert.equal(completeWord.query, 'apple iphone 13 mini');
});

test('numbered lots with separately named products require component review', () => {
  assert.equal(detectMixedLot('Lot of 2 Sony Headphones and Bose Speaker').mixed, true);
  assert.equal(detectMixedLot('Lot of (2) Sony Headphones + Bose Speaker').mixed, true);
  assert.equal(detectMixedLot('Lot of 2 GE Dinamap Vital Signs Monitors').mixed, false);
});

test('unnumbered estate lots naming distinct contents require component review', () => {
  for (const title of [
    'LOT OF ANTQ. CAMERAS AND ACCESSORIES',
    'LOT OF GLASS REFRIGERATOR DISHES & OLD BAY TIN',
    'LOT OF COLLECTIBLE DOLLS, TEDDY BEAR, ETC',
    'LOT OF CAMERAS + LENSES',
  ]) assert.equal(detectMixedLot(title).mixed, true, title);
  assert.equal(detectMixedLot('LOT OF CLEAR GLASS SERVING TRAYS').mixed, false);
  assert.equal(detectMixedLot('Lot of 2 GE Dinamap Vital Signs Monitors').mixed, false);
  assert.equal(detectMixedLot('Lot of 2 VEVOR Hot Water Dispenser, 4 Temps, 3L').mixed, false);
  assert.equal(detectMixedLot('Lot of 2 GE Dinamap Vital Signs Monitors, Tested Working').mixed, false);
  assert.equal(detectMixedLot('LOT OF BLACK AND DECKER DRILLS').mixed, false);
  assert.equal(detectMixedLot('LOT OF WHITE CUPS, NEW IN BOX').mixed, false);
});

test('multi-title media collections require component review rather than a single-item comp', () => {
  for (const title of [
    '25 Vintage LP Albums - Rock/Folk - Simon And Garfunkel, J. Geils, Woodstock, Doors, James Taylor, Etc',
    '11 Vintage LP Albums - Rock/Pop/Disco/R&B - David Bowie, Andy Gibb, Commodores, Sat Night Fever, Etc',
    '7 VNTG. CHILDRENS BOOKS',
    '3 CURRIER & IVES COFFEE TABLE BOOKS',
  ]) assert.equal(detectMixedLot(title).mixed, true, title);
  for (const title of [
    'Funko Pop! Albums: Lil Wayne - Tha Carter III',
    '3 Tier Wood Bookshelf',
    '24 Pack Record Sleeves',
  ]) assert.equal(detectMixedLot(title).mixed, false, title);
});

test('seller-labeled multiple pieces and apostrophe LP plurals require component review', () => {
  assert.equal(detectMixedLot("10 Vintage Vinyl Record LP's Queen, Poison, & More").mixed, true);
  assert.equal(detectMixedLot('10 Vintage Vinyl Record LP’s Queen, Poison, & More').mixed, true);
  assert.equal(detectMixedLot('3 Pieces Of Amber Glass Vases & Bowls').mixed, true);
  assert.equal(detectMixedLot('Ford Light Up Sign & Wood Wall Decor', 'The light up sign works and both are sold as is.').mixed, true);
  assert.equal(detectMixedLot('24 Pack Record Sleeves').mixed, false);
  assert.equal(detectMixedLot('Kobalt Work Swivel Stool', 'The item is used and has wear.').mixed, false);
});

test('assortment and abbreviated assorted titles require component review', () => {
  assert.equal(detectMixedLot('LOT OF ASST. HOUSEHOLD & DECOR').mixed, true);
  assert.equal(detectMixedLot('An Assortment Of Belleek Irish Pottery').mixed, true);
  assert.equal(detectMixedLot('Pack of 6 assorted color tablecloths').mixed, true);
  assert.equal(detectMixedLot('Six white tablecloths').mixed, false);
});

test('collection product lines do not become mixed lots or boilerplate components', () => {
  assert.equal(detectMixedLot('A Jewel Collection Leopard Print Rug').mixed, false);
  assert.equal(detectMixedLot('Hans Turnwald Signature Collection Silver-plated Serving Set').mixed, false);
  assert.equal(detectMixedLot('CANADA 1999 COIN COLLECTION, 12 MONTH').mixed, true);
  assert.equal(detectMixedLot('Vintage Daiwa "Coach Collection" Golf Bag W/ Clubs').mixed, true);
  const dining = detectMixedLot(
    'An Italian Modern Leather Dining Room Table And Chairs By Ycami Collection',
    'In good condition with some minor surface wear. See photos for condition and size details.',
  );
  assert.equal(dining.mixed, true);
  assert.deepEqual(dining.components, ['An Italian Modern Leather Dining Room Table And Chairs By Ycami Collection']);
  const glassware = detectMixedLot(
    'A Collection Of Sevres Crystal Glassware',
    'Some chips seen in photos. See all photos for condition and size details.',
  );
  assert.deepEqual(glassware.components, ['A Collection Of Sevres Crystal Glassware']);
});

test('a generic clothing lot described as a collection needs component review', () => {
  const clothing = detectMixedLot('Sweaters', 'Size s-Lp A collection of sweaters and t-shirts. Includes Lauren brand. See pictures for details.');
  assert.equal(clothing.mixed, true);
  assert.ok(clothing.reasons.includes('description identifies a collection of different items'));
  assert.equal(detectMixedLot('Sony PlayStation 5 Console', 'Includes a collection of games and accessories in the box.').mixed, true);
  assert.equal(detectMixedLot('Display Cabinet', 'Display your collection of books and keepsakes in this cabinet.').mixed, false);
  assert.equal(detectMixedLot('Sony Headphones', 'Part of our collection of headphones and speakers.').mixed, false);
});

test('ordinary single-product marketing prose does not trigger mixed-lot review', () => {
  const tv = detectMixedLot('Samsung The Frame 55" QLED TV LS03FAF', 'With Samsung Vision AI, enjoy optimized picture and sound quality.');
  const projector = detectMixedLot('Magcubic 4K Smart Projector, WiFi/BT', 'Projector with autofocus and automatic keystone correction.');
  assert.equal(tv.mixed, false);
  assert.equal(projector.mixed, false);
});

test('undisclosed mystery lots require contents review rather than a generic product query', () => {
  const unknown = detectMixedLot('$20 LOOT LOT!!!', 'A mystery box filled with surprise items. Loot lots vary in condition from New to completely Uninspected.');
  assert.equal(unknown.mixed, true);
  assert.deepEqual(unknown.components, []);
  assert.match(unknown.reasons[0]!, /undisclosed contents/);
  assert.equal(detectMixedLot('Pokemon Mystery Box 3 booster packs', 'Contains three sealed booster packs.').mixed, false);
  assert.equal(detectMixedLot('Pokemon Mystery Box 3 booster packs', 'Contains three sealed booster packs. Condition: Uninspected.').mixed, false);
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

test('Apple Pencil identity is a stylus, preserves generation, and rejects tablet accessories', () => {
  const pencil = extractProductIdentity({
    title: 'Apple Pencil (2nd Generation) for iPad Pro',
    description: 'Apple Pencil 2nd generation with magnetic charging for compatible iPad models.',
  });
  assert.equal(pencil.kind, 'stylus');
  assert.match(pencil.query, /apple pencil.*ipad pro/i);

  const matchingPencil = evaluateRetailCandidate('Apple Pencil 2nd Generation for iPad Pro', pencil);
  assert.equal(matchingPencil.accepted, true, JSON.stringify(matchingPencil));

  const wrongGeneration = evaluateRetailCandidate('Apple Pencil 1st Generation for iPad', pencil);
  assert.equal(wrongGeneration.accepted, false, JSON.stringify(wrongGeneration));
  assert.match(wrongGeneration.rejectionReasons.join(' '), /editions/);

  for (const accessory of [
    'Apple Pencil 2nd Generation Replacement Tips for iPad',
    'Case for Apple Pencil 2nd Generation Compatible with iPad Pro',
  ]) {
    const result = evaluateRetailCandidate(accessory, pencil);
    assert.equal(result.accepted, false, `${accessory}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(' '), /accessory-or-component/);
  }
});

test('audited Apple Pencil lot infers second generation without borrowing iPad compatibility prose', () => {
  const audited = extractProductIdentity({
    title: '$129 Apple Pencil for iPad 2nd gen (Renewed)',
    description: 'Brand: Apple\nModel: mxn43am/a',
  });
  assert.equal(audited.kind, 'stylus');
  assert.ok(audited.discriminators.editions.includes('stylus-generation:2'));
  assert.deepEqual(audited.discriminators.seriesSignatures, []);

  const equivalent = evaluateRetailCandidate('Apple Pencil 2nd Generation MU8F2AM/A Stylus', audited);
  assert.equal(equivalent.accepted, true, JSON.stringify(equivalent));
  for (const title of [
    'Apple Pencil (2nd Generation) Stylus, White - MU8F2AM/A A2051 for iPad',
    'Apple Pencil (2nd Gen - MU8F2AM) - Barely used',
  ]) {
    const result = evaluateRetailCandidate(title, audited);
    assert.equal(result.accepted, true, `${title}: ${JSON.stringify(result)}`);
  }
  for (const title of [
    'Apple Pencil (1st Generation) for iPad',
    'Apple Pencil (USB-C) for iPad',
    'Apple Pencil Pro for iPad Pro',
  ]) {
    const result = evaluateRetailCandidate(title, audited);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
  }

  assert.deepEqual(
    extractProductDiscriminators('Apple Pencil compatible with iPad 2nd gen').editions,
    [],
  );

  const unrelated = extractProductIdentity('Acme Digital Stylus', 'Brand: Acme\nModel: MXN43AM/A');
  const unrelatedAlias = evaluateRetailCandidate('Acme Digital Stylus MU8F2AM/A', unrelated);
  assert.equal(unrelatedAlias.accepted, false, JSON.stringify(unrelatedAlias));
  assert.match(unrelatedAlias.rejectionReasons.join(' '), /model-mismatch/);

  const skuIdentified = extractProductIdentity('Apple Pencil', 'Brand: Apple\nModel: MXN43AM/A');
  for (const title of [
    'Apple Pencil 1st Generation MU8F2AM/A',
    'Apple Pencil USB-C MU8F2AM/A',
    'Apple Pencil (USB-C) MU8F2AM/A',
    'Apple Pencil Pro MU8F2AM/A',
    'Apple Pencil (Pro) MU8F2AM/A',
    'Apple Pencil - USB-C MU8F2AM/A',
    'Apple Pencil: Pro MU8F2AM/A',
    'Apple Pencil MU8F2AM/A USB-C',
    'Apple Pencil MU8F2AM/A Pro',
  ]) {
    const result = evaluateRetailCandidate(title, skuIdentified);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
  }
  const compatible = evaluateRetailCandidate('Apple Pencil MU8F2AM/A compatible with iPad Pro', skuIdentified);
  assert.equal(compatible.accepted, true, JSON.stringify(compatible));
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

test('bundle components preserve decimal battery ratings and chargers', () => {
  const product = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Includes a 5.0Ah battery and a charger.',
  });
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill with Battery and Charger', product).accepted, true);
  const missingBattery = evaluateRetailCandidate('DeWalt 20V Cordless Drill with Charger', product);
  assert.equal(missingBattery.accepted, false, JSON.stringify(missingBattery));
  assert.match(missingBattery.rejectionReasons.join(' '), /bundle-component-missing:battery/);
});

test('explicit partial-kit wording demotes advertised full bundles from research and retail matching', () => {
  const partial = extractProductIdentity({
    title: '$1140 DJI Osmo Pocket 3 Creator Combo 4K Gimbal',
    description: 'Camera with gimble handle and carrying case only. Missing Parts Unknown.',
  });
  assert.equal(partial.query, 'dji osmo pocket 3 4k gimbal');
  assert.equal(partial.explicitlyPartialBundle, true);
  assert.equal(buildEbaySoldQueryVariants(partial)[0], 'dji osmo pocket 3 4k gimbal');
  const fullKit = evaluateRetailCandidate('DJI Osmo Pocket 3 Creator Combo with DJI Mic transmitter and tripod', partial);
  assert.equal(fullKit.accepted, false, JSON.stringify(fullKit));
  assert.match(fullKit.rejectionReasons.join(' '), /bundle-completeness-unverified/);

  const complete = extractProductIdentity({
    title: 'DJI Osmo Pocket 3 Creator Combo',
    description: 'Includes camera, DJI Mic transmitter, tripod and carrying case.',
  });
  assert.equal(complete.explicitlyPartialBundle, undefined);
  assert.equal(evaluateRetailCandidate('DJI Osmo Pocket 3 Creator Combo with DJI Mic transmitter, tripod and carrying case', complete).accepted, true);

  const unrelatedOnly = extractProductIdentity({
    title: 'DJI Osmo Pocket 3 Creator Combo',
    description: 'Only tested once. Includes the complete kit.',
  });
  assert.equal(unrelatedOnly.explicitlyPartialBundle, undefined);
  assert.equal(unrelatedOnly.query, 'dji osmo pocket 3 creator combo');
});

test('bundle matching rejects candidates that explicitly exclude required components', () => {
  const scuba = extractProductIdentity({
    title: 'VEVOR Mini Scuba Tank 0.5L Portable Diving',
    description: 'Includes a hand pump, bag and lanyard.',
  });
  const withoutPump = evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Bag and Lanyard, No Hand Pump', scuba);
  assert.equal(withoutPump.accepted, false, JSON.stringify(withoutPump));
  assert.match(withoutPump.rejectionReasons.join(' '), /bundle-component-excluded:pump/);

  const cable = extractProductIdentity({
    title: 'Sony Wireless Headphones',
    description: 'Includes a charging cable.',
  });
  const withoutCable = evaluateRetailCandidate('Sony Wireless Headphones, Without Charging Cable', cable);
  assert.equal(withoutCable.accepted, false, JSON.stringify(withoutCable));
  assert.match(withoutCable.rejectionReasons.join(' '), /bundle-component-excluded:cable/);

  const bothExcluded = evaluateRetailCandidate('Sony Wireless Headphones without charging cable and case',
    extractProductIdentity({ title: 'Sony Wireless Headphones', description: 'Includes a charging cable and case.' }));
  assert.equal(bothExcluded.accepted, false, JSON.stringify(bothExcluded));
  assert.match(bothExcluded.rejectionReasons.join(' '), /bundle-component-excluded:cable/);
  assert.match(bothExcluded.rejectionReasons.join(' '), /bundle-component-excluded:case/);
});

test('bundle exclusions remain hard rejections through Amazon fallback and scoring', () => {
  const scuba = extractProductIdentity({
    title: 'VEVOR Mini Scuba Tank 0.5L Portable Diving',
    description: 'Includes a hand pump, bag and lanyard.',
  });
  const title = 'VEVOR Mini Scuba Tank 0.5L with Bag, Pump Not Included';
  const matchText = 'VEVOR Mini Scuba Tank 0.5L with Pump and Bag';
  const direct = evaluateRetailCandidate(title, scuba);
  assert.equal(direct.accepted, false, JSON.stringify(direct));
  assert.match(direct.rejectionReasons.join(' '), /bundle-component-excluded:pump/);
  assert.equal(scoreRetailCandidate(title, scuba), 0);
  assert.equal(evaluateAmazonCandidateEvidence({
    asin: 'B0BUNDLEEXCLUDED', title, matchText, price: 59.99,
    used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0BUNDLEEXCLUDED',
  }, scuba).accepted, false);
});

test('description bundle exclusions retain affirmative components', () => {
  const product = extractProductIdentity({
    title: 'VEVOR Portable Air Compressor',
    description: 'Includes bag without pump.',
  });
  assert.deepEqual(product.includedComponents, [['bag']]);
  assert.equal(evaluateRetailCandidate('VEVOR Portable Air Compressor with Bag', product).accepted, true);
  assert.equal(evaluateRetailCandidate('VEVOR Portable Air Compressor with Pump', product).accepted, false);
});

test('accompanying jack stands are included components, not a jack-only listing', () => {
  const product = extractProductIdentity({
    title: 'VEVOR 2 Ton Low-Profile Floor Jack',
    description: 'The accompanying jack stands enhance safety and stability during use.',
  });
  assert.deepEqual(product.includedComponents, [['stand']]);
  assert.equal(evaluateRetailCandidate('VEVOR 2 Ton Low-Profile Floor Jack with 2 Jack Stands', product).accepted, true);
  assert.equal(evaluateRetailCandidate('VEVOR 2 Ton Low-Profile Floor Jack Only', product).accepted, false);
});

test('bundle quantities require the stated number of components', () => {
  const product = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Includes two batteries and a charger.',
  });
  const oneBattery = evaluateRetailCandidate('DeWalt 20V Cordless Drill with one battery and charger', product);
  assert.equal(oneBattery.accepted, false, JSON.stringify(oneBattery));
  assert.match(oneBattery.rejectionReasons.join(' '), /bundle-component-missing:2-battery/);
  const unrelatedTwo = evaluateRetailCandidate('DeWalt 20V 2-Speed Cordless Drill with one Battery and Charger', product);
  assert.equal(unrelatedTwo.accepted, false, JSON.stringify(unrelatedTwo));
  assert.match(unrelatedTwo.rejectionReasons.join(' '), /bundle-component-missing:2-battery/);
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill with two batteries and charger', product).accepted, true);
});

test('bundle quantities and exclusions stay scoped to their noun phrases', () => {
  const camera = extractProductIdentity({
    title: 'Nikon D5300 DSLR Camera',
    description: 'Includes a lens.',
  });
  assert.equal(evaluateRetailCandidate('Nikon D5300 DSLR Camera Body Only', camera).accepted, false);

  const twoLenses = extractProductIdentity({
    title: 'Nikon D5300 DSLR Camera',
    description: 'Includes two lenses.',
  });
  assert.equal(evaluateRetailCandidate('Nikon D5300 DSLR Camera with two lenses', twoLenses).accepted, true);

  const twoBatteriesAndCharger = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Includes two batteries and a charger.',
  });
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill with two 5.0Ah batteries and charger', twoBatteriesAndCharger).accepted, true);

  const twoBatteries = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Includes two batteries.',
  });
  assert.equal(evaluateRetailCandidate('DeWalt 20V 2-Speed Cordless Drill with 2 tools & battery', twoBatteries).accepted, false);
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill with 2 batteries', twoBatteries).accepted, true);

  const battery = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Includes battery.',
  });
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill without charger but with battery', battery).accepted, true);
});

test('bundle quantities do not leak across unrelated nouns or lens measurements', () => {
  const hammer = extractProductIdentity({
    title: 'VEVOR 2200W Demolition Jack Hammer, 1350 BPM',
    description: 'Includes two chisels in a case.',
  });
  assert.deepEqual(hammer.includedComponents, [['case']]);
  assert.equal(evaluateRetailCandidate('VEVOR 2200W Demolition Jack Hammer 1350 BPM with Case', hammer).accepted, true);

  const lens = extractProductIdentity('Nikon D5300 DSLR Camera Dual Lens Kit with 18-55mm and 70-300mm Lenses');
  assert.equal(evaluateRetailCandidate('Nikon D5300 DSLR Camera Dual Lens Kit with 18-55mm and 70-300mm Lenses', lens).accepted, true);
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

test('Nespresso machine does not inherit a pod-kit price', () => {
  const machine = extractProductIdentity('Vertuo by Nespresso: For large coffee lovers');
  const podKit = 'NESSUSReusable Pod Kit for Nespresso Pods Vertuo, Reuse Old Coffee Pods for Nespresso Vertuo: 100 Pcs Aluminum Foil Seal Lid, Holder, Brush, Refillable Vertuo Plus Next Capsule Machine(No Pods Come)';
  const accessory = evaluateRetailCandidate(podKit, machine);
  assert.equal(accessory.accepted, false);
  assert.ok(accessory.rejectionReasons.includes('accessory-or-component'));
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Reusable Coffee Pods', machine).accepted, false);
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Coffee Machine with 12 Capsules', machine).accepted, true);
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Coffee Machine, 12 Capsules Included', machine).accepted, true);
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Coffee Machine + 12 Capsules', machine).accepted, true);
  const identifiedMachine = extractProductIdentity('Nespresso Vertuo Coffee Machine');
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Capsule Machine', identifiedMachine).accepted, true);
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Pod Coffee Maker Cleaning Kit', machine).accepted, false);
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Capsule Coffee Machine Reusable Pod Kit', machine).accepted, false);

  const pods = extractProductIdentity('Nespresso Vertuo Reusable Coffee Pods');
  assert.equal(evaluateRetailCandidate('Nespresso Vertuo Reusable Coffee Pods', pods).accepted, true);
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

test('temperature counts and tent dimensions are specifications, not manufacturer models', () => {
  assert.equal(extractProductIdentity('$60 VEVOR Wax Melter 6.5L, 9-Temp Control').model, null);
  assert.equal(extractProductIdentity('$160 VEVOR SUV Tent 8x8ft, Waterproof, 5-8P').model, null);
  assert.equal(extractProductIdentity('$89 Ozark Trail 4-Person Dome Tent, 8x8').model, null);
  assert.equal(extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver').model, 'TX-SR304');
});

test('brand followed by a horsepower rating does not invent a manufacturer model', () => {
  const identity = extractProductIdentity('$136 VEVOR 1 HP Submersible Trash Pump, 5000 GPH');
  assert.equal(identity.model, null);
  assert.deepEqual(buildEbaySoldQueryVariants(identity).slice(0, 1), ['vevor 1 hp submersible trash pump 5000 gph']);
  assert.ok(buildEbaySoldQueryVariants(identity).every((query) => !/vevor1hp/i.test(query)));
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

test('unknown SCUF revision cannot inherit a V2 Amazon price', () => {
  const source = extractProductIdentity('SCUF ENVISION PRO Wireless Controller for PC -',
    'Brand: SCUF\nModel: ENVISION PRO\nCondition: Used\nMissing Parts?: Yes\nNotes: Not in box will need Charger and cords');
  const v2 = 'SCUF ENVISION PRO Wireless V2 (2025) PC Gaming Controller - White and Black PC Only';
  assert.equal(source.model, null);
  assert.match(evaluateRetailCandidate(v2, source).rejectionReasons.join(','), /revision-unverified/);
  assert.equal(scoreRetailCandidate(v2, source), 0);
  assert.equal(evaluateAmazonCandidateEvidence({ title: v2, matchText: 'SCUF ENVISION PRO Wireless Controller for PC', detailEnriched: true, price: 134.99 }, source).accepted, false);
  assert.equal(evaluateRetailCandidate('SCUF ENVISION PRO Wireless Controller for PC', source).accepted, true);

  const knownV1 = extractProductIdentity('SCUF ENVISION PRO V1 Wireless Controller for PC');
  assert.match(evaluateRetailCandidate(v2, knownV1).rejectionReasons.join(','), /revision-mismatch/);
  assert.equal(evaluateRetailCandidate('SCUF ENVISION PRO V1 Wireless Controller for PC', knownV1).accepted, true);
});

test('protocol versions do not become unsupported product revisions', () => {
  const headphones = extractProductIdentity('Sony WH-1000XM5 Headphones');
  const exact = evaluateRetailCandidate('Sony WH-1000XM5 Wireless Headphones Bluetooth v5.2', headphones);
  assert.equal(exact.accepted, true, exact.rejectionReasons.join(','));
  assert.doesNotMatch(exact.rejectionReasons.join(','), /revision-unverified/);

  const scuf = extractProductIdentity('SCUF ENVISION PRO Wireless Controller for PC');
  assert.match(
    evaluateRetailCandidate('SCUF ENVISION PRO Wireless V2 Controller with Bluetooth v5.2', scuf).rejectionReasons.join(','),
    /revision-unverified/,
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

test('Amazon matching rejects live catalog accessory, format, and character false positives', () => {
  const cases = [
    ['Bambu Lab P1S 3D Printer AMS w/ Filament', '3D Printer AMS Filament Desiccant Pack'],
    ['ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum and Mop', '22 PCS Accessories for ECOVACS DEEBOT N30 Omni Robot Vacuum'],
    ['MTG LOTR Tales of Middle-Earth Commander Deck', 'Tales of Middle-Earth Set Booster'],
    ['Ultra Pro Pokemon Binder 9-Pocket Lucario', 'Mega Charizard Binder'],
  ] as const;
  for (const [source, candidate] of cases) {
    const identity = extractProductIdentity(source);
    assert.equal(scoreRetailCandidate(candidate, identity), 0, `${source} must reject ${candidate}`);
  }
});

test('collectible format and character conflicts remain hard failures through donor scoring and detail enrichment', () => {
  const commander = extractProductIdentity('MTG LOTR Tales of Middle-Earth Commander Deck');
  const booster = 'MTG LOTR Tales of Middle-Earth Set Booster';
  assert.match(evaluateRetailCandidate(booster, commander).rejectionReasons.join(','), /format-mismatch:/);
  assert.equal(scoreRetailCandidate(booster, commander), 0);
  assert.equal(evaluateAmazonCandidateEvidence({ title: booster, matchText: commander.name, detailEnriched: true, price: 19.99 }, commander).accepted, false);

  const lucario = extractProductIdentity('Ultra Pro Pokemon Binder 9-Pocket Lucario');
  const charizard = 'Ultra Pro Pokemon Binder 9-Pocket Charizard';
  assert.match(evaluateRetailCandidate(charizard, lucario).rejectionReasons.join(','), /variant-mismatch:lucario/);
  assert.equal(scoreRetailCandidate(charizard, lucario), 0);
  assert.equal(evaluateAmazonCandidateEvidence({ title: charizard, matchText: lucario.name, detailEnriched: true, price: 19.99 }, lucario).accepted, false);
  assert.equal(evaluateRetailCandidate('Ultra Pro Pokemon Binder 9-Pocket Lucario', lucario).accepted, true);
});

test('accessory kits without compatibility wording are not full robot vacuums', () => {
  const vacuum = extractProductIdentity('ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum and Mop');
  const kit = 'ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum Accessories Kit';
  assert.equal(scoreRetailCandidate(kit, vacuum), 0);
  assert.match(evaluateRetailCandidate(kit, vacuum).rejectionReasons.join(','), /accessory-or-component/);
  assert.equal(evaluateAmazonCandidateEvidence({ title: kit, matchText: vacuum.name, detailEnriched: true, price: 34.99 }, vacuum).accepted, false);
  const bundle = 'ECOVACS DEEBOT N30 PRO OMNI Robot Vacuum with Accessories Kit';
  assert.equal(isAccessoryListing(bundle, vacuum), false);
  assert.ok(scoreRetailCandidate(bundle, vacuum) > 0);
});

test('printer bundle with included dryer is distinct from a standalone consumable', () => {
  const printer = extractProductIdentity('Bambu Lab P1S 3D Printer');
  const bundle = 'Bambu Lab P1S 3D Printer with Filament Dryer';
  assert.equal(isAccessoryListing(bundle, printer), false);
  assert.ok(scoreRetailCandidate(bundle, printer) > 0);
  for (const accessory of ['Bambu Lab P1S Filament Dryer', '3D Printer P1S Filament Desiccant Pack']) {
    assert.equal(scoreRetailCandidate(accessory, printer), 0, accessory);
  }
});

test('printer replacement components and lights cannot inherit complete-printer matches', () => {
  const printer = extractProductIdentity('Bambu Lab P1S 3D Printer AMS w/ Filament');
  for (const accessory of [
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
  ]) {
    const result = evaluateRetailCandidate(accessory, printer);
    assert.equal(result.accepted, false, `${accessory}: ${JSON.stringify(result)}`);
    assert.ok(result.rejectionReasons.includes('accessory-or-component'), `${accessory}: ${result.rejectionReasons.join(', ')}`);
    assert.equal(evaluateAmazonCandidateEvidence({
      asin: 'B0BAMBUPART', title: accessory, matchText: accessory, price: 29.99,
      used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0BAMBUPART',
    }, printer).accepted, false, `Amazon: ${accessory}`);
  }
});

test('complete printers may include printer components and printer accessories remain comparable to themselves', () => {
  const printer = extractProductIdentity('Bambu Lab P1S 3D Printer');
  for (const complete of [
    'Bambu Lab P1S 3D Printer with LED light',
    'Bambu Lab P1S with LED Light 3D Printer',
    'Bambu Lab P1S 3D Printer Combo with AMS',
  ]) {
    assert.equal(evaluateRetailCandidate(complete, printer).accepted, true, complete);
  }
  const ams = extractProductIdentity('Bambu Lab AMS 2 Pro - Auto Material System for X1C/P1S/P1P, 4-Color Printing');
  assert.equal(evaluateRetailCandidate(ams.name, ams).accepted, true);
  const bundlePrinter = extractProductIdentity('Bambu Lab P1S 3D Printer AMS w/ Filament');
  const printerOnly = evaluateRetailCandidate('Bambu Lab P1S 3D Printer', bundlePrinter);
  assert.equal(printerOnly.accepted, false);
  assert.match(printerOnly.rejectionReasons.join(' '), /bundle-component-missing:ams/);
  for (const missingAms of [
    'Bambu Lab P1S 3D Printer AMS not included',
    'Bambu Lab P1S 3D Printer AMS sold separately',
  ]) {
    const result = evaluateRetailCandidate(missingAms, bundlePrinter);
    assert.equal(result.accepted, false, missingAms);
    assert.match(result.rejectionReasons.join(' '), /bundle-component-missing:ams/);
    assert.equal(evaluateAmazonCandidateEvidence({
      asin: 'B0BAMBUNOAMS', title: missingAms, matchText: missingAms, price: 299,
      used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0BAMBUNOAMS', detailEnriched: true,
    }, bundlePrinter).accepted, false, `Amazon: ${missingAms}`);
  }
  for (const complete of ['Bambu Lab P1S AMS Combo 3D Printer', 'Bambu Lab P1S with AMS 3D Printer']) {
    assert.equal(evaluateRetailCandidate(complete, bundlePrinter).accepted, true, complete);
    const reorderedSource = extractProductIdentity(complete);
    for (const accessory of [ams.name, 'Bambu Lab P1S Replacement Nozzle', 'Bambu Lab P1S 3D Printer']) {
      assert.equal(evaluateRetailCandidate(accessory, reorderedSource).accepted, false, `${complete}: ${accessory}`);
      assert.equal(evaluateAmazonCandidateEvidence({
        asin: 'B0BAMBUPART', title: accessory, matchText: accessory, price: 299,
        used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0BAMBUPART', detailEnriched: true,
      }, reorderedSource).accepted, false, `Amazon ${complete}: ${accessory}`);
    }
    assert.equal(evaluateRetailCandidate('Bambu Lab P1S 3D Printer Combo with AMS', reorderedSource).accepted, true);
  }
  assert.equal(evaluateRetailCandidate(ams.name, bundlePrinter).accepted, false);

  const hotend = extractProductIdentity('Bambu Lab P1 Series Complete Hotend 0.4mm P1P P1S');
  assert.equal(evaluateRetailCandidate('Bambu Lab P1 Series Complete Hotend 0.4mm P1P P1S', hotend).accepted, true);
});

test('specific booster formats and reordered Pokemon characters retain identity', () => {
  const setBooster = extractProductIdentity('MTG Tales of Middle-Earth Set Booster Box');
  assert.equal(scoreRetailCandidate('MTG Tales of Middle-Earth Draft Booster Box', setBooster), 0);
  assert.match(evaluateRetailCandidate('MTG Tales of Middle-Earth Draft Booster Box', setBooster).rejectionReasons.join(','), /format-mismatch:set-booster/);
  assert.ok(scoreRetailCandidate('MTG Tales of Middle-Earth Set Booster Box', setBooster) > 0);

  const lucario = extractProductIdentity('Ultra Pro Pokemon Lucario 9-Pocket Premium Binder');
  assert.equal(scoreRetailCandidate('Ultra Pro Pokemon Charizard 9-Pocket Trading Card Binder', lucario), 0);
  assert.match(evaluateRetailCandidate('Ultra Pro Pokemon Charizard 9-Pocket Trading Card Binder', lucario).rejectionReasons.join(','), /variant-mismatch:lucario/);
  assert.ok(scoreRetailCandidate('Ultra Pro Pokemon 9-Pocket Lucario Binder', lucario) > 0);
});

test('single booster packs cannot inherit box prices in either direction', () => {
  const pack = extractProductIdentity('MTG Modern Horizons Set Booster Pack');
  const box = extractProductIdentity('MTG Modern Horizons Set Booster Box');
  assert.equal(scoreRetailCandidate(box.name, pack), 0);
  assert.equal(scoreRetailCandidate(pack.name, box), 0);
  assert.ok(scoreRetailCandidate(pack.name, pack) > 0);
  assert.ok(scoreRetailCandidate(box.name, box) > 0);
});

test('binder material cannot satisfy a different named character', () => {
  const pikachu = extractProductIdentity('Pokemon Leather Binder 9 Pocket Pikachu');
  assert.equal(scoreRetailCandidate('Pokemon Leather Binder 9 Pocket Charizard', pikachu), 0);
  assert.match(evaluateRetailCandidate('Pokemon Leather Binder 9 Pocket Charizard', pikachu).rejectionReasons.join(','), /variant-mismatch:pikachu/);
  assert.ok(scoreRetailCandidate('Pokemon Leather Binder 9 Pocket Pikachu', pikachu) > 0);
});

test('complete headphones with their original box are not packaging-only', () => {
  const headphones = extractProductIdentity('Sony WH-1000XM5 Headphones');
  assert.equal(isAccessoryListing('Sony WH-1000XM5 Headphones with original box', headphones), false);
  assert.ok(scoreRetailCandidate('Sony WH-1000XM5 Headphones with original box', headphones) > 0);
  for (const packaging of ['Sony WH-1000XM5 original box only', 'Sony WH-1000XM5 empty original box']) {
    assert.equal(scoreRetailCandidate(packaging, headphones), 0, packaging);
  }
});
