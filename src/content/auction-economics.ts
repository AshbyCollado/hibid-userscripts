export type PaymentMethod = 'cash' | 'check' | 'card' | 'unknown';
export type PremiumSource = 'auction_override' | 'lot_buyer_premium' | 'auction_terms' | 'fallback';

export interface AuctionEconomicsInput {
  hammer: number;
  premiumPct: number | null;
  premiumSource: PremiumSource;
  auctionTerms?: string | null;
  biddingNotice?: string | null;
  paymentInfo?: string | null;
  shippingAndPickupInfo?: string | null;
  paymentMethod?: PaymentMethod;
  premiumIncludesOnlineFee?: boolean;
  taxPct?: number | null;
  taxVerified?: boolean;
  taxIsStateEstimate?: boolean;
  taxOnPremium?: boolean;
  acquisitionShipping?: number | null;
  acquisitionShippingVerified?: boolean;
  feeScheduleVerified?: boolean;
}

export interface AuctionEconomics {
  hammer: number;
  premiumPct: number | null;
  premiumSource: PremiumSource;
  premium: number;
  flatFees: number;
  paymentFee: number;
  tax: number;
  knownSubtotal: number;
  estimatedCost: number;
  complete: boolean;
  warnings: string[];
  evidence: string[];
}

const FLAT_FEE = /\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(?:(?<prefix>administrative|handling|processing)\s+)?(?:fee\s+)?(?:per[ -]*lot|for\s+each\s+lot)\b(?:\s+(?<suffix>administrative|handling|processing)\s+fee)?/gi;
const PER_ITEM_FEE = /\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(?:fee\s+)?(?:per[ -]*(?:item|unit)|for\s+each\s+(?:item|unit))\b/i;
const PREMIUM_RATE = /(\d+(?:\.\d+)?)\s*%\s*buyer(?:['’]s|s)?\s+(?:premium|premuim)\b|\bbuyer(?:['’]s|s)?\s+(?:premium|premuim)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*%/gi;
const PAYMENT_RATE = /(\d+(?:\.\d+)?)\s*%\s*(?:with|for)\s+(?:(?:a\s+)?payment\s+(?:of|by)\s+)?(?:a\s+)?(?:credit\s+card|debit\s+card|card|cash|check)\b/gi;
const PAYMENT_CONTEXT = /\b(?:with|for|if|when|by)\s+(?:(?:a\s+)?payment\s+(?:of|by)\s+)?(?:a\s+)?(credit\s+card|debit\s+card|card|cash|check)(?:\s+or\s+(cash|check))?\b/i;

