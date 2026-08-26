import { getSyncStorage, runtimeMessage } from '../core/browser.js';
import { buildScrapeDiagnostic } from '../core/diagnostics.js';
import { failure, isEnvelope, success, type MessageEnvelope } from '../core/messages.js';
import { resolveHiBidRoute, routeFingerprint } from '../core/route.js';
import { normalizeSettings } from '../core/settings.js';
import type { HiBidLotRecord, HiBidRoute, PageContext, PastAuctionGroup, ScrapeJobSummary } from '../core/types.js';
import type { HiBidTransport } from '../core/types.js';
import { extractAccountLots, extractHiBidPageState, extractHiBidPortalSearchContext, extractHibidLotDetail, extractPastAuctionGroups, extractPastAuctionGroupState } from '../hibid/dom.js';
import { scrapeHibidApiCatalog, validateHibidApiCoverage } from '../hibid/api.js';
import { DealIntelligenceController } from './deal-intelligence.js';
import { installHibidImagePreview } from './image-preview.js';
import { runHibidAuctionHandoff } from './auction-handoff.js';
import type { AuctionRelayAcceptedV1 } from '../core/auction-relay.js';
import { isAnalysisActivityPhase, isScrapeActivityPhase, type ToolbarActivityUpdate } from '../core/activity.js';

document.documentElement.dataset.flippahContentVersion = chrome.runtime.getManifest().version;

let activeJob: ScrapeJobSummary | null = null;
let controller: AbortController | null = null;
let keepalive: chrome.runtime.Port | null = null;
let keepaliveTimer: number | null = null;
let selectedGroup: PastAuctionGroup | undefined;
let saveQueue: Promise<unknown> = Promise.resolve();

const transport: HiBidTransport = {
  searchLots: (body, options) => abortableRuntime('flippah:network.search', { body }, options?.signal),
  hydrateLots: (body, options) => abortableRuntime('flippah:network.hydrate', { body }, options?.signal)
};
function reportToolbarActivity(update: ToolbarActivityUpdate): void {
  void runtimeMessage('flippah:activity.set', update).catch(() => undefined);
}

const dealIntelligence = new DealIntelligenceController(() => {
  let route = resolveHiBidRoute(location.href);
  if (route.supported && route.statePrefix && route.kind === 'search') route = { ...route, ...extractHiBidPortalSearchContext(document) };
  return route;
}, transport, (summary) => reportToolbarActivity({
  kind: 'analysis',
  active: isAnalysisActivityPhase(summary.phase),
  phase: summary.phase,
  message: summary.message,
  current: summary.amazonAnalyzed,
  total: summary.total,
}));
const imagePreview = installHibidImagePreview(document, window, false);
let auctionHandoffInFlight: Promise<AuctionRelayAcceptedV1> | null = null;

function startAuctionHandoff(): Promise<AuctionRelayAcceptedV1> {
  if (auctionHandoffInFlight) return auctionHandoffInFlight;
  const sourceUrl = location.href;
  const operation = runHibidAuctionHandoff({
    document,
    sourceUrl,
    currentUrl: () => location.href,
    transport,
    send: (manifest) => runtimeMessage<AuctionRelayAcceptedV1>('flippah:auction.handoff', { manifest }),
  });
  auctionHandoffInFlight = operation;
  operation.then(
    () => { if (auctionHandoffInFlight === operation) auctionHandoffInFlight = null; },
    () => { if (auctionHandoffInFlight === operation) auctionHandoffInFlight = null; },
  );
  return operation;
}

void getSyncStorage()
  .then((value) => imagePreview.setEnabled(normalizeSettings(value).fullSizeImageHover))
  .catch(() => imagePreview.setEnabled(true));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.fullSizeImageHover) {
    imagePreview.setEnabled(changes.fullSizeImageHover.newValue !== false);
  }
});

function abortableRuntime<T>(type: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('HiBid scrape cancelled'));
  return Promise.race([
    runtimeMessage<T>(type, payload),
    new Promise<T>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('HiBid scrape cancelled')), { once: true }))
  ]);
}

function nowSummary(route: HiBidRoute, fingerprint: string, scopeId: string | null): ScrapeJobSummary {
  const now = Date.now();
  return {
    jobId: crypto.randomUUID(), schemaVersion: 1, tabId: null, sourceUrl: location.href,
    fingerprint, routeKind: route.kind as ScrapeJobSummary['routeKind'], scopeId, phase: 'queued', revision: 1,
    expectedTotal: null, enumeratedCount: 0, hydratedCount: 0, message: 'Queued', errorCode: '',
    startedAt: now, updatedAt: now, completedAt: null
  };
}

