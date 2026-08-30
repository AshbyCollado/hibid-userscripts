import { getLocalStorage, getSyncStorage, runtimeMessage, setLocalStorage } from '../core/browser.js';
import { effectiveTaxPct, normalizeSettings, type FlippahSettings } from '../core/settings.js';
import type { DealAnalysisSummary } from '../core/types.js';
import {
  auctionStateKey,
  lotStateKey,
  normalizeStoredLotState,
  type StoredLotState,
} from '../intelligence/deal-storage.js';
import { runProviderQueue } from '../intelligence/provider-queue.js';
import {
  assessCondition,
  buildConditionPresentation,
  buildProductResearchQuery,
  buildRetailIndicatorTooltip,
  buildRetailSearchPresentation,
  calculateUsAllIn,
  computeRetailIndicators,
  detectComparisonCurrency,
  detectMixedLot,
  extractLotQuantityFromTitle,
  extractProductIdentity,
  formatUsd,
  requiresQuantityConfirmation,
  selectAuctionHammer,
  trustedAmazonMarketValue,
  type AmazonCandidate,
  type AmazonCandidateMatch,
  type ConditionAssessment,
  type ProductIdentity,
  type RetailCandidateEvaluation,
  type RetailIndicator,
  type UsAllInResult,
} from '../intelligence/us-deal-intelligence.js';
import {
  extractAuctionNinjaAccountItems,
  extractAuctionNinjaCategoryItems,
  extractAuctionNinjaItemDetail,
  extractAuctionNinjaSaleCatalogItems,
  mergeAuctionNinjaItemDetail,
} from '../auctionninja/dom.js';
import {
  auctionNinjaRouteFingerprint,
  productIdFromAuctionNinjaUrl,
  resolveAuctionNinjaPage,
  saleIdFromAuctionNinjaUrl,
} from '../auctionninja/route.js';
import { scrapeAuctionNinja } from '../auctionninja/scrape.js';
import type {
  AuctionNinjaAccountItem,
  AuctionNinjaDetailRecord,
  AuctionNinjaLocationLike,
  AuctionNinjaLotRecord,
  AuctionNinjaRoute,
} from '../auctionninja/types.js';

const STYLE_ID = 'flippah-auctionninja-deal-intelligence-style';
const OWNED_SELECTOR = '[data-flippah-owned="true"]';
const SUPPORTED = new Set<AuctionNinjaRoute['kind']>([
  'followed-items', 'items-won', 'bid-history', 'category-search', 'sale-catalog', 'item-detail',
]);
const CARD_SELECTOR = [
  '.search-catalog-item-box', '.search-catalog-item-box-in', '[id^="MainItmID_"]',
  '.hot-items-box', '.hot-items-box-in', '.item-box', '.account-item-card', '.dashboard-item',
  '.followed-item', '.favorite-item', '.watchlist-item', '.item-won', '.won-item', '.bid-item',
  '.my-account-item',
].join(', ');
const PRODUCT_STRUCTURE_SELECTOR = `${CARD_SELECTOR}, a[href*="/product/"]`;
const DETAIL_CACHE_MS = 12 * 60 * 60 * 1_000;

export interface AuctionNinjaRetailLookupResult {
  status: 'matched' | 'no_match' | 'blocked' | 'rate_limited' | 'network_error' | 'parse_error' | 'low_confidence';
  query: string;
  match: AmazonCandidateMatch | null;
  candidates: AmazonCandidate[];
  fetchedAt: number;
  cached: boolean;
  message: string;
  retryAfterMs?: number;
  candidateAudit?: Array<Pick<RetailCandidateEvaluation, 'accepted' | 'score' | 'rejectionReasons' | 'matchedEvidence'> & { asin: string; title: string }>;
}

export interface AuctionNinjaAnalysisSource {
  id?: string;
  stableId?: string;
  title: string;
  description?: string;
  descriptionFields?: Record<string, string>;
  rawText?: string;
  currentBid?: number | null;
  buyerPremium?: string;
  saleUrl?: string;
  url?: string;
  status?: string;
  lot?: string;
}

export interface AuctionNinjaAnalysisRecord {
  item: AuctionNinjaAnalysisSource;
  identity: ProductIdentity;
  condition: ConditionAssessment;
  mixed: ReturnType<typeof detectMixedLot>;
  allIn: UsAllInResult | null;
  amazon: AuctionNinjaRetailLookupResult | null;
  amazonIndicator: RetailIndicator;
  ebayIndicator: RetailIndicator;
  state: StoredLotState;
  currency: 'USD' | 'CAD';
  needsQuantity: boolean;
  ebayNet: number | null;
  premiumPct: number;
}

export interface AuctionNinjaAnalysisOptions {
  settings?: FlippahSettings;
  state?: Partial<StoredLotState>;
  buyerPremiumPct?: number | null;
}

function emptySummary(): DealAnalysisSummary {
  return {
    phase: 'idle', routeFingerprint: '', total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0,
    amazonAnalyzed: 0, amazonMatched: 0, mixedLots: 0, quantityReview: 0, message: 'Ready', updatedAt: Date.now(),
  };
}

