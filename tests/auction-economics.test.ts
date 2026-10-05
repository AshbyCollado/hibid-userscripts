import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAuctionEconomics } from '../src/content/auction-economics.js';

test('Buda premium and per-lot fee are calculated once', () => {
  const result = calculateAuctionEconomics({ hammer: 12.5, premiumPct: 15, premiumSource: 'lot_buyer_premium', auctionTerms: '15% buyer premium + $2 per lot', biddingNotice: '15% buyer premium + $2.00 per-lot fee', taxVerified: true, taxPct: 0 });
  assert.equal(result.estimatedCost, 16.375);
  assert.equal(result.flatFees, 2);
});

test('live Buda per lot/item notice adds its fixed fee without claiming full true cost', () => {
  const biddingNotice = 'Weekly Online Auction - Lots begin closing Sunday at 7:00 PM | Pickup starts the day after the auctions ends. Pickup Schedule: (Monday - Wednesday, 10AM - 6PM) | Fees: 15% Buyer\'s Premium + $2 per lot/item won | No Holds / No Extensions: Items not picked up by Wednesday 6PM = forfeited, no refund.';
  const result = calculateAuctionEconomics({ hammer: 45, premiumPct: 15, premiumSource: 'lot_buyer_premium', biddingNotice });
  assert.equal(result.flatFees, 2);
  assert.equal(result.knownSubtotal, 53.75);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /shipping|tax/i);
});

test('a separate online fee does not acquire a guessed hammer base for cash', () => {
  const result = calculateAuctionEconomics({ hammer: 23, premiumPct: 0, premiumSource: 'lot_buyer_premium', paymentInfo: '2% online fee; 4% card fee', paymentMethod: 'cash', taxVerified: true, taxPct: 0 });
  assert.equal(result.estimatedCost, 23);
  assert.match(result.warnings.join(' '), /separate online fee/);
});

test('card fee with unspecified base is incomplete', () => {
  const result = calculateAuctionEconomics({ hammer: 23, premiumPct: 0, premiumSource: 'lot_buyer_premium', paymentInfo: '4% card fee', paymentMethod: 'card', taxVerified: true, taxPct: 0 });
  assert.equal(result.paymentFee, 0);
  assert.match(result.warnings.join(' '), /charging base need confirmation/i);
});

test('unknown tax preserves subtotal and warns', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 15, premiumSource: 'lot_buyer_premium', auctionTerms: '$2 per lot' });
  assert.equal(result.knownSubtotal, 13.5);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /tax/i);
});

test('next bid remains the caller-selected hammer', () => {
  const result = calculateAuctionEconomics({ hammer: 31, premiumPct: 15, premiumSource: 'lot_buyer_premium', taxVerified: true, taxPct: 0 });
  assert.equal(result.hammer, 31);
});

test('conflicting or waived fees are not assumed', () => {
  const conflict = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'lot_buyer_premium', auctionTerms: '$2 per lot and $3 per lot', taxVerified: true, taxPct: 0 });
  assert.equal(conflict.flatFees, 0);
  const waived = calculateAuctionEconomics({ hammer: 10, premiumPct: 15, premiumSource: 'auction_override', auctionTerms: '15% buyer premium; shipping fees waived.', taxVerified: true, taxPct: 0 });
  assert.equal(waived.premium, 1.5);
});

test('a fallback premium is not inserted into the known subtotal', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 15, premiumSource: 'fallback' });
  assert.equal(result.knownSubtotal, 10);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /unverified fallback/);
});

test('payment-dependent buyer premium uses the higher published rate without overriding a correction', () => {
  const terms = 'Buyers shall pay a 20% buyers premuim on final accepted bids. A discount of 5% is offered if Buyer pays cash or check.';
  const input = { hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium' as const,
    auctionTerms: terms, biddingNotice: '20% buyers premium with a payment of a credit card, 15% with cash or check', taxPct: 0, taxVerified: true };
  const unknown = calculateAuctionEconomics(input);
  assert.equal(unknown.premiumPct, 20);
  assert.equal(unknown.premiumSource, 'auction_terms');
  assert.equal(unknown.premium, 20);
  assert.equal(unknown.knownSubtotal, 120);
  assert.match(unknown.warnings.join(' '), /published buyer premium exceeds/i);
  assert.equal(calculateAuctionEconomics({ ...input, paymentMethod: 'card' }).premiumPct, 20);
  assert.equal(calculateAuctionEconomics({ ...input, paymentMethod: 'cash' }).premiumPct, 15);
  assert.equal(calculateAuctionEconomics({ ...input, premiumPct: 17, premiumSource: 'auction_override' }).premiumPct, 17);
});