async function saveJob(patch: Partial<ScrapeJobSummary>): Promise<ScrapeJobSummary> {
  const operation = saveQueue.then(async () => {
    if (!activeJob) throw new Error('No active scrape job');
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

async function checkpointRecords(jobId: string, records: HiBidLotRecord[]): Promise<void> {
  const size = 50;
  if (!records.length) {
    await runtimeMessage('flippah:job.records', { jobId, records: [], replace: true });
    return;
  }
  for (let index = 0; index < records.length; index += size) {
    await runtimeMessage('flippah:job.records', { jobId, records: records.slice(index, index + size), replace: index === 0 });
  }
}

function mergeDetail(base: HiBidLotRecord, detail: HiBidLotRecord | null): HiBidLotRecord {
  if (!detail) return base;
  const images = [...new Set([...base.images, ...detail.images])];
  return {
    ...base,
    title: detail.title || base.title,
    lead: detail.lead || base.lead,
    description: detail.description || base.description,
    descriptionHtml: detail.descriptionHtml || base.descriptionHtml,
    category: detail.category || base.category,
    categories: detail.categories.length ? detail.categories : base.categories,
    images,
    image: images[0] || base.image,
    currentBid: detail.currentBid ?? base.currentBid,
    nextBid: detail.nextBid ?? base.nextBid,
    rawText: `${base.rawText}\n[DETAIL]\n${detail.rawText}`.slice(0, 20000),
    descriptionFields: detail.descriptionFields || base.descriptionFields || {}
  };
}

async function enrichAccountLots(items: HiBidLotRecord[], signal: AbortSignal): Promise<{ items: HiBidLotRecord[]; failures: string[] }> {
  const output = items.slice();
  const queue = items.map((item, index) => ({ item, index }));
  const failures: string[] = [];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const next = queue.shift();
      if (!next) return;
      if (!next.item.url) { failures.push(`Lot ${next.item.lot}: missing detail URL`); continue; }
      try {
        const response = await fetch(next.item.url, { credentials: 'same-origin', cache: 'no-store', signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const document = new DOMParser().parseFromString(await response.text(), 'text/html');
        output[next.index] = mergeDetail(next.item, extractHibidLotDetail(document, next.item.url));
      } catch (error) {
        if (!signal.aborted) failures.push(`Lot ${next.item.lot}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await saveJob({ phase: 'hydrating', hydratedCount: output.filter((item) => Boolean(item.description || item.images.length)).length, message: `Reading descriptions ${Math.min(items.length, items.length - queue.length)}/${items.length}` });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, () => worker()));
  return { items: output, failures };
}

async function readAccountPages(route: HiBidRoute, signal: AbortSignal): Promise<{ items: HiBidLotRecord[]; expected: number | null; failures: string[] }> {
  const firstState = extractHiBidPageState(document, location.href);
  const groups = route.kind === 'pastbids' || route.kind === 'pastwatchlist' ? extractPastAuctionGroups(document, location.href) : [];
  const groupState = selectedGroup ? extractPastAuctionGroupState(document, selectedGroup) : null;
  const found = new Map<string, HiBidLotRecord>();
  const failures: string[] = [];
  const add = (root: Document | Element, url: string) => {
    for (const item of extractAccountLots(root, route, url, selectedGroup)) found.set(item.id, item);
  };
  add(document, location.href);
  const expected = groupState?.expectedTotal ?? (selectedGroup && groups.length !== 1 ? null : firstState.visibleExpectedTotal);
  const pageSize = firstState.visibleCount || Math.max(1, found.size);
  const pages = expected !== null && expected > pageSize ? Math.ceil(expected / pageSize) : 1;
  for (let page = 2; page <= pages && !signal.aborted; page += 1) {
    const url = new URL(location.href);
    url.searchParams.set('apage', String(page));
    try {
      const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!selectedGroup || extractPastAuctionGroupState(next, selectedGroup).found) add(next, url.href);
      else failures.push(`Page ${page}: selected auction group ${selectedGroup.id} was not present`);
      await saveJob({ phase: 'enumerating', expectedTotal: expected, enumeratedCount: found.size, message: `Reading account page ${page}/${pages}` });
    } catch (error) {
      failures.push(`Page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { items: [...found.values()], expected, failures };
}

async function runJob(route: HiBidRoute): Promise<void> {
  if (!activeJob || !controller) return;
  const startFingerprint = activeJob.fingerprint;
  const signal = controller.signal;
  startKeepalive();
  try {
    let items: HiBidLotRecord[] = [];
    let coverage: any;
    let failures: string[] = [];
    if (route.kind === 'lot') {
      await saveJob({ phase: 'hydrating', expectedTotal: 1, message: 'Reading lot detail' });
      const lot = extractHibidLotDetail(document, location.href);
      items = lot ? [lot] : [];
      coverage = validateHibidApiCoverage({ enumeratedIds: lot ? [lot.id] : [], hydratedItems: items, expectedTotal: 1, startFingerprint, endFingerprint: routeFingerprint(resolveHiBidRoute(location.href), location.href) });
    } else if (['watchlist', 'currentbids-winning', 'currentbids-outbid', 'pastbids', 'pastwatchlist'].includes(route.kind)) {
      await saveJob({ phase: 'enumerating', message: 'Reading saved HiBid lots' });
      let account = await readAccountPages(route, signal);
      if (route.kind === 'watchlist') {
        for (let attempt = 1; attempt < 3 && account.expected !== null && account.items.length !== account.expected && !signal.aborted; attempt += 1) {
          await saveJob({
            phase: 'enumerating',
            expectedTotal: account.expected,
            enumeratedCount: account.items.length,
            message: `Watchlist changed during capture; refreshing snapshot ${attempt}/2`
          });
          const refresh = [...document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button, a')]
            .find((element) => /^refresh$/i.test(element.textContent?.trim() || '') && !element.closest('[data-flippah-root]'));
          refresh?.click();
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          account = await readAccountPages(route, signal);
        }
      }
      failures = account.failures;
      await saveJob({ phase: 'hydrating', expectedTotal: account.expected, enumeratedCount: account.items.length, message: 'Reading lot descriptions' });
      const enriched = await enrichAccountLots(account.items, signal);
      items = enriched.items;
      failures.push(...enriched.failures);
      const ids = account.items.map((item) => item.id);
      coverage = validateHibidApiCoverage({ enumeratedIds: ids, hydratedItems: items, expectedTotal: account.expected, failedPages: failures.map((error, index) => ({ page: index + 1, error })), startFingerprint, endFingerprint: routeFingerprint(resolveHiBidRoute(location.href), location.href), stopped: signal.aborted });
    } else {
      const visibleState = extractHiBidPageState(document, location.href);
      await saveJob({ phase: 'enumerating', expectedTotal: visibleState.visibleExpectedTotal, message: 'Enumerating exact HiBid IDs' });
      const result = await scrapeHibidApiCatalog(transport, route, location.href, {
        visibleState, signal,
        onProgress: (message) => { void saveJob({ message }); }
      });
      items = result.items;
      coverage = result.coverage;
      failures = result.errors;
    }
    if (signal.aborted) {
      await saveJob({ phase: 'stopped', message: 'Stopped', errorCode: 'user-stop', completedAt: Date.now() });
      return;
    }
    if (routeFingerprint(resolveHiBidRoute(location.href), location.href) !== startFingerprint) {
      await saveJob({ phase: 'stale', message: 'Page or filters changed; retry on the current page', errorCode: 'route-fingerprint-changed', completedAt: Date.now() });
      return;
    }
    await saveJob({ phase: 'validating', expectedTotal: coverage.expectedCount, enumeratedCount: coverage.uniqueEnumeratedCount, hydratedCount: coverage.uniqueHydratedCount, message: 'Validating exact coverage' });
    if (!coverage.complete) throw Object.assign(new Error(`Coverage failed: ${coverage.reason} (${coverage.uniqueHydratedCount}/${coverage.expectedCount ?? '?'})`), { coverage, failures });
    await checkpointRecords(activeJob.jobId, items);
    await saveJob({ phase: 'completed', expectedTotal: items.length, enumeratedCount: items.length, hydratedCount: items.length, message: `Ready to copy ${items.length} lot${items.length === 1 ? '' : 's'}`, completedAt: Date.now() });
    await runtimeMessage('flippah:diagnostic.store', {
      jobId: activeJob.jobId,
      diagnostic: buildScrapeDiagnostic({ job: activeJob, coverage, failures })
    });
  } catch (error: any) {
    if (signal.aborted) return;
    const diagnostic = {
      sourceUrl: location.href, fingerprint: startFingerprint, phase: activeJob.phase,
      reason: error?.message || String(error), expectedTotal: activeJob.expectedTotal,
      enumeratedCount: activeJob.enumeratedCount, hydratedCount: activeJob.hydratedCount,
      coverage: error?.coverage || {}, failures: error?.failures || []
    };
    await saveJob({ phase: 'failed', message: error?.message || 'Scrape failed', errorCode: error?.coverage?.reason || 'scrape-failed', completedAt: Date.now() });
    const stored = await runtimeMessage<{ diagnostic: unknown }>('flippah:diagnostic.store', { jobId: activeJob.jobId, diagnostic });
    try {
      await navigator.clipboard.writeText(JSON.stringify(stored.diagnostic, null, 2));
    } catch {
      await runtimeMessage('flippah:diagnostic.download', { diagnostic: stored.diagnostic });
    }
  } finally {
    stopKeepalive();
  }
}

function pageContext(): PageContext {
  let route = resolveHiBidRoute(location.href);
  if (route.supported && route.statePrefix && route.kind === 'search') {
    route = { ...route, ...extractHiBidPortalSearchContext(document) };
  }
  const state = extractHiBidPageState(document, location.href);
  return {
    supported: route.supported, url: location.href, title: document.title, route,
    fingerprint: routeFingerprint(route, location.href), visibleExpectedTotal: state.visibleExpectedTotal,
    noMatches: state.noMatches,
    auctionGroups: route.kind === 'pastbids' || route.kind === 'pastwatchlist' ? extractPastAuctionGroups(document, location.href) : [],
    job: activeJob?.fingerprint === routeFingerprint(route, location.href) ? activeJob : null,
    analysis: dealIntelligence.summary()
  };
}

async function handleMessage(message: MessageEnvelope): Promise<unknown> {
  if (message.type === 'flippah:page.get-context') return pageContext();
  if (message.type === 'flippah:job.start' || message.type === 'flippah:job.retry') {
    const context = pageContext();
    if (!context.route.supported) throw new Error(context.route.reason || 'Unsupported HiBid page');
    if (activeJob && !['completed', 'failed', 'stopped', 'stale'].includes(activeJob.phase)) return activeJob;
    const groupId = String((message.payload as any)?.groupId || '');
    selectedGroup = context.auctionGroups.find((group) => group.id === groupId);
    if ((context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist') && !selectedGroup) throw new Error('Select one past auction first');
    controller?.abort();
    controller = new AbortController();
    activeJob = nowSummary(context.route, context.fingerprint, selectedGroup?.id || null);
    await saveJob({ phase: 'queued' });
    void runJob(context.route);
    return activeJob;
  }
  if (message.type === 'flippah:job.stop') {
    if (activeJob && !['completed', 'failed', 'stopped', 'stale'].includes(activeJob.phase)) {
      await saveJob({ phase: 'stopping', message: 'Stopping' });
      controller?.abort();
      await saveJob({ phase: 'stopped', message: 'Stopped', errorCode: 'user-stop', completedAt: Date.now() });
      await runtimeMessage('flippah:diagnostic.store', {
        jobId: activeJob.jobId,
        diagnostic: buildScrapeDiagnostic({ job: activeJob })
      });
    }
    return activeJob;
  }
  if (message.type === 'flippah:analysis.rerun') {
    await dealIntelligence.rerun();
    return dealIntelligence.summary();
  }
  if (message.type === 'flippah:analysis.clear-cache') {
    await dealIntelligence.clearCache();
    return dealIntelligence.summary();
  }
  if (message.type === 'flippah:auction.handoff.start') {
    const context = pageContext();
    if (!context.route.supported || context.route.kind !== 'lot') {
      throw new Error('Book analysis is available only on an individual HiBid lot');
    }
    return startAuctionHandoff();
  }
  throw new Error('Unknown page command');
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
    void saveJob({ phase: 'stale', message: 'Page changed during scrape', errorCode: 'route-fingerprint-changed', completedAt: Date.now() })
      .then(() => activeJob && runtimeMessage('flippah:diagnostic.store', {
        jobId: activeJob.jobId,
        diagnostic: buildScrapeDiagnostic({ job: activeJob })
      }));
  } else {
    activeJob = null;
    selectedGroup = undefined;
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