function numberFrom(value: unknown): number | null {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAuctionNinjaBuyerPremium(value: string | null | undefined): number | null {
  const parsed = numberFrom(String(value ?? '').match(/\d+(?:\.\d+)?\s*%/)?.[0]);
  return parsed !== null && parsed >= 0 && parsed <= 50 ? parsed : null;
}

export function calculateAuctionNinjaAllIn(
  currentBid: number | null | undefined,
  buyerPremiumPct: number,
  settings: Pick<FlippahSettings, 'stateCode' | 'taxPctOverride' | 'taxExempt' | 'taxOnPremium'>,
): UsAllInResult | null {
  const hammer = selectAuctionHammer(null, currentBid);
  if (hammer === null) return null;
  return calculateUsAllIn({
    hammer,
    buyerPremiumPct,
    salesTaxPct: effectiveTaxPct(settings),
    taxOnPremium: settings.taxOnPremium,
  });
}

function structuredDescription(item: AuctionNinjaAnalysisSource): string {
  const fields = Object.entries(item.descriptionFields || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${key}: ${value}`);
  return [item.description || '', ...fields].filter(Boolean).join('\n');
}

export function auctionNinjaConditionInput(title: string, description: string): string {
  if (/(?:^|\n)\s*condition\s*:/i.test(description)) return description;
  const source = String(title || '');
  const inferred = /\b(?:factory[\s-]*sealed|new[\s-]*sealed|sealed)\b/i.test(source)
    ? 'New - Factory Sealed'
    : /\b(?:brand[\s-]*new|new\s+in\s+box|\bnib\b)\b/i.test(source)
      ? 'New'
      : /\bopen[\s-]*box\b/i.test(source)
        ? 'Open Box'
        : /\blike[\s-]*new\b/i.test(source)
          ? 'Like New'
          : /\bused\b/i.test(source)
            ? 'Used'
            : '';
  return [inferred ? `Condition: ${inferred}` : '', source, description].filter(Boolean).join('\n');
}

function itemQuantity(item: AuctionNinjaAnalysisSource): number | null {
  const fromFields = Object.entries(item.descriptionFields || {})
    .filter(([key]) => /quantity|count|set size/i.test(key))
    .map(([, value]) => numberFrom(value))
    .find((value): value is number => value !== null && value > 0);
  return fromFields || extractLotQuantityFromTitle(item.title) || null;
}

export function buildAuctionNinjaAnalysis(
  item: AuctionNinjaAnalysisSource,
  options: AuctionNinjaAnalysisOptions = {},
): AuctionNinjaAnalysisRecord {
  const settings = options.settings || normalizeSettings({});
  const state = normalizeStoredLotState(options.state);
  const description = structuredDescription(item);
  const identity = extractProductIdentity(item.title, description);
  if (state.queryOverride) identity.query = buildProductResearchQuery(state.queryOverride) || identity.query;
  const condition = assessCondition(auctionNinjaConditionInput(item.title, description));
  const mixed = detectMixedLot(item.title, description);
  const quantity = itemQuantity(item);
  const needsQuantity = requiresQuantityConfirmation(quantity, mixed.mixed, state.confirmedQuantity);
  const currency = detectComparisonCurrency(item.rawText || description, item.buyerPremium || '');
  const premiumPct = options.buyerPremiumPct ?? parseAuctionNinjaBuyerPremium(item.buyerPremium) ?? settings.defaultBuyerPremiumPct ?? 0;
  const allIn = currency === 'USD' ? calculateAuctionNinjaAllIn(item.currentBid, premiumPct, settings) : null;
  const ebayNet = state.resaleEstimate === null
    ? null
    : Math.max(0, state.resaleEstimate * (1 - settings.ebayFeePct / 100) - settings.ebayFeeFixedCents / 100);
  const indicators = computeRetailIndicators(allIn, { amazon: null, ebay: state.resaleEstimate });
  return {
    item, identity, condition, mixed, allIn, amazon: null,
    amazonIndicator: indicators.amazon, ebayIndicator: indicators.ebay, state, currency,
    needsQuantity, ebayNet, premiumPct,
  };
}

export function auctionNinjaIdentitySignature(items: readonly Pick<AuctionNinjaAnalysisSource, 'stableId' | 'id' | 'url' | 'title'>[]): string {
  return items.map((item) => [item.stableId || item.id || '', item.url || '', item.title || ''].join('~')).filter(Boolean).sort().join('|');
}

export function auctionNinjaVisibleIdentitySignature(
  root: ParentNode,
  route: AuctionNinjaRoute,
  locationLike: AuctionNinjaLocationLike,
): string {
  const items = route.kind === 'item-detail'
    ? [extractAuctionNinjaItemDetail(root as Document | Element, locationLike)].filter((item): item is AuctionNinjaDetailRecord => Boolean(item))
    : route.kind === 'sale-catalog'
      ? extractAuctionNinjaSaleCatalogItems(root as Document | Element, locationLike)
      : route.kind === 'category-search'
        ? extractAuctionNinjaCategoryItems(root as Document | Element, locationLike)
        : SUPPORTED.has(route.kind)
          ? extractAuctionNinjaAccountItems(root as Document | Element, locationLike, route.kind as 'followed-items' | 'items-won' | 'bid-history')
          : [];
  return auctionNinjaIdentitySignature(items);
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function productIdForElement(element: Element): string {
  const link = element.matches('a[href*="/product/"]') ? element : element.querySelector('a[href*="/product/"]');
  return productIdFromAuctionNinjaUrl(String(link?.getAttribute('href') || (link as HTMLAnchorElement | null)?.href || ''));
}

function addAffectedElement(element: Element, ids: Set<string>): void {
  if (element.matches(OWNED_SELECTOR) || element.closest(OWNED_SELECTOR)) return;
  const card = element.matches(CARD_SELECTOR) ? element : element.closest(CARD_SELECTOR);
  if (card) {
    const id = productIdForElement(card);
    if (id) ids.add(id);
  }
  element.querySelectorAll(CARD_SELECTOR).forEach((candidate) => {
    const id = productIdForElement(candidate);
    if (id) ids.add(id);
  });
}

export function auctionNinjaMutationAffectedIds(mutations: readonly MutationRecord[]): string[] {
  const ids = new Set<string>();
  for (const mutation of mutations) {
    const target = elementForNode(mutation.target);
    if (target?.closest(OWNED_SELECTOR)) continue;
    let nativeChange = false;
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      const element = elementForNode(node);
      if (element?.matches(OWNED_SELECTOR) || element?.closest(OWNED_SELECTOR)) continue;
      nativeChange = nativeChange || Boolean(element || node.textContent?.trim());
      if (element) addAffectedElement(element, ids);
    }
    if (nativeChange && target) addAffectedElement(target, ids);
  }
  return [...ids].sort();
}

function mutationNodeElement(node: Node): Element | null {
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function nodeContainsProductStructure(node: Node): boolean {
  const element = mutationNodeElement(node);
  return Boolean(element && (element.matches(PRODUCT_STRUCTURE_SELECTOR) || element.querySelector(PRODUCT_STRUCTURE_SELECTOR)));
}

export function auctionNinjaMutationChangesProducts(mutations: readonly MutationRecord[]): boolean {
  return mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsProductStructure));
}

function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function installStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .flippah-an-deal-strip{display:flex;align-items:center;align-content:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;min-height:52px;box-sizing:border-box;margin:5px 0;padding:3px 5px;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:0}
    .flippah-an-pill{display:inline-flex;align-items:center;gap:5px;min-height:22px;padding:2px 7px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#475569;white-space:nowrap}
    a.flippah-an-pill{text-decoration:none;cursor:pointer}.flippah-an-pill:hover{text-decoration:underline}.flippah-an-pill:focus-visible{outline:2px solid #2563eb;outline-offset:2px;text-decoration:none}
    .flippah-an-pill.amazon{border-color:#f59e0b;color:#111827;font-family:Arial,sans-serif;font-weight:800}.flippah-an-pill.ebay{border-color:#93c5fd;color:#3665f3;font-family:Arial,sans-serif;font-weight:800}
    .flippah-an-pill.green,.flippah-an-pill.yellow,.flippah-an-pill.orange,.flippah-an-pill.red,.flippah-an-pill.black{border-color:transparent;background:transparent;padding-left:2px;padding-right:2px}
    .flippah-an-pill.green::before,.flippah-an-pill.yellow::before,.flippah-an-pill.orange::before,.flippah-an-pill.red::before,.flippah-an-pill.black::before{content:"";width:9px;height:9px;border:1px solid #64748b;border-radius:50%;background:#94a3b8;flex:0 0 9px}
    .flippah-an-pill.green::before{border-color:#3f6212;background:#65a30d}.flippah-an-pill.yellow::before{border-color:#854d0e;background:#eab308}.flippah-an-pill.orange::before{border-color:#9a3412;background:#f97316}.flippah-an-pill.red::before{border-color:#991b1b;background:#dc2626}.flippah-an-pill.black::before{border-color:#111827;background:#111827}
    .flippah-an-pill.condition-good{border-color:#86efac;background:#f0fdf4;color:#166534}.flippah-an-pill.condition-warning{border-color:#fcd34d;background:#fffbeb;color:#92400e}.flippah-an-pill.condition-danger{border-color:#fca5a5;background:#fef2f2;color:#991b1b}.flippah-an-pill.condition-unknown{background:#f8fafc;color:#64748b}
    .flippah-an-allin{border-color:transparent;background:transparent;color:#1d4ed8;font-weight:800}
    .flippah-an-panel{width:100%;max-width:380px;margin:14px 0;padding:12px;border:1px solid #d7e0ea;border-left:4px solid #2563eb;border-radius:6px;background:#fff;color:#202522;box-shadow:0 4px 14px rgba(15,23,42,.08);font:12px/1.4 system-ui,sans-serif;letter-spacing:0}
    .flippah-an-panel *{box-sizing:border-box}.flippah-an-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.flippah-an-brand{display:flex;align-items:center;gap:8px;min-width:0}.flippah-an-brand-dot{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px #dcfce7;flex:0 0 10px}.flippah-an-brand-copy{display:grid;gap:1px;min-width:0}.flippah-an-brand-copy strong{font-size:13px;color:#0f172a}.flippah-an-brand-copy span{color:#64748b;font-size:10px;font-weight:700}
    .flippah-an-panel-allin{flex:0 0 auto;border:1px solid #bfdbfe;border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:3px 8px;font-size:11px;font-weight:800}.flippah-an-retail{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:10px}.flippah-an-condition-line{margin-top:8px}.flippah-an-match-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin-top:8px;color:#64748b;font-size:10px;line-height:1.35}
    .flippah-an-panel details{margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px}.flippah-an-panel summary{cursor:pointer;color:#334155;font-weight:800}.flippah-an-panel summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.flippah-an-panel label{display:grid;gap:3px;margin-top:8px;color:#475569;font-size:11px;font-weight:700}.flippah-an-panel input{min-height:32px;width:100%;border:1px solid #cfd4d0;border-radius:5px;background:#fff;padding:5px 7px;color:#111827;font:12px/1.3 system-ui,sans-serif}.flippah-an-panel a{font-weight:800}
    @media (max-width:760px){.flippah-an-panel{max-width:none}.flippah-an-panel-head{align-items:flex-start}.flippah-an-panel-allin{white-space:nowrap}}
  `;
  (doc.head || doc.documentElement).append(style);
}

function cardForRecord(record: AuctionNinjaAnalysisRecord, root: ParentNode = document): Element | null {
  const id = record.item.stableId || record.item.id || productIdFromAuctionNinjaUrl(record.item.url || '');
  if (!id) return null;
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/product/"]'))) {
    if (productIdFromAuctionNinjaUrl(link.href || link.getAttribute('href') || '') !== id) continue;
    return link.closest(CARD_SELECTOR) || link.parentElement;
  }
  return null;
}

function createPill(doc: Document, label: string, title: string, className: string, href?: string): HTMLElement {
  const pill = doc.createElement(href ? 'a' : 'span');
  pill.className = `flippah-an-pill ${className}`;
  pill.title = title;
  pill.setAttribute('aria-label', title);
  if (pill.tagName === 'A') {
    const link = pill as HTMLAnchorElement;
    link.href = safeExternalUrl(href || '');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  pill.textContent = label;
  return pill;
}

function amazonPrice(record: AuctionNinjaAnalysisRecord): number | null {
  return trustedAmazonMarketValue(record.amazon?.status || '', record.amazon?.match, record.state.confirmedQuantity ?? 1);
}

export function renderAuctionNinjaCardAnnotation(card: Element, record: AuctionNinjaAnalysisRecord): HTMLElement {
  const doc = card.ownerDocument;
  installStyles(doc);
  const recordId = record.item.stableId || record.item.id || '';
  let strip = Array.from(card.children).find((child) => child.classList.contains('flippah-an-deal-strip') && child.getAttribute('data-flippah-deal-for') === recordId) as HTMLElement | undefined;
  if (!strip) {
    strip = doc.createElement('div');
    strip.className = 'flippah-an-deal-strip';
    strip.dataset.flippahOwned = 'true';
    strip.dataset.flippahDealFor = recordId;
    card.append(strip);
  }
  const query = record.identity.query;
  const links = {
    amazon: buildRetailSearchPresentation('amazon', query),
    ebay: buildRetailSearchPresentation('ebay', query),
  };
  const amazon = amazonPrice(record);
  const condition = buildConditionPresentation(record.condition);
  const allInTitle = record.allIn
    ? `Current bid ${formatUsd(record.allIn.hammer)} plus ${record.premiumPct}% buyer premium and estimated ${formatUsd(record.allIn.tax)} sales tax.`
    : 'Current bid and buyer premium/tax are unavailable for an all-in calculation.';
  const amazonTitle = amazon !== null
    ? buildRetailIndicatorTooltip({ providerName: 'Amazon', indicator: record.amazonIndicator, allIn: record.allIn?.total, marketPrice: amazon, evidenceSource: record.amazon?.match?.candidate.title || 'verified Amazon.com match' })
    : links.amazon.title;
  const ebay = record.state.resaleEstimate === null ? null : record.state.resaleEstimate;
  const ebayTitle = ebay === null
    ? links.ebay.title
    : `${buildRetailIndicatorTooltip({ providerName: 'eBay', indicator: record.ebayIndicator, allIn: record.allIn?.total, marketPrice: ebay, evidenceSource: 'your saved manual resale estimate' })} Open Sold and Completed results to verify.`;
  strip.replaceChildren(
    createPill(doc, amazon === null ? 'Amazon ↗' : `Amazon ${formatUsd(amazon)}`, amazonTitle, amazon === null ? 'amazon' : `amazon ${record.amazonIndicator.cls}`, amazon === null ? links.amazon.href : record.amazon?.match?.candidate.url || links.amazon.href),
    createPill(doc, ebay === null ? 'eBay ↗' : `eBay ${formatUsd(ebay)}`, ebayTitle, ebay === null ? 'ebay' : `ebay ${record.ebayIndicator.cls}`, links.ebay.href),
    createPill(doc, condition.label, condition.title, `condition-${condition.tone}`),
    createPill(doc, record.allIn ? `All-in ${formatUsd(record.allIn.total)}` : 'All-in unavailable', allInTitle, 'flippah-an-allin'),
  );
  return strip;
}

export function resolveAuctionNinjaDetailPanelMount(root: Document): { host: HTMLElement; anchor: Element | null } {
  const detailColumn = root.querySelector<HTMLElement>('.item-detail-box-right');
  if (detailColumn) return { host: detailColumn, anchor: detailColumn.querySelector('.item-detail-btn') };
  return {
    host: root.querySelector<HTMLElement>('.item-detail-box-main, .product-detail, .item-detail-main') || root.body,
    anchor: null,
  };
}

export function renderAuctionNinjaDetailPanel(record: AuctionNinjaAnalysisRecord, onChange: (patch: Partial<StoredLotState>) => void, doc: Document = document): HTMLElement | null {
  const { host, anchor } = resolveAuctionNinjaDetailPanelMount(doc);
  if (!host) return null;
  installStyles(doc);
  const id = record.item.stableId || record.item.id || '';
  let panel = Array.from(doc.querySelectorAll<HTMLElement>('.flippah-an-panel')).find((candidate) => candidate.dataset.flippahDealFor === id) || null;
  if (!panel) {
    panel = doc.createElement('section');
    panel.className = 'flippah-an-panel';
    panel.dataset.flippahOwned = 'true';
    panel.dataset.flippahDealFor = id;
  }
  if (anchor) anchor.insertAdjacentElement('afterend', panel);
  else if (panel.parentElement !== host) host.append(panel);
  const query = doc.createElement('input');
  query.type = 'text'; query.value = record.state.queryOverride || record.identity.query; query.setAttribute('aria-label', 'Research query');
  const resale = doc.createElement('input');
  resale.type = 'number'; resale.min = '0'; resale.step = '0.01'; resale.value = record.state.resaleEstimate === null ? '' : String(record.state.resaleEstimate); resale.setAttribute('aria-label', 'eBay resale estimate in US dollars');
  const quantity = doc.createElement('input');
  quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = record.state.confirmedQuantity === null ? '' : String(record.state.confirmedQuantity); quantity.setAttribute('aria-label', 'Confirmed quantity');
  query.addEventListener('change', () => onChange({ queryOverride: buildProductResearchQuery(query.value) }));
  resale.addEventListener('change', () => onChange({ resaleEstimate: numberFrom(resale.value) }));
  quantity.addEventListener('change', () => onChange({ confirmedQuantity: numberFrom(quantity.value) }));
  const label = (text: string, input: HTMLInputElement): HTMLLabelElement => { const node = doc.createElement('label'); node.append(doc.createTextNode(text), input); return node; };
  const head = doc.createElement('div'); head.className = 'flippah-an-panel-head';
  const brand = doc.createElement('div'); brand.className = 'flippah-an-brand';
  const brandDot = doc.createElement('span'); brandDot.className = 'flippah-an-brand-dot'; brandDot.setAttribute('aria-hidden', 'true');
  const brandCopy = doc.createElement('div'); brandCopy.className = 'flippah-an-brand-copy';
  const title = doc.createElement('strong'); title.textContent = 'Flippah';
  const subtitle = doc.createElement('span'); subtitle.textContent = 'Deal check';
  brandCopy.append(title, subtitle); brand.append(brandDot, brandCopy);
  const allIn = doc.createElement('strong'); allIn.className = 'flippah-an-panel-allin'; allIn.textContent = record.allIn ? `All-in ${formatUsd(record.allIn.total)}` : 'All-in unavailable'; allIn.title = record.allIn ? `Current bid plus ${record.premiumPct}% buyer premium and estimated tax.` : 'Current bid and fee data are unavailable.';
  head.append(brand, allIn);
  const conditionPresentation = buildConditionPresentation(record.condition);
  const condition = doc.createElement('div'); condition.className = 'flippah-an-condition-line'; condition.append(createPill(doc, conditionPresentation.label, conditionPresentation.title, `condition-${conditionPresentation.tone}`));
  const retail = doc.createElement('div'); retail.className = 'flippah-an-retail';
  const amazon = amazonPrice(record);
  const amazonLink = createPill(doc, amazon === null ? 'Amazon ↗' : `Amazon ${formatUsd(amazon)}`, amazon === null ? buildRetailSearchPresentation('amazon', record.identity.query).title : record.amazon?.match?.candidate.title || 'Verified Amazon match', amazon === null ? 'amazon' : `amazon ${record.amazonIndicator.cls}`, amazon === null ? buildRetailSearchPresentation('amazon', record.identity.query).href : record.amazon?.match?.candidate.url);
  const ebaySearch = buildRetailSearchPresentation('ebay', record.identity.query);
  const ebayLink = createPill(doc, record.state.resaleEstimate === null ? 'eBay Sold ↗' : `eBay ${formatUsd(record.state.resaleEstimate)}`, ebaySearch.title, record.state.resaleEstimate === null ? 'ebay' : `ebay ${record.ebayIndicator.cls}`, ebaySearch.href);
  retail.append(amazonLink, ebayLink);
  const matchedTitle = doc.createElement('div'); matchedTitle.className = 'flippah-an-match-title';
  matchedTitle.textContent = record.amazon?.match?.candidate.title ? `Amazon match: ${record.amazon.match.candidate.title}` : 'No verified Amazon match yet. Use the search action to review results.';
  const details = doc.createElement('details');
  const summary = doc.createElement('summary'); summary.textContent = 'Research details';
  details.append(summary, label('Search query', query), label('eBay resale estimate (USD)', resale), label('Confirmed quantity', quantity));
  panel.replaceChildren(head, retail, condition, matchedTitle, details);
  return panel;
}

function saleIdForItem(item: AuctionNinjaAnalysisSource, route: AuctionNinjaRoute): string {
  return route.saleId || saleIdFromAuctionNinjaUrl(item.saleUrl || '') || 'unknown';
}

async function readAuctionNinjaState(items: readonly AuctionNinjaAnalysisSource[], route: AuctionNinjaRoute): Promise<{ lots: Map<string, StoredLotState>; premiums: Map<string, number> }> {
  const lotIds = items.map((item) => item.stableId || item.id || '').filter(Boolean);
  const saleIds = [...new Set(items.map((item) => saleIdForItem(item, route)).filter((id) => id && id !== 'unknown'))];
  const keys = [...lotIds.map(lotStateKey), ...saleIds.map(auctionStateKey), 'watchlist'];
  const raw = await getLocalStorage(keys);
  const lots = new Map(lotIds.map((id) => {
    const state = normalizeStoredLotState(raw[lotStateKey(id)]);
    const legacy = raw.watchlist && typeof raw.watchlist === 'object' ? (raw.watchlist as Record<string, unknown>)[id] : null;
    if (state.resaleEstimate === null && legacy && typeof legacy === 'object' && Number.isFinite(Number((legacy as Record<string, unknown>).resaleCents))) state.resaleEstimate = Number((legacy as Record<string, unknown>).resaleCents) / 100;
    if (state.maxBid === null && legacy && typeof legacy === 'object' && Number.isFinite(Number((legacy as Record<string, unknown>).maxBidCents))) state.maxBid = Number((legacy as Record<string, unknown>).maxBidCents) / 100;
    return [id, state] as const;
  }));
  const premiums = new Map(saleIds.flatMap((id) => {
    const value = Number((raw[auctionStateKey(id)] as Record<string, unknown> | undefined)?.premiumPct);
    return Number.isFinite(value) && value >= 0 && value <= 30 ? [[id, value] as const] : [];
  }));
  return { lots, premiums };
}

export class AuctionNinjaDealIntelligenceController {
  private summaryValue = emptySummary();
  private generation = 0;
  private rerunTimer: number | null = null;
  private annotationRepairTimer: number | null = null;
  private pendingAnnotationRepairIds = new Set<string>();
  private records = new Map<string, AuctionNinjaAnalysisRecord>();
  private visibleSignature = '';
  private abortController: AbortController | null = null;
  private detailCache = new Map<string, { item: AuctionNinjaAnalysisSource; expiresAt: number }>();

  constructor(
    private readonly getRoute: () => AuctionNinjaRoute,
    private readonly onSummary?: (summary: DealAnalysisSummary) => void,
  ) {}

  summary(): DealAnalysisSummary { return { ...this.summaryValue }; }

  start(): void { this.schedule(250); }

  rerun(): void { this.invalidate(); this.schedule(0); }

  handleLocationChange(): void {
    this.invalidate();
    this.records.clear();
    this.visibleSignature = '';
    this.update(emptySummary());
    this.schedule(250);
  }

  handleMutations(mutations: MutationRecord[]): void {
    const route = this.getRoute();
    if (!route.supported || !SUPPORTED.has(route.kind)) return;
    const affected = auctionNinjaMutationAffectedIds(mutations);
    const cached = affected.filter((id) => {
      const record = this.records.get(id);
      const card = record ? cardForRecord(record) : null;
      const mounted = card && [...card.querySelectorAll<HTMLElement>('.flippah-an-deal-strip')]
        .some((strip) => strip.dataset.flippahDealFor === id);
      return Boolean(record && card && !mounted);
    });
    if (cached.length) this.scheduleAnnotationRepair(cached);
    if (!auctionNinjaMutationChangesProducts(mutations)) return;
    const nextSignature = auctionNinjaVisibleIdentitySignature(document, route, location.href);
    if (nextSignature !== this.visibleSignature) {
      this.invalidate();
      this.visibleSignature = nextSignature;
      this.schedule(180);
    }
  }

  async clearCache(): Promise<void> {
    await runtimeMessage('flippah:retail.cache.clear', {});
    this.rerun();
  }

  private invalidate(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    if (this.annotationRepairTimer !== null) window.clearTimeout(this.annotationRepairTimer);
    this.annotationRepairTimer = null;
    this.pendingAnnotationRepairIds.clear();
  }

  private schedule(delay: number): void {
    if (this.rerunTimer !== null) window.clearTimeout(this.rerunTimer);
    this.rerunTimer = window.setTimeout(() => { this.rerunTimer = null; void this.run(); }, delay);
  }

  private update(patch: Partial<DealAnalysisSummary>): void {
    this.summaryValue = { ...this.summaryValue, ...patch, updatedAt: Date.now() };
    try { this.onSummary?.(this.summary()); } catch { /* reporting must not stop analysis */ }
  }

  private scheduleAnnotationRepair(ids: string[]): void {
    ids.forEach((id) => this.pendingAnnotationRepairIds.add(id));
    if (this.annotationRepairTimer !== null) return;
    this.annotationRepairTimer = window.setTimeout(() => {
      this.annotationRepairTimer = null;
      const pending = [...this.pendingAnnotationRepairIds];
      this.pendingAnnotationRepairIds.clear();
      pending.forEach((id) => {
        const record = this.records.get(id);
        const card = record ? cardForRecord(record) : null;
        if (record && card) renderAuctionNinjaCardAnnotation(card, record);
      });
    }, 120);
  }

  private itemsForRoute(route: AuctionNinjaRoute): AuctionNinjaAnalysisSource[] {
    if (route.kind === 'item-detail') {
      const detail = extractAuctionNinjaItemDetail(document, location.href);
      return detail ? [detail] : [];
    }
    if (route.kind === 'sale-catalog') return extractAuctionNinjaSaleCatalogItems(document, location.href);
    if (route.kind === 'category-search') return extractAuctionNinjaCategoryItems(document, location.href);
    if (route.kind === 'followed-items' || route.kind === 'items-won' || route.kind === 'bid-history') return extractAuctionNinjaAccountItems(document, location.href, route.kind);
    return [];
  }

  private async enrichVisibleItems(items: AuctionNinjaAnalysisSource[], route: AuctionNinjaRoute, signal: AbortSignal): Promise<AuctionNinjaAnalysisSource[]> {
    if (route.kind === 'item-detail' || !items.length) return items;
    const output = items.slice();
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length && !signal.aborted) {
        const index = cursor++;
        const item = items[index]!;
        const id = item.stableId || item.id || productIdFromAuctionNinjaUrl(item.url || '');
        if (!id || !item.url) continue;
        const cached = this.detailCache.get(id);
        if (cached && cached.expiresAt > Date.now()) {
          output[index] = { ...item, ...cached.item };
          continue;
        }
        try {
          const result = await scrapeAuctionNinja(item.url, {
            fetcher: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
            parseDocument: (html) => new DOMParser().parseFromString(html, 'text/html'),
            signal,
            attempts: 3,
            timeoutMs: 20_000,
          });
          if (!result.coverage.complete || !result.detail || result.detail.stableId !== id) continue;
          const merged = mergeAuctionNinjaItemDetail(item as AuctionNinjaLotRecord, result.detail);
          output[index] = merged;
          this.detailCache.set(id, { item: merged, expiresAt: Date.now() + DETAIL_CACHE_MS });
        } catch {
          if (signal.aborted) return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, () => worker()));
    return output;
  }

  private async saveState(id: string, patch: Partial<StoredLotState>): Promise<void> {
    const key = lotStateKey(id);
    const current = normalizeStoredLotState((await getLocalStorage([key]))[key]);
    await setLocalStorage({ [key]: { ...current, ...patch, updatedAt: Date.now() } });
    this.rerun();
  }

  private async run(): Promise<void> {
    const route = this.getRoute();
    if (!route.supported || !SUPPORTED.has(route.kind)) {
      this.update({ phase: 'idle', total: 0, analyzed: 0, message: 'Not available on this page' });
      return;
    }
    const fingerprint = auctionNinjaRouteFingerprint(route, location.href);
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abortController = abort;
    const current = () => generation === this.generation && !abort.signal.aborted && auctionNinjaRouteFingerprint(this.getRoute(), location.href) === fingerprint;
    this.update({ phase: 'scanning', routeFingerprint: fingerprint, total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0, amazonAnalyzed: 0, amazonMatched: 0, message: 'Reading visible AuctionNinja items' });
    try {
      const settings = normalizeSettings(await getSyncStorage());
      const items = this.itemsForRoute(route);
      this.visibleSignature = auctionNinjaIdentitySignature(items);
      const stored = await readAuctionNinjaState(items, route);
      const salePremium = route.kind === 'sale-catalog' || route.kind === 'item-detail'
        ? parseAuctionNinjaBuyerPremium((document.body?.textContent || '').match(/Buyer'?s Premium[\s\S]{0,80}/i)?.[0])
        : null;
      const analyze = (sourceItems: AuctionNinjaAnalysisSource[]) => sourceItems.map((item) => {
        const saleId = saleIdForItem(item, route);
        return buildAuctionNinjaAnalysis(item, { settings, state: stored.lots.get(item.stableId || item.id || ''), buyerPremiumPct: stored.premiums.get(saleId) ?? salePremium });
      });
      let preliminary = analyze(items);
      this.records = new Map(preliminary.map((record) => [record.item.stableId || record.item.id || '', record]));
      preliminary.forEach((record) => {
        const card = cardForRecord(record);
        if (card) renderAuctionNinjaCardAnnotation(card, record);
        if (route.kind === 'item-detail') renderAuctionNinjaDetailPanel(record, (patch) => { void this.saveState(record.item.stableId || record.item.id || '', patch); });
      });
      const enrichedItems = await this.enrichVisibleItems(items, route, abort.signal);
      if (!current()) return;
      preliminary = analyze(enrichedItems);
      this.records = new Map(preliminary.map((record) => [record.item.stableId || record.item.id || '', record]));
      preliminary.forEach((record) => {
        const card = cardForRecord(record);
        if (card) renderAuctionNinjaCardAnnotation(card, record);
      });
      const eligible = preliminary.filter((record) => record.currency !== 'CAD' && !record.mixed.mixed && !record.needsQuantity && Boolean(record.identity.query));
      const matchedIds = new Set<string>();
      let analyzed = settings.amazonAutoLookup ? preliminary.length - eligible.length : preliminary.length;
      const progress = () => this.update({ analyzed, amazonAnalyzed: analyzed, retailMatched: matchedIds.size, retailUnmatched: Math.max(0, preliminary.length - matchedIds.size), amazonMatched: matchedIds.size, message: `Checking Amazon prices ${analyzed}/${preliminary.length}` });
      this.update({ total: preliminary.length, analyzed, amazonAnalyzed: analyzed, mixedLots: preliminary.filter((record) => record.mixed.mixed).length, quantityReview: preliminary.filter((record) => record.needsQuantity).length, phase: settings.amazonAutoLookup ? 'retail' : 'complete', message: settings.amazonAutoLookup ? 'Starting paced Amazon checks' : 'Automatic price checks are off' });
      if (settings.amazonAutoLookup) {
        const result = await runProviderQueue({
          items: eligible,
          shouldContinue: current,
          policy: { batchSize: 6, delayMs: 350 },
          lookup: async (record): Promise<AuctionNinjaRetailLookupResult> => {
            try {
              if (abort.signal.aborted) throw new Error('AuctionNinja price check cancelled');
              return await Promise.race([
                runtimeMessage<AuctionNinjaRetailLookupResult>('flippah:retail.lookup', { identity: record.identity }),
                new Promise<AuctionNinjaRetailLookupResult>((_resolve, reject) => abort.signal.addEventListener('abort', () => reject(new Error('AuctionNinja price check cancelled')), { once: true })),
              ]);
            } catch (error) {
              return { status: 'network_error', query: record.identity.query, match: null, candidates: [], fetchedAt: Date.now(), cached: false, retryAfterMs: 5_000, message: error instanceof Error ? error.message : String(error) };
            }
          },
          onProgress: ({ item: record, result }) => {
            if (!current()) return;
            if (record.state.amazonOverrideAsin) {
              const candidate = result.candidates.find((candidate) => candidate.asin === record.state.amazonOverrideAsin);
              if (candidate) { result.match = { candidate, score: 100 }; result.status = 'matched'; }
            }
            record.amazon = result;
            record.amazonIndicator = computeRetailIndicators(record.allIn, { amazon: amazonPrice(record) }).amazon;
            analyzed += 1;
            if (result.status === 'matched' && amazonPrice(record) !== null) matchedIds.add(record.item.stableId || record.item.id || '');
            const card = cardForRecord(record);
            if (card) renderAuctionNinjaCardAnnotation(card, record);
            if (route.kind === 'item-detail') renderAuctionNinjaDetailPanel(record, (patch) => { void this.saveState(record.item.stableId || record.item.id || '', patch); });
            progress();
          },
        });
        if (result.stoppedResult && current()) { this.update({ phase: 'error', message: result.stoppedResult.message || 'Amazon price checks paused' }); return; }
      }
      if (!current()) return;
      this.update({ phase: 'complete', retailMatched: matchedIds.size, retailUnmatched: Math.max(0, preliminary.length - matchedIds.size), amazonMatched: matchedIds.size, message: preliminary.length ? `Amazon prices found for ${matchedIds.size} item${matchedIds.size === 1 ? '' : 's'}` : 'No visible items to analyze' });
    } catch (error) {
      if (current()) this.update({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.abortController === abort) this.abortController = null;
    }
  }
}

export const AuctionNinjaDealIntelligence = AuctionNinjaDealIntelligenceController;
