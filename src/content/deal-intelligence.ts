import { getSyncStorage, runtimeMessage } from '../core/browser.js';
import { RETAIL_MATCHING_EPOCH } from '../core/retail-db.js';
import { effectiveTaxPct, normalizeSettings, type FlippahSettings } from '../core/settings.js';
import { calculateDealOutcome, normalizeDealOutcome, outcomeStorageKey, type DealOutcome, type OutcomeChannel } from '../core/outcomes.js';
import { routeFingerprint } from '../core/route.js';
import type { DealAnalysisSummary, HiBidLotRecord, HiBidRoute, HiBidTransport } from '../core/types.js';
import { hydrateHibidLots, mergeHibidVisibleWithHydrated } from '../hibid/api.js';
import { extractHiBidVisibleLots, extractHibidLotDetail, extractHibidTileEventItemId } from '../hibid/dom.js';
import { runProviderQueue } from '../intelligence/provider-queue.js';
import { retailCacheTtl, retailIdentityCacheKey } from '../intelligence/retail-policy.js';
import {
  auctionStateKey,
  lotStateKey as stateKey,
  normalizeStoredLotState as normalizeStored,
  type StoredLotState,
} from '../intelligence/deal-storage.js';
import {
  assessCondition, buildConditionPresentation, buildProductResearchQuery, buildRetailIndicatorTooltip, buildRetailSearchPresentation, calculateUsAllIn, computeAccountVerdict, computeRetailIndicators,
  detectComparisonCurrency, detectMixedLot, extractProductIdentity, formatUsd,
  explainHibidStatus, extractLotQuantityFromTitle, requiresQuantityConfirmation, selectAuctionHammer, trustedAmazonMarketValue,
  type AmazonCandidate, type AmazonCandidateMatch, type ConditionAssessment,
  type ProductIdentity, type RetailCandidateEvaluation, type RetailIndicator, type UsAllInResult
} from '../intelligence/us-deal-intelligence.js';

const LOT_TILE_SELECTOR = 'app-lot-tile[id^="lot-"], [data-event-item-id], .bid-status-border[id^="lot-"]';
const FLIPPAH_OWNED_SELECTOR = '[data-flippah-owned="true"]';
const TILE_ANNOTATION_HOST_ATTRIBUTE = 'data-flippah-retail-host-for';
const SUPPORTED = new Set(['catalog', 'livecatalog', 'search', 'lot', 'watchlist', 'currentbids', 'currentbids-winning', 'currentbids-outbid']);

export interface RetailLookupResult {
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
  outcome: DealOutcome | null;
}

interface RetainedRetailEvidence {
  query: string;
  amazonOverrideAsin: string;
  result: RetailLookupResult;
}

export interface StoredRetailEvidence {
  expiresAt: number;
  result: RetailLookupResult;
}

export interface StoredLotRetailEvidence extends StoredRetailEvidence {
  identityKey: string;
  lotSignature?: string;
  identity?: ProductIdentity;
}

const REUSABLE_RETAIL_STATUSES = new Set<RetailLookupResult['status']>(['matched', 'no_match', 'low_confidence']);
export const LOCAL_RETAIL_EVIDENCE_PREFIX = 'flippah:retail-evidence:';
export const LOCAL_LOT_RETAIL_EVIDENCE_PREFIX = 'flippah:lot-retail-evidence:';

export function localRetailEvidenceStorageKey(identity: ProductIdentity): string {
  return `${LOCAL_RETAIL_EVIDENCE_PREFIX}${retailIdentityCacheKey(identity, RETAIL_MATCHING_EPOCH)}`;
}

export function localLotRetailEvidenceStorageKey(lotId: string): string {
  return `${LOCAL_LOT_RETAIL_EVIDENCE_PREFIX}${lotId}`;
}

export function visibleLotRetailSignature(lot: Pick<HiBidLotRecord, 'id' | 'lead' | 'title'>): string {
  const clean = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
  const productTitle = buildProductResearchQuery(lot.lead || lot.title) || clean(lot.lead || lot.title);
  return [lot.id, productTitle].map(clean).join('\u001f');
}

export function isFreshStoredRetailEvidence(value: unknown, now = Date.now()): value is StoredRetailEvidence {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredRetailEvidence>;
  return Number.isFinite(entry.expiresAt)
    && Number(entry.expiresAt) > now
    && Boolean(entry.result && REUSABLE_RETAIL_STATUSES.has(entry.result.status));
}

export function canReuseStoredLotIdentity(
  lot: Pick<HiBidLotRecord, 'id' | 'lead' | 'title'>,
  evidence: StoredLotRetailEvidence | null | undefined,
  now = Date.now(),
): evidence is StoredLotRetailEvidence & { identity: ProductIdentity; lotSignature: string } {
  return Boolean(evidence?.identity
    && evidence.lotSignature === visibleLotRetailSignature(lot)
    && isFreshStoredRetailEvidence(evidence, now));
}

function copyRetailLookupResult(result: RetailLookupResult, cached = result.cached): RetailLookupResult {
  return {
    ...result,
    cached,
    candidates: result.candidates.map((candidate) => ({ ...candidate })),
    match: result.match ? { ...result.match, candidate: { ...result.match.candidate } } : null,
    candidateAudit: result.candidateAudit?.map((entry) => ({
      ...entry,
      rejectionReasons: [...entry.rejectionReasons],
      matchedEvidence: [...entry.matchedEvidence],
    })),
  };
}

function copyProductIdentity(identity: ProductIdentity): ProductIdentity {
  return {
    ...identity,
    capacities: [...identity.capacities],
    tokens: [...identity.tokens],
    discriminators: Object.fromEntries(Object.entries(identity.discriminators)
      .map(([key, values]) => [key, [...values]])) as unknown as ProductIdentity['discriminators'],
  };
}

export function shouldRenderProvisionalDealAnnotations(route: Pick<HiBidRoute, 'kind'>): boolean {
  // List and account pages wait for stored or hydrated evidence. Lot-detail pages
  // render into the existing Shadow DOM panel and never annotate native HiBid DOM.
  return false;
}

export function canReuseRetailEvidence(
  evidence: RetainedRetailEvidence | null | undefined,
  query: string,
  amazonOverrideAsin: string | null | undefined,
): evidence is RetainedRetailEvidence {
  return Boolean(evidence
    && evidence.query === query
    && evidence.amazonOverrideAsin === String(amazonOverrideAsin || '')
    && REUSABLE_RETAIL_STATUSES.has(evidence.result.status));
}

function emptySummary(): DealAnalysisSummary {
  return {
    phase: 'idle', routeFingerprint: '', total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0,
    amazonAnalyzed: 0, amazonMatched: 0,
    mixedLots: 0, quantityReview: 0, message: 'Ready', updatedAt: Date.now()
  };
}

