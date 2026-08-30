import {
  assessCondition,
  evaluateRetailCandidate,
  extractLotQuantityFromTitle,
  extractProductDiscriminators,
  extractProductIdentity,
  type ConditionAssessment,
  type ProductIdentity,
  type RetailCandidateEvaluation,
} from './us-deal-intelligence.js';
import {
  assessEbayEvidenceUrl,
  classifyEbayEvidenceUrl,
  extractEbayItemId,
  type IndependentEbaySoldEvidence,
  type IndependentEbaySoldEvidenceSource,
} from './ebay-evidence-url.js';

export type EbaySoldResultSource = 'seller-hub-product-research' | 'public-sold-search';
export type EbaySoldAttemptStatus = 'ok' | 'no-results' | 'challenge' | 'not-sold-context' | 'parse-error';
export type EbaySoldPriceKind = 'actual' | 'average-actual' | 'public-visible' | 'best-offer-unknown';
export type EbaySoldVerificationStatus = 'not-attempted' | 'incomplete' | 'blocked' | 'insufficient' | 'verified';
export type EbaySoldMatchConfidence = 'none' | 'exact-model' | 'title-family' | 'variant-ambiguous';

export interface EbayMoney {
  amount: number;
  currency: 'USD' | 'CAD' | 'GBP' | 'EUR' | 'AUD' | 'UNKNOWN';
}

export interface EbaySoldRecord {
  source: EbaySoldResultSource;
  sourceUrl: string;
  observedAt: string;
  itemId: string;
  itemUrl: string;
  title: string;
  imageUrl: string | null;
  soldPrice: EbayMoney | null;
  shippingPrice: EbayMoney | null;
  deliveredPrice: EbayMoney | null;
  totalSold: number | null;
  totalSales: EbayMoney | null;
  soldAt: string | null;
  condition: string | null;
  format: string | null;
  priceKind: EbaySoldPriceKind;
  provenance: IndependentEbaySoldEvidence;
}

export interface EbaySoldSearchAttempt {
  source: EbaySoldResultSource;
  sourceUrl: string;
  query: string;
  observedAt: string;
  status: EbaySoldAttemptStatus;
  records: EbaySoldRecord[];
  hasNextPage: boolean;
  pageOffset: number;
  pageLimit: number | null;
  failureReason: string | null;
}

export interface EbaySoldRecordRejection {
  itemId: string;
  title: string;
  itemUrl: string;
  query: string;
  reasons: string[];
}

export interface VerifiedEbaySoldComp extends EbaySoldRecord {
  query: string;
  evaluation: RetailCandidateEvaluation;
  candidateModel: string | null;
  candidateVariantSignals: string[];
}

export interface EbaySoldCompStatistics {
  sampleSize: number;
  salePriceMedian: number | null;
  salePriceLow: number | null;
  salePriceHigh: number | null;
  deliveredPriceMedian: number | null;
  currency: EbayMoney['currency'] | null;
}

export interface EbaySoldCompVerification {
  status: EbaySoldVerificationStatus;
  attempted: boolean;
  allPlannedQueriesAttempted: boolean;
  completePages: boolean;
  matchConfidence: EbaySoldMatchConfidence;
  marketValueReady: boolean;
  variantModels: string[];
  variantSignals: string[];
  plannedQueries: string[];
  attemptedQueries: string[];
  accepted: VerifiedEbaySoldComp[];
  rejected: EbaySoldRecordRejection[];
  duplicateItemIds: string[];
  statistics: EbaySoldCompStatistics;
  insufficiencyReasons: string[];
}

export interface VerifyEbaySoldCompOptions {
  plannedQueries: string[];
  minimumSampleSize?: number;
  sourceCondition?: ConditionAssessment | null;
  sourceQuantity?: number | null;
}

const EBAY_QUERY_NOISE = new Set([
  'av', 'channel', 'channels', 'multi', 'multichannel', 'wireless', 'smart', 'portable',
  'new', 'used', 'open', 'box', 'black', 'white', 'video', 'audio', 'system', 'unit', 'console',
]);

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedQuery(value: string | null | undefined): string {
  return cleanText(value).toLocaleLowerCase('en-US');
}

function addUniqueQuery(target: string[], candidate: string): void {
  const cleaned = cleanText(candidate);
  if (!cleaned) return;
  const key = normalizedQuery(cleaned);
  if (!target.some((query) => normalizedQuery(query) === key)) target.push(cleaned);
}

function explicitBookTitleFromName(name: string): string | null {
  return cleanText(
    name.match(/^(.+?)\s+(?:book|novel)\s+by\s+.+$/i)?.[1]
      || name.match(/^(.+?)\s+(?:book|novel)$/i)?.[1],
  ) || null;
}

