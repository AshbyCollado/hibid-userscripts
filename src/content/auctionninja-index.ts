import { runtimeMessage } from '../core/browser.js';
import { failure, isEnvelope, success, type MessageEnvelope } from '../core/messages.js';
import type { PageContext, ScrapeJobSummary, ScrapeStoredRecord } from '../core/types.js';
import { isAnalysisActivityPhase, isScrapeActivityPhase, type ToolbarActivityUpdate } from '../core/activity.js';
import {
  auctionNinjaRouteFingerprint,
  extractAuctionNinjaAuctionSearchContext,
  extractAuctionNinjaCategoryContext,
  extractAuctionNinjaSaleContext,
  parseAuctionNinjaAccountTotal,
  resolveAuctionNinjaPage,
  saleIdFromAuctionNinjaUrl,
  scrapeAuctionNinja,
  type AuctionNinjaRoute,
  type AuctionNinjaScrapeResult,
} from '../auctionninja/index.js';
import type { AuctionNinjaExportRecord } from '../auctionninja/exports.js';
import { AuctionNinjaDealIntelligenceController } from './auctionninja-deal-intelligence.js';

document.documentElement.dataset.flippahContentVersion = chrome.runtime.getManifest().version;
document.documentElement.dataset.flippahAuctionNinja = 'active';

let activeJob: ScrapeJobSummary | null = null;
let controller: AbortController | null = null;
let keepalive: chrome.runtime.Port | null = null;
let keepaliveTimer: number | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();

function routeNow(): AuctionNinjaRoute {
  return resolveAuctionNinjaPage(location.href);
}

function fingerprintNow(route = routeNow()): string {
  return auctionNinjaRouteFingerprint(route, location.href);
}

function reportToolbarActivity(update: ToolbarActivityUpdate): void {
  void runtimeMessage('flippah:activity.set', update).catch(() => undefined);
}

const dealIntelligence = new AuctionNinjaDealIntelligenceController(routeNow, (summary) => {
  reportToolbarActivity({
    kind: 'analysis',
    active: isAnalysisActivityPhase(summary.phase),
    phase: summary.phase,
    message: summary.message,
    current: summary.amazonAnalyzed,
    total: summary.total,
  });
});

