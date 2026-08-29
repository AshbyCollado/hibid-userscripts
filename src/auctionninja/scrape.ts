import {
  auctionNinjaRouteFingerprint,
  buildAuctionNinjaCatalogPageUrl,
  buildAuctionNinjaMarketplaceAjaxPageUrl,
  canonicalAuctionNinjaProductUrl,
  resolveAuctionNinjaPage,
  toAuctionNinjaUrl
} from './route.js';
import {
  extractAuctionNinjaAccountItems,
  extractAuctionNinjaCatalogLots,
  extractAuctionNinjaCategoryContext,
  extractAuctionNinjaItemDetail,
  extractAuctionNinjaSaleContext,
  mergeAuctionNinjaItemDetail,
  parseAuctionNinjaAccountTotal,
  parseCatalogRange
} from './dom.js';
import { extractAuctionNinjaAuctionSearchContext, extractAuctionNinjaAuctionSearchSales, parseAuctionNinjaPagedResponse } from './marketplace.js';
import { buildAuctionNinjaPageAudit, validateAuctionNinjaCoverage, validateAuctionNinjaPageCoverage } from './coverage.js';
import type {
  AuctionNinjaAccountItem,
  AuctionNinjaCoverage,
  AuctionNinjaDocumentParser,
  AuctionNinjaFetch,
  AuctionNinjaLocationLike,
  AuctionNinjaLotRecord,
  AuctionNinjaPageAudit,
  AuctionNinjaPagedResponse,
  AuctionNinjaRoute,
  AuctionNinjaScrapeOptions,
  AuctionNinjaScrapeResult,
  AuctionNinjaSaleRecord
} from './types.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_CONCURRENCY = 4;

type ScrapeInput = AuctionNinjaLocationLike | AuctionNinjaFetch;
type LotLike = AuctionNinjaLotRecord | AuctionNinjaAccountItem;

function isFetch(value: ScrapeInput): value is AuctionNinjaFetch {
  return typeof value === 'function';
}

function normalizeArgs(input: ScrapeInput, locationOrOptions?: AuctionNinjaLocationLike | AuctionNinjaScrapeOptions, options?: AuctionNinjaScrapeOptions): { location: AuctionNinjaLocationLike; options: AuctionNinjaScrapeOptions } {
  if (isFetch(input)) {
    if (!locationOrOptions || typeof locationOrOptions === 'object' && !('href' in locationOrOptions)) throw new Error('AuctionNinja location is required');
    return { location: locationOrOptions as AuctionNinjaLocationLike, options: { ...(options || {}), fetcher: input } };
  }
  return { location: input, options: (locationOrOptions as AuctionNinjaScrapeOptions) || {} };
}

function defaultParser(html: string, url: string): Document {
  if (typeof DOMParser === 'undefined') throw new Error('AuctionNinja scraper requires a DOMParser or parseDocument option');
  return new DOMParser().parseFromString(html, 'text/html');
}

function fetcherFrom(options: AuctionNinjaScrapeOptions): AuctionNinjaFetch {
  const fetcher = options.fetcher || options.fetch;
  if (fetcher) return fetcher;
  if (typeof fetch === 'undefined') throw new Error('AuctionNinja scraper requires a fetcher');
  return fetch.bind(globalThis);
}

function parserFrom(options: AuctionNinjaScrapeOptions): AuctionNinjaDocumentParser {
  return options.parseDocument || options.documentParser || defaultParser;
}