export function buildEbaySoldQueryVariants(identity: ProductIdentity, maximum = 3): string[] {
  const limit = Math.max(1, Math.min(3, Math.floor(maximum)));
  const variants: string[] = [];
  addUniqueQuery(variants, identity.query);

  if (identity.model) {
    addUniqueQuery(variants, [identity.brand, identity.model].filter(Boolean).join(' '));
    addUniqueQuery(variants, identity.model);
  } else {
    const isbn = identity.name.match(/\b(?:97[89][\s-]?)?\d(?:[\s-]?\d){8,12}[\s-]?[\dXx]\b/)?.[0]
      ?.replace(/[^\dXx]/g, '');
    if (isbn) addUniqueQuery(variants, isbn);
    const explicitBookTitle = explicitBookTitleFromName(identity.name);
    if (explicitBookTitle) {
      addUniqueQuery(variants, explicitBookTitle);
      addUniqueQuery(variants, `"${explicitBookTitle.replace(/"/g, '')}"`);
    }
    const coreTokens = identity.query.split(/\s+/)
      .filter((token) => (token.length > 2 || /\d/.test(token)) && !EBAY_QUERY_NOISE.has(token.toLocaleLowerCase('en-US')))
      .slice(0, 6);
    if (coreTokens.length >= 2) addUniqueQuery(variants, coreTokens.join(' '));
    if (identity.query.split(/\s+/).length >= 3) addUniqueQuery(variants, `"${identity.query.replace(/"/g, '')}"`);
  }
  return variants.slice(0, limit);
}

function textOf(root: ParentNode, selector: string): string {
  return cleanText(root.querySelector(selector)?.textContent);
}

