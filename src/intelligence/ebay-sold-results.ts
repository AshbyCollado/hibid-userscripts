import {
  assessCondition,
  buildProductResearchQuery,
  evaluateRetailCandidate,
  extractLotQuantityFromTitle,
  extractProductDiscriminators,
  extractProductIdentity,
  getLimitedTestingCautions,
  missingMajorComponentRejections,
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
export type EbaySoldQueryPlanVersion = 'legacy-v1' | 'short-model-v2';

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
  'heavy', 'duty', 'capacity', 'lb', 'lbs',
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

function jewelrySellerAbbreviationFallback(identity: ProductIdentity): string | null {
  if (identity.model || identity.model2) return null;
  const query = identity.query;
  const tokens = query.split(/\s+/).filter(Boolean);
  const tokenCore = (token: string): string => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  const hasSellerAbbreviation = tokens.some((token) => /^(?:antq|vntg)$/i.test(tokenCore(token)));
  const hasJewelryMaterial = /\b(?:sterling|silver|gold|925)\b/i.test(query);
  const hasJewelryObject = /\b(?:pin|buckle|pendant|necklace|earring|bracelet|ring)\b/i.test(query);
  const hasExplicitJewelryContext = /\b(?:jewelry|jewellery)\b/i.test(query);
  const hasToolContext = /\b(?:broaching|cutting|drill(?:ing)?|ream(?:er|ing)?|tools?|tooling|hss|milling|lathe|tap|die)\b|\bguide\s+pin\b/i.test(query);
  if ((!hasSellerAbbreviation && !/\bbroach\b/i.test(query))
    || !hasJewelryMaterial
    || (!hasJewelryObject && !hasExplicitJewelryContext)
    || (/\bbroach\b/i.test(query) && hasToolContext)) return null;

  const fallback = tokens
    .filter((token) => !/^(?:antq|vntg)$/i.test(tokenCore(token)))
    .map((token) => /^(?:broach)$/i.test(tokenCore(token)) ? token.replace(/broach/i, 'brooch') : token)
    .join(' ');
  return fallback && normalizedQuery(fallback) !== normalizedQuery(query) ? fallback : null;
}

function apparelFallbackQuery(identity: ProductIdentity): string | null {
  if (identity.model || identity.model2 || !identity.brand) return null;
  const query = normalizedQuery(identity.query);
  const placeholderBrand = /^(?:generic|unknown|unbranded|no|none|n\/?a|na|brandless)$/i.test(cleanText(identity.brand))
    || /\b(?:generic|unknown|unbranded|brandless|no[\s-]+brand|no[\s-]+name)\b/i.test(query);
  if (placeholderBrand) return null;

  const letterSize = '(?:xxxs?|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl)';
  const sizeMatch = query.match(new RegExp(
    `\\b(?:size|sz)\\s*[:#-]?\\s*((?:${letterSize}(?:\\s*\\/\\s*${letterSize})?|\\d{1,2}(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?(?:\\s*[-\\u2013\\u2014]\\s*\\d{1,2}(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?)?\\s*[wrl]?))\\b`,
    'i',
  ));
  if (!sizeMatch?.[1] || sizeMatch.index === undefined) return null;
  // A separator immediately after the match means a size continuation that
  // this deliberately small grammar did not understand. Do not truncate it.
  const sizeEnd = sizeMatch.index + sizeMatch[0].length;
  if (/^\s*[\/\u2013\u2014-]|^\s*[a-z0-9]/i.test(query.slice(sizeEnd))) return null;
  const size = sizeMatch[1]
    .replace(/\s*([\/\u2013\u2014-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .toUpperCase();

  const garment = query.match(/\b(?:t[- ]?shirts?|tees?|shirts?|blouses?|tops?|sweaters?|sweatshirts?|hoodies?|jackets?|coats?|blazers?|cardigans?|vests?|dresses?|skirts?|pants?|jeans?|shorts?|trousers?|leggings?|rompers?|jumpsuits?|overalls?|swimsuits?|bikinis?|bras?|underwear|socks?|shoes?|boots?|sandals?)\b/i)?.[0];
  if (!garment) return null;
  if (/\b(?:books?|patterns?|sewing|crafts?|tools?|tooling|electronics?|organizers?|organisers?)\b/i.test(query)) return null;

  // Keep only a small set of recognizable patterns; fabric, fit, and sales
  // language is deliberately excluded from this discovery-only fallback.
  const pattern = query.match(/\b(?:plaid|tartan|floral|striped?|checkered?|paisley|polka[- ]?dot(?:ted)?|houndstooth|argyle|camo(?:uflage)?|tie[- ]?dye)\b/i)?.[0];
  const fallback = [identity.brand, pattern, garment, size]
    .filter(Boolean)
    .join(' ');
  return normalizedQuery(fallback) !== normalizedQuery(identity.query) ? fallback : null;
}

function modelFreeSkuQuery(identity: ProductIdentity): string | null {
  const model = identity.model || '';
  const compactModel = model.replace(/[^a-z0-9]/gi, '');
  const hasLongHyphenSku = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(model)
    && compactModel.length >= 12 && (compactModel.match(/\d/g) || []).length >= 4;
  const hasSkuShape = (/^[a-z]{2,}[a-z0-9]*(?:\/[a-z0-9]+)?$/i.test(model)
    && (compactModel.match(/\d/g) || []).length >= 2) || hasLongHyphenSku;
  const hasSkuAlias = model.includes('/') || hasLongHyphenSku
    || /\b[A-Z0-9][A-Z0-9+.-]*\/[A-Z0-9]+\b/i.test(identity.name);
  if (!hasSkuShape || !hasSkuAlias) return null;
  const models = [identity.model, identity.model2].filter(Boolean)
    .map((value) => value!.replace(/[^a-z0-9]/gi, '').toLocaleLowerCase('en-US'));
  const productName = identity.query.split(/\s+/)
    .filter((token) => {
      const compact = token.replace(/[^a-z0-9]/gi, '').toLocaleLowerCase('en-US');
      return !models.some((model) => compact.includes(model));
    })
    .join(' ');
  const query = buildProductResearchQuery(hasLongHyphenSku
    ? productName.replace(/\b\d+(?:\.\d+)?\s*(?:lb|lbs|pounds?)\b/gi, ' ')
    : productName);
  return query.split(/\s+/).length >= 2 ? query : null;
}

function joinedModelVariantQuery(identity: ProductIdentity): string | null {
  const model = cleanText(identity.model);
  if (!identity.brand || !model || /\s/.test(model)) return null;
  const match = /^(.*\d)(Plus|Pro|Max|Mini|Ultra)$/i.exec(model);
  if (!match || !match[1]) return null;
  return [identity.brand, match[1], match[2]].join(' ');
}

function explicitBookTitleFromName(name: string): string | null {
  return cleanText(
    name.match(/^(.+?)\s+(?:book|novel)\s+by\s+.+$/i)?.[1]
      || name.match(/^(.+?)\s+(?:book|novel)$/i)?.[1],
  ) || null;
}

function brandModelQuery(identity: ProductIdentity): string {
  const brand = cleanText(identity.brand);
  const model = cleanText(identity.model);
  if (!brand) return model;
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`^${escapedBrand}(?=$|[^A-Za-z0-9])`, 'i').test(model)
    ? model : [brand, model].filter(Boolean).join(' ');
}

function isRecognizedPlaceholderBrand(brand: string): boolean {
  return /^(?:unknown|unbranded|generic|n\/?a|na|no(?:\s+brand|\s+name)?|none|brandless)$/i.test(cleanText(brand));
}

export function buildEbaySoldQueryVariants(
  identity: ProductIdentity,
  maximum = 3,
  queryPlanVersion: EbaySoldQueryPlanVersion = 'short-model-v2',
): string[] {
  const limit = Math.max(1, Math.min(3, Math.floor(maximum)));
  const variants: string[] = [];
  addUniqueQuery(variants, identity.query);
  const jewelryFallback = jewelrySellerAbbreviationFallback(identity);
  if (jewelryFallback) addUniqueQuery(variants, jewelryFallback);
  const apparelFallback = apparelFallbackQuery(identity);
  if (apparelFallback) addUniqueQuery(variants, apparelFallback);

  if (identity.model) {
    const modelFreeQuery = modelFreeSkuQuery(identity);
    if (modelFreeQuery) addUniqueQuery(variants, modelFreeQuery);
    const productBeforeBundle = identity.name.match(/^(.+?)\s+(?:w\/|with|including|includes)\s+.+$/i)?.[1];
    if (productBeforeBundle) {
      const coreQuery = buildProductResearchQuery(productBeforeBundle);
      const modelQuery = brandModelQuery(identity);
      if (coreQuery.split(/\s+/).some((token) => token.toLocaleLowerCase('en-US') === identity.model?.toLocaleLowerCase('en-US'))
        && coreQuery.split(/\s+/).length > modelQuery.split(/\s+/).length) {
        addUniqueQuery(variants, coreQuery);
      }
    }
    const joinedVariantQuery = joinedModelVariantQuery(identity);
    if (joinedVariantQuery) addUniqueQuery(variants, joinedVariantQuery);
    addUniqueQuery(variants, brandModelQuery(identity));
    // Short model codes recur across unrelated brands and product categories.
    if (!identity.brand
      || isRecognizedPlaceholderBrand(identity.brand)
      || queryPlanVersion === 'legacy-v1'
      || identity.model.replace(/[^A-Za-z0-9]/g, '').length > 4) {
      addUniqueQuery(variants, identity.model);
    }
  } else {
    const isbn = identity.name.match(/\b(?:97[89][\s-]?)?\d(?:[\s-]?\d){8,12}[\s-]?[\dXx]\b/)?.[0]
      ?.replace(/[^\dXx]/g, '');
    if (isbn) addUniqueQuery(variants, isbn);
    const explicitBookTitle = explicitBookTitleFromName(identity.name);
    if (explicitBookTitle) {
      addUniqueQuery(variants, explicitBookTitle);
      addUniqueQuery(variants, `"${explicitBookTitle.replace(/"/g, '')}"`);
    }
    const gasTrimmerDisplacement = /\b(?:gas|gasoline)\b/i.test(identity.query)
      && /\btrimmer\b/i.test(identity.query)
      ? identity.query.match(/\b(\d+(?:\.\d+)?)cc\b/i)?.[1] : null;
    if (gasTrimmerDisplacement) {
      addUniqueQuery(variants, [identity.brand, `${gasTrimmerDisplacement}cc`, 'gas', 'trimmer'].filter(Boolean).join(' '));
    }
    const coreTokens = identity.query
      .replace(/\b(\d+(?:\.\d+)?)\s+(hp|btu|gpm|gph|psi|rpm)\b/gi, '$1$2')
      .replace(/\b\d+\s+in\s+\d+\b/gi, ' ')
      .split(/\s+/)
      .filter((token) => (token.length > 2 || /\d/.test(token))
        && !EBAY_QUERY_NOISE.has(token.toLocaleLowerCase('en-US'))
        && !/^\d+[a-z]?\/\d+(?:[a-z]+)?$/i.test(token)
        && !/^\d+(?:\.\d+)?[-–]\d+(?:\.\d+)?$/.test(token))
      .slice(0, 6);
    const coreSet = new Set(coreTokens.map((token) => token.toLocaleLowerCase('en-US')));
    const includedNouns = [...new Set((identity.includedComponents || []).flat()
      .filter((token) => !/^\d+$/.test(token)
        && !/^accessor(?:y|ies)$/i.test(token)
        && !/^adapter$/i.test(token)
        && !coreSet.has(token.toLocaleLowerCase('en-US'))))];
    // Generic token shortening cannot safely preserve an unfamiliar size.
    const canShortenGeneric = !apparelFallback && !/\b(?:size|sz)\s*[:#-]?\s*[a-z0-9]/i.test(identity.query);
    if (canShortenGeneric && coreTokens.length >= 2 && includedNouns.length) {
      addUniqueQuery(variants, [...coreTokens, ...includedNouns.slice(0, 2)].join(' '));
    }
    if (canShortenGeneric && coreTokens.length >= 2) addUniqueQuery(variants, coreTokens.join(' '));
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

function isVisibleUiElement(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden')?.toLowerCase() === 'true') return false;
    const inlineStyle = current.getAttribute('style') || '';
    if (/(?:^|;)\s*(?:display|visibility)\s*:\s*(?:none|hidden)\b/i.test(inlineStyle)) return false;
    const view = current.ownerDocument.defaultView;
    if (view) {
      const computedStyle = view.getComputedStyle(current);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return false;
    }
  }
  return true;
}

function sellerHubQueryServerError(root: ParentNode): boolean {
  function visibleText(node: Node): string {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType === 1 && (!isVisibleUiElement(node as Element)
      || /^(?:script|style|template)$/i.test((node as Element).tagName))) return '';
    return [...node.childNodes].map(visibleText).join(' ');
  }
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="alert"]')]
    .some((element) => isVisibleUiElement(element)
      && /our\s+server\s+failed\s+to\s+respond\s+to\s+your\s+query/i.test(cleanText(visibleText(element))));
}

function sellerHubRowIdentity(row: Element): { itemId: string; itemUrl: string; title: string } | null {
  const links = [...row.querySelectorAll<HTMLAnchorElement>('a.research-table-row__link-row-anchor[href*="/itm/"]')];
  const productIds = new Set(row.querySelectorAll<Element>(
    '.research-table-row__product-info-name[data-item-id],.research-table-row__product-info-name [data-item-id]',
  ));
  const itemIds = new Set<string>();
  for (const link of links) {
    const linkedId = extractEbayItemId(link.href);
    if (!linkedId) return null;
    itemIds.add(linkedId);
    if (link.hasAttribute('data-item-id')) productIds.add(link);
    for (const element of link.querySelectorAll('[data-item-id]')) productIds.add(element);
  }
  for (const element of productIds) {
    const dataId = element.getAttribute('data-item-id') || '';
    if (!/^\d{9,15}$/.test(dataId) || dataId !== dataId.trim()) return null;
    itemIds.add(dataId);
  }
  if (itemIds.size !== 1) return null;
  const itemId = [...itemIds][0];
  if (!itemId) return null;

  const title = cleanText(row.querySelector('.research-table-row__product-info-name')?.textContent)
    || cleanText(links[0]?.textContent)
    || cleanText(row.querySelector('img[alt]')?.getAttribute('alt'));
  if (!title || /^item\s+id\b/i.test(title)) return null;
  return { itemId, itemUrl: `https://www.ebay.com/itm/${itemId}`, title };
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
  const records: EbaySoldRecord[] = [];
  for (const row of root.querySelectorAll('tr.research-table-row')) {
    const identity = sellerHubRowIdentity(row);
    if (!identity) continue;
    const { itemId, itemUrl, title } = identity;
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
    // Keep repeated rows until verification can distinguish identical captures
    // from contradictory paid amounts, quantities, dates or conditions.
    records.push(record);
  }

  const next = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => /go\s+to\s+next\s+page/i.test(button.getAttribute('aria-label') || cleanText(button.textContent)));
  const hasNextPage = Boolean(next && !next.disabled && next.getAttribute('aria-disabled') !== 'true');
  if (records.length === 0 && sellerHubQueryServerError(root)) {
    return attempt('seller-hub-product-research', url.href, observedAt, 'parse-error', [], hasNextPage, 'seller-hub-query-server-error');
  }
  const noResults = records.length === 0 && /(?:0\s+results|no\s+(?:(?:matching|sold)\s+)?results|try\s+another\s+search|your\s+search\s+did(?:\s+not|n['’]t)\s+return\s+any\s+results)/i.test(challengeText(root));
  if (records.length === 0 && !noResults) return attempt('seller-hub-product-research', url.href, observedAt, 'parse-error', [], hasNextPage, 'sold-table-contained-no-parseable-records');
  return attempt('seller-hub-product-research', url.href, observedAt, noResults ? 'no-results' : 'ok', records, hasNextPage, null);
}

function publicResultElements(root: ParentNode, rewriteBoundary: Element | null = null): Element[] {
  const selectors = ['.srp-results > li.s-item', '.srp-results > li.s-card[id^="item"]', '.srp-results > [data-view*="mi:1686"]'];
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      if (rewriteBoundary && Boolean(rewriteBoundary.compareDocumentPosition(element) & 4)) continue;
      seen.add(element);
      result.push(element);
    }
  }
  return result;
}

function publicSoldPrice(card: Element, currency: EbayMoney['currency']): EbayMoney | null {
  const priceSelector = '.s-item__price,.s-card__price';
  const originalPriceSelector = 's,strike,del,[class*="strikethrough" i],[style*="line-through" i],.s-item__original-price,.s-card__original-price';
  const parts: string[] = [];
  for (const price of card.querySelectorAll(priceSelector)) {
    if (price.closest(originalPriceSelector) || price.parentElement?.closest(priceSelector)) continue;
    const visiblePrice = price.cloneNode(true) as Element;
    for (const original of visiblePrice.querySelectorAll(`${originalPriceSelector},.clipped`)) original.remove();
    parts.push(cleanText(visiblePrice.textContent));
  }
  const text = parts.filter(Boolean).join(' ');
  // Ranges and multiple unmarked amounts do not establish a single sold price.
  if (text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.length !== 1 || /\b(?:from|starting|to)\b/i.test(text)) return null;
  return parseEbayMoney(text, currency);
}

function explicitlyHasNoExactMatches(root: ParentNode): boolean {
  return [...root.querySelectorAll('#srp-results-heading,.srp-controls__count-heading')]
    .some((heading) => !heading.closest('aside,nav,footer,.s-item,.s-card,[hidden],[aria-hidden="true"],[style*="display:none" i],[style*="display: none" i]')
      && /(?:\b0\s+results?\b|no\s+exact\s+matches?\s+found)/i.test(cleanText(heading.textContent)));
}

function visibleUiText(node: Node): string {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType === 1 && (!isVisibleUiElement(node as Element)
    || /^(?:script|style|template)$/i.test((node as Element).tagName))) return '';
  return [...node.childNodes].map(visibleUiText).join(' ');
}

function publicSearchQueryWasCorrected(root: ParentNode, url: URL): boolean {
  const originalQuery = normalizedQuery(queryFromUrl(url, 'public-sold-search'));
  if (!originalQuery) return false;
  return [...root.querySelectorAll('#srp-results-heading,.srp-controls__count-heading')].some((heading) => {
    if (!isVisibleUiElement(heading) || heading.closest('aside,nav,footer,.s-item,.s-card')) return false;
    const headingQuery = cleanText(visibleUiText(heading)).match(/^[\d,]+\+?\s+results?\s+for\s+(.+)$/i)?.[1];
    if (!headingQuery || normalizedQuery(headingQuery) === originalQuery) return false;
    const notices = [...root.querySelectorAll('.section-notice__main')].filter((notice) => {
      if (!isVisibleUiElement(notice) || notice.closest('aside,nav,footer,.s-item,.s-card')) return false;
      const noticeText = cleanText(visibleUiText(notice));
      return new RegExp(`including\\s+results\\s+for\\s+${escapePattern(headingQuery)}(?:\\.|$)`, 'i').test(noticeText)
        && /search\s+instead\s+for/i.test(noticeText);
    });
    const colocatedScope = heading.closest('.srp-controls');
    if (colocatedScope && isVisibleUiElement(colocatedScope)
      && !notices.some((notice) => colocatedScope.contains(notice))) {
      const noticeText = cleanText(visibleUiText(colocatedScope));
      if (/including\s+results\s+for/i.test(noticeText) && /search\s+instead\s+for/i.test(noticeText)) {
        notices.push(colocatedScope);
      }
    }
    return notices.some((notice) => [...notice.querySelectorAll<HTMLAnchorElement>('a[href]')].some((link) => {
      if (!isVisibleUiElement(link) || link.closest('aside,nav,footer,.s-item,.s-card')) return false;
      try {
        const retryUrl = new URL(link.href, url.href);
        const linkText = cleanText(visibleUiText(link));
        const displayedOriginal = normalizedQuery(linkText.replace(/^search\s+instead\s+for\s+/i, '').replace(/[.!?]+$/, ''));
        return isTrustedUsEbayUrl(retryUrl)
          && /^\/sch\/i\.html\/?$/i.test(retryUrl.pathname)
          && retryUrl.searchParams.get('_blrs')?.toLowerCase() === 'spell_auto_correct'
          && normalizedQuery(retryUrl.searchParams.get('_nkw')) === originalQuery
          && displayedOriginal === originalQuery;
      } catch {
        return false;
      }
    }));
  });
}

function publicResultCondition(card: Element): string | null {
  const candidates = [...card.querySelectorAll('.SECONDARY_INFO,.s-item__subtitle,.s-card__subtitle')]
    .map((node) => cleanText(node.textContent)).filter(Boolean);
  const conditionPrefix = /^(?:item\s+)?condition\s*:\s*/i;
  // Subtitles also contain promotions; recognize complete labels, not words such as "New".
  const labels = [
    /^(?:brand\s+)?new(?:\s+(?:\(?other\)?(?:\s*\(see details\))?|with(?:out)?\s+(?:tags|box)|with\s+defects))?$/i,
    /^(?:used|pre[- ]owned|like new|very good|good|acceptable|open[- ]box)$/i,
    /^(?:(?:certified|seller|manufacturer|excellent|very good|good)\s*(?:-\s*)?)?refurbished$/i,
    /^(?:for\s+parts\s+or\s+not\s+working|parts\s+only|parts\s+or\s+repair)$/i,
  ];
  return candidates.find((text) => labels.some((label) => label.test(text.replace(conditionPrefix, ''))))
    ?? candidates.find((text) => conditionPrefix.test(text))
    ?? null;
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
  const next = root.querySelector<HTMLAnchorElement>('a.pagination__next[href],a[aria-label*="next" i][href]');
  const hasNextPage = Boolean(next && next.getAttribute('aria-disabled') !== 'true');
  if (publicSearchQueryWasCorrected(root, url)) {
    return attempt('public-sold-search', url.href, observedAt, 'parse-error', [], hasNextPage, 'sold-search-query-corrected');
  }
  const resultRootElement = root.querySelector('#srp-river-results');
  const resultRoot = resultRootElement || root;
  const rewriteBoundary = resultRoot.querySelector('.srp-river-answer--REWRITE_START');
  const resultCards = publicResultElements(resultRoot, rewriteBoundary);
  const explicitNoExactMatches = (!rewriteBoundary || resultCards.length === 0) && explicitlyHasNoExactMatches(root);
  const byId = new Map<string, EbaySoldRecord>();
  for (const card of resultCards) {
    const titleNode = card.querySelector('.s-item__title,.s-card__title');
    const link = titleNode?.closest<HTMLAnchorElement>('a[href*="/itm/"]')
      || card.querySelector<HTMLAnchorElement>('a.s-item__link[href*="/itm/"],a.s-card__link[href*="/itm/"],a[href*="/itm/"]');
    const itemId = extractEbayItemId(link?.href || '');
    const itemUrl = canonicalItemUrl(link?.href || '');
    const titleCopy = (titleNode || link)?.cloneNode(true) as Element | undefined;
    for (const clipped of titleCopy?.querySelectorAll('.clipped') || []) clipped.remove();
    const title = cleanText(titleCopy?.textContent);
    if (!itemId || !itemUrl || !title || /shop\s+on\s+ebay/i.test(title)) continue;
    const cardText = cleanText(card.textContent);
    const soldMarker = [...card.querySelectorAll('.s-item__caption--signal,.s-item__title--tagblock,.s-item__ended-date,.s-card__caption')]
      .map((node) => cleanText(node.textContent)).find((text) => /^sold\b/i.test(text));
    if (!soldMarker) continue;
    const bestOfferUnknown = /\b(?:best\s+offer\s+accepted|accepted\s+(?:best\s+)?offer|offer\s+accepted)\b/i.test(cardText);
    const soldPrice = bestOfferUnknown ? null : publicSoldPrice(card, currency);
    const attributes = [...card.querySelectorAll('.s-card__attribute-row')].map((row) => cleanText(row.textContent));
    const shippingText = textOf(card, '.s-item__shipping,.s-item__logisticsCost')
      || attributes.find((text) => /\b(?:shipping|delivery)\b/i.test(text) && (/\bfree\s+(?:shipping|delivery)\b/i.test(text) || parseEbayMoney(text, currency))) || '';
    const shippingPrice = parseEbayMoney(shippingText, currency)
      || (/\bfree\s+(?:shipping|delivery)\b/i.test(shippingText) ? { amount: 0, currency } : null);
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
      condition: publicResultCondition(card),
      format: textOf(card, '.s-item__purchase-options,.s-item__bidCount')
        || attributes.find((text) => /^(?:or\s+best\s+offer|best\s+offer\s+accepted|accepted\s+(?:best\s+)?offer|\d+\s+bids?|buy\s+it\s+now)\b/i.test(text)) || null,
      priceKind: bestOfferUnknown ? 'best-offer-unknown' : 'public-visible',
      provenance: evidence('public-sold-search', itemId),
    };
    const previous = byId.get(itemId);
    if (!previous) {
      byId.set(itemId, record);
    } else {
      const hiddenOffer = previous.priceKind === 'best-offer-unknown' || record.priceKind === 'best-offer-unknown';
      const agreedPrice = !hiddenOffer
        && previous.soldPrice?.amount === record.soldPrice?.amount && previous.soldPrice?.currency === record.soldPrice?.currency
        && normalizedQuery(previous.title) === normalizedQuery(record.title) && normalizedQuery(previous.condition) === normalizedQuery(record.condition)
        ? previous.soldPrice : null;
      const agreedShipping = previous.shippingPrice?.amount === record.shippingPrice?.amount && previous.shippingPrice?.currency === record.shippingPrice?.currency
        ? previous.shippingPrice : null;
      byId.set(itemId, {
        ...previous,
        soldPrice: agreedPrice,
        totalSales: agreedPrice,
        shippingPrice: agreedShipping,
        deliveredPrice: sumMoney(agreedPrice, agreedShipping),
        priceKind: hiddenOffer ? 'best-offer-unknown' : 'public-visible',
        format: record.priceKind === 'best-offer-unknown' ? record.format : previous.format,
      });
    }
  }

  const records = explicitNoExactMatches ? [] : [...byId.values()];
  const emptyResultsList = resultRoot.querySelector('.srp-results') && !resultRoot.querySelector('.srp-results > *');
  const loading = Boolean(resultRootElement?.closest('[aria-busy="true"]')
    || resultRoot.querySelector('.srp-results')?.closest('[aria-busy="true"]'));
  const noResults = records.length === 0
    && !loading
    && (explicitNoExactMatches || (!rewriteBoundary && emptyResultsList && /(?:\b0\s+results?\b|no\s+(?:(?:matching|sold)\s+)?results|try\s+another\s+search)/i.test(challengeText(root))));
  if (records.length === 0 && !noResults) return attempt('public-sold-search', url.href, observedAt, 'parse-error', [], hasNextPage, loading ? 'sold-search-still-loading' : 'sold-search-contained-no-parseable-records');
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

function conditionRejections(source: ConditionAssessment | null | undefined, record: EbaySoldRecord, identity: ProductIdentity): string[] {
  const candidateText = `${record.title}\n${record.condition || ''}`;
  const candidate = assessCondition(candidateText);
  const reasons: string[] = [];
  if (!source?.partsOnly && candidate.partsOnly) reasons.push('condition-mismatch:parts-only-comp');
  if (source?.partsOnly && !candidate.partsOnly) reasons.push('condition-mismatch:working-comp-for-parts-lot');
  if (source?.cautions.includes('possible repair')) reasons.push('condition-review:source-possible-repair');
  const locked = /\b(?:(?:icloud|activation|google|frp|carrier|mdm)\s*[- ]?locked|bad\s+esn|blacklisted)\b/i;
  const sourceText = [identity.name, source?.condition, source?.freeText,
    ...(source ? Object.entries(source.fields).map(([name, value]) => `${name}: ${value}`) : []),
    ...(source?.cautions || [])]
    .filter(Boolean).join('\n');
  reasons.push(...missingMajorComponentRejections(
    sourceText,
    candidateText,
  ));
  const candidateLimitedTesting = getLimitedTestingCautions(candidateText).length > 0;
  if (locked.test(candidateText) && !locked.test(sourceText)) reasons.push('condition-mismatch:locked-comp');
  if (source?.positive && (candidateLimitedTesting || /\bas[\s-]*is\b/i.test(candidateText))) {
    reasons.push('condition-mismatch:untested-comp-for-working-lot');
  }
  const affirmativeMatches = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].filter((match) => {
    const beforeMatch = text.slice(0, match.index ?? 0);
    const afterMatch = text.slice((match.index ?? 0) + match[0].length);
    return !/\b(?:not|never|no|non|without|isn't|wasn't|like)[ \t-]*$/i.test(beforeMatch)
      && !/^[ \t]*(?:(?:condition|status)[ \t]*)?[?:]{0,2}[ \t]*(?:is[ \t]+)?(?:no|false|unknown|unconfirmed|unspecified)\b/i.test(afterMatch);
  });
  const workingPattern = /\b(?:fully\s+tested(?:\s+and\s+working)?|tested\s*(?:and\s*)?working|(?:fully\s+)?(?:working|functional)|works?)\b/gi;
  const newPattern = /\b(?:(?:brand[\s-]+)?new(?:[\s-]+(?:(?:factory[\s-]+)?sealed|in\s+(?:box|packaging)))?|(?:factory[\s-]+)?sealed|nib)\b/gi;
  const candidateWorking = affirmativeMatches(candidateText, workingPattern).length > 0;
  const candidateStrongWorking = affirmativeMatches(candidateText, /\b(?:fully\s+tested(?:\s+and\s+working)?|tested\s*(?:and\s*)?working|fully\s+(?:functional|working)|works?\s+perfectly)\b/gi).length > 0;
  const candidateNew = affirmativeMatches(record.condition || '', newPattern).length > 0
    || affirmativeMatches(record.title, newPattern).some((match) => {
      // A bare New may belong to the source product name rather than its condition.
      if (!/^new$/i.test(match[0])) return true;
      const nextWord = record.title.slice((match.index ?? 0) + match[0].length).match(/^[\s-]+(\w+)/)?.[1];
      return !nextWord || !new RegExp(`\\bnew[\\s-]+${escapePattern(nextWord)}\\b`, 'i').test(identity.name);
    });
  if (candidateStrongWorking && candidateLimitedTesting) {
    reasons.push('condition-ambiguous:comp-conflicting-testing-evidence');
  }
  if (getLimitedTestingCautions(sourceText).length > 0 && !candidate.partsOnly) {
    if (candidateNew || candidateStrongWorking || (candidateWorking && !candidateLimitedTesting)) {
      reasons.push('condition-mismatch:working-comp-for-untested-lot');
    } else if (!candidateLimitedTesting) {
      reasons.push('condition-ambiguous:comp-function-unconfirmed');
    }
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

const soldAccessoryNoun = /\b(?:power\s+supply|power\s+adapter|adapters?|chargers?|remote(?:\s+controls?)?|cables?|cords?|manuals?|replacement\s+parts?)\b/i;
const soldCompleteProductNoun = /\b(?:pedal|receiver|amplifier|speaker|headphones?|camera|projector|console|monitor|printer|laptop|tablet|phone|guitar|keyboard|drum|microphone|controller|machine|device|unit)\b/i;

type SoldComponentKind = 'packaging' | 'manuals' | 'power-supply' | 'cup' | 'replacement-base' | 'remote' | 'cable' | 'charger';

function soldComponentAssertion(text: string, pattern: RegExp, replacement = false): boolean {
  for (const match of text.matchAll(new RegExp(pattern.source, 'gi'))) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index! + match[0].length);
    // Negation and inclusion apply to this noun, not to nearby missing parts.
    if (/\b(?:no|not|without|missing|isn't|is\s+not)\s+(?:(?:an?|the|any|original|new|replacement|ac|dc|power)\s+){0,5}$/i.test(before)
      || /^\s*(?:[-,:()]\s*)?(?:(?:is|are)\s+)?(?:not\s+(?:included|supplied|provided)|missing|absent|excluded)\b/i.test(after)
      || /(?:\b(?:with|includes?|including|comes\s+with)\b|\bw\/)\s*[:,-]?\s*(?:(?:an?|the|new|original|replacement|spare|working|ac|dc|power)\s+){0,5}(?:(?:box|manuals?|cups?|cables?|cords?|chargers?|adapters?|power\s+suppl(?:y|ies)|remotes?)\s*(?:and|&)\s*(?:(?:an?|the|new|original|replacement|spare|working|ac|dc|power)\s+){0,5}){0,2}$/i.test(before)) continue;
    const exclusive = /^\s*(?:[-,:()/]\s*)?(?:only|alone)\b(?!\s+(?:used|tested|played|opened|tried|once|twice)\b)/i.test(after)
      || /\bonly\s+(?:(?:an?|the)\s+)?$/i.test(before);
    if (exclusive || replacement) return true;
  }
  return false;
}

function soldComponentSubject(text: string): SoldComponentKind | null {
  if (soldComponentAssertion(text, /\b(?:(?:empty|original|retail|storage)\s+)*(?:box(?:es)?|cartons?|packag(?:e|es|ing))(?:\s*(?:and|&|\/)\s*(?:manuals?|guides?))?\b/)
    || soldComponentAssertion(text, /\b(?:manuals?|guides?)\s*(?:and|&|\/)\s*(?:box(?:es)?|packaging)\b/)) return 'packaging';
  if (soldComponentAssertion(text, /\b(?:(?:user|instruction|owner'?s|service)\s+)?(?:manuals?|guides?)\b/)
    || soldComponentAssertion(text, /\b(?:(?:user|instruction|owner'?s|service)\s+)?(?:manuals?|guides?)\s+reprint\b/, true)) return 'manuals';
  if (soldComponentAssertion(text, /\breplacement\s+(?:motor\s+)?base(?:\s+unit)?\b/, true)
    || soldComponentAssertion(text, /\b(?:motor\s+)?base(?:\s+unit)?\b/)) return 'replacement-base';
  if (soldComponentAssertion(text, /\breplacement\s+power\s+(?:supply|adapter)\b/, true)
    || soldComponentAssertion(text, /\bpower\s+(?:supply|adapter)\b/)) return 'power-supply';
  if (soldComponentAssertion(text, /\b(?:original\s+)?cups?\b/)) return 'cup';
  if (!soldCompleteProductNoun.test(text)) {
    for (const [kind, pattern] of [
      ['manuals', /\b(?:(?:user|instruction|owner'?s|service)\s+)?(?:manuals?|guides?)\b/],
      ['power-supply', /\bpower\s+(?:supply|adapter)\b/],
      ['remote', /\bremote(?:\s+controls?)?\b/],
      ['cable', /\b(?:cables?|cords?)\b/],
      ['charger', /\bchargers?\b/],
    ] as const) {
      if (soldComponentAssertion(text, pattern, true)) return kind;
    }
  }
  return null;
}

function soldComponentRejections(source: ProductIdentity, candidateTitle: string): string[] {
  const sourceText = source.name;
  const sourceComponent = soldComponentSubject(sourceText);
  const candidateComponent = soldComponentSubject(candidateTitle);
  if ((sourceComponent || candidateComponent)
    && sourceComponent !== candidateComponent) return ['accessory-or-component'];

  // Exact-model accessory rows can retain enough title overlap to pass the
  // generic retail evaluator. Preserve a source that is itself an accessory.
  const exactModel = Boolean(source.model
    && new RegExp(`\\b${escapePattern(source.model)}\\b`, 'i').test(candidateTitle));
  if (exactModel && soldComponentAssertion(candidateTitle, soldAccessoryNoun, true)
    && !soldCompleteProductNoun.test(candidateTitle)
    && !soldAccessoryNoun.test(sourceText)) {
    return ['accessory-or-component'];
  }
  return [];
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
  const planned = uniqueInOrder(plannedQueries).map(normalizedQuery);
  const attempted = uniqueInOrder(attemptedQueries).map(normalizedQuery);
  // Completed captures can arrive out of order; partial runs must still follow the plan.
  if (planned.length > 0 && attempted.length === planned.length
    && attempted.every((query) => planned.includes(query))) return true;
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
    totalSold: record.totalSold,
    totalSales: record.totalSales,
    soldAt: record.soldAt,
    condition: record.condition,
    format: record.format,
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
    reasons.push(...soldComponentRejections(comparisonIdentity, record.title));
    if (!record.soldPrice) reasons.push(record.priceKind === 'best-offer-unknown' ? 'best-offer-price-not-public' : 'missing-sold-price');
    if (record.soldPrice && record.soldPrice.amount <= 0) reasons.push('nonpositive-sold-price');
    if (record.soldPrice?.currency !== 'USD') reasons.push(`unsupported-currency:${record.soldPrice?.currency || 'unknown'}`);
    reasons.push(...quantityRejections(options.sourceQuantity ?? null, record.title));
    reasons.push(...conditionRejections(options.sourceCondition, record, comparisonIdentity));
    reasons.push(...modelVariantRejections(comparisonIdentity, record.title));
    reasons.push(...bundleRejections(comparisonIdentity, record.title));
    reasons.push(...bookMediaRejections(identity, record.title));
    if (reasons.length === 0 && record.priceKind === 'public-visible') reasons.push('public-visible-price-unconfirmed');
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
