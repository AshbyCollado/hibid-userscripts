import { getSyncStorage, runtimeMessage } from '../core/browser.js';
import { effectiveTaxPct, normalizeSettings, type FlippahSettings } from '../core/settings.js';
import { routeFingerprint } from '../core/route.js';
import type { DealAnalysisSummary, HiBidLotRecord, HiBidRoute, HiBidTransport } from '../core/types.js';
import { hydrateHibidLots, mergeHibidVisibleWithHydrated } from '../hibid/api.js';
import { extractHiBidVisibleLots, extractHibidLotDetail } from '../hibid/dom.js';
import {
  assessCondition, calculateUsAllIn, computeAccountVerdict, computeRetailIndicators,
  detectComparisonCurrency, detectMixedLot, extractProductIdentity, formatUsd,
  requiresQuantityConfirmation, selectAuctionHammer, trustedAmazonMarketValue,
  type AmazonCandidate, type AmazonCandidateMatch, type ConditionAssessment,
  type ProductIdentity, type RetailIndicator, type UsAllInResult
} from '../intelligence/us-deal-intelligence.js';

const LOT_STATE_PREFIX = 'flippahDealLotV1:';
const AUCTION_STATE_PREFIX = 'flippahDealAuctionV1:';
const STYLE_ID = 'flippah-deal-intelligence-style';
const SUPPORTED = new Set(['catalog', 'livecatalog', 'search', 'lot', 'watchlist', 'currentbids-winning', 'currentbids-outbid']);

interface StoredLotState {
  queryOverride: string;
  amazonOverrideAsin: string;
  resaleEstimate: number | null;
  confirmedQuantity: number | null;
  maxBid: number | null;
  updatedAt: number;
}

interface RetailLookupResult {
  status: 'matched' | 'no_match' | 'blocked' | 'rate_limited' | 'network_error' | 'low_confidence';
  query: string;
  match: AmazonCandidateMatch | null;
  candidates: AmazonCandidate[];
  fetchedAt: number;
  cached: boolean;
  message: string;
}

interface AnalysisRecord {
  lot: HiBidLotRecord;
  identity: ProductIdentity;
  condition: ConditionAssessment;
  mixed: ReturnType<typeof detectMixedLot>;
  allIn: UsAllInResult | null;
  amazon: RetailLookupResult | null;
  amazonIndicator: RetailIndicator;
  ebayIndicator: RetailIndicator;
  state: StoredLotState;
  currency: 'USD' | 'CAD';
  needsQuantity: boolean;
  ebayNet: number | null;
  premiumPct: number;
}

function emptySummary(): DealAnalysisSummary {
  return { phase: 'idle', routeFingerprint: '', total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0, mixedLots: 0, quantityReview: 0, message: 'Ready', updatedAt: Date.now() };
}

function localGet(keys: string | string[]): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => chrome.storage.local.get(keys, (value) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}

function localSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => chrome.storage.local.set(value, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

function stateKey(id: string): string { return `${LOT_STATE_PREFIX}${id}`; }
function auctionStateKey(id: string): string { return `${AUCTION_STATE_PREFIX}${id || 'unknown'}`; }

function normalizeStored(value: unknown): StoredLotState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const finite = (item: unknown) => Number.isFinite(Number(item)) ? Number(item) : null;
  return {
    queryOverride: typeof source.queryOverride === 'string' ? source.queryOverride.trim().slice(0, 180) : '',
    amazonOverrideAsin: typeof source.amazonOverrideAsin === 'string' ? source.amazonOverrideAsin.trim().slice(0, 10) : '',
    resaleEstimate: finite(source.resaleEstimate), confirmedQuantity: finite(source.confirmedQuantity),
    maxBid: finite(source.maxBid),
    updatedAt: finite(source.updatedAt) ?? 0
  };
}