function parsePositiveInteger(value: string | null | undefined): number | null {
  const match = cleanText(value).replace(/,/g, '').match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function marketplaceCurrency(url: URL): EbayMoney['currency'] {
  const marketplace = url.searchParams.get('marketplace')?.toUpperCase();
  if (marketplace === 'EBAY-CA') return 'CAD';
  if (marketplace === 'EBAY-GB') return 'GBP';
  if (marketplace === 'EBAY-AU') return 'AUD';
  if (marketplace?.startsWith('EBAY-') && marketplace !== 'EBAY-US') return 'UNKNOWN';
  return url.hostname.endsWith('.ca') ? 'CAD' : url.hostname.endsWith('.co.uk') ? 'GBP' : 'USD';
}

export function parseEbayMoney(
  value: string | null | undefined,
  fallbackCurrency: EbayMoney['currency'] = 'USD',
): EbayMoney | null {
  const text = cleanText(value);
  if (!text || /^(?:-|n\/a|unknown)$/i.test(text)) return null;
  const match = text.replace(/,/g, '').match(/(?:US|C|AU)?\s*\$\s*(-?\d+(?:\.\d{1,2})?)|(?:EUR|GBP)\s*(-?\d+(?:\.\d{1,2})?)|[\u00a3\u20ac]\s*(-?\d+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const amount = Number(match[1] ?? match[2] ?? match[3]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  let currency = fallbackCurrency;
  if (/\bC\s*\$/i.test(text)) currency = 'CAD';
  else if (/\bAU\s*\$/i.test(text)) currency = 'AUD';
  else if (/\bGBP\b|\u00a3/i.test(text)) currency = 'GBP';
  else if (/\bEUR\b|\u20ac/i.test(text)) currency = 'EUR';
  else if (/\bUS\s*\$/i.test(text)) currency = 'USD';
  return { amount, currency };
}

function sumMoney(left: EbayMoney | null, right: EbayMoney | null): EbayMoney | null {
  if (!left || !right || left.currency !== right.currency) return null;
  return { amount: Number((left.amount + right.amount).toFixed(2)), currency: left.currency };
}

function canonicalItemUrl(input: string): string | null {
  const itemId = extractEbayItemId(input);
  return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
}

function evidence(source: EbaySoldResultSource, itemId: string): IndependentEbaySoldEvidence {
  const provenanceSource: IndependentEbaySoldEvidenceSource = source === 'seller-hub-product-research'
    ? 'seller-hub-sold-record'
    : 'rendered-sold-listing';
  return { kind: 'independent-sold-evidence', source: provenanceSource, itemId };
}

function challengeText(root: ParentNode): string {
  if (root.nodeType === 9) {
    const documentRoot = root as Document;
    return cleanText(`${documentRoot.title} ${documentRoot.body?.textContent || ''}`);
  }
  return cleanText(root.textContent);
}

function isChallenge(root: ParentNode): boolean {
  return /pardon\s+our\s+interruption|verify\s+(?:that\s+)?you(?:'re|\s+are)\s+human|security\s+challenge|captcha/i.test(challengeText(root));
}

function isTrustedUsEbayUrl(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'www.ebay.com' || url.hostname === 'ebay.com');
}

function sellerHubSoldContext(root: ParentNode, url: URL): boolean {
  if (!isTrustedUsEbayUrl(url) || !/^\/sh\/research\/?$/i.test(url.pathname)) return false;
  if (url.searchParams.get('tabName')?.toUpperCase() !== 'SOLD') return false;
  const selectedTabs = [...root.querySelectorAll('[role="tab"],button')].filter((node) => (
    node.getAttribute('aria-selected') === 'true' || node.hasAttribute('selected')
  ));
  return selectedTabs.length === 0 || selectedTabs.some((node) => /^sold$/i.test(cleanText(node.textContent)));
}

function publicSoldContext(url: URL): boolean {
  return classifyEbayEvidenceUrl(url).kind === 'sold-search-seed';
}

function queryFromUrl(url: URL, source: EbaySoldResultSource): string {
  return cleanText(url.searchParams.get(source === 'seller-hub-product-research' ? 'keywords' : '_nkw'));
}

function pageInfo(url: URL, source: EbaySoldResultSource): { offset: number; limit: number | null } {
  if (source === 'public-sold-search') {
    const page = Number(url.searchParams.get('_pgn') || 1);
    return {
      offset: Number.isSafeInteger(page) && page > 0 ? page - 1 : 0,
      limit: 1,
    };
  }
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 0);
  return {
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
    limit: Number.isSafeInteger(limit) && limit > 0 ? limit : null,
  };
}

function attempt(
  source: EbaySoldResultSource,
  sourceUrl: string,
  observedAt: string,
  status: EbaySoldAttemptStatus,
  records: EbaySoldRecord[],
  hasNextPage: boolean,
  failureReason: string | null,
): EbaySoldSearchAttempt {
  const url = new URL(sourceUrl);
  const page = pageInfo(url, source);
  return {
    source,
    sourceUrl: url.href,
    query: queryFromUrl(url, source),
    observedAt,
    status,
    records,
    hasNextPage,
    pageOffset: page.offset,
    pageLimit: page.limit,
    failureReason,
  };
}

export function parseSellerHubProductResearch(
  root: ParentNode,
  sourceUrl: string,
  observedAt = new Date().toISOString(),
): EbaySoldSearchAttempt {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return attempt('seller-hub-product-research', 'https://www.ebay.com/sh/research', observedAt, 'parse-error', [], false, 'invalid-source-url');
  }
  if (isChallenge(root)) return attempt('seller-hub-product-research', url.href, observedAt, 'challenge', [], false, 'ebay-challenge');
  if (!sellerHubSoldContext(root, url)) return attempt('seller-hub-product-research', url.href, observedAt, 'not-sold-context', [], false, 'seller-hub-sold-tab-not-proven');

  const currency = marketplaceCurrency(url);
  const byId = new Map<string, EbaySoldRecord>();
  for (const row of root.querySelectorAll('tr.research-table-row')) {
    const link = row.querySelector<HTMLAnchorElement>('a.research-table-row__link-row-anchor[href*="/itm/"]');
    const dataId = row.querySelector<HTMLElement>('[data-item-id]')?.dataset.itemId || '';
    const itemId = dataId || extractEbayItemId(link?.href || '');
    const itemUrl = canonicalItemUrl(link?.href || '');
    const title = cleanText(link?.textContent || row.querySelector('img[alt]')?.getAttribute('alt'));
    if (!itemId || !itemUrl || !title) continue;
    const soldCell = textOf(row, '.research-table-row__avgSoldPrice');
    const shippingCell = textOf(row, '.research-table-row__avgShippingCost');
    const soldPrice = parseEbayMoney(soldCell, currency);
    const shippingPrice = /free\s+shipping/i.test(shippingCell) && !parseEbayMoney(shippingCell, currency)
      ? { amount: 0, currency }
      : parseEbayMoney(shippingCell, currency);
    const totalSold = parsePositiveInteger(textOf(row, '.research-table-row__totalSoldCount'));
    const totalSales = parseEbayMoney(textOf(row, '.research-table-row__totalSalesValue'), currency);
    const format = cleanText(row.querySelector('.research-table-row__avgSoldPrice .format')?.textContent) || null;
    const record: EbaySoldRecord = {
      source: 'seller-hub-product-research',
      sourceUrl: url.href,
      observedAt,
      itemId,
      itemUrl,
      title,
      imageUrl: row.querySelector<HTMLImageElement>('img[src]')?.src || null,
      soldPrice,
      shippingPrice,
      deliveredPrice: sumMoney(soldPrice, shippingPrice),
      totalSold,
      totalSales,
      soldAt: textOf(row, '.research-table-row__dateLastSold') || null,
      condition: textOf(row, '.research-table-row__condition') || null,
      format,
      priceKind: totalSold != null && totalSold > 1 ? 'average-actual' : 'actual',
      provenance: evidence('seller-hub-product-research', itemId),
    };
    if (!byId.has(itemId)) byId.set(itemId, record);
  }

  const next = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => /go\s+to\s+next\s+page/i.test(button.getAttribute('aria-label') || cleanText(button.textContent)));
  const hasNextPage = Boolean(next && !next.disabled && next.getAttribute('aria-disabled') !== 'true');
  const records = [...byId.values()];
  const noResults = records.length === 0 && /(?:0\s+results|no\s+(?:(?:matching|sold)\s+)?results|try\s+another\s+search)/i.test(challengeText(root));
  if (records.length === 0 && !noResults) return attempt('seller-hub-product-research', url.href, observedAt, 'parse-error', [], hasNextPage, 'sold-table-contained-no-parseable-records');
  return attempt('seller-hub-product-research', url.href, observedAt, noResults ? 'no-results' : 'ok', records, hasNextPage, null);
}

function publicResultElements(root: ParentNode): Element[] {
  const selectors = ['li.s-item', '.srp-results .s-item', '[data-view*="mi:1686"]'];
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      result.push(element);
    }
  }
  return result;
}