function sourceClauses(input: AuctionEconomicsInput): string[] {
  // Restrict fee discovery to auction fields; product descriptions are not terms.
  return [...new Set([input.auctionTerms, input.biddingNotice, input.paymentInfo]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .flatMap((value) => value.split(/(?<=[.!?;])\s+|\r?\n+/))
    .map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function fixedLotFee(clauses: string[], warnings: string[], evidence: string[]): number {
  const charges = new Map<string, number>();
  const amountsByKind = new Map<string, Set<number>>();
  const kindsByAmount = new Map<number, Set<string>>();
  let uncertain = false;
  for (const clause of clauses) {
    const matches = [...clause.matchAll(FLAT_FEE)];
    if (matches.length) {
      // Conditional terms require review, not a guessed present-day charge.
      const conditionText = clause.replace(/\bapplies\s+unless\s+otherwise\s+stated\s+for\s+a\s+specific\s+(?:auction|lot)\b(?:\s+or\s+(?:auction|lot)\b)?/gi, 'applies');
      if (/\b(?:waiv\w*|not\s+charged|no\s+(?:charge|fee)|included)\b|\bno\s+\$|\b(?:if|when|after|before|once|until|upon)\b|\bunless\b|\bapplies?\s+(?:only\s+)?(?:after|before|if|when|unless|once|upon)\b/i.test(conditionText)) {
        uncertain = true;
        evidence.push(clause);
        continue;
      }
      for (const match of matches) {
        const amount = Number(match[1]!.replace(/,/g, ''));
        const kind = (match.groups?.suffix ?? match.groups?.prefix ?? 'generic').toLowerCase();
        const amounts = amountsByKind.get(kind) ?? new Set<number>();
        amounts.add(amount);
        amountsByKind.set(kind, amounts);
        charges.set(`${kind}:${amount}`, amount);
        const kinds = kindsByAmount.get(amount) ?? new Set<string>();
        kinds.add(kind);
        kindsByAmount.set(amount, kinds);
      }
      evidence.push(clause);
    }
    if (PER_ITEM_FEE.test(clause)) {
      warnings.push('A per-item or per-unit fee needs quantity and charging-basis confirmation; it was not added.');
      evidence.push(clause);
    }
  }
  const hasGenericNamedCollision = [...kindsByAmount.values()].some((kinds) => kinds.has('generic') && kinds.size > 1);
  const conflictingKind = [...amountsByKind.values()].some((amounts) => amounts.size > 1);
  if (hasGenericNamedCollision || conflictingKind) {
    warnings.push('Conflicting or ambiguous per-lot fee terms need review; no flat fee was assumed.');
    return 0;
  }
  if (uncertain) warnings.push('Conditional, included, or waived per-lot fee terms need review; those fees were not assumed.');
  return [...charges.values()].reduce((total, amount) => total + amount, 0);
}

function paymentWarnings(input: AuctionEconomicsInput, clauses: string[], warnings: string[], evidence: string[]): void {
  const method = input.paymentMethod ?? 'unknown';
  for (const clause of clauses) {
    const positiveTerms = clause.replace(/\b(?:no|without)\s+(?:(?:credit|debit)\s+)?card\s+(?:(?:processing|transaction|convenience)\s+)?(?:fee|charge|surcharge)\b/gi, '');
    const cardFee = /\b(?:(?:credit|debit)\s+)?cards?\s+(?:(?:payments?|accepted,?|may\s+be\s+used\s+for\s+purchases,?)\s+)?(?:are\s+)?(?:subject\s+to|assessed|charged|carry|carries|have|has|incur|incurs|added)\s+(?:an?\s+)?(?:\d+(?:\.\d+)?\s*%\s*)?(?:(?:processing|transaction|convenience)\s+)?(?:fee|charge|surcharge)\b/i.test(positiveTerms)
      || /\b(?:\d+(?:\.\d+)?\s*%\s*)?(?:(?:credit|debit)\s+)?card\s+(?:(?:processing|transaction|convenience)\s+)?(?:fee|charge|surcharge)\b/i.test(positiveTerms)
      || /\b(?:\d+(?:\.\d+)?\s*%\s*)?(?:(?:processing|transaction|convenience)\s+)?(?:fee|charge|surcharge)\b\s+(?:applies\s+to|for|on)\s+(?:(?:credit|debit)\s+)?cards?\b/i.test(positiveTerms);
    if (cardFee && method !== 'cash' && method !== 'check') {
      warnings.push(method === 'card'
        ? 'Card fee amount, applicability and charging base need confirmation; no card surcharge was calculated.'
        : 'Card fees may apply; payment method and charging base are unconfirmed.');
      evidence.push(clause);
    }
    const onlineRates = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*%\s+(?:online|internet)\s+(?:bidding\s+)?fee\b/gi)].map((match) => Number(match[1]));
    if (onlineRates.length && !(input.premiumIncludesOnlineFee && onlineRates.every((rate) => rate === input.premiumPct))) {
      warnings.push('A separate online fee is not reconciled with the supplied premium; it was not added twice or assigned a guessed base.');
      evidence.push(clause);
    }
  }
}

function resolvePremium(input: AuctionEconomicsInput, clauses: string[], warnings: string[], evidence: string[]): { pct: number | null; source: PremiumSource } {
  const method = input.paymentMethod ?? 'unknown';
  if (input.premiumSource === 'auction_override') {
    return { pct: input.premiumPct, source: input.premiumSource };
  }
  const rates = clauses.flatMap((clause) => {
    const premiumMatches = [...clause.matchAll(PREMIUM_RATE)];
    const paymentMatches = premiumMatches.length ? [...clause.matchAll(PAYMENT_RATE)] : [];
    return [...premiumMatches, ...paymentMatches].map((match) => {
      const rate = Number(match[1] ?? match[2]);
      const isPremiumRate = premiumMatches.includes(match);
      const prefix = clause.slice(Math.max(0, (match.index ?? 0) - 80), match.index);
      const tail = clause.slice((match.index ?? 0) + match[0].length).split(/(?=\d+(?:\.\d+)?\s*%)/, 1)[0] ?? '';
      const precedingPremium = premiumMatches.filter((candidate) => (candidate.index ?? 0) < (match.index ?? 0)).at(-1);
      const alternativeContext = precedingPremium
        ? clause.slice((precedingPremium.index ?? 0) + precedingPremium[0].length, match.index) + tail
        : '';
      const waivedForCash = /\bwaiv(?:e|ed)\s+(?:for|with)\s+(?:cash|check)\b/i.test(tail);
      const payment = PAYMENT_CONTEXT.exec(`${match[0]} ${tail}`);
      const paymentKind = waivedForCash ? '' : payment?.[1]?.toLowerCase() ?? '';
      const conditional = /\b(?:late|past[ -]due|delinquent)\s+payments?\b|\b(?:if|when)\s+paid\s+after\b|\bafter\s+\d+\s+days?\b|\bapplies?\s+only\b/i.test(`${prefix} ${tail}`);
      const negated = /\b(?:no|not|without)\s*$/i.test(prefix) || /\b(?:not\s+charged|no\s+premium)\b/i.test(tail);
      const waived = /\bwaiv(?:e|ed)\b/i.test(tail);
      const unrelatedRate = !isPremiumRate && /\b(?:discount|sales\s+tax|tax|surcharge|shipping|processing\s+fee)\b/i.test(alternativeContext);
      const applies = !conditional && !negated && !unrelatedRate && (!waived || (waivedForCash && method !== 'cash' && method !== 'check'))
        && (!paymentKind || method === 'unknown' || (paymentKind.includes('card') ? method === 'card'
          : (method === 'cash' && (paymentKind === 'cash' || payment?.[2] === 'cash'))
            || (method === 'check' && (paymentKind === 'check' || payment?.[2] === 'check'))));
      return { rate, clause, applies, methodSpecific: Boolean(paymentKind), conditional: conditional || negated || waived || unrelatedRate };
    });
  }).filter(({ rate }) => Number.isFinite(rate) && rate >= 0 && rate <= 50);
  const applicable = rates.filter(({ applies }) => applies);
  const methodRates = method === 'unknown' ? [] : applicable.filter(({ methodSpecific }) => methodSpecific);
  const considered = methodRates.length ? methodRates : applicable;
  const highest = considered.length ? Math.max(...considered.map(({ rate }) => rate)) : null;
  if (rates.some(({ conditional }) => conditional)) {
    warnings.push('Conditional or waived buyer-premium terms need review; those rates were not assumed.');
    evidence.push(...rates.filter(({ conditional }) => conditional).map(({ clause }) => clause));
  }
  if (highest === null) {
    return { pct: input.premiumPct, source: input.premiumSource };
  }
  if (!methodRates.length && input.premiumSource !== 'fallback' && input.premiumPct !== null && highest <= input.premiumPct) {
    return { pct: input.premiumPct, source: input.premiumSource };
  }
  warnings.push(methodRates.length
    ? `Buyer premium is reconciled to the published ${method} payment rate of ${highest}%; confirm the selected payment method.`
    : input.premiumSource === 'fallback'
      ? `Buyer premium is inferred from auction terms at ${highest}%; confirm the applicable payment rate.`
      : `Published buyer premium exceeds the lot rate; ${highest}% is used conservatively until the payment rate is confirmed.`);
  evidence.push(...considered.filter(({ rate }) => rate === highest).map(({ clause }) => clause));
  return { pct: highest, source: 'auction_terms' };
}

export function calculateAuctionEconomics(input: AuctionEconomicsInput): AuctionEconomics {
  if (!Number.isFinite(input.hammer) || input.hammer < 0) throw new RangeError('hammer must be a finite non-negative number');
  const warnings: string[] = [];
  const evidence: string[] = [];
  const clauses = sourceClauses(input);
  if (!clauses.length) warnings.push('Auction fee terms are unavailable; additional charges remain unverified.');
  if (input.feeScheduleVerified !== true) warnings.push('Auction fee schedule is unverified; unmatched or undisclosed charges may remain.');
  const resolvedPremium = resolvePremium(input, clauses, warnings, evidence);
  const premiumPct = resolvedPremium.pct;
  const validPremium = premiumPct != null && Number.isFinite(premiumPct) && premiumPct >= 0;
  if (!validPremium) warnings.push('Buyer premium is unknown; no premium was calculated.');
  if (resolvedPremium.source === 'fallback') warnings.push('Buyer premium is an unverified fallback.');
  // Numeric auction/user corrections remain authoritative; prose never silently zeros them.
  const premium = validPremium && resolvedPremium.source !== 'fallback' ? input.hammer * premiumPct / 100 : 0;
  const flatFees = fixedLotFee(clauses, warnings, evidence);
  paymentWarnings(input, clauses, warnings, evidence);
  const paymentFee = 0;
  const knownSubtotal = input.hammer + premium + flatFees;
  const usableTax = input.taxPct != null && Number.isFinite(input.taxPct) && input.taxPct >= 0;
  const hasTax = usableTax && input.taxVerified === true;
  const estimatedTax = usableTax && input.taxIsStateEstimate === true;
  const taxable = input.hammer + (input.taxOnPremium === false ? 0 : premium);
  const tax = hasTax || estimatedTax ? taxable * input.taxPct! / 100 : 0;
  if (estimatedTax) warnings.push('Sales tax uses a state estimate, not a confirmed auction tax rate.');
  else if (!hasTax) warnings.push('Sales tax is unconfigured or its applicability is unknown; subtotal excludes tax.');
  if ((hasTax || estimatedTax) && input.taxPct! > 0 && flatFees > 0) {
    warnings.push('Tax treatment of auction fees is unknown; fee tax was not calculated.');
  }
  const shippingKnown = input.acquisitionShippingVerified === true && input.acquisitionShipping != null
    && Number.isFinite(input.acquisitionShipping) && input.acquisitionShipping >= 0;
  if (!shippingKnown) warnings.push('Shipping, handling and pickup costs are unverified and excluded; this is not a fully costed profit estimate.');
  return {
    hammer: input.hammer, premiumPct, premiumSource: resolvedPremium.source, premium, flatFees,
    paymentFee, tax, knownSubtotal,
    estimatedCost: knownSubtotal + tax + (shippingKnown ? input.acquisitionShipping! : 0),
    complete: warnings.length === 0, warnings: [...new Set(warnings)], evidence: [...new Set(evidence)],
  };
}