async function readStoredLots(ids: string[]): Promise<Map<string, StoredLotState>> {
  const keys = ids.map(stateKey);
  const raw = keys.length ? await localGet([...keys, 'watchlist']) : {};
  const watchlist = raw.watchlist && typeof raw.watchlist === 'object' ? raw.watchlist : {};
  return new Map(ids.map((id) => {
    const stored = normalizeStored(raw[stateKey(id)]);
    const watched = watchlist[id];
    if (stored.resaleEstimate === null && Number.isFinite(Number(watched?.resaleCents))) stored.resaleEstimate = Number(watched.resaleCents) / 100;
    if (stored.maxBid === null && Number.isFinite(Number(watched?.maxBidCents))) stored.maxBid = Number(watched.maxBidCents) / 100;
    return [id, stored];
  }));
}

async function saveStoredLot(id: string, patch: Partial<StoredLotState>): Promise<StoredLotState> {
  const key = stateKey(id);
  const current = normalizeStored((await localGet(key))[key]);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await localSet({ [key]: next });
  return next;
}

async function readAuctionPremiums(ids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const raw = unique.length ? await localGet(unique.map(auctionStateKey)) : {};
  return new Map(unique.flatMap((id) => {
    const value = Number(raw[auctionStateKey(id)]?.premiumPct);
    return Number.isFinite(value) && value >= 0 && value <= 30 ? [[id, value] as const] : [];
  }));
}

async function saveAuctionPremium(id: string, premiumPct: number): Promise<void> {
  if (!id || !Number.isFinite(premiumPct) || premiumPct < 0 || premiumPct > 30) return;
  await localSet({ [auctionStateKey(id)]: { premiumPct, updatedAt: Date.now() } });
}

function numberFrom(value: unknown): number | null {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function detectLotCurrency(lot: Pick<HiBidLotRecord, 'rawText' | 'buyerPremium'>): 'USD' | 'CAD' {
  return detectComparisonCurrency(lot.rawText, lot.buyerPremium);
}

function cleanQuery(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 180); }

function safeExternalUrl(url: string): string {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' ? value.href : '#';
  } catch { return '#'; }
}

function researchLinks(query: string): { amazon: string; ebay: string; camel: string } {
  const amazon = new URL('https://www.amazon.com/s'); amazon.searchParams.set('k', query);
  const ebay = new URL('https://www.ebay.com/sch/i.html'); ebay.searchParams.set('_nkw', query); ebay.searchParams.set('LH_Sold', '1'); ebay.searchParams.set('LH_Complete', '1');
  const camel = new URL('https://camelcamelcamel.com/search'); camel.searchParams.set('sq', query);
  return { amazon: amazon.href, ebay: ebay.href, camel: camel.href };
}

function tileFor(id: string): Element | null {
  const escaped = CSS.escape(id);
  return document.querySelector(`#lot-${escaped}, [data-event-item-id="${escaped}"], .bid-status-border#lot-${escaped}`);
}

function installPageStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .flippah-deal-strip{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;min-height:24px;margin:5px 0;padding:3px 5px;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:0}
    .flippah-deal-pill{display:inline-flex;align-items:center;gap:5px;min-height:20px;color:#475569;white-space:nowrap}
    a.flippah-deal-pill{text-decoration:none;cursor:pointer}a.flippah-deal-pill:hover,a.flippah-deal-pill:focus-visible{text-decoration:underline}
    .flippah-deal-dot{display:inline-block;width:9px;height:9px;border:1px solid #64748b;border-radius:50%;background:#94a3b8;flex:0 0 9px}
    .flippah-deal-pill.green .flippah-deal-dot{border-color:#3f6212;background:#65a30d}.flippah-deal-pill.yellow .flippah-deal-dot{border-color:#854d0e;background:#eab308}
    .flippah-deal-pill.orange .flippah-deal-dot{border-color:#9a3412;background:#f97316}.flippah-deal-pill.red .flippah-deal-dot{border-color:#991b1b;background:#dc2626}
    .flippah-deal-pill.black .flippah-deal-dot{border-color:#111827;background:#111827}.flippah-allin{display:block;margin-top:2px;font:700 10px/1.15 system-ui,sans-serif;letter-spacing:0}
  `;
  document.documentElement.append(style);
}

function indicatorTitle(name: string, indicator: RetailIndicator, price: number | null): string {
  return price === null ? `${name}: no saved or verified value` : `${name}: ${formatUsd(price)}; all-in is ${indicator.ratio === null ? 'unknown' : `${Math.round(indicator.ratio * 100)}%`} of value`;
}

function amazonMarketValue(record: AnalysisRecord): number | null {
  return trustedAmazonMarketValue(record.amazon?.status || '', record.amazon?.match, record.state.confirmedQuantity ?? 1);
}

function applyTileAnnotation(record: AnalysisRecord, route: HiBidRoute): void {
  const tile = tileFor(record.lot.id);
  if (!tile) return;
  installPageStyles();
  const bidControl = [...tile.querySelectorAll<HTMLElement>('button,a')].find((element) => /^\s*Bid\s+\$?\s*[\d,.]+/i.test(element.textContent || ''));
  if (bidControl && record.allIn) {
    let allIn = bidControl.querySelector<HTMLElement>(':scope > .flippah-allin');
    if (!allIn) { allIn = document.createElement('span'); allIn.className = 'flippah-allin'; allIn.dataset.flippahOwned = 'true'; bidControl.append(allIn); }
    allIn.textContent = `All-in ${formatUsd(record.allIn.total)}`;
    allIn.title = 'Current/next bid plus buyer premium and estimated US sales tax';
  }
  let strip = tile.querySelector<HTMLElement>(`:scope .flippah-deal-strip[data-flippah-retail-for="${CSS.escape(record.lot.id)}"]`);
  if (!strip) {
    strip = document.createElement('div'); strip.className = 'flippah-deal-strip'; strip.dataset.flippahRetailFor = record.lot.id; strip.dataset.flippahOwned = 'true';
    const content = tile.querySelector('.lot-tile-content');
    const heading = tile.querySelector('.lot-lead-heading');
    if (content) content.insertAdjacentElement('beforebegin', strip);
    else if (heading) heading.insertAdjacentElement('afterend', strip);
    else if (bidControl) bidControl.insertAdjacentElement('beforebegin', strip);
    else tile.append(strip);
  }
  if (!strip.isConnected) return;
  const amazonPrice = amazonMarketValue(record);
  const ebayPrice = record.state.resaleEstimate;
  const links = researchLinks(record.identity.query);
  const amazonLabel = record.currency === 'CAD' ? 'Amazon: CAD' : record.mixed.mixed ? 'Amazon: mixed review' : record.needsQuantity ? 'Amazon: qty review' : amazonPrice === null ? 'Amazon: --' : `Amazon ${formatUsd(amazonPrice)}`;
  const ebayLabel = ebayPrice === null ? 'eBay: --' : `eBay ${formatUsd(ebayPrice)}`;
  const verdict = (route.kind === 'watchlist' || route.kind.startsWith('currentbids-')) && record.allIn
    ? computeAccountVerdict({ status: record.lot.status || record.lot.rawText, condition: record.condition, nextHammer: record.lot.nextBid, allIn: record.allIn.total, maxBid: record.state.maxBid, retail: record.ebayNet ?? amazonPrice })
    : null;
  strip.replaceChildren();
  const add = (text: string, cls: string, title: string, href = '') => {
    const pill = document.createElement(href ? 'a' : 'span'); pill.className = `flippah-deal-pill ${cls}`; pill.title = title; pill.setAttribute('aria-label', title);
    if (pill instanceof HTMLAnchorElement) {
      pill.href = safeExternalUrl(href); pill.target = '_blank'; pill.rel = 'noopener noreferrer';
    }
    const dot = document.createElement('span'); dot.className = 'flippah-deal-dot'; dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = text;
    pill.append(dot, label); strip!.append(pill);
  };
  add(amazonLabel, record.amazonIndicator.cls, record.amazon?.message || indicatorTitle('Amazon', record.amazonIndicator, amazonPrice), links.amazon);
  add(ebayLabel, record.ebayIndicator.cls, `${indicatorTitle('eBay saved resale', record.ebayIndicator, ebayPrice)}. Open exact sold and completed results.`, links.ebay);
  if (verdict) add(verdict.label, verdict.cls, verdict.advice);
}

function lotPanelStyles(): string {
  return `<style id="flippah-intelligence-shadow-style">
    .flippah-intelligence{margin-top:12px;border-top:1px solid #e2e2df;padding-top:10px;color:#202522;font:12px/1.4 system-ui,sans-serif}.flippah-intelligence *{box-sizing:border-box}
    .flippah-intelligence-head,.flippah-retail-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.flippah-intelligence-head strong{font-size:13px}.flippah-retail-row{margin-top:7px;padding:8px;border:1px solid #d7ddd9;border-radius:6px;background:#fff}
    .flippah-intelligence .price{color:#0d47a1;font-weight:800}.flippah-condition{margin-top:8px;border-left:3px solid #b45309;background:#fff7ed;padding:7px}.flippah-condition.danger{border-color:#b91c1c;background:#fef2f2}
    .flippah-intelligence details{margin-top:7px;border:1px solid #e2e2df;border-radius:6px;background:#fff;padding:7px}.flippah-intelligence summary{cursor:pointer;font-weight:750}.flippah-intelligence a{color:#0d47a1;font-weight:700}.flippah-link-row{display:flex;flex-wrap:wrap;gap:9px;margin-top:7px}
    .flippah-evidence-title{margin-top:7px;color:#4b5563}.flippah-intelligence select,.flippah-intelligence input{min-height:30px;border:1px solid #cfd4d0;border-radius:6px;background:#fff;padding:5px 7px}.flippah-intelligence select{width:100%;margin-top:7px}.flippah-quantity{display:flex;align-items:center;gap:8px;margin-top:7px}.flippah-quantity input{width:70px}
  </style>`;
}

function renderLotPanel(record: AnalysisRecord, onChange: () => void): boolean {
  const host = document.getElementById('lotlens-root');
  const root = host?.shadowRoot;
  const panel = root?.querySelector('.lotlens-panel');
  if (!root || !panel) return false;
  if (!root.getElementById('flippah-intelligence-shadow-style')) {
    const parsed = new DOMParser().parseFromString(lotPanelStyles(), 'text/html');
    const style = parsed.querySelector('style');
    if (style) root.prepend(document.importNode(style, true));
  }
  let section = root.querySelector<HTMLElement>('#flippah-intelligence');
  if (!section) {
    section = document.createElement('section'); section.id = 'flippah-intelligence'; section.className = 'flippah-intelligence';
    const actions = panel.querySelector('.lotlens-actions'); actions?.insertAdjacentElement('beforebegin', section);
    if (!section.isConnected) panel.append(section);
  }
  const queryInput = root.querySelector<HTMLInputElement>('#lotlens-comps-query');
  const resaleInput = root.querySelector<HTMLInputElement>('#lotlens-resale');
  const premiumInput = root.querySelector<HTMLInputElement>('#lotlens-premium');
  if (queryInput && record.state.queryOverride && queryInput.value !== record.state.queryOverride) queryInput.value = record.state.queryOverride;
  if (queryInput && !record.state.queryOverride && record.identity.query && queryInput.value !== record.identity.query) {
    queryInput.value = record.identity.query;
    queryInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const query = cleanQuery(queryInput?.value || record.state.queryOverride || record.identity.query);
  const links = researchLinks(query);
  const amazonPrice = amazonMarketValue(record);
  const conditionText = record.condition.partsOnly ? record.condition.partsReasons.join('; ') : record.condition.damaged ? record.condition.damageReasons.join('; ') : record.condition.cautions.join('; ');
  const candidates = record.amazon?.candidates || [];
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const details = (label: string): HTMLDetailsElement => {
    const node = element('details');
    node.append(element('summary', '', label));
    return node;
  };
  const warning = (label: string, text: string, danger = false): HTMLDivElement => {
    const node = element('div', `flippah-condition${danger ? ' danger' : ''}`);
    node.append(element('strong', '', label), document.createTextNode(` ${text}`));
    return node;
  };

  section.replaceChildren();
  const head = element('div', 'flippah-intelligence-head');
  head.append(
    element('strong', '', 'US Deal Intelligence'),
    element('span', '', record.currency === 'CAD' ? 'CAD - no USD comparison' : record.mixed.mixed ? 'component review required' : record.amazon?.status || 'researching')
  );
  section.append(head);
  if (conditionText) section.append(warning('Condition warning:', `${conditionText}. Research remains available.`, record.condition.partsOnly || record.condition.damaged));
  if (record.mixed.mixed) section.append(warning('Mixed/group lot:', 'review every identifiable component before using a retail value.'));
  if (record.needsQuantity) {
    const quantity = element('label', 'flippah-quantity');
    quantity.append(document.createTextNode('Confirmed quantity '));
    const input = element('input');
    input.id = 'flippah-confirmed-quantity'; input.type = 'number'; input.min = '1'; input.step = '1'; input.placeholder = 'required';
    input.value = record.state.confirmedQuantity == null ? '' : String(record.state.confirmedQuantity);
    quantity.append(input); section.append(quantity);
  }
  const retail = element('div', 'flippah-retail-row');
  retail.append(
    element('span', '', `Amazon.com${record.state.confirmedQuantity && record.state.confirmedQuantity > 1 ? ` x${record.state.confirmedQuantity}` : ''}`),
    element('span', 'price', amazonPrice === null ? '--' : formatUsd(amazonPrice))
  );
  section.append(retail);

  const evidence = details('Amazon / eBay evidence');
  const linkRow = element('div', 'flippah-link-row');
  for (const [label, href] of [['Amazon', links.amazon], ['eBay Sold', links.ebay], ['CamelCamelCamel', links.camel]] as const) {
    const link = element('a', '', label); link.href = safeExternalUrl(href); link.target = '_blank'; link.rel = 'noopener noreferrer'; linkRow.append(link);
  }
  evidence.append(linkRow);
  evidence.append(element('div', 'flippah-evidence-title', record.amazon?.match
    ? `${record.amazon.match.candidate.title} - confidence ${record.amazon.match.score.toFixed(1)}`
    : record.amazon?.message || 'No Amazon evidence loaded yet.'));
  if (candidates.length) {
    const label = element('label', '', 'Correct Amazon match');
    const select = element('select'); select.id = 'flippah-amazon-match';
    const automatic = element('option', '', 'Automatic conservative match'); automatic.value = ''; select.append(automatic);
    const selectedAsin = record.state.amazonOverrideAsin || record.amazon?.match?.candidate.asin;
    for (const candidate of candidates) {
      const option = element('option', '', `${formatUsd(candidate.price)} - ${candidate.title.slice(0, 100)}`);
      option.value = candidate.asin; option.selected = candidate.asin === selectedAsin; select.append(option);
    }
    label.append(select); evidence.append(label);
  }
  section.append(evidence);

  const bind = (element: HTMLInputElement | null, marker: string, handler: () => void) => {
    if (!element || element.dataset[marker] === 'true') return;
    element.dataset[marker] = 'true'; element.addEventListener('change', handler); element.addEventListener('input', handler);
  };
  let timer = 0;
  bind(queryInput, 'flippahQueryBound', () => {
    window.clearTimeout(timer); timer = window.setTimeout(() => void saveStoredLot(record.lot.id, { queryOverride: cleanQuery(queryInput?.value || '') }).then(onChange), 350);
  });
  bind(resaleInput, 'flippahResaleBound', () => {
    window.clearTimeout(timer); timer = window.setTimeout(() => void saveStoredLot(record.lot.id, { resaleEstimate: numberFrom(resaleInput?.value) }).then(onChange), 350);
  });
  bind(premiumInput, 'flippahPremiumBound', () => {
    window.clearTimeout(timer); timer = window.setTimeout(() => void saveAuctionPremium(record.lot.auctionId, numberFrom(premiumInput?.value) ?? record.premiumPct).then(onChange), 350);
  });
  section.querySelector<HTMLSelectElement>('#flippah-amazon-match')?.addEventListener('change', (event) => void saveStoredLot(record.lot.id, { amazonOverrideAsin: (event.currentTarget as HTMLSelectElement).value }).then(onChange));
  section.querySelector<HTMLInputElement>('#flippah-confirmed-quantity')?.addEventListener('change', (event) => void saveStoredLot(record.lot.id, { confirmedQuantity: numberFrom((event.currentTarget as HTMLInputElement).value) }).then(onChange));
  return true;
}

function buildAnalysisRecords(
  lots: HiBidLotRecord[],
  stored: Map<string, StoredLotState>,
  auctionPremiums: Map<string, number>,
  settings: FlippahSettings
): AnalysisRecord[] {
  const taxPct = effectiveTaxPct(settings);
  return lots.map((lot) => {
    const state = stored.get(lot.id) || normalizeStored(null);
    const identity = extractProductIdentity(lot.lead || lot.title, lot.description);
    if (state.queryOverride) identity.query = state.queryOverride;
    const condition = assessCondition(lot.description);
    const mixed = detectMixedLot(lot.lead || lot.title, lot.description);
    const quantity = lot.quantity ?? numberFrom((lot.descriptionFields as any)?.Quantity);
    const needsQuantity = requiresQuantityConfirmation(quantity, mixed.mixed, state.confirmedQuantity);
    const currency = detectLotCurrency(lot);
    const hammer = selectAuctionHammer(lot.nextBid, lot.currentBid);
    const premiumPct = auctionPremiums.get(lot.auctionId) ?? numberFrom(lot.buyerPremium) ?? 15;
    const allIn = currency === 'USD' && hammer !== null
      ? calculateUsAllIn({ hammer, buyerPremiumPct: premiumPct, salesTaxPct: taxPct, taxOnPremium: settings.taxOnPremium })
      : null;
    const ebayNet = state.resaleEstimate === null
      ? null
      : Math.max(0, state.resaleEstimate * (1 - settings.ebayFeePct / 100) - settings.ebayFeeFixedCents / 100);
    const indicators = computeRetailIndicators(allIn, { ebay: state.resaleEstimate });
    return { lot, identity, condition, mixed, allIn, amazon: null, amazonIndicator: indicators.amazon, ebayIndicator: indicators.ebay, state, currency, needsQuantity, ebayNet, premiumPct };
  });
}

export class DealIntelligenceController {
  private summaryValue = emptySummary();
  private generation = 0;
  private rerunTimer: number | null = null;
  private records = new Map<string, AnalysisRecord>();

  constructor(private readonly getRoute: () => HiBidRoute, private readonly transport: HiBidTransport) {}

  summary(): DealAnalysisSummary { return { ...this.summaryValue }; }

  start(): void { this.schedule(250); }

  handleMutations(mutations: MutationRecord[]): void {
    if (!SUPPORTED.has(this.getRoute().kind)) return;
    const hasNewLot = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node instanceof Element && (node.matches('app-lot-tile[id^="lot-"], #lotlens-root') || Boolean(node.querySelector('app-lot-tile[id^="lot-"], #lotlens-root')))));
    if (hasNewLot) this.schedule(300);
  }

  handleLocationChange(): void {
    this.generation += 1; this.records.clear(); this.summaryValue = emptySummary(); this.schedule(250);
  }

  async clearCache(): Promise<void> {
    await runtimeMessage('flippah:retail.cache.clear', {}); this.records.clear(); void this.run();
  }

  async rerun(): Promise<void> { this.records.clear(); void this.run(); }

  private schedule(delay: number): void {
    if (this.rerunTimer !== null) window.clearTimeout(this.rerunTimer);
    this.rerunTimer = window.setTimeout(() => { this.rerunTimer = null; void this.run(); }, delay);
  }

  private update(patch: Partial<DealAnalysisSummary>): void {
    this.summaryValue = { ...this.summaryValue, ...patch, updatedAt: Date.now() };
  }

  private async run(): Promise<void> {
    const route = this.getRoute();
    if (!route.supported || !SUPPORTED.has(route.kind)) { this.update({ phase: 'idle', message: 'Not available on this page', total: 0, analyzed: 0 }); return; }
    const fingerprint = routeFingerprint(route, location.href);
    const generation = ++this.generation;
    this.update({ phase: 'scanning', routeFingerprint: fingerprint, total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0, mixedLots: 0, quantityReview: 0, message: 'Reading visible lots' });
    try {
      const settings = normalizeSettings(await getSyncStorage());
      let lots = route.kind === 'lot' ? [extractHibidLotDetail(document, location.href)].filter((item): item is HiBidLotRecord => Boolean(item)) : extractHiBidVisibleLots(document, route, location.href);
      const stored = await readStoredLots(lots.map((lot) => lot.id));
      let auctionPremiums = await readAuctionPremiums(lots.map((lot) => lot.auctionId));
      const quickRecords = buildAnalysisRecords(lots, stored, auctionPremiums, settings);
      this.records = new Map(quickRecords.map((record) => [record.lot.id, record]));
      quickRecords.forEach((record) => applyTileAnnotation(record, route));
      this.update({
        total: quickRecords.length,
        mixedLots: quickRecords.filter((item) => item.mixed.mixed).length,
        quantityReview: quickRecords.filter((item) => item.needsQuantity).length,
        message: quickRecords.length ? `Calculated all-in for ${quickRecords.length} visible lot${quickRecords.length === 1 ? '' : 's'}` : 'No visible lots to analyze'
      });
      if (lots.length) {
        const hydrated = await hydrateHibidLots(this.transport, lots.map((lot) => lot.id), route, location.href, { rawRecords: [], retries: 2 });
        const byId = new Map(hydrated.items.map((lot) => [lot.id, lot]));
        lots = lots.map((lot) => {
          const hydratedLot = byId.get(lot.id);
          return hydratedLot ? mergeHibidVisibleWithHydrated(lot, hydratedLot) : lot;
        });
      }
      if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
      auctionPremiums = await readAuctionPremiums(lots.map((lot) => lot.auctionId));
      const preliminary = buildAnalysisRecords(lots, stored, auctionPremiums, settings);
      this.records = new Map(preliminary.map((record) => [record.lot.id, record]));
      preliminary.forEach((record) => applyTileAnnotation(record, route));
      this.update({ total: preliminary.length, analyzed: 0, mixedLots: preliminary.filter((item) => item.mixed.mixed).length, quantityReview: preliminary.filter((item) => item.needsQuantity).length, phase: settings.amazonAutoLookup ? 'retail' : 'complete', message: settings.amazonAutoLookup ? 'Checking Amazon.com' : 'Amazon auto-lookup is off' });
      let analyzed = 0; let matched = 0; let unmatched = 0;
      await Promise.all(preliminary.map(async (record) => {
        const blocked = record.currency === 'CAD' || record.mixed.mixed || record.needsQuantity || !record.identity.query;
        if (!blocked && settings.amazonAutoLookup) {
          const result = await runtimeMessage<RetailLookupResult>('flippah:retail.lookup', { identity: record.identity });
          if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
          if (record.state.amazonOverrideAsin) {
            const candidate = result.candidates.find((item) => item.asin === record.state.amazonOverrideAsin);
            if (candidate) {
              result.match = { candidate, score: 100 };
              result.status = 'matched';
              result.message = `Manual Amazon match: ${candidate.title}`;
            }
          }
          record.amazon = result;
          const price = amazonMarketValue(record);
          record.amazonIndicator = computeRetailIndicators(record.allIn, { amazon: price }).amazon;
          if (price !== null && result.status === 'matched') matched += 1; else unmatched += 1;
        } else unmatched += 1;
        analyzed += 1;
        applyTileAnnotation(record, route);
        if (route.kind === 'lot') {
          const rerun = () => this.schedule(0);
          if (!renderLotPanel(record, rerun)) window.setTimeout(() => generation === this.generation && renderLotPanel(record, rerun), 500);
        }
        this.update({ analyzed, retailMatched: matched, retailUnmatched: unmatched, message: `Amazon analysis ${analyzed}/${preliminary.length}` });
      }));
      if (generation !== this.generation) return;
      this.update({ phase: preliminary.some((record) => record.currency === 'CAD') && preliminary.every((record) => record.currency === 'CAD') ? 'unsupported-currency' : 'complete', message: preliminary.length ? `Analyzed ${preliminary.length} visible lot${preliminary.length === 1 ? '' : 's'}` : 'No visible lots to analyze' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}