function nowSummary(route: AuctionNinjaRoute, fingerprint: string): ScrapeJobSummary {
  const now = Date.now();
  return {
    jobId: crypto.randomUUID(),
    schemaVersion: 1,
    tabId: null,
    sourceUrl: location.href,
    fingerprint,
    routeKind: route.kind,
    scopeId: null,
    phase: 'queued',
    revision: 1,
    expectedTotal: null,
    enumeratedCount: 0,
    hydratedCount: 0,
    message: 'Queued',
    errorCode: '',
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

async function saveJob(patch: Partial<ScrapeJobSummary>): Promise<ScrapeJobSummary> {
  const operation = saveQueue.then(async () => {
    if (!activeJob) throw new Error('No active AuctionNinja scrape job');
    const snapshot = { ...activeJob, ...patch, revision: activeJob.revision + 1, updatedAt: Date.now() };
    activeJob = snapshot;
    const response = await runtimeMessage<{ stored: boolean; job: ScrapeJobSummary }>('flippah:job.put', { job: snapshot });
    if (!activeJob || response.job.revision >= activeJob.revision) activeJob = response.job;
    reportToolbarActivity({
      kind: 'scrape',
      active: isScrapeActivityPhase(activeJob.phase),
      phase: activeJob.phase,
      message: activeJob.message,
      current: activeJob.hydratedCount || activeJob.enumeratedCount,
      total: activeJob.expectedTotal,
    });
    return activeJob;
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function startKeepalive(): void {
  stopKeepalive();
  keepalive = chrome.runtime.connect({ name: 'flippah-scrape-owner' });
  const send = () => {
    try { keepalive?.postMessage({ jobId: activeJob?.jobId || '', revision: activeJob?.revision || 0 }); } catch { /* reconnect on next job */ }
  };
  send();
  keepaliveTimer = window.setInterval(send, 20_000);
}

function stopKeepalive(): void {
  if (keepaliveTimer !== null) window.clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  try { keepalive?.disconnect(); } catch { /* already disconnected */ }
  keepalive = null;
}

function storageRecord(record: AuctionNinjaExportRecord, route: AuctionNinjaRoute): ScrapeStoredRecord {
  const stableId = String(record.stableId || record.id || '').trim();
  const saleUrl = 'saleUrl' in record ? String(record.saleUrl || '') : String(record.url || '');
  return {
    ...record,
    id: stableId,
    auctionId: route.saleId || saleIdFromAuctionNinjaUrl(saleUrl),
  } as ScrapeStoredRecord;
}

async function checkpointRecords(jobId: string, records: ScrapeStoredRecord[]): Promise<void> {
  const size = 50;
  if (!records.length) {
    await runtimeMessage('flippah:job.records', { jobId, records: [], replace: true });
    return;
  }
  for (let index = 0; index < records.length; index += size) {
    await runtimeMessage('flippah:job.records', { jobId, records: records.slice(index, index + size), replace: index === 0 });
  }
}

function currentExpectedTotal(route: AuctionNinjaRoute): number | null {
  try {
    if (route.kind === 'item-detail') return 1;
    if (route.kind === 'sale-catalog') return extractAuctionNinjaSaleContext(document, location.href).expectedTotal;
    if (route.kind === 'category-search') return extractAuctionNinjaCategoryContext(document, location.href).totalItems;
    if (route.kind === 'auction-search') return extractAuctionNinjaAuctionSearchContext(document, location.href).totalSales;
    if (route.kind === 'followed-items' || route.kind === 'items-won' || route.kind === 'bid-history') {
      return parseAuctionNinjaAccountTotal(document.body?.innerText || document.body?.textContent || '');
    }
  } catch { /* the scraper will provide a diagnostic with the exact failure */ }
  return null;
}

function progressCounts(result: AuctionNinjaScrapeResult): { enumerated: number; hydrated: number } {
  const records = result.items.length ? result.items : result.sales;
  const enumerated = result.coverage.uniqueIdentityCount;
  const hydrated = result.items.length
    ? result.items.filter((item) => Boolean(item.detailEnriched || item.pageKind === 'item-detail')).length
    : records.length;
  return { enumerated, hydrated: Math.max(hydrated, result.coverage.complete ? records.length : 0) };
}

function diagnosticFor(result: AuctionNinjaScrapeResult | null, reason = ''): Record<string, unknown> {
  return {
    provider: 'AuctionNinja',
    sourceUrl: activeJob?.sourceUrl || location.href,
    fingerprint: activeJob?.fingerprint || fingerprintNow(),
    phase: activeJob?.phase || 'failed',
    reason: reason || activeJob?.errorCode || activeJob?.message || '',
    expectedTotal: activeJob?.expectedTotal ?? result?.expectedTotal ?? null,
    enumeratedCount: activeJob?.enumeratedCount ?? result?.coverage.uniqueIdentityCount ?? 0,
    hydratedCount: activeJob?.hydratedCount ?? result?.items.length ?? result?.sales.length ?? 0,
    coverage: result?.coverage || {},
    pageAudits: result?.pageAudits || [],
    failedPages: result?.failedPages || [],
    failedDetails: result?.failedDetails || [],
  };
}

async function runJob(route: AuctionNinjaRoute): Promise<void> {
  if (!activeJob || !controller) return;
  const signal = controller.signal;
  const startFingerprint = activeJob.fingerprint;
  let result: AuctionNinjaScrapeResult | null = null;
  startKeepalive();
  try {
    await saveJob({ phase: 'enumerating', expectedTotal: currentExpectedTotal(route), message: 'Reading AuctionNinja pages' });
    result = await scrapeAuctionNinja(location.href, {
      fetcher: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
      parseDocument: (html) => new DOMParser().parseFromString(html, 'text/html'),
      signal,
      concurrency: 4,
      timeoutMs: 20_000,
      attempts: 3,
      getLocation: () => location.href,
      onProgress: (message) => { void saveJob({ message }); },
    });
    if (signal.aborted) {
      await saveJob({ phase: 'stopped', message: 'Stopped', errorCode: 'user-stop', completedAt: Date.now() });
      return;
    }
    if (fingerprintNow() !== startFingerprint) {
      await saveJob({ phase: 'stale', message: 'Page or filters changed; retry on the current page', errorCode: 'route-fingerprint-drift', completedAt: Date.now() });
      return;
    }
    const counts = progressCounts(result);
    await saveJob({
      phase: 'validating',
      expectedTotal: result.expectedTotal,
      enumeratedCount: counts.enumerated,
      hydratedCount: counts.hydrated,
      message: 'Validating exact AuctionNinja coverage',
    });
    if (!result.coverage.complete) {
      throw Object.assign(new Error(`Coverage failed: ${result.coverage.reason} (${result.coverage.uniqueIdentityCount}/${result.expectedTotal ?? '?'})`), { result });
    }
    const records = (result.items.length ? result.items : result.sales).map((record) => storageRecord(record as AuctionNinjaExportRecord, route));
    await checkpointRecords(activeJob.jobId, records);
    await saveJob({
      phase: 'completed',
      expectedTotal: records.length,
      enumeratedCount: records.length,
      hydratedCount: records.length,
      message: `Ready to copy ${records.length} ${route.kind === 'auction-search' ? 'auction' : 'lot'}${records.length === 1 ? '' : 's'}`,
      completedAt: Date.now(),
    });
    await runtimeMessage('flippah:diagnostic.store', { jobId: activeJob.jobId, diagnostic: diagnosticFor(result) });
  } catch (error) {
    if (signal.aborted) return;
    const reason = error instanceof Error ? error.message : String(error);
    const coverageReason = result?.coverage.reason || 'auctionninja-scrape-failed';
    await saveJob({ phase: 'failed', message: reason, errorCode: coverageReason, completedAt: Date.now() });
    const diagnostic = diagnosticFor(result, reason);
    await runtimeMessage('flippah:diagnostic.store', { jobId: activeJob.jobId, diagnostic });
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
    } catch {
      await runtimeMessage('flippah:diagnostic.download', { diagnostic });
    }
  } finally {
    stopKeepalive();
  }
}

function exportContext(route: AuctionNinjaRoute, expected: number | null): PageContext {
  const fingerprint = fingerprintNow(route);
  return {
    supported: route.supported,
    url: location.href,
    title: document.title,
    route: { ...route, source: 'auctionninja' },
    fingerprint,
    visibleExpectedTotal: expected,
    noMatches: expected === 0,
    auctionGroups: [],
    job: activeJob?.fingerprint === fingerprint ? activeJob : null,
    analysis: dealIntelligence.summary(),
  };
}

function pageContext(): PageContext {
  const route = routeNow();
  return exportContext(route, currentExpectedTotal(route));
}

async function handleMessage(message: MessageEnvelope): Promise<unknown> {
  if (message.type === 'flippah:page.get-context') return pageContext();
  if (message.type === 'flippah:job.start' || message.type === 'flippah:job.retry') {
    const context = pageContext();
    if (!context.route.supported) throw new Error(context.route.reason || 'Unsupported AuctionNinja page');
    if (activeJob && !['completed', 'failed', 'stopped', 'stale'].includes(activeJob.phase)) return activeJob;
    controller?.abort();
    controller = new AbortController();
    activeJob = nowSummary(routeNow(), context.fingerprint);
    await saveJob({ phase: 'queued' });
    void runJob(routeNow());
    return activeJob;
  }
  if (message.type === 'flippah:job.stop') {
    if (activeJob && !['completed', 'failed', 'stopped', 'stale'].includes(activeJob.phase)) {
      await saveJob({ phase: 'stopping', message: 'Stopping' });
      controller?.abort();
      await saveJob({ phase: 'stopped', message: 'Stopped', errorCode: 'user-stop', completedAt: Date.now() });
      await runtimeMessage('flippah:diagnostic.store', { jobId: activeJob.jobId, diagnostic: diagnosticFor(null, 'user-stop') });
    }
    return activeJob;
  }
  if (message.type === 'flippah:analysis.rerun') {
    dealIntelligence.rerun();
    return dealIntelligence.summary();
  }
  if (message.type === 'flippah:analysis.clear-cache') {
    await dealIntelligence.clearCache();
    return dealIntelligence.summary();
  }
  throw new Error('Unknown AuctionNinja page command');
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isEnvelope(message) || !message.type.startsWith('flippah:')) return false;
  handleMessage(message)
    .then((data) => sendResponse(success(message, data)))
    .catch((error) => sendResponse(failure(message, 'page-operation-failed', error)));
  return true;
});

let lastHref = location.href;
function handleLocationChange(): void {
  if (location.href === lastHref) return;
  lastHref = location.href;
  if (activeJob && !['completed', 'failed', 'stopped', 'stale'].includes(activeJob.phase)) {
    controller?.abort();
    void saveJob({ phase: 'stale', message: 'Page changed during scrape', errorCode: 'route-fingerprint-drift', completedAt: Date.now() })
      .then(() => activeJob && runtimeMessage('flippah:diagnostic.store', { jobId: activeJob.jobId, diagnostic: diagnosticFor(null, 'route-fingerprint-drift') }));
  } else {
    activeJob = null;
  }
  dealIntelligence.handleLocationChange();
}

new MutationObserver((mutations) => {
  handleLocationChange();
  dealIntelligence.handleMutations(mutations);
}).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', handleLocationChange);
window.addEventListener('hashchange', handleLocationChange);
window.setInterval(handleLocationChange, 500);
dealIntelligence.start();