export function parsePublicEbaySoldSearch(
  root: ParentNode,
  sourceUrl: string,
  observedAt = new Date().toISOString(),
): EbaySoldSearchAttempt {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return attempt('public-sold-search', 'https://www.ebay.com/sch/i.html', observedAt, 'parse-error', [], false, 'invalid-source-url');
  }
  if (isChallenge(root)) return attempt('public-sold-search', url.href, observedAt, 'challenge', [], false, 'ebay-challenge');
  if (!publicSoldContext(url)) return attempt('public-sold-search', url.href, observedAt, 'not-sold-context', [], false, 'sold-and-completed-flags-not-proven');

  const currency = marketplaceCurrency(url);
  const byId = new Map<string, EbaySoldRecord>();
  for (const card of publicResultElements(root)) {
    const link = card.querySelector<HTMLAnchorElement>('a.s-item__link[href*="/itm/"],a[href*="/itm/"]');
    const itemId = extractEbayItemId(link?.href || '');
    const itemUrl = canonicalItemUrl(link?.href || '');
    const title = cleanText(card.querySelector('.s-item__title')?.textContent || link?.textContent);
    if (!itemId || !itemUrl || !title || /shop\s+on\s+ebay/i.test(title)) continue;
    const cardText = cleanText(card.textContent);
    const soldMarker = cleanText(card.querySelector('.s-item__caption--signal,.s-item__title--tagblock,.s-item__ended-date')?.textContent);
    if (!/\bsold\b/i.test(soldMarker)) continue;
    const bestOfferUnknown = /\b(?:best\s+offer\s+accepted|accepted\s+(?:best\s+)?offer|offer\s+accepted)\b/i.test(cardText);
    const soldPrice = bestOfferUnknown ? null : parseEbayMoney(textOf(card, '.s-item__price'), currency);
    const shippingText = textOf(card, '.s-item__shipping,.s-item__logisticsCost');
    const shippingPrice = /free\s+shipping/i.test(shippingText)
      ? { amount: 0, currency }
      : parseEbayMoney(shippingText, currency);
    const soldAt = soldMarker
      .replace(/^sold\s*/i, '') || null;
    const record: EbaySoldRecord = {
      source: 'public-sold-search',
      sourceUrl: url.href,
      observedAt,
      itemId,
      itemUrl,
      title,
      imageUrl: card.querySelector<HTMLImageElement>('img[src]')?.src || null,
      soldPrice,
      shippingPrice,
      deliveredPrice: sumMoney(soldPrice, shippingPrice),
      totalSold: 1,
      totalSales: soldPrice,
      soldAt,
      condition: textOf(card, '.SECONDARY_INFO,.s-item__subtitle') || null,
      format: textOf(card, '.s-item__purchase-options,.s-item__bidCount') || null,
      priceKind: bestOfferUnknown ? 'best-offer-unknown' : 'public-visible',
      provenance: evidence('public-sold-search', itemId),
    };
    if (!byId.has(itemId)) byId.set(itemId, record);
  }

  const next = root.querySelector<HTMLAnchorElement>('a.pagination__next[href],a[aria-label*="next" i][href]');
  const hasNextPage = Boolean(next && next.getAttribute('aria-disabled') !== 'true');
  const records = [...byId.values()];
  const noResults = records.length === 0 && /(?:0\s+results|no\s+exact\s+matches|no\s+matching\s+results)/i.test(challengeText(root));
  if (records.length === 0 && !noResults) return attempt('public-sold-search', url.href, observedAt, 'parse-error', [], hasNextPage, 'sold-search-contained-no-parseable-records');
  return attempt('public-sold-search', url.href, observedAt, noResults ? 'no-results' : 'ok', records, hasNextPage, null);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] ?? null
    : Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(2));
}