test('unconditional premium applies to cash and to a missing lot premium', () => {
  const terms = 'Buyer premium 20% for all payment methods.';
  const cash = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: terms, paymentMethod: 'cash' });
  assert.equal(cash.premiumPct, 20);
  assert.equal(cash.premium, 20);
  const missing = calculateAuctionEconomics({ hammer: 100, premiumPct: null, premiumSource: 'fallback',
    auctionTerms: terms, paymentMethod: 'check' });
  assert.equal(missing.premiumPct, 20);
  assert.equal(missing.premium, 20);
});

test('conditional or waived premium is not applied as the normal card rate', () => {
  const late = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: '25% buyer premium applies only to late payments. Regular buyer premium 15%.', paymentMethod: 'card' });
  assert.equal(late.premiumPct, 15);
  assert.equal(late.premium, 15);
  assert.match(late.warnings.join(' '), /conditional or waived buyer-premium/i);
  const waived = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: '20% buyer premium waived for cash. Regular buyer premium 15%.', paymentMethod: 'cash' });
  assert.equal(waived.premiumPct, 15);
  assert.equal(waived.premium, 15);
  const card = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: '20% buyer premium waived for cash. Regular buyer premium 15%.', paymentMethod: 'card' });
  assert.equal(card.premiumPct, 20);
  const discount = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: '20% buyer premium, discount of 5% with cash.', paymentMethod: 'cash' });
  assert.equal(discount.premiumPct, 20);
  assert.match(discount.warnings.join(' '), /conditional or waived buyer-premium/i);
});

test('late-payment penalties and negated percentages never replace the normal premium', () => {
  for (const terms of [
    'For late payments, 25% buyer premium. Regular buyer premium 15%.',
    '25% buyer premium if paid after 7 days. Regular buyer premium 15%.',
    'No 20% buyer premium is charged. Regular buyer premium 15%.',
  ]) {
    const result = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
      auctionTerms: terms, paymentMethod: 'card' });
    assert.equal(result.premiumPct, 15, terms);
    assert.equal(result.premium, 15, terms);
    assert.match(result.warnings.join(' '), /conditional or waived buyer-premium/i, terms);
  }
});

test('cash discounts and sales tax are not alternative buyer-premium rates', () => {
  for (const terms of [
    '20% buyer premium, receive a 5% with cash discount.',
    '20% buyer premium, sales tax is 8% for cash payments.',
  ]) {
    const result = calculateAuctionEconomics({ hammer: 100, premiumPct: 15, premiumSource: 'lot_buyer_premium',
      auctionTerms: terms, paymentMethod: 'cash' });
    assert.equal(result.premiumPct, 20, terms);
    assert.equal(result.premium, 20, terms);
  }
});

test('published cash rate can lower an otherwise full lot premium', () => {
  const result = calculateAuctionEconomics({ hammer: 100, premiumPct: 20, premiumSource: 'lot_buyer_premium',
    biddingNotice: '20% buyers premium with a credit card, 15% with cash or check', paymentMethod: 'cash' });
  assert.equal(result.premiumPct, 15);
  assert.equal(result.premiumSource, 'auction_terms');
  assert.equal(result.knownSubtotal, 115);
});

for (const method of ['cash', 'check'] as const) {
  test(`Great Lakes online premium is counted once and card fee excluded for ${method}`, () => {
    const result = calculateAuctionEconomics({ hammer: 100, premiumPct: 2, premiumSource: 'lot_buyer_premium',
      premiumIncludesOnlineFee: true, paymentMethod: method, taxPct: 0, taxVerified: true,
      auctionTerms: 'All purchases are subject to a 2% online bidding fee. Credit Cards may be used for purchases, subject to a 4% processing fee and approval.',
      paymentInfo: 'Credit cards accepted, subject to a 4% processing fee.' });
    assert.equal(result.knownSubtotal, 102);
    assert.equal(result.paymentFee, 0);
    assert.doesNotMatch(result.warnings.join(' '), /Card fee|separate online/);
  });
}