function cancelled(): Error {
  const error = new Error('AuctionNinja scrape cancelled');
  error.name = 'AbortError';
  return error;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

async function requestText(url: string, options: AuctionNinjaScrapeOptions): Promise<string> {
  const fetcher = fetcherFrom(options);
  const signal = options.signal;
  const attempts = Math.max(1, Math.min(DEFAULT_ATTEMPTS, Math.floor(options.attempts || DEFAULT_ATTEMPTS)));
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    checkCancelled(signal);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled: ((reason?: unknown) => void) | undefined;
    const abort = () => {
      controller.abort();
      rejectCancelled?.(cancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const request = fetcher(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`AuctionNinja request failed: HTTP ${response.status}`);
          return response.text();
        });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`AuctionNinja request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const aborted = new Promise<never>((_, reject) => { rejectCancelled = reject; });
      return await Promise.race([request, timeout, aborted]);
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      lastError = error instanceof Error && error.name === 'AbortError'
        ? new Error(`AuctionNinja request timed out after ${timeoutMs}ms`)
        : error;
      if (attempt === attempts) break;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'AuctionNinja request failed'));
}

function currentFingerprint(route: AuctionNinjaRoute, source: AuctionNinjaLocationLike, options: AuctionNinjaScrapeOptions): string {
  const location = options.getLocation?.() || source;
  return auctionNinjaRouteFingerprint(route, location);
}

function pageTotal(document: Document, kind: AuctionNinjaRoute['kind']): { total: number | null; range: { start: number; end: number } | null; pageSize: number } {
  const raw = document.body?.textContent || document.documentElement?.textContent || '';
  const range = parseCatalogRange(raw);
  if (range) return { total: range.total, range: { start: range.start, end: range.end }, pageSize: range.pageSize };
  if (kind === 'followed-items' || kind === 'items-won' || kind === 'bid-history') return { total: parseAuctionNinjaAccountTotal(raw), range: null, pageSize: 20 };
  return { total: null, range: null, pageSize: 20 };
}

function failureMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function mapConcurrent<T>(values: T[], concurrency: number, worker: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) }, run));
}

function lotsCoverage(audits: AuctionNinjaPageAudit[], expectedTotal: number | null, failedPages: Array<{ page?: number; url?: string; error: string }>, startFingerprint: string, endFingerprint: string, items: LotLike[], detailsAttempted: boolean, detailFailures: Array<{ id: string; url: string; error: string }>): AuctionNinjaCoverage {
  const pageCoverage = validateAuctionNinjaPageCoverage(audits, expectedTotal, { failedPages, startFingerprint, endFingerprint });
  if (!detailsAttempted || !pageCoverage.complete || expectedTotal === null) return pageCoverage;
  const hydrated = validateAuctionNinjaCoverage({
    expectedTotal,
    enumeratedIds: audits.flatMap((audit) => audit.ids),
    hydratedIds: items
      .filter((item) => !detailFailures.some((failure) => failure.id === String(item.stableId || item.id)))
      .map((item) => String(item.stableId || item.id)),
    pageCounts: audits.map((audit) => audit.count),
    startFingerprint,
    endFingerprint
  });
  return hydrated;
}

async function enrichLots(items: LotLike[], sourceUrl: string, options: AuctionNinjaScrapeOptions, failedDetails: Array<{ id: string; url: string; error: string }>): Promise<void> {
  const parser = parserFrom(options);
  const source = new URL(sourceUrl);
  await mapConcurrent(items, options.concurrency || DEFAULT_CONCURRENCY, async (item) => {
    checkCancelled(options.signal);
    const url = canonicalAuctionNinjaProductUrl(item.url, sourceUrl);
    if (!url || new URL(url).origin !== source.origin) {
      failedDetails.push({ id: String(item.stableId || item.id), url: item.url, error: 'detail URL is not same-origin' });
      return;
    }
    try {
      const html = await requestText(url, options);
      checkCancelled(options.signal);
      const detail = extractAuctionNinjaItemDetail(parser(html, url), url);
      if (!detail || detail.stableId !== item.stableId) throw new Error('detail stable ID mismatch');
      Object.assign(item, mergeAuctionNinjaItemDetail(item, detail));
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      failedDetails.push({ id: String(item.stableId || item.id), url, error: failureMessage(error) });
    }
  });
}

function baseResult(route: AuctionNinjaRoute, sourceUrl: string, context: AuctionNinjaScrapeResult['context'], expectedTotal: number | null, items: AuctionNinjaScrapeResult['items'], sales: AuctionNinjaSaleRecord[], pageAudits: AuctionNinjaPageAudit[], failedPages: Array<{ page?: number; url?: string; error: string }>, failedDetails: Array<{ id: string; url: string; error: string }>, coverage: AuctionNinjaCoverage, fingerprint: string): AuctionNinjaScrapeResult {
  return { source: 'AuctionNinja', route, sourceUrl, fingerprint, context, items, sales, expectedTotal, pageAudits, coverage, failedPages, failedDetails };
}

async function scrapeLotPages(source: AuctionNinjaLocationLike, route: AuctionNinjaRoute, options: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  const sourceUrl = toAuctionNinjaUrl(source).href;
  const startFingerprint = currentFingerprint(route, source, options);
  const parser = parserFrom(options);
  const pageAudits: AuctionNinjaPageAudit[] = [];
  const failedPages: Array<{ page?: number; url?: string; error: string }> = [];
  const items: LotLike[] = [];
  let expectedTotal: number | null = null;
  let context: AuctionNinjaScrapeResult['context'] = {};
  let pageSize = 20;
  let routeDrift = false;
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    checkCancelled(options.signal);
    if (currentFingerprint(route, source, options) !== startFingerprint) { routeDrift = true; break; }
    const url = buildAuctionNinjaCatalogPageUrl(source, page);
    try {
      const document = parser(await requestText(url, options), url);
      const pageInfo = pageTotal(document, route.kind);
      const pageItems: LotLike[] = route.kind === 'followed-items' || route.kind === 'items-won' || route.kind === 'bid-history'
        ? extractAuctionNinjaAccountItems(document, url, route.kind)
        : extractAuctionNinjaCatalogLots(document, url, route.kind === 'category-search' ? 'category-search' : 'sale-catalog');
      if (page === 1) {
        context = route.kind === 'category-search'
          ? extractAuctionNinjaCategoryContext(document, url)
          : route.kind === 'sale-catalog'
            ? extractAuctionNinjaSaleContext(document, url)
            : { source: 'AuctionNinja', pageKind: route.kind, url: sourceUrl };
        const contextTotal = route.kind === 'category-search'
          ? (context as ReturnType<typeof extractAuctionNinjaCategoryContext>).totalItems
          : route.kind === 'sale-catalog'
            ? (context as ReturnType<typeof extractAuctionNinjaSaleContext>).expectedTotal
            : null;
        expectedTotal = pageInfo.total ?? contextTotal;
        // Category pages commonly say only "229 results" and expose no
        // Showing-range. The canonical cards establish the real page size.
        pageSize = pageInfo.range ? pageInfo.pageSize : (pageItems.length || pageInfo.pageSize || 20);
        pageCount = expectedTotal === null ? 1 : Math.max(1, Math.ceil(expectedTotal / pageSize));
      }
      if (page === 1 && (route.kind === 'followed-items' || route.kind === 'items-won' || route.kind === 'bid-history')) {
        pageSize = Math.max(pageInfo.range ? pageInfo.range.end - pageInfo.range.start + 1 : 0, pageItems.length) || 20;
        pageCount = expectedTotal === null ? 1 : Math.max(1, Math.ceil(expectedTotal / pageSize));
      }
      const range = pageInfo.range && pageItems.length > pageInfo.range.end - pageInfo.range.start + 1
        ? { start: pageInfo.range.start, end: pageInfo.range.start + pageItems.length - 1 }
        : pageInfo.range;
      pageAudits.push(buildAuctionNinjaPageAudit(pageItems, url, pageInfo.total ?? expectedTotal, range));
      items.push(...pageItems);
      options.onProgress?.(`AuctionNinja ${route.kind} page ${page}/${pageCount}`);
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      failedPages.push({ page, url, error: failureMessage(error) });
    }
    page += 1;
  }
  const failedDetails: Array<{ id: string; url: string; error: string }> = [];
  if (items.length) await enrichLots(items, sourceUrl, options, failedDetails);
  const endFingerprint = currentFingerprint(route, source, options);
  if (!routeDrift && endFingerprint !== startFingerprint) routeDrift = true;
  const coverage = lotsCoverage(pageAudits, expectedTotal, failedPages, startFingerprint, routeDrift ? `${startFingerprint}:drift` : endFingerprint, items, items.length > 0, failedDetails);
  return baseResult(route, sourceUrl, context, expectedTotal, items, [], pageAudits, failedPages, failedDetails, coverage, startFingerprint);
}

async function scrapeAccount(source: AuctionNinjaLocationLike, route: AuctionNinjaRoute, options: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  return scrapeLotPages(source, route, options);
}

async function scrapeSearch(source: AuctionNinjaLocationLike, route: AuctionNinjaRoute, options: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  const sourceUrl = toAuctionNinjaUrl(source).href;
  const startFingerprint = currentFingerprint(route, source, options);
  const parser = parserFrom(options);
  const pageAudits: AuctionNinjaPageAudit[] = [];
  const failedPages: Array<{ page?: number; url?: string; error: string }> = [];
  const sales: AuctionNinjaSaleRecord[] = [];
  let expectedTotal: number | null = null;
  let pageSize = 12;
  let pageCount = 1;
  let context: AuctionNinjaScrapeResult['context'] = {};
  let routeDrift = false;
  for (let page = 1; page <= pageCount; page += 1) {
    checkCancelled(options.signal);
    if (currentFingerprint(route, source, options) !== startFingerprint) { routeDrift = true; break; }
    const url = buildAuctionNinjaMarketplaceAjaxPageUrl(source, page);
    try {
      const payload: AuctionNinjaPagedResponse = parseAuctionNinjaPagedResponse(await requestText(url, options));
      const document = parser(payload.html, url);
      const pageSales = extractAuctionNinjaAuctionSearchSales(document, url);
      if (page === 1) {
        expectedTotal = payload.totalSales;
        pageSize = pageSales.length || pageSize;
        pageCount = expectedTotal === null ? 1 : Math.max(1, Math.ceil(expectedTotal / pageSize));
        context = extractAuctionNinjaAuctionSearchContext(document, source);
      }
      pageAudits.push(buildAuctionNinjaPageAudit(pageSales, url, payload.totalSales));
      sales.push(...pageSales);
      options.onProgress?.(`AuctionNinja auction-search page ${page}/${pageCount}`);
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      failedPages.push({ page, url, error: failureMessage(error) });
    }
  }
  const endFingerprint = currentFingerprint(route, source, options);
  if (endFingerprint !== startFingerprint) routeDrift = true;
  const coverage = validateAuctionNinjaPageCoverage(pageAudits, expectedTotal, { failedPages, startFingerprint, endFingerprint: routeDrift ? `${startFingerprint}:drift` : endFingerprint });
  return baseResult(route, sourceUrl, context, expectedTotal, [], sales, pageAudits, failedPages, [], coverage, startFingerprint);
}

async function scrapeItem(source: AuctionNinjaLocationLike, route: AuctionNinjaRoute, options: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  const sourceUrl = canonicalAuctionNinjaProductUrl(toAuctionNinjaUrl(source).href) || toAuctionNinjaUrl(source).href;
  const startFingerprint = currentFingerprint(route, source, options);
  const parser = parserFrom(options);
  const pageAudits: AuctionNinjaPageAudit[] = [];
  const failedPages: Array<{ page?: number; url?: string; error: string }> = [];
  let detail = null;
  try {
    detail = extractAuctionNinjaItemDetail(parser(await requestText(sourceUrl, options), sourceUrl), sourceUrl);
  } catch (error) {
    if (options.signal?.aborted) throw cancelled();
    failedPages.push({ page: 1, url: sourceUrl, error: failureMessage(error) });
  }
  const expectedId = route.productId || '';
  const hydratedIds = detail ? [detail.stableId] : [];
  const coverage = validateAuctionNinjaCoverage({ expectedTotal: 1, enumeratedIds: [expectedId], hydratedIds, startFingerprint, endFingerprint: currentFingerprint(route, source, options) });
  if (detail && detail.stableId === expectedId) pageAudits.push(buildAuctionNinjaPageAudit([detail], sourceUrl, 1, { start: 1, end: 1 }));
  const items = detail && detail.stableId === expectedId ? [detail] : [];
  return { ...baseResult(route, sourceUrl, { source: 'AuctionNinja', pageKind: 'item-detail', url: sourceUrl }, 1, items, [], pageAudits, failedPages, [], coverage, startFingerprint), detail };
}

async function scrapeWithRoute(source: AuctionNinjaLocationLike, options: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  const route = resolveAuctionNinjaPage(source);
  if (!route.supported) throw new Error(`Unsupported AuctionNinja route: ${route.reason}`);
  if (route.kind === 'item-detail') return scrapeItem(source, route, options);
  if (route.kind === 'auction-search') return scrapeSearch(source, route, options);
  if (route.kind === 'sale-catalog' || route.kind === 'category-search') return scrapeLotPages(source, route, options);
  if (route.kind === 'followed-items' || route.kind === 'items-won' || route.kind === 'bid-history') return scrapeAccount(source, route, options);
  throw new Error(`Unsupported AuctionNinja route: ${route.reason}`);
}

export function scrapeAuctionNinja(input: AuctionNinjaLocationLike, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult>;
export function scrapeAuctionNinja(fetcher: AuctionNinjaFetch, location: AuctionNinjaLocationLike, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult>;
export function scrapeAuctionNinja(input: ScrapeInput, locationOrOptions?: AuctionNinjaLocationLike | AuctionNinjaScrapeOptions, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  const args = normalizeArgs(input, locationOrOptions, options);
  return scrapeWithRoute(args.location, args.options);
}

export function scrapeAuctionNinjaSaleCatalog(input: AuctionNinjaLocationLike, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult>;
export function scrapeAuctionNinjaSaleCatalog(fetcher: AuctionNinjaFetch, location: AuctionNinjaLocationLike, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult>;
export function scrapeAuctionNinjaSaleCatalog(input: ScrapeInput, locationOrOptions?: AuctionNinjaLocationLike | AuctionNinjaScrapeOptions, options?: AuctionNinjaScrapeOptions): Promise<AuctionNinjaScrapeResult> {
  return scrapeAuctionNinja(input as never, locationOrOptions as never, options);
}

export const scrapeAuctionNinjaCategory = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaAuctionSearch = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaItem = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaItemDetail = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaFollowedItems = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaItemsWon = scrapeAuctionNinjaSaleCatalog;
export const scrapeAuctionNinjaBidHistory = scrapeAuctionNinjaSaleCatalog;