function compStatistics(records: VerifiedEbaySoldComp[]): EbaySoldCompStatistics {
  const priced = records.filter((record) => record.soldPrice && record.soldPrice.amount > 0 && record.soldPrice.currency !== 'UNKNOWN');
  const currencies = [...new Set(priced.map((record) => record.soldPrice!.currency))];
  if (currencies.length !== 1) {
    return { sampleSize: 0, salePriceMedian: null, salePriceLow: null, salePriceHigh: null, deliveredPriceMedian: null, currency: null };
  }
  const currency = currencies[0] ?? null;
  const salePrices = priced.map((record) => record.soldPrice!.amount);
  const deliveredPrices = priced
    .filter((record) => record.deliveredPrice?.currency === currency)
    .map((record) => record.deliveredPrice!.amount);
  return {
    sampleSize: salePrices.length,
    salePriceMedian: median(salePrices),
    salePriceLow: salePrices.length ? Math.min(...salePrices) : null,
    salePriceHigh: salePrices.length ? Math.max(...salePrices) : null,
    deliveredPriceMedian: median(deliveredPrices),
    currency,
  };
}

function quantityRejections(sourceQuantity: number | null, title: string): string[] {
  const candidateQuantity = extractLotQuantityFromTitle(title);
  if (sourceQuantity && sourceQuantity > 1) {
    if (!candidateQuantity) return [`quantity-ambiguous:source-${sourceQuantity}:candidate-unspecified`];
    if (candidateQuantity !== sourceQuantity) return [`quantity-mismatch:${sourceQuantity}:${candidateQuantity}`];
  } else if (candidateQuantity && candidateQuantity > 1) {
    return [`quantity-mismatch:1:${candidateQuantity}`];
  }
  return [];
}

function conditionRejections(source: ConditionAssessment | null | undefined, record: EbaySoldRecord): string[] {
  const candidateText = `${record.title}\n${record.condition || ''}`;
  const candidate = assessCondition(candidateText);
  const reasons: string[] = [];
  if (!source?.partsOnly && candidate.partsOnly) reasons.push('condition-mismatch:parts-only-comp');
  if (source?.partsOnly && !candidate.partsOnly) reasons.push('condition-mismatch:working-comp-for-parts-lot');
  const locked = /\b(?:(?:icloud|activation|google|frp|carrier|mdm)\s*[- ]?locked|bad\s+esn|blacklisted)\b/i;
  const sourceText = source ? [source.condition, source.freeText, ...Object.values(source.fields)].join(' ') : '';
  if (locked.test(candidateText) && !locked.test(sourceText)) reasons.push('condition-mismatch:locked-comp');
  if (source?.positive && /\b(?:untested|not\s+tested|unable\s+to\s+test|as[\s-]*is)\b/i.test(candidateText)) {
    reasons.push('condition-mismatch:untested-comp-for-working-lot');
  }
  if (source && /\b(?:new\s*[- ]*factory\s*sealed|factory\s*sealed|brand\s*new|new\s+in\s+(?:box|packaging)|sealed)\b/i.test(sourceText)
    && /\b(?:used|pre[\s-]?owned|open\s*box|refurbished|renewed)\b/i.test(candidateText)) {
    reasons.push('condition-mismatch:used-comp-for-new-lot');
  }
  return [...new Set(reasons)];
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function romanGeneration(value: string): number | null {
  const roman = value.toLocaleUpperCase('en-US');
  const values: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman[index]!] ?? 0;
    const next = values[roman[index + 1]!] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && total <= 20 ? total : null;
}