test('Great Lakes card fee remains unknown rather than adding four percent to a guessed base', () => {
  const result = calculateAuctionEconomics({ hammer: 100, premiumPct: 2, premiumSource: 'lot_buyer_premium', premiumIncludesOnlineFee: true,
    paymentMethod: 'card', auctionTerms: 'All purchases are subject to a 2% online bidding fee.',
    paymentInfo: 'Credit cards accepted, subject to a 4% processing fee.', taxPct: 0, taxVerified: true });
  assert.equal(result.knownSubtotal, 102);
  assert.equal(result.paymentFee, 0);
  assert.match(result.warnings.join(' '), /no card surcharge was calculated/);
});

test('per-item fee is not assumed to mean one fee for a multi-unit lot', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: '$2 per item.' });
  assert.equal(result.flatFees, 0);
  assert.match(result.warnings.join(' '), /quantity and charging-basis/);
});

test('explicitly negated or conflicting per-lot amounts are not silently charged', () => {
  for (const terms of ['No $2 per lot fee.', '$2 per lot fee is waived.', '$2 per lot fee. $3 per lot fee.']) {
    const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: terms });
    assert.equal(result.flatFees, 0, terms);
    assert.match(result.warnings.join(' '), /per-lot fee terms need review/, terms);
  }
});

test('an unrelated sentence waiver does not remove the actual flat fee', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: '$2 per lot fee. Shipping fees waived.' });
  assert.equal(result.flatFees, 2);
});

test('tax-exempt zero differs from missing tax and state-average estimates', () => {
  const input = { hammer: 10, premiumPct: 15, premiumSource: 'lot_buyer_premium' as const, auctionTerms: '$2 per lot.' };
  const exempt = calculateAuctionEconomics({ ...input, taxVerified: true, taxPct: 0 });
  assert.doesNotMatch(exempt.warnings.join(' '), /tax/i);
  const missing = calculateAuctionEconomics(input);
  assert.match(missing.warnings.join(' '), /Sales tax is unconfigured/);
  const estimate = calculateAuctionEconomics({ ...input, taxPct: 8.2, taxIsStateEstimate: true });
  assert.ok(Math.abs(estimate.tax - .943) < 1e-9);
  assert.equal(estimate.complete, false);
  assert.match(estimate.warnings.join(' '), /state estimate/);
  assert.match(estimate.warnings.join(' '), /fee tax was not calculated/);
});

test('unknown delivery costs never masquerade as a complete total', () => {
  const input = { hammer: 10, premiumPct: 15, premiumSource: 'lot_buyer_premium' as const, auctionTerms: 'Buyer premium 15%.', taxVerified: true, taxPct: 0 };
  assert.equal(calculateAuctionEconomics(input).complete, false);
  const supplied = calculateAuctionEconomics({ ...input, acquisitionShipping: 5, acquisitionShippingVerified: true, feeScheduleVerified: true });
  assert.equal(supplied.estimatedCost, 16.5);
  assert.equal(supplied.complete, true);
});

test('conditional per-lot fees preserve evidence without charging now', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: '$2 per lot applies after 7 days.' });
  assert.equal(result.flatFees, 0);
  assert.equal(result.evidence[0], '$2 per lot applies after 7 days.');
  assert.match(result.warnings.join(' '), /review/);
});

test('an unknown conditional fee does not erase a separately established charge', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override',
    auctionTerms: '$2 per lot applies after 7 days. $3 handling fee per lot.' });
  assert.equal(result.flatFees, 3);
  assert.match(result.warnings.join(' '), /Conditional/);
});

test('Buda default per-lot charge survives a specific-auction override clause and duplicate notice', () => {
  const result = calculateAuctionEconomics({ hammer: 12.5, premiumPct: 15, premiumSource: 'lot_buyer_premium',
    auctionTerms: 'Lot Fee: A $2.00 per-lot charge applies unless otherwise stated for a specific auction or lot.',
    biddingNotice: 'Fees: 15% Buyer premium + $2 perlot/itemwon', taxVerified: true, taxPct: 0 });
  assert.equal(result.flatFees, 2);
  assert.equal(result.estimatedCost, 16.375);
});