function localGet(keys: string | string[] | null): Promise<Record<string, any>> {
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

function localRemove(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return new Promise((resolve, reject) => chrome.storage.local.remove(keys, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

async function saveStoredLot(id: string, patch: Partial<StoredLotState>): Promise<StoredLotState> {
  const key = stateKey(id);
  const current = normalizeStored((await localGet(key))[key]);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await localSet({ [key]: next });
  return next;
}

async function saveStoredOutcome(outcome: DealOutcome): Promise<void> {
  await localSet({ [outcomeStorageKey(outcome.lotId)]: outcome });
}

async function clearStoredOutcome(id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => chrome.storage.local.remove(outcomeStorageKey(id), () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

async function readAuctionPremiums(ids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const raw = unique.length ? await localGet(unique.map(auctionStateKey)) : {};
  return new Map(unique.flatMap((id) => {
    const value = Number(raw[auctionStateKey(id)]?.premiumPct);
    return Number.isFinite(value) && value >= 0 && value <= 30 ? [[id, value] as const] : [];
  }));
}

interface InitialAnalysisStorage {
  storedLots: Map<string, StoredLotState>;
  outcomes: Map<string, DealOutcome | null>;
  auctionPremiums: Map<string, number>;
  lotEvidence: Map<string, StoredLotRetailEvidence>;
  raw: Record<string, any>;
}

async function readInitialAnalysisStorage(
  lots: HiBidLotRecord[],
  prefetchedRaw?: Record<string, any>,
): Promise<InitialAnalysisStorage> {
  const ids = [...new Set(lots.map((lot) => lot.id).filter(Boolean))];
  const auctionIds = [...new Set(lots.map((lot) => lot.auctionId).filter(Boolean))];
  const keys = [
    ...ids.map(stateKey),
    ...ids.map(outcomeStorageKey),
    ...ids.map(localLotRetailEvidenceStorageKey),
    ...auctionIds.map(auctionStateKey),
    'watchlist',
  ];
  const raw = prefetchedRaw ?? (keys.length ? await localGet(keys) : {});
  const watchlist = raw.watchlist && typeof raw.watchlist === 'object' ? raw.watchlist : {};
  const storedLots = new Map(ids.map((id) => {
    const stored = normalizeStored(raw[stateKey(id)]);
    const watched = watchlist[id];
    if (stored.resaleEstimate === null && Number.isFinite(Number(watched?.resaleCents))) stored.resaleEstimate = Number(watched.resaleCents) / 100;
    if (stored.maxBid === null && Number.isFinite(Number(watched?.maxBidCents))) stored.maxBid = Number(watched.maxBidCents) / 100;
    return [id, stored] as const;
  }));
  const outcomes = new Map(ids.map((id) => [id, normalizeDealOutcome(raw[outcomeStorageKey(id)])] as const));
  const auctionPremiums = new Map(auctionIds.flatMap((id) => {
    const value = Number(raw[auctionStateKey(id)]?.premiumPct);
    return Number.isFinite(value) && value >= 0 && value <= 30 ? [[id, value] as const] : [];
  }));
  const lotEvidence = new Map(ids.flatMap((id) => {
    const value = raw[localLotRetailEvidenceStorageKey(id)];
    return value && typeof value === 'object' ? [[id, value as StoredLotRetailEvidence] as const] : [];
  }));
  return { storedLots, outcomes, auctionPremiums, lotEvidence, raw };
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

function cleanQuery(value: string): string { return buildProductResearchQuery(value).slice(0, 180); }

function safeExternalUrl(url: string): string {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' ? value.href : '#';
  } catch { return '#'; }
}

export function visibleLotIdSignature(root: ParentNode): string {
  return [...root.querySelectorAll<HTMLElement>('app-lot-tile[id^="lot-"]')]
    .map(extractHibidTileEventItemId)
    .filter(Boolean)
    .sort()
    .join('|');
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === 1) return node as Element;
  return node.parentElement;
}

function lotIdForTile(tile: Element): string {
  return extractHibidTileEventItemId(tile);
}

function addElementLotIds(element: Element, ids: Set<string>): void {
  if (element.matches(FLIPPAH_OWNED_SELECTOR) || element.closest(FLIPPAH_OWNED_SELECTOR)) return;
  const closest = element.matches(LOT_TILE_SELECTOR) ? element : element.closest(LOT_TILE_SELECTOR);
  if (closest) {
    const id = lotIdForTile(closest);
    if (id) ids.add(id);
  }
  element.querySelectorAll(LOT_TILE_SELECTOR).forEach((tile) => {
    const id = lotIdForTile(tile);
    if (id) ids.add(id);
  });
}

export function mutationAffectedLotIds(mutations: readonly MutationRecord[]): string[] {
  const ids = new Set<string>();
  for (const mutation of mutations) {
    const target = elementForNode(mutation.target);
    if (target?.closest(FLIPPAH_OWNED_SELECTOR)) continue;
    let hasNativeChange = false;
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      const element = elementForNode(node);
      if (!element) {
        if (node.textContent?.trim()) hasNativeChange = true;
        continue;
      }
      if (element.matches(FLIPPAH_OWNED_SELECTOR) || element.closest(FLIPPAH_OWNED_SELECTOR)) continue;
      hasNativeChange = true;
      addElementLotIds(element, ids);
    }
    if (hasNativeChange && target) addElementLotIds(target, ids);
  }
  return [...ids].sort();
}

function researchLinks(query: string): { amazon: string; ebay: string; camel: string } {
  const amazon = new URL('https://www.amazon.com/s'); amazon.searchParams.set('k', query);
  const ebay = new URL('https://www.ebay.com/sch/i.html'); ebay.searchParams.set('_nkw', query); ebay.searchParams.set('LH_Sold', '1'); ebay.searchParams.set('LH_Complete', '1');
  const camel = new URL('https://camelcamelcamel.com/search'); camel.searchParams.set('sq', query);
  return { amazon: amazon.href, ebay: ebay.href, camel: camel.href };
}

function tileFor(id: string): Element | null {
  const escaped = CSS.escape(id);
  const match = document.querySelector(`app-lot-tile#lot-${escaped}, app-lot-tile[data-event-item-id="${escaped}"], [data-event-item-id="${escaped}"], .bid-status-border#lot-${escaped}`);
  const tile = match?.matches('app-lot-tile') ? match : match?.closest('app-lot-tile');
  if (tile) return tile;
  return match?.matches('.bid-status-border') ? match : null;
}

function tileAnnotationStyles(): string {
  return `
    :host{all:initial;display:block;max-width:100%;contain:content}
    *{box-sizing:border-box}
    .flippah-deal-strip{display:flex;align-items:center;align-content:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;min-height:52px;margin:5px 0;padding:3px 5px;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:0}
    .flippah-deal-pill{display:inline-flex;align-items:center;gap:5px;min-height:20px;color:#475569;white-space:nowrap}
    a.flippah-deal-pill{text-decoration:none;cursor:pointer}a.flippah-deal-pill:hover{text-decoration:underline}a.flippah-deal-pill:focus-visible{outline:2px solid #2563eb;outline-offset:2px;text-decoration:none}
    .flippah-deal-dot{display:inline-block;width:9px;height:9px;border:1px solid #64748b;border-radius:50%;background:#94a3b8;flex:0 0 9px}
    .flippah-deal-pill.green .flippah-deal-dot{border-color:#3f6212;background:#65a30d}.flippah-deal-pill.yellow .flippah-deal-dot{border-color:#854d0e;background:#eab308}
    .flippah-deal-pill.orange .flippah-deal-dot{border-color:#9a3412;background:#f97316}.flippah-deal-pill.red .flippah-deal-dot{border-color:#991b1b;background:#dc2626}
    .flippah-deal-pill.black .flippah-deal-dot{border-color:#111827;background:#111827}
    .flippah-deal-pill.search{min-height:22px;padding:2px 7px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;box-shadow:0 1px 1px rgba(15,23,42,.08);font-size:11px}
    .flippah-deal-pill.search.amazon{border-color:#f59e0b;color:#111827;font-family:Arial,sans-serif;font-weight:800}.flippah-deal-pill.search.ebay{border-color:#93c5fd;color:#3665f3;font-family:Arial,sans-serif;font-weight:800}
    .flippah-deal-pill.condition,.flippah-deal-pill.allin{min-height:20px;padding:2px 7px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-weight:800}
    .flippah-deal-pill.condition-good{border-color:#86efac;background:#f0fdf4;color:#166534}.flippah-deal-pill.condition-warning{border-color:#fcd34d;background:#fffbeb;color:#92400e}
    .flippah-deal-pill.condition-danger{border-color:#fca5a5;background:#fef2f2;color:#991b1b}.flippah-deal-pill.condition-unknown{color:#64748b}
    .flippah-deal-loading{display:inline-flex;align-items:center;gap:7px;min-height:22px;color:#64748b;font-weight:700}
    .flippah-deal-loading-spinner{width:12px;height:12px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:flippah-deal-spin .8s linear infinite}
    @keyframes flippah-deal-spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.flippah-deal-loading-spinner{animation:none;border-top-color:#cbd5e1;background:#2563eb}}
  `;
}

function amazonMarketValue(record: AnalysisRecord): number | null {
  return trustedAmazonMarketValue(record.amazon?.status || '', record.amazon?.match, record.state.confirmedQuantity ?? 1);
}

function ebayMarketValue(record: AnalysisRecord): number | null {
  return record.state.resaleEstimate;
}

function tileAnnotationMount(tile: Element): Element | null {
  if (!tile.matches('app-lot-tile, .bid-status-border')) return null;
  return tile.querySelector('.lot-tile-content, .current-bids-card-content, .lot-card-content');
}

function annotationStrip(tile: Element, id: string): HTMLElement | null {
  const host = tile.querySelector<HTMLElement>(`[${TILE_ANNOTATION_HOST_ATTRIBUTE}="${CSS.escape(id)}"]`);
  return host?.shadowRoot?.querySelector<HTMLElement>('.flippah-deal-strip') || null;
}

function ensureTileAnnotationStrip(id: string, route?: Pick<HiBidRoute, 'kind'>): { tile: Element; strip: HTMLElement } | null {
  if (route?.kind === 'lot') return null;
  const tile = tileFor(id);
  if (!tile) return null;
  let strip = annotationStrip(tile, id);
  if (strip) return { tile, strip };
  const mount = tileAnnotationMount(tile);
  if (!mount) return null;
  const host = document.createElement('div');
  host.dataset.flippahRetailHostFor = id;
  host.dataset.flippahOwned = 'true';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = tileAnnotationStyles();
  strip = document.createElement('div');
  strip.className = 'flippah-deal-strip';
  strip.dataset.flippahRetailFor = id;
  root.append(style, strip);
  mount.prepend(host);
  if (!host.isConnected) {
    host.remove();
    return null;
  }
  return { tile, strip };
}

export function reserveTileAnnotationSpace(id: string, route?: Pick<HiBidRoute, 'kind'>): boolean {
  const target = ensureTileAnnotationStrip(id, route);
  if (!target) return false;
  const { strip } = target;
  if (strip.dataset.flippahRenderSignature) return true;
  strip.dataset.flippahRenderSignature = 'pending';
  strip.setAttribute('aria-busy', 'true');
  strip.setAttribute('aria-label', 'Restoring saved product prices');
  const loading = document.createElement('span'); loading.className = 'flippah-deal-loading';
  const spinner = document.createElement('span'); spinner.className = 'flippah-deal-loading-spinner'; spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.textContent = 'Restoring prices';
  loading.append(spinner, label);
  strip.replaceChildren(loading);
  return true;
}

export function applyTileAnnotation(record: AnalysisRecord, route: HiBidRoute): boolean {
  const target = ensureTileAnnotationStrip(record.lot.id, route);
  if (!target) return false;
  const { strip } = target;
  const amazonPrice = amazonMarketValue(record);
  const ebayPrice = ebayMarketValue(record);
  const condition = buildConditionPresentation(record.condition);
  const links = researchLinks(record.identity.query);
  const amazonLabel = record.currency === 'CAD'
    ? 'Amazon: CAD'
    : record.mixed.mixed
      ? 'Amazon: mixed review'
      : record.needsQuantity
        ? 'Amazon: qty review'
        : amazonPrice !== null
          ? `Amazon ${formatUsd(amazonPrice)}${record.amazon?.match?.candidate.used ? ' used' : ''}${record.amazon?.match?.referenceKind === 'equivalent' ? ' equiv' : ''}`
          : 'Amazon';
  const ebayLabel = ebayPrice === null ? 'eBay' : `eBay ${formatUsd(ebayPrice)}${record.state.resaleEstimate !== null ? ' saved' : ''}`;
  const verdict = (route.kind === 'watchlist' || route.kind.startsWith('currentbids-')) && record.allIn
    ? computeAccountVerdict({ status: record.lot.status || record.lot.rawText, condition: record.condition, nextHammer: record.lot.nextBid, allIn: record.allIn.total, maxBid: record.state.maxBid, retail: record.ebayNet ?? amazonPrice })
    : null;
  const renderSignature = JSON.stringify([
    record.identity.query,
    record.currency,
    amazonPrice,
    record.amazon?.status || '',
    record.amazon?.match?.candidate.asin || '',
    record.amazonIndicator.cls,
    ebayPrice,
    record.ebayIndicator.cls,
    condition.label,
    condition.tone,
    record.allIn?.total ?? null,
    verdict?.kind || '',
  ]);
  strip.dataset.flippahAmazonSource = record.amazon ? (record.amazon.cached ? 'cache' : 'network') : 'none';
  if (strip.dataset.flippahRenderSignature === renderSignature) return true;
  strip.dataset.flippahRenderSignature = renderSignature;
  strip.removeAttribute('aria-busy');
  strip.removeAttribute('aria-label');
  strip.replaceChildren();
  const add = (text: string, cls: string, title: string, href = '', showDot = true, brand = '') => {
    const pill = document.createElement(href ? 'a' : 'span'); pill.className = `flippah-deal-pill ${cls}${brand ? ` search ${brand}` : ''}`; pill.title = title; pill.setAttribute('aria-label', title);
    if (pill instanceof HTMLAnchorElement) {
      pill.href = safeExternalUrl(href); pill.target = '_blank'; pill.rel = 'noopener noreferrer';
    }
    const label = document.createElement('span'); label.textContent = text;
    if (showDot) {
      const dot = document.createElement('span'); dot.className = 'flippah-deal-dot'; dot.setAttribute('aria-hidden', 'true'); pill.append(dot);
    }
    pill.append(label); strip.append(pill);
  };
  const amazonSpecialTitle = record.currency === 'CAD'
    ? 'CAD listing: Flippah does not compare a Canadian-dollar lot against US-dollar Amazon prices.'
    : record.mixed.mixed
      ? 'Mixed/group lot: review every identifiable component before using a single retail value.'
      : record.needsQuantity
        ? 'Quantity review: confirm how many complete units are included before using a retail comparison.'
        : '';
  if (amazonPrice === null && !amazonSpecialTitle) {
    const search = buildRetailSearchPresentation('amazon', record.identity.query);
    const reason = record.amazon?.message ? ` ${record.amazon.message}.` : '';
    add(search.label, '', `${search.title}${reason}`, search.href, false, 'amazon');
  } else {
    const retailTitle = amazonSpecialTitle || (amazonPrice !== null
      ? buildRetailIndicatorTooltip({
          providerName: 'Amazon', indicator: record.amazonIndicator, allIn: record.allIn?.total,
          marketPrice: amazonPrice, evidenceSource: `${record.amazon?.match?.candidate.title || 'verified Amazon.com match'}${record.amazon?.match?.candidate.used ? ' (used/renewed fallback)' : ''}${record.amazon?.match?.referenceKind === 'equivalent' ? (record.identity.kind === 'graphics-card' ? ' (same GPU model; different board partner)' : ' (near-equivalent model reference)') : ''}`
        })
      : 'Amazon comparison needs manual review.');
    add(amazonLabel, record.amazonIndicator.cls, retailTitle, links.amazon);
  }
  if (ebayPrice === null) {
    const search = buildRetailSearchPresentation('ebay', record.identity.query);
    add(search.label, '', search.title, search.href, false, 'ebay');
  } else {
    const ebayTitle = `${buildRetailIndicatorTooltip({
      providerName: 'eBay', indicator: record.ebayIndicator, allIn: record.allIn?.total,
      marketPrice: ebayPrice, evidenceSource: 'your saved manual resale estimate'
    })} Open Sold and Completed results to verify it.`;
    add(ebayLabel, record.ebayIndicator.cls, ebayTitle, links.ebay);
  }
  add(condition.label, `condition condition-${condition.tone}`, condition.title, '', false);
  if (record.allIn) add(`All-in ${formatUsd(record.allIn.total)}`, 'allin', 'Current or next bid plus buyer premium and estimated US sales tax.', '', false);
  if (verdict) add(verdict.label, verdict.cls, `${explainHibidStatus(record.lot.status)} Flippah: ${verdict.advice}`);
  return true;
}

function lotPanelStyles(): string {
  return `<style id="flippah-intelligence-shadow-style">
    .flippah-intelligence{margin-top:12px;border-top:1px solid #e2e2df;padding-top:10px;color:#202522;font:12px/1.4 system-ui,sans-serif}.flippah-intelligence *{box-sizing:border-box}
    .flippah-intelligence-head,.flippah-retail-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.flippah-intelligence-head strong{font-size:13px}.flippah-retail-row{margin-top:7px;padding:8px;border:1px solid #d7ddd9;border-radius:6px;background:#fff}
    .flippah-intelligence .price{color:#0d47a1;font-weight:800}.flippah-condition{margin-top:8px;border-left:3px solid #b45309;background:#fff7ed;padding:7px}.flippah-condition.danger{border-color:#b91c1c;background:#fef2f2}
    .flippah-intelligence details{margin-top:7px;border:1px solid #e2e2df;border-radius:6px;background:#fff;padding:7px}.flippah-intelligence summary{cursor:pointer;font-weight:750}.flippah-intelligence a{color:#0d47a1;font-weight:700}.flippah-link-row{display:flex;flex-wrap:wrap;gap:9px;margin-top:7px}
    .flippah-evidence-title{margin-top:7px;color:#4b5563}.flippah-intelligence select,.flippah-intelligence input{min-height:30px;border:1px solid #cfd4d0;border-radius:6px;background:#fff;padding:5px 7px}.flippah-intelligence select{width:100%;margin-top:7px}.flippah-quantity{display:flex;align-items:center;gap:8px;margin-top:7px}.flippah-quantity input{width:70px}
    .flippah-retail-value{display:inline-flex;align-items:center;gap:6px;font-weight:800}.flippah-retail-value .flippah-deal-dot{display:inline-block;width:9px;height:9px;border:1px solid #64748b;border-radius:50%;background:#94a3b8;flex:0 0 9px}
    .flippah-retail-value.green .flippah-deal-dot{border-color:#3f6212;background:#65a30d}.flippah-retail-value.yellow .flippah-deal-dot{border-color:#854d0e;background:#eab308}.flippah-retail-value.orange .flippah-deal-dot{border-color:#9a3412;background:#f97316}.flippah-retail-value.red .flippah-deal-dot{border-color:#991b1b;background:#dc2626}
    .flippah-search-pill{display:inline-flex;align-items:center;min-height:26px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;text-decoration:none;box-shadow:0 1px 1px rgba(15,23,42,.08)}.flippah-search-pill.amazon{border-color:#f59e0b;color:#111827;font-family:Arial,sans-serif}.flippah-search-pill.ebay{border-color:#93c5fd;color:#3665f3;font-family:Arial,sans-serif}.flippah-search-pill:hover{text-decoration:underline}.flippah-search-pill:focus-visible{outline:2px solid #2563eb;outline-offset:2px;text-decoration:none}
    .flippah-review-value{display:inline-flex;align-items:center;min-height:24px;padding:2px 7px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;color:#475569;font-weight:750}
    .flippah-outcome-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.flippah-outcome-grid label{display:grid;gap:3px;color:#4b5563}.flippah-outcome-grid input,.flippah-outcome-grid select{width:100%;margin:0}.flippah-outcome-result{margin-top:8px;padding:7px;border-radius:5px;background:#f1f5f9;font-weight:750}.flippah-outcome-actions{display:flex;gap:7px;margin-top:8px}.flippah-outcome-actions button{min-height:30px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:5px 9px;font-weight:750;cursor:pointer}.flippah-outcome-help{margin-top:6px;color:#64748b}
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
  const ebayPrice = ebayMarketValue(record);
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
  const searchValue = (provider: 'amazon' | 'ebay'): HTMLAnchorElement => {
    const presentation = buildRetailSearchPresentation(provider, query);
    const link = element('a', `flippah-search-pill ${provider}`, presentation.label);
    link.href = safeExternalUrl(presentation.href); link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.title = presentation.title; link.setAttribute('aria-label', presentation.ariaLabel);
    return link;
  };
  const pricedValue = (providerName: string, price: number, indicator: RetailIndicator, evidenceSource: string): HTMLSpanElement => {
    const value = element('span', `flippah-retail-value ${indicator.cls}`);
    const dot = element('span', 'flippah-deal-dot'); dot.setAttribute('aria-hidden', 'true');
    value.append(dot, element('span', 'price', formatUsd(price)));
    const title = buildRetailIndicatorTooltip({ providerName, indicator, allIn: record.allIn?.total, marketPrice: price, evidenceSource });
    value.title = title; value.setAttribute('aria-label', title);
    return value;
  };
  const reviewValue = (label: string, title: string): HTMLSpanElement => {
    const value = element('span', 'flippah-review-value', label); value.title = title; value.setAttribute('aria-label', title); return value;
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
  const amazonValue = record.currency === 'CAD'
    ? reviewValue('CAD', 'CAD listing: Flippah does not compare a Canadian-dollar lot against US-dollar Amazon prices.')
    : record.mixed.mixed
      ? reviewValue('Mixed review', 'Mixed/group lot: review every identifiable component before using a single retail value.')
      : record.needsQuantity
        ? reviewValue('Qty review', 'Confirm how many complete units are included before using a retail comparison.')
        : amazonPrice === null
          ? searchValue('amazon')
          : pricedValue('Amazon', amazonPrice, record.amazonIndicator, `${record.amazon?.match?.candidate.title || 'verified Amazon.com match'}${record.amazon?.match?.candidate.used ? ' (used/renewed fallback)' : ''}${record.amazon?.match?.referenceKind === 'equivalent' ? ' (same GPU model; different board partner)' : ''}`);
  retail.append(element('span', '', `Amazon.com${record.state.confirmedQuantity && record.state.confirmedQuantity > 1 ? ` x${record.state.confirmedQuantity}` : ''}`), amazonValue);
  section.append(retail);
  const ebayRetail = element('div', 'flippah-retail-row');
  ebayRetail.append(element('span', '', 'eBay resale (manual)'), ebayPrice === null
    ? searchValue('ebay')
    : pricedValue('eBay', ebayPrice, record.ebayIndicator, 'your saved manual resale estimate'));
  section.append(ebayRetail);

  const evidence = details('Amazon / eBay evidence');
  const linkRow = element('div', 'flippah-link-row');
  for (const [label, href] of [['Amazon', links.amazon], ['eBay Sold', links.ebay], ['CamelCamelCamel', links.camel]] as const) {
    const link = element('a', '', label); link.href = safeExternalUrl(href); link.target = '_blank'; link.rel = 'noopener noreferrer'; linkRow.append(link);
  }
  evidence.append(linkRow);
  evidence.append(element('div', 'flippah-evidence-title', record.amazon?.match
    ? `${record.amazon.match.candidate.title} - confidence ${record.amazon.match.score.toFixed(1)}`
    : record.amazon?.message || 'No Amazon evidence loaded yet.'));
  evidence.append(element('div', 'flippah-evidence-title', record.state.resaleEstimate !== null
    ? `Saved eBay resale estimate: ${formatUsd(record.state.resaleEstimate)}`
    : 'Open eBay Sold results and enter a verified resale estimate above.'));
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

  const outcomeDetails = details(record.outcome ? 'Resale outcome saved' : 'Record resale outcome');
  outcomeDetails.className = 'flippah-outcome';
  const outcome = record.outcome;
  const outcomeGrid = element('div', 'flippah-outcome-grid');
  const outcomeInput = (labelText: string, id: string, value: number | null, placeholder = '') => {
    const label = element('label', '', labelText);
    const input = element('input');
    input.id = id; input.type = 'number'; input.min = '0'; input.step = '0.01'; input.placeholder = placeholder;
    input.value = value === null ? '' : String(value);
    label.append(input); return label;
  };
  outcomeGrid.append(
    outcomeInput('Actual all-in paid', 'flippah-outcome-cost', outcome?.actualAllInCost ?? null, record.allIn ? record.allIn.total.toFixed(2) : ''),
    outcomeInput('Sold for', 'flippah-outcome-sold', outcome?.soldPrice ?? null),
    outcomeInput('Selling costs', 'flippah-outcome-costs', outcome?.sellingCosts ?? null, 'fees + shipping'),
  );
  const channelLabel = element('label', '', 'Sold through');
  const channel = element('select'); channel.id = 'flippah-outcome-channel';
  for (const [value, label] of [['', 'Not sold yet'], ['ebay', 'eBay'], ['marketplace', 'Facebook Marketplace'], ['local', 'Local sale'], ['other', 'Other']] as const) {
    const option = element('option', '', label); option.value = value; option.selected = outcome?.channel === value; channel.append(option);
  }
  channelLabel.append(channel); outcomeGrid.append(channelLabel); outcomeDetails.append(outcomeGrid);
  const outcomeResult = calculateDealOutcome({
    actualAllInCost: outcome?.actualAllInCost ?? null,
    soldPrice: outcome?.soldPrice ?? null,
    sellingCosts: outcome?.sellingCosts ?? null,
    predictedResale: outcome?.predictedResale ?? null,
  });
  if (outcomeResult.profit !== null || outcomeResult.predictionError !== null) {
    const parts = [outcomeResult.profit === null ? '' : `Actual profit ${formatUsd(outcomeResult.profit)}`];
    if (outcomeResult.predictionError !== null) parts.push(`estimate difference ${outcomeResult.predictionError >= 0 ? '+' : ''}${formatUsd(outcomeResult.predictionError)}`);
    outcomeDetails.append(element('div', 'flippah-outcome-result', parts.filter(Boolean).join(' · ')));
  }
  outcomeDetails.append(element('div', 'flippah-outcome-help', 'Optional and stored only in Flippah. The first saved resale estimate becomes the comparison baseline.'));
  const outcomeActions = element('div', 'flippah-outcome-actions');
  const saveOutcomeButton = element('button', '', 'Save outcome'); saveOutcomeButton.id = 'flippah-outcome-save'; saveOutcomeButton.type = 'button'; outcomeActions.append(saveOutcomeButton);
  if (outcome) { const clear = element('button', '', 'Clear'); clear.id = 'flippah-outcome-clear'; clear.type = 'button'; outcomeActions.append(clear); }
  outcomeDetails.append(outcomeActions); section.append(outcomeDetails);

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
  section.querySelector<HTMLButtonElement>('#flippah-outcome-save')?.addEventListener('click', () => {
    const inputNumber = (id: string, fallback: number | null = null) => {
      const input = section?.querySelector<HTMLInputElement>(`#${id}`);
      return input?.value.trim() ? numberFrom(input.value) : fallback;
    };
    const predictedResale = outcome?.predictedResale ?? ebayPrice ?? amazonPrice;
    const next: DealOutcome = {
      lotId: record.lot.id,
      lotNumber: record.lot.lot,
      title: record.lot.lead || record.lot.title,
      url: record.lot.url,
      auctionId: record.lot.auctionId,
      actualAllInCost: inputNumber('flippah-outcome-cost', record.allIn?.total ?? null),
      soldPrice: inputNumber('flippah-outcome-sold'),
      sellingCosts: inputNumber('flippah-outcome-costs'),
      predictedResale,
      channel: (section?.querySelector<HTMLSelectElement>('#flippah-outcome-channel')?.value || '') as OutcomeChannel,
      soldAt: outcome?.soldAt || '',
      note: outcome?.note || '',
      updatedAt: Date.now(),
    };
    void saveStoredOutcome(next).then(onChange);
  });
  section.querySelector<HTMLButtonElement>('#flippah-outcome-clear')?.addEventListener('click', () => void clearStoredOutcome(record.lot.id).then(onChange));
  return true;
}

function buildAnalysisRecords(
  lots: HiBidLotRecord[],
  stored: Map<string, StoredLotState>,
  auctionPremiums: Map<string, number>,
  outcomes: Map<string, DealOutcome | null>,
  settings: FlippahSettings,
  prefetchedIdentities?: Map<string, ProductIdentity>,
): AnalysisRecord[] {
  const taxPct = effectiveTaxPct(settings);
  return lots.map((lot) => {
    const state = stored.get(lot.id) || normalizeStored(null);
    const savedIdentity = prefetchedIdentities?.get(lot.id);
    const identity = savedIdentity
      ? copyProductIdentity(savedIdentity)
      : extractProductIdentity({
          title: lot.lead || lot.title,
          description: lot.description,
        });
    if (state.queryOverride) {
      const normalizedOverride = buildProductResearchQuery(state.queryOverride);
      if (normalizedOverride) {
        state.queryOverride = normalizedOverride;
        identity.query = normalizedOverride;
      } else {
        state.queryOverride = '';
      }
    }
    const structuredCondition = Object.entries(lot.descriptionFields || {})
      .filter(([key]) => /^(?:condition|in packaging|packaging|assembly required|is item damaged|item damaged|damaged|damage desc|damage desct|damage description|is item functional|item functional|functional|working|missing major parts|missing parts|missing any parts|notes?)\??$/i.test(key.trim()))
      .map(([key, value]) => `${key}: ${String(value || '').trim()}`)
      .filter((line) => !/:\s*$/.test(line))
      .join('\n');
    const condition = assessCondition([lot.description, structuredCondition].filter(Boolean).join('\n'));
    const mixed = detectMixedLot(lot.lead || lot.title, lot.description);
    const quantities = [
      numberFrom(lot.quantity),
      numberFrom((lot.descriptionFields as any)?.Quantity),
      extractLotQuantityFromTitle(lot.lead || lot.title),
    ].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
    const quantity = quantities.length ? Math.max(...quantities) : null;
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
    const indicators = computeRetailIndicators(allIn, { amazon: null, ebay: state.resaleEstimate });
    return { lot, identity, condition, mixed, allIn, amazon: null, amazonIndicator: indicators.amazon, ebayIndicator: indicators.ebay, state, currency, needsQuantity, ebayNet, premiumPct, outcome: outcomes.get(lot.id) || null };
  });
}

export class DealIntelligenceController {
  private summaryValue = emptySummary();
  private generation = 0;
  private rerunTimer: number | null = null;
  private annotationRepairTimer: number | null = null;
  private pendingAnnotationRepairIds = new Set<string>();
  private records = new Map<string, AnalysisRecord>();
  private retailEvidence = new Map<string, RetainedRetailEvidence>();
  private visibleLotSignature = '';
  private initialStorageSnapshot: Promise<Record<string, any> | null> | null = null;

  constructor(
    private readonly getRoute: () => HiBidRoute,
    private readonly transport: HiBidTransport,
    private readonly onSummary?: (summary: DealAnalysisSummary) => void,
  ) {}

  summary(): DealAnalysisSummary { return { ...this.summaryValue }; }

  start(): void {
    this.initialStorageSnapshot = localGet(null).catch(() => null);
    this.schedule(250);
  }

  handleMutations(mutations: MutationRecord[]): void {
    const route = this.getRoute();
    if (!SUPPORTED.has(route.kind)) return;
    const affectedIds = mutationAffectedLotIds(mutations);
    const cachedIds = affectedIds.filter((id) => this.records.has(id));
    cachedIds.forEach((id) => {
      const tile = tileFor(id);
      const strip = tile ? annotationStrip(tile, id) : null;
      if (strip) return;
      const record = this.records.get(id);
      if (record) applyTileAnnotation(record, route);
    });
    if (route.kind !== 'lot' && !shouldRenderProvisionalDealAnnotations(route)) {
      affectedIds.filter((id) => !this.records.has(id)).forEach((id) => reserveTileAnnotationSpace(id, route));
    }
    if (cachedIds.length) this.scheduleAnnotationRepair(cachedIds);
    const hasLotPanelMount = mutations.some((mutation) => [...mutation.addedNodes].some((node) => {
      const element = elementForNode(node);
      return Boolean(element && (element.matches('#lotlens-root') || element.querySelector('#lotlens-root')));
    }));
    if (hasLotPanelMount) {
      this.schedule(0);
      return;
    }
    if (!affectedIds.length && !hasLotPanelMount) return;
    const nextSignature = visibleLotIdSignature(document);
    if (nextSignature && nextSignature !== this.visibleLotSignature) {
      this.visibleLotSignature = nextSignature;
      this.schedule(300);
    }
  }

  handleLocationChange(): void {
    this.generation += 1;
    this.records.clear();
    this.visibleLotSignature = '';
    this.update(emptySummary());
    this.pendingAnnotationRepairIds.clear();
    if (this.annotationRepairTimer !== null) window.clearTimeout(this.annotationRepairTimer);
    this.annotationRepairTimer = null;
    this.schedule(250);
  }

  async clearCache(): Promise<void> {
    const stored = await localGet(null);
    await Promise.all([
      runtimeMessage('flippah:retail.cache.clear', {}),
      localRemove(Object.keys(stored).filter((key) => key.startsWith(LOCAL_RETAIL_EVIDENCE_PREFIX)
        || key.startsWith(LOCAL_LOT_RETAIL_EVIDENCE_PREFIX))),
    ]);
    this.records.clear(); this.retailEvidence.clear(); void this.run();
  }

  async rerun(): Promise<void> { this.records.clear(); this.retailEvidence.clear(); void this.run(); }

  private retainKnownEvidence(record: AnalysisRecord, previous?: AnalysisRecord): AnalysisRecord {
    if (previous && !record.lot.description && previous.lot.id === record.lot.id) {
      record.lot.description = previous.lot.description;
      record.lot.descriptionHtml = previous.lot.descriptionHtml;
      record.lot.descriptionFields = previous.lot.descriptionFields;
      record.lot.category = previous.lot.category;
      record.lot.categories = previous.lot.categories;
      record.lot.images = record.lot.images.length ? record.lot.images : previous.lot.images;
      record.lot.image = record.lot.image || previous.lot.image;
      record.condition = previous.condition;
      record.mixed = previous.mixed;
      record.needsQuantity = previous.needsQuantity;
      if (record.state.queryOverride === previous.state.queryOverride) record.identity = previous.identity;
    }
    const evidence = this.retailEvidence.get(record.lot.id);
    if (!canReuseRetailEvidence(evidence, record.identity.query, record.state.amazonOverrideAsin)) return record;
    record.amazon = evidence.result;
    const price = amazonMarketValue(record);
    record.amazonIndicator = computeRetailIndicators(record.allIn, { amazon: price }).amazon;
    return record;
  }

  private applyRestoredEvidence(record: AnalysisRecord, incoming: RetailLookupResult): boolean {
    if (!REUSABLE_RETAIL_STATUSES.has(incoming.status)) return false;
    const result = copyRetailLookupResult(incoming, true);
    if (record.state.amazonOverrideAsin) {
      const candidate = result.candidates.find((item) => item.asin === record.state.amazonOverrideAsin);
      if (candidate) {
        result.match = { candidate, score: 100 };
        result.status = 'matched';
        result.message = `Manual Amazon match: ${candidate.title}`;
      }
    }
    this.retailEvidence.set(record.lot.id, {
      query: record.identity.query,
      amazonOverrideAsin: String(record.state.amazonOverrideAsin || ''),
      result,
    });
    record.amazon = result;
    record.amazonIndicator = computeRetailIndicators(record.allIn, { amazon: amazonMarketValue(record) }).amazon;
    return true;
  }

  private async persistLocalEvidence(entries: Array<{ record: AnalysisRecord; result: RetailLookupResult }>): Promise<void> {
    const values: Record<string, StoredRetailEvidence | StoredLotRetailEvidence> = {};
    const now = Date.now();
    entries.forEach(({ record, result }) => {
      if (!REUSABLE_RETAIL_STATUSES.has(result.status)) return;
      const ttl = retailCacheTtl(result.status === 'matched' || result.status === 'low_confidence' ? 'matched' : 'no_results');
      const identityKey = localRetailEvidenceStorageKey(record.identity);
      const stored: StoredRetailEvidence = {
        expiresAt: now + ttl,
        result: copyRetailLookupResult(result, false),
      };
      values[identityKey] = stored;
      values[localLotRetailEvidenceStorageKey(record.lot.id)] = {
        ...stored,
        identityKey,
        lotSignature: visibleLotRetailSignature(record.lot),
        identity: copyProductIdentity(record.identity),
      };
    });
    if (Object.keys(values).length) await localSet(values);
  }

  private restorePrefetchedLotEvidence(records: AnalysisRecord[], stored: Map<string, StoredLotRetailEvidence>): number {
    let restored = 0;
    records.forEach((record) => {
      const entry = stored.get(record.lot.id);
      if (!entry
        || !entry.identity
        || entry.identity.query !== record.identity.query
        || !isFreshStoredRetailEvidence(entry)) return;
      if (this.applyRestoredEvidence(record, entry.result)) restored += 1;
    });
    return restored;
  }

  private async restoreLocalCachedEvidence(
    records: AnalysisRecord[],
    prefetchedRaw?: Record<string, any>,
  ): Promise<number> {
    const pending = records.filter((record) => record.currency !== 'CAD'
      && !record.mixed.mixed
      && !record.needsQuantity
      && Boolean(record.identity.query)
      && !canReuseRetailEvidence(this.retailEvidence.get(record.lot.id), record.identity.query, record.state.amazonOverrideAsin));
    if (!pending.length) return 0;
    const keys = pending.map((record) => localRetailEvidenceStorageKey(record.identity));
    const stored = prefetchedRaw ?? await localGet(keys);
    const expired: string[] = [];
    const migrated: Array<{ record: AnalysisRecord; result: RetailLookupResult }> = [];
    let restored = 0;
    pending.forEach((record, index) => {
      const key = keys[index]!;
      const entry = stored[key];
      if (!isFreshStoredRetailEvidence(entry)) {
        if (entry) expired.push(key);
        return;
      }
      if (this.applyRestoredEvidence(record, entry.result)) {
        migrated.push({ record, result: entry.result });
        restored += 1;
      }
    });
    void localRemove(expired).catch(() => undefined);
    void this.persistLocalEvidence(migrated).catch(() => undefined);
    return restored;
  }

  private async restoreCachedEvidence(records: AnalysisRecord[]): Promise<{ requested: number; restored: number }> {
    const pending = records.filter((record) => record.currency !== 'CAD'
      && !record.mixed.mixed
      && !record.needsQuantity
      && Boolean(record.identity.query)
      && !canReuseRetailEvidence(this.retailEvidence.get(record.lot.id), record.identity.query, record.state.amazonOverrideAsin));
    if (!pending.length) return { requested: 0, restored: 0 };
    const cached = await runtimeMessage<Array<RetailLookupResult | null>>('flippah:retail.peek', {
      identities: pending.map((record) => record.identity),
    });
    let restored = 0;
    const localEntries: Array<{ record: AnalysisRecord; result: RetailLookupResult }> = [];
    pending.forEach((record, index) => {
      const result = cached[index];
      if (!result || !REUSABLE_RETAIL_STATUSES.has(result.status)) return;
      if (this.applyRestoredEvidence(record, result)) {
        localEntries.push({ record, result });
        restored += 1;
      }
    });
    void this.persistLocalEvidence(localEntries).catch(() => undefined);
    return { requested: pending.length, restored };
  }

  private schedule(delay: number): void {
    if (this.rerunTimer !== null) window.clearTimeout(this.rerunTimer);
    this.rerunTimer = window.setTimeout(() => { this.rerunTimer = null; void this.run(); }, delay);
  }

  private scheduleAnnotationRepair(ids: string[]): void {
    ids.forEach((id) => this.pendingAnnotationRepairIds.add(id));
    if (this.annotationRepairTimer !== null) return;
    this.annotationRepairTimer = window.setTimeout(() => {
      this.annotationRepairTimer = null;
      const pending = [...this.pendingAnnotationRepairIds];
      this.pendingAnnotationRepairIds.clear();
      const route = this.getRoute();
      if (!route.supported || !SUPPORTED.has(route.kind)) return;
      pending.forEach((id) => {
        const record = this.records.get(id);
        if (record) applyTileAnnotation(record, route);
      });
    }, 120);
  }

  private update(patch: Partial<DealAnalysisSummary>): void {
    this.summaryValue = { ...this.summaryValue, ...patch, updatedAt: Date.now() };
    try { this.onSummary?.(this.summary()); } catch { /* activity reporting must never stop analysis */ }
  }

  private async run(): Promise<void> {
    const route = this.getRoute();
    if (!route.supported || !SUPPORTED.has(route.kind)) { this.update({ phase: 'idle', message: 'Not available on this page', total: 0, analyzed: 0 }); return; }
    const fingerprint = routeFingerprint(route, location.href);
    const generation = ++this.generation;
    const previousRecords = this.records;
    this.update({ phase: 'scanning', routeFingerprint: fingerprint, total: 0, analyzed: 0, retailMatched: 0, retailUnmatched: 0, mixedLots: 0, quantityReview: 0, message: 'Reading visible lots' });
    try {
      const settings = normalizeSettings(await getSyncStorage());
      let lots = route.kind === 'lot' ? [extractHibidLotDetail(document, location.href)].filter((item): item is HiBidLotRecord => Boolean(item)) : extractHiBidVisibleLots(document, route, location.href);
      if (lots.length && !document.documentElement.dataset.flippahFirstVisibleLotsAt) {
        document.documentElement.dataset.flippahFirstVisibleLotsAt = performance.now().toFixed(1);
      }
      this.visibleLotSignature = lots.map((lot) => lot.id).filter(Boolean).sort().join('|');
      const initialStorageStartedAt = performance.now();
      let prefetchedStorage: Record<string, any> | undefined;
      if (lots.length && this.initialStorageSnapshot) {
        prefetchedStorage = (await this.initialStorageSnapshot) || undefined;
        this.initialStorageSnapshot = null;
      }
      const initialStorage = await readInitialAnalysisStorage(lots, prefetchedStorage);
      document.documentElement.dataset.flippahInitialStorageMs = (performance.now() - initialStorageStartedAt).toFixed(1);
      const stored = initialStorage.storedLots;
      const outcomes = initialStorage.outcomes;
      let auctionPremiums = initialStorage.auctionPremiums;
      let quickRestore = { requested: 0, restored: 0 };
      let localQuickRestored = 0;
      if (settings.amazonAutoLookup) {
        this.update({
          phase: 'restoring',
          total: lots.length,
          analyzed: 0,
          amazonAnalyzed: 0,
          message: 'Restoring saved prices',
        });
      }
      const paintQuickRecord = (record: AnalysisRecord) => {
        const hasSavedEvidence = canReuseRetailEvidence(
          this.retailEvidence.get(record.lot.id),
          record.identity.query,
          record.state.amazonOverrideAsin,
        );
        if (route.kind !== 'lot') {
          if (shouldRenderProvisionalDealAnnotations(route) || hasSavedEvidence) applyTileAnnotation(record, route);
          else reserveTileAnnotationSpace(record.lot.id, route);
        }
        if (route.kind === 'lot') {
          const rerun = () => this.schedule(0);
          if (!renderLotPanel(record, rerun)) window.setTimeout(() => renderLotPanel(record, rerun), 500);
        }
      };
      const fastIdentities = new Map<string, ProductIdentity>();
      if (settings.amazonAutoLookup) {
        lots.forEach((lot) => {
          const evidence = initialStorage.lotEvidence.get(lot.id);
          if (canReuseStoredLotIdentity(lot, evidence)) fastIdentities.set(lot.id, evidence.identity);
        });
      }
      const fastLotIds = new Set(fastIdentities.keys());
      const fastLots = lots.filter((lot) => fastLotIds.has(lot.id));
      const remainingLots = lots.filter((lot) => !fastLotIds.has(lot.id));
      const quickBuildStartedAt = performance.now();
      const fastBuildStartedAt = performance.now();
      const fastRecords = buildAnalysisRecords(fastLots, stored, auctionPremiums, outcomes, settings, fastIdentities)
        .map((record) => this.retainKnownEvidence(record, previousRecords.get(record.lot.id)));
      document.documentElement.dataset.flippahFastBuildMs = (performance.now() - fastBuildStartedAt).toFixed(1);
      if (settings.amazonAutoLookup) {
        localQuickRestored = this.restorePrefetchedLotEvidence(fastRecords, initialStorage.lotEvidence);
        quickRestore.restored = localQuickRestored;
      }
      if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
      this.records = new Map(fastRecords.map((record) => [record.lot.id, record]));
      fastRecords.forEach(paintQuickRecord);
      if (localQuickRestored > 0 && !document.documentElement.dataset.flippahLocalPricesPaintedAt) {
        document.documentElement.dataset.flippahLocalPricesPaintedAt = performance.now().toFixed(1);
        document.documentElement.dataset.flippahLocalPricesPaintedCount = String(localQuickRestored);
      }
      if (localQuickRestored > 0 && remainingLots.length) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
      const remainingRecords = buildAnalysisRecords(remainingLots, stored, auctionPremiums, outcomes, settings)
        .map((record) => this.retainKnownEvidence(record, previousRecords.get(record.lot.id)));
      const byId = new Map([...fastRecords, ...remainingRecords].map((record) => [record.lot.id, record]));
      const quickRecords = lots.flatMap((lot) => {
        const record = byId.get(lot.id);
        return record ? [record] : [];
      });
      document.documentElement.dataset.flippahQuickBuildMs = (performance.now() - quickBuildStartedAt).toFixed(1);
      this.records = new Map(quickRecords.map((record) => [record.lot.id, record]));
      remainingRecords.forEach(paintQuickRecord);
      if (settings.amazonAutoLookup) {
        const identityRestore = await this.restoreLocalCachedEvidence(quickRecords, initialStorage.raw);
        quickRestore.restored += identityRestore;
        if (identityRestore) {
          quickRecords.forEach(paintQuickRecord);
          if (!document.documentElement.dataset.flippahLocalPricesPaintedAt) {
            document.documentElement.dataset.flippahLocalPricesPaintedAt = performance.now().toFixed(1);
            document.documentElement.dataset.flippahLocalPricesPaintedCount = String(identityRestore);
          }
        }
        const backgroundRestore = await this.restoreCachedEvidence(quickRecords);
        quickRestore = {
          requested: backgroundRestore.requested,
          restored: quickRestore.restored + backgroundRestore.restored,
        };
        if (backgroundRestore.restored) quickRecords.forEach(paintQuickRecord);
      }
      if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
      this.update({
        phase: 'scanning',
        total: quickRecords.length,
        analyzed: quickRestore.restored,
        amazonAnalyzed: quickRestore.restored,
        retailMatched: quickRecords.filter((record) => amazonMarketValue(record) !== null).length,
        mixedLots: quickRecords.filter((item) => item.mixed.mixed).length,
        quantityReview: quickRecords.filter((item) => item.needsQuantity).length,
        message: quickRecords.length
          ? `${quickRestore.restored} saved price${quickRestore.restored === 1 ? '' : 's'} restored; reading complete lot details`
          : 'No visible lots to analyze'
      });
      if (lots.length) {
        try {
          const hydrated = await hydrateHibidLots(this.transport, lots.map((lot) => lot.id), route, location.href, { rawRecords: [], retries: 2 });
          const byId = new Map(hydrated.items.map((lot) => [lot.id, lot]));
          lots = lots.map((lot) => {
            const hydratedLot = byId.get(lot.id);
            return hydratedLot ? mergeHibidVisibleWithHydrated(lot, hydratedLot) : lot;
          });
        } catch (error) {
          if (route.kind !== 'lot') throw error;
          this.update({ message: 'Using the complete lot page because live enrichment was unavailable' });
        }
      }
      if (generation !== this.generation || fingerprint !== routeFingerprint(this.getRoute(), location.href)) return;
      auctionPremiums = await readAuctionPremiums(lots.map((lot) => lot.auctionId));
      const quickById = new Map(quickRecords.map((record) => [record.lot.id, record]));
      const preliminary = buildAnalysisRecords(lots, stored, auctionPremiums, outcomes, settings)
        .map((record) => this.retainKnownEvidence(record, quickById.get(record.lot.id)));
      const stillCurrent = () => generation === this.generation && fingerprint === routeFingerprint(this.getRoute(), location.href);
      if (settings.amazonAutoLookup) {
        await this.restoreLocalCachedEvidence(preliminary);
        const pendingRestore = preliminary.filter((record) => record.currency !== 'CAD'
          && !record.mixed.mixed
          && !record.needsQuantity
          && Boolean(record.identity.query)
          && !canReuseRetailEvidence(this.retailEvidence.get(record.lot.id), record.identity.query, record.state.amazonOverrideAsin));
        if (pendingRestore.length) {
          this.update({
            phase: 'restoring',
            total: preliminary.length,
            message: `Restoring saved prices for ${pendingRestore.length} updated lot${pendingRestore.length === 1 ? '' : 's'}`,
          });
          await this.restoreCachedEvidence(preliminary);
        }
      }
      if (!stillCurrent()) return;
      this.records = new Map(preliminary.map((record) => [record.lot.id, record]));
      const repaint = (record: AnalysisRecord) => {
        applyTileAnnotation(record, route);
        if (route.kind === 'lot') {
          const rerun = () => this.schedule(0);
          if (!renderLotPanel(record, rerun)) window.setTimeout(() => stillCurrent() && renderLotPanel(record, rerun), 500);
        }
      };
      preliminary.forEach(repaint);
      const researchable = preliminary.filter((record) => record.currency !== 'CAD' && !record.mixed.mixed && !record.needsQuantity && Boolean(record.identity.query));
      const eligible = researchable.filter((record) => !canReuseRetailEvidence(this.retailEvidence.get(record.lot.id), record.identity.query, record.state.amazonOverrideAsin));
      const retained = researchable.length - eligible.length;
      const skipped = preliminary.length - researchable.length;
      let amazonAnalyzed = settings.amazonAutoLookup ? skipped + retained : preliminary.length;
      const amazonMatchedIds = new Set(preliminary.filter((record) => amazonMarketValue(record) !== null && record.amazon?.status === 'matched').map((record) => record.lot.id));
      const needsNetworkResearch = settings.amazonAutoLookup && eligible.length > 0;
      const updateProgress = () => {
        this.update({
          analyzed: amazonAnalyzed,
          retailMatched: amazonMatchedIds.size,
          retailUnmatched: Math.max(0, preliminary.length - amazonMatchedIds.size),
          amazonAnalyzed,
          amazonMatched: amazonMatchedIds.size,
          message: `Checking Amazon prices ${amazonAnalyzed}/${preliminary.length}`,
        });
      };
      this.update({
        total: preliminary.length,
        analyzed: amazonAnalyzed,
        retailMatched: amazonMatchedIds.size,
        retailUnmatched: Math.max(0, preliminary.length - amazonMatchedIds.size),
        amazonAnalyzed,
        amazonMatched: 0,
        mixedLots: preliminary.filter((item) => item.mixed.mixed).length,
        quantityReview: preliminary.filter((item) => item.needsQuantity).length,
        phase: needsNetworkResearch ? 'retail' : 'complete',
        message: needsNetworkResearch
          ? `Searching Amazon for ${eligible.length} uncached lot${eligible.length === 1 ? '' : 's'}`
          : settings.amazonAutoLookup
            ? `${retained} saved price result${retained === 1 ? '' : 's'} restored`
            : 'Automatic price checks are off',
      });
      if (needsNetworkResearch) {
        const localEvidenceWrites: Array<{ record: AnalysisRecord; result: RetailLookupResult }> = [];
        const queueResult = await runProviderQueue({
            items: eligible,
            shouldContinue: stillCurrent,
            policy: { delayMs: 350, batchSize: 6, maxRetries: 3, retryBaseMs: 5_000, retryMaxMs: 60_000 },
            lookup: async (record): Promise<RetailLookupResult> => {
              try {
                return await runtimeMessage<RetailLookupResult>('flippah:retail.lookup', { identity: record.identity });
              } catch (error) {
                return { status: 'network_error', query: record.identity.query, match: null, candidates: [], fetchedAt: Date.now(), cached: false, retryAfterMs: 5_000, message: error instanceof Error ? error.message : String(error) };
              }
            },
            onProgress: ({ item: record, result }) => {
              if (!stillCurrent()) return;
              const providerResult = copyRetailLookupResult(result);
              if (record.state.amazonOverrideAsin) {
                const candidate = result.candidates.find((item) => item.asin === record.state.amazonOverrideAsin);
                if (candidate) {
                  result.match = { candidate, score: 100 };
                  result.status = 'matched';
                  result.message = `Manual Amazon match: ${candidate.title}`;
                }
              }
              record.amazon = result;
              if (REUSABLE_RETAIL_STATUSES.has(result.status)) {
                this.retailEvidence.set(record.lot.id, {
                  query: record.identity.query,
                  amazonOverrideAsin: String(record.state.amazonOverrideAsin || ''),
                  result,
                });
                localEvidenceWrites.push({ record, result: providerResult });
              }
              const price = amazonMarketValue(record);
              record.amazonIndicator = computeRetailIndicators(record.allIn, { amazon: price }).amazon;
              amazonAnalyzed += 1;
              if (price !== null && result.status === 'matched') amazonMatchedIds.add(record.lot.id);
              repaint(record);
              updateProgress();
            },
          });
        await this.persistLocalEvidence(localEvidenceWrites);
        if (queueResult.stoppedResult && stillCurrent()) {
          this.update({
            phase: 'error',
            message: `${queueResult.stoppedResult.message || 'Amazon price checks paused'} Use Check again after the paced wait.`
          });
          return;
        }
      }
      if (generation !== this.generation) return;
      this.update({
        phase: preliminary.some((record) => record.currency === 'CAD') && preliminary.every((record) => record.currency === 'CAD') ? 'unsupported-currency' : 'complete',
        message: preliminary.length ? `Amazon prices found for ${amazonMatchedIds.size} lot${amazonMatchedIds.size === 1 ? '' : 's'}` : 'No visible lots to analyze'
      });
    } catch (error) {
      if (generation !== this.generation) return;
      if (!shouldRenderProvisionalDealAnnotations(route)) {
        this.records.forEach((record) => applyTileAnnotation(record, route));
      }
      this.update({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}