function canonicalModelExtension(value: string): string | null {
  const cleaned = cleanText(value);
  const suffix = cleaned.match(/^[-/]\s*(\d+)$/);
  if (suffix) return `suffix:${Number(suffix[1])}`;
  const generation = cleaned.match(/^(?:(?:mark|mk|gen|generation)\s*)?([ivx]+|\d+)$/i)?.[1];
  if (!generation) return null;
  const numeric = /^\d+$/.test(generation) ? Number(generation) : romanGeneration(generation);
  return numeric ? `generation:${numeric}` : null;
}

function modelExtension(text: string, model: string | null | undefined): string | null {
  const parts = cleanText(model).match(/[a-z0-9]+/gi) || [];
  if (!parts.length) return null;
  const match = new RegExp(parts.map(escapePattern).join('[^a-z0-9]*'), 'i').exec(text);
  if (!match) return null;
  const tail = text.slice(match.index + match[0].length);
  const extension = tail.match(/^\s*((?:(?:mark|mk|gen|generation)\s*(?:[ivx]+|\d+)|[ivx]{1,4}|[-/]\s*\d+))\b/i)?.[1];
  return extension ? canonicalModelExtension(extension) : null;
}

function modelVariantRejections(source: ProductIdentity, candidateTitle: string): string[] {
  if (!source.model) return [];
  const candidateExtension = modelExtension(candidateTitle, source.model);
  const sourceExtension = modelExtension(source.name, source.model);
  if (sourceExtension === candidateExtension) return [];
  if (!sourceExtension && !candidateExtension) return [];
  return [`model-extension-mismatch:${source.model}:${candidateExtension || 'none'}`];
}

function bundleRejections(source: ProductIdentity, candidateTitle: string): string[] {
  const explicitBundle = /(?:\bbundle\s*(?:with|includes?|\+|:)|\b(?:w\/|with|includes?)\s+(?:[^,;]{0,30}\b)?(?:game|controller|case|battery|charger|lens|remote|stand|mount|accessor(?:y|ies))\b)/i;
  return explicitBundle.test(candidateTitle) && !explicitBundle.test(source.name)
    ? ['candidate-only-bundle']
    : [];
}

function bookMediaRejections(source: ProductIdentity, candidateTitle: string): string[] {
  if (!explicitBookTitleFromName(source.name) && !/\b(?:book|novel|hardcover|paperback|isbn|edition)\b/i.test(source.name)) return [];
  const reasons: string[] = [];
  const sourceText = source.name;
  const alternateMedia = /\b(?:audio\s*book|audiobook|audio\s*(?:cd|disc)|\d+\s*[- ]?cd\s+set|dvd|e[\s-]?book|kindle|summary|study\s+guide)\b/i;
  if (alternateMedia.test(candidateTitle) && !alternateMedia.test(sourceText)) reasons.push('book-media-mismatch');
  if (/\bhardcover\b/i.test(sourceText) && /\b(?:paperback|international\s+edition)\b/i.test(candidateTitle)) reasons.push('book-format-mismatch');
  return reasons;
}

function credibleCandidateModel(title: string, source: ProductIdentity): string | null {
  const sourceModel = source.model?.replace(/[^a-z0-9]/gi, '').toLocaleUpperCase('en-US') || '';
  const compactTitle = title.replace(/[^a-z0-9]/gi, '').toLocaleUpperCase('en-US');
  if (sourceModel && compactTitle.includes(sourceModel)) return source.model!.toLocaleUpperCase('en-US');
  const model = extractProductIdentity(title).model;
  if (!model) return null;
  const compact = model.replace(/[^a-z0-9+.-]/gi, '');
  if (!compact || /^(?:[458]k|720p|1080p|1440p|2160p|\d+ansi|wifi\d*|bt\d*)$/i.test(compact)) return null;
  if (/^(?:projector|monitor|television|tv|receiver|console)\d+(?:ansi|hz|p)?$/i.test(compact)) return null;
  return compact.toLocaleUpperCase('en-US');
}

function candidateOnlyVariantSignals(title: string, source: ProductIdentity): string[] {
  const expected = source.discriminators || extractProductDiscriminators(source.name);
  const actual = extractProductDiscriminators(title);
  const signals: string[] = [];
  for (const group of ['editions', 'capacities'] as const) {
    if (expected[group].length === 0 && actual[group].length > 0) {
      signals.push(...actual[group].map((value) => `${group}:${value}`));
    }
  }
  const region = /\b(?:japanese?|japan)\s+(?:import|region)|\bpal\s+(?:console|system|version)\b/i.test(title)
    ? 'region:import'
    : null;
  if (region && !/\b(?:japanese?|japan)\s+(?:import|region)|\bpal\s+(?:console|system|version)\b/i.test(source.name)) signals.push(region);
  return [...new Set(signals)];
}