test('Buda live notice calculates the known subtotal with a two-dollar flat fee', () => {
  const result = calculateAuctionEconomics({
    hammer: 2.50,
    premiumPct: 15,
    premiumSource: 'lot_buyer_premium',
    biddingNotice: 'Fees: 15% Buyer’s Premium + $2 per lot/item won',
    taxVerified: true,
    taxPct: 0,
  });
  assert.equal(result.flatFees, 2);
  assert.equal(result.premium, 0.375);
  assert.equal(result.knownSubtotal, 4.875);
  assert.equal(Math.round(result.knownSubtotal * 100) / 100, 4.88);
});

test('distinct named per-lot fees count separately while duplicate notices dedupe', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: '$2 handling fee per lot and $2 administrative fee per lot.', biddingNotice: '$2.00 handling fee per-lot and $2 administrative fee per lot.' });
  assert.equal(result.flatFees, 4);
});

test('specific-auction defaults never exempt a same-clause waiver or future charge', () => {
  for (const suffix of ['and $2 per lot fee is waived.', 'and $2 per lot applies after 7 days.', 'if paid after Friday.']) {
    const auctionTerms = `$2.00 per-lot charge applies unless otherwise stated for a specific auction or lot ${suffix}`;
    const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms,
      taxVerified: true, taxPct: 0, acquisitionShipping: 0, acquisitionShippingVerified: true, feeScheduleVerified: true });
    assert.equal(result.flatFees, 0, auctionTerms);
    assert.equal(result.complete, false, auctionTerms);
    assert.match(result.warnings.join(' '), /Conditional/);
    assert.ok(result.evidence.includes(auctionTerms));
  }
});

test('suffix-form named per-lot fees count separately', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override',
    auctionTerms: '$2 per lot handling fee. $2 per lot administrative fee.' });
  assert.equal(result.flatFees, 4);
});

test('generic and named same-amount fees remain ambiguous', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: '$2 per lot and $2 handling fee per lot.' });
  assert.equal(result.flatFees, 0);
  assert.match(result.warnings.join(' '), /review/);
});

test('processing charge is recognized as an unresolved card fee', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', paymentMethod: 'card', auctionTerms: 'Credit cards are subject to a 4% processing charge.' });
  assert.equal(result.paymentFee, 0);
  assert.match(result.warnings.join(' '), /charging base need confirmation/i);
});

test('ordinary invoice fees do not imply a card surcharge', () => {
  for (const paymentInfo of [
    "By providing a card or payment credential, you authorize us to charge the total invoice amount (including buyer's premium, lot fee, taxes, shipping/handling if applicable, and any disclosed fees).",
    'Your card will be charged the invoice total including the lot fee.',
    'Pay the invoice including the lot fee using a credit card.',
    'No credit card fee applies.',
  ]) {
    const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 15, premiumSource: 'lot_buyer_premium', paymentInfo,
      feeScheduleVerified: true, taxPct: 0, taxVerified: true, acquisitionShipping: 0, acquisitionShippingVerified: true });
    assert.equal(result.paymentFee, 0, paymentInfo);
    assert.doesNotMatch(result.warnings.join(' '), /card fees?|card surcharge/i, paymentInfo);
    assert.equal(result.complete, true, paymentInfo);
  }
});

test('processing fee stated before credit cards remains unresolved', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override',
    paymentMethod: 'card', paymentInfo: 'A 3% processing fee applies to credit cards.' });
  assert.match(result.warnings.join(' '), /no card surcharge was calculated/i);
});

test('card payment fee remains unresolved even beside a separate no-fee clause', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override',
    paymentMethod: 'card', paymentInfo: 'No credit card fee applies to pickup. Credit card payments carry a 3% processing fee.',
    feeScheduleVerified: true, taxPct: 0, taxVerified: true, acquisitionShipping: 0, acquisitionShippingVerified: true });
  assert.match(result.warnings.join(' '), /no card surcharge was calculated/i);
  assert.equal(result.complete, false);
});

test('nonmatching terms cannot prove a complete fee schedule', () => {
  const result = calculateAuctionEconomics({ hammer: 10, premiumPct: 0, premiumSource: 'auction_override', auctionTerms: 'See complete terms at the desk.', taxVerified: true, taxPct: 0, acquisitionShipping: 0, acquisitionShippingVerified: true });
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /fee schedule is unverified/i);
});