function trustedSoldSourceUrl(source: EbaySoldResultSource, value: string): boolean {
  try {
    const url = new URL(value);
    if (source === 'seller-hub-product-research') {
      return isTrustedUsEbayUrl(url)
        && /^\/sh\/research\/?$/i.test(url.pathname)
        && url.searchParams.get('tabName')?.toUpperCase() === 'SOLD';
    }
    return classifyEbayEvidenceUrl(url).kind === 'sold-search-seed';
  } catch {
    return false;
  }
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizedQuery(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attemptedQueriesArePlannedPrefix(plannedQueries: string[], attemptedQueries: string[]): boolean {
  const planned = plannedQueries.map(normalizedQuery);
  const attempted = attemptedQueries.map(normalizedQuery);
  return attempted.length > 0
    && attempted.length <= planned.length
    && attempted.every((query, index) => planned[index] === query);
}

function resultPaginationComplete(attempts: EbaySoldSearchAttempt[]): boolean {
  if (!attempts.length) return false;
  const groups = new Map<string, EbaySoldSearchAttempt[]>();
  for (const entry of attempts) {
    const key = `${entry.source}:${normalizedQuery(entry.query)}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].every((group) => {
    const pages = [...group].sort((left, right) => left.pageOffset - right.pageOffset);
    if (pages[0]?.pageOffset !== 0) return false;
    if (new Set(pages.map((page) => page.pageOffset)).size !== pages.length) return false;
    for (let index = 0; index < pages.length - 1; index += 1) {
      const page = pages[index]!;
      const next = pages[index + 1]!;
      if (!page.hasNextPage || !page.pageLimit || next.pageOffset !== page.pageOffset + page.pageLimit) return false;
    }
    return pages.at(-1)?.hasNextPage === false;
  });
}

function duplicateRecordSignature(search: EbaySoldSearchAttempt, record: EbaySoldRecord): string {
  return JSON.stringify({
    searchSource: search.source,
    recordSource: record.source,
    trustedSearch: trustedSoldSourceUrl(search.source, search.sourceUrl),
    trustedRecord: trustedSoldSourceUrl(record.source, record.sourceUrl),
    title: normalizedQuery(record.title),
    soldPrice: record.soldPrice,
    shippingPrice: record.shippingPrice,
    priceKind: record.priceKind,
  });
}

export function verifyEbaySoldCompSet(
  identity: ProductIdentity,
  attempts: EbaySoldSearchAttempt[],
  options: VerifyEbaySoldCompOptions,
): EbaySoldCompVerification {
  const minimumSampleSize = Math.max(1, Math.floor(options.minimumSampleSize ?? 3));
  const plannedQueries = [...new Set(options.plannedQueries.map(cleanText).filter(Boolean))];
  const attemptedQueries = uniqueInOrder(attempts.map((entry) => cleanText(entry.query)).filter(Boolean));
  const attemptedQueryKeys = new Set(attemptedQueries.map(normalizedQuery));
  const allPlannedQueriesAttempted = plannedQueries.length > 0
    && plannedQueries.every((query) => attemptedQueryKeys.has(normalizedQuery(query)));
  const accepted: VerifiedEbaySoldComp[] = [];
  const rejected: EbaySoldRecordRejection[] = [];
  const duplicateItemIds: string[] = [];
  const explicitBookTitle = explicitBookTitleFromName(identity.name);
  const bookIdentity = explicitBookTitle ? extractProductIdentity(explicitBookTitle) : null;
  const comparisonIdentity = bookIdentity
    ? { ...bookIdentity, brand: '', model: explicitBookTitle }
    : identity;

  const recordGroups = new Map<string, Array<{ search: EbaySoldSearchAttempt; record: EbaySoldRecord }>>();
  for (const search of attempts.filter((entry) => entry.status === 'ok')) {
    for (const record of search.records) {
      const group = recordGroups.get(record.itemId) ?? [];
      group.push({ search, record });
      recordGroups.set(record.itemId, group);
    }
  }

  for (const [itemId, group] of recordGroups) {
    if (group.length > 1) duplicateItemIds.push(itemId);
    const signatures = new Set(group.map(({ search, record }) => duplicateRecordSignature(search, record)));
    const first = group[0]!;
    if (signatures.size > 1) {
      rejected.push({
        itemId,
        title: first.record.title,
        itemUrl: first.record.itemUrl,
        query: first.search.query,
        reasons: ['duplicate-record-conflict'],
      });
      continue;
    }
    const { search, record } = first;
    const reasons: string[] = [];
    if (record.source !== search.source || !trustedSoldSourceUrl(search.source, search.sourceUrl) || !trustedSoldSourceUrl(record.source, record.sourceUrl)) {
      reasons.push('untrusted-sold-source');
    }
    const soldEvidence = assessEbayEvidenceUrl(record.itemUrl, record.provenance);
    if (!soldEvidence.verifiedSoldComp) reasons.push('unverified-sold-provenance');
    const evaluation = evaluateRetailCandidate(record.title, comparisonIdentity);
    if (!evaluation.accepted) reasons.push(...evaluation.rejectionReasons);
    if (!record.soldPrice) reasons.push(record.priceKind === 'best-offer-unknown' ? 'best-offer-price-not-public' : 'missing-sold-price');
    if (record.soldPrice && record.soldPrice.amount <= 0) reasons.push('nonpositive-sold-price');
    if (record.soldPrice?.currency !== 'USD') reasons.push(`unsupported-currency:${record.soldPrice?.currency || 'unknown'}`);
    reasons.push(...quantityRejections(options.sourceQuantity ?? null, record.title));
    reasons.push(...conditionRejections(options.sourceCondition, record));
    reasons.push(...modelVariantRejections(comparisonIdentity, record.title));
    reasons.push(...bundleRejections(comparisonIdentity, record.title));
    reasons.push(...bookMediaRejections(identity, record.title));
    if (reasons.length) {
      rejected.push({ itemId: record.itemId, title: record.title, itemUrl: record.itemUrl, query: search.query, reasons: [...new Set(reasons)] });
      continue;
    }
    accepted.push({
      ...record,
      query: search.query,
      evaluation,
      candidateModel: explicitBookTitle ? null : credibleCandidateModel(record.title, comparisonIdentity),
      candidateVariantSignals: explicitBookTitle ? [] : candidateOnlyVariantSignals(record.title, comparisonIdentity),
    });
  }

  const statistics = compStatistics(accepted);
  const variantModels = [...new Set(accepted.map((record) => record.candidateModel).filter((value): value is string => Boolean(value)))];
  const variantSignals = [...new Set(accepted.flatMap((record) => record.candidateVariantSignals))];
  const matchConfidence: EbaySoldMatchConfidence = accepted.length === 0
    ? 'none'
    : identity.model
      ? 'exact-model'
      : variantModels.length > 0 || variantSignals.length > 0
        ? 'variant-ambiguous'
        : 'title-family';
  const completePages = resultPaginationComplete(attempts);
  const targetReached = statistics.sampleSize >= minimumSampleSize;
  const attempted = attempts.length > 0;
  const blocked = attempts.some((entry) => entry.status === 'challenge');
  const parseFailure = attempts.some((entry) => entry.status === 'parse-error' || entry.status === 'not-sold-context');
  const plannedPrefix = attemptedQueriesArePlannedPrefix(plannedQueries, attemptedQueries);
  const cleanCoverage = attempted && plannedPrefix && completePages && !blocked && !parseFailure;
  const terminal = cleanCoverage && allPlannedQueriesAttempted;
  const insufficiencyReasons: string[] = [];
  if (!attempted) insufficiencyReasons.push('no-search-attempts');
  if (!plannedPrefix && attempted) insufficiencyReasons.push('attempted-queries-not-planned-prefix');
  if (!allPlannedQueriesAttempted && !targetReached) insufficiencyReasons.push('planned-queries-not-all-attempted');
  if (!completePages && attempted) insufficiencyReasons.push('result-pagination-incomplete');
  if (blocked) insufficiencyReasons.push('ebay-challenge');
  if (parseFailure) insufficiencyReasons.push('result-page-not-verified');
  if (!targetReached) insufficiencyReasons.push(`verified-sample-below-minimum:${statistics.sampleSize}/${minimumSampleSize}`);
  if (matchConfidence === 'variant-ambiguous') insufficiencyReasons.push('variant-ambiguous');

  let status: EbaySoldVerificationStatus;
  if (!attempted) status = 'not-attempted';
  else if (blocked) status = 'blocked';
  else if (parseFailure || !cleanCoverage) status = 'incomplete';
  else if (targetReached && matchConfidence !== 'variant-ambiguous') status = 'verified';
  else if (!terminal) status = 'incomplete';
  else status = 'insufficient';

  return {
    status,
    attempted,
    allPlannedQueriesAttempted,
    completePages,
    matchConfidence,
    marketValueReady: status === 'verified' && cleanCoverage,
    variantModels,
    variantSignals,
    plannedQueries,
    attemptedQueries,
    accepted,
    rejected,
    duplicateItemIds: [...new Set(duplicateItemIds)],
    statistics,
    insufficiencyReasons,
  };
}
