import { activeTab, getLocalStorage, getSyncStorage, runtimeMessage, setLocalStorage, tabMessage } from '../core/browser.js';
import { buildCsv } from '../core/csv.js';
import { getDiagnostic, getJobForFingerprint, getRecords } from '../core/job-db.js';
import { normalizeSettings } from '../core/settings.js';
import { jobMatchesContextAndScope } from '../core/job-scope.js';
import { calculateDealOutcome, type DealOutcome } from '../core/outcomes.js';
import type { HiBidLotRecord, PageContext, ScrapeJobSummary } from '../core/types.js';
import type { AuctionRelayAcceptedV1 } from '../core/auction-relay.js';
import { buildHibidExportPayload, buildHibidResearchQueue } from '../hibid/exports.js';
import { buildHibidSavedResearchSnapshot, hibidSavedResearchStorageKeys } from '../intelligence/deal-storage.js';
import { buildAuctionNinjaExportPayload, buildAuctionNinjaResearchQueue, type AuctionNinjaExportContext, type AuctionNinjaExportRecord } from '../auctionninja/exports.js';
import { clampResearchBatch, researchBatchCount, researchBatchScopeKey, restoreResearchBatchSelection } from './research-batch-selection.js';
import { buildResearchCopyText } from './research-copy.js';
import { createCopyCoordinator } from './copy-coordinator.js';
import { resolveResearchSessionStartedAt, type ResearchSessionIdentity } from '../intelligence/research-session-storage.js';
import { resolveAuctionNinjaPage } from '../auctionninja/route.js';
import { currentViewRenderKey } from './render-key.js';
import {
  UPDATE_STATE_STORAGE_KEY,
  failedUpdateState,
  idleUpdateState,
  normalizeStoredUpdateState,
  runtimeResultUpdateState,
  checkingUpdateState,
  unsupportedUpdateState,
  type ExtensionUpdateState,
  type RuntimeUpdateCheckResultLike,
} from '../core/update-check.js';

const app = document.querySelector<HTMLElement>('#app')!;
const currentVersion = chrome.runtime.getManifest().version;
let currentTabId: number | null = null;
let context: PageContext | null = null;
let job: ScrapeJobSummary | null = null;
let selectedTab: 'current' | 'watchlist' = 'watchlist';
let selectedGroupId = '';
let selectedResearchBatch = 1;
let researchBatchKey = '';
let toast = '';
let toastFromRefreshError = false;
let pendingCopy: { format: 'json' | 'llm'; batch: number; request: number } | null = null;
let pollTimer: number | null = null;
let refreshInFlight = false;
let countdownTimer: number | null = null;
let bookHandoffBusy = false;
let bookHandoffStatus = 'Ready to send every seller photo';
let bookHandoffFailed = false;
let updateCheckState: ExtensionUpdateState = idleUpdateState(currentVersion);
let lastCurrentRenderKey: string | null = null;

function legacyMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response: T) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(response);
  }));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function safeHiBidUrl(value: unknown, fallback = '#'): string {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && /(^|\.)hibid\.com$/i.test(url.hostname) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function replaceMarkup(target: Element, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  target.replaceChildren(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)));
}

function formatCountdown(endsAt: unknown): string {
  const remaining = Number(endsAt) - Date.now();
  if (!Number.isFinite(remaining)) return 'Closing time unavailable';
  if (remaining <= 0) return 'Ended';
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`;
}

function refreshCountdowns(): void {
  app.querySelectorAll<HTMLElement>('[data-ends-at]').forEach((node) => {
    node.textContent = formatCountdown(node.dataset.endsAt);
  });
}

function busy(): boolean {
  return Boolean(job && ['queued', 'enumerating', 'hydrating', 'validating', 'stopping'].includes(job.phase));
}

function jobMatchesSelection(candidate: ScrapeJobSummary | null = job): boolean {
  return jobMatchesContextAndScope(candidate, context, selectedGroupId);
}

async function loadMatchingJob(): Promise<ScrapeJobSummary | null> {
  if (!context) return null;
  const past = context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist';
  if (past && !selectedGroupId) return null;
  const scopeId = past ? selectedGroupId : null;
  if (jobMatchesContextAndScope(context.job, context, selectedGroupId)) return context.job;
  const stored = await getJobForFingerprint(currentTabId, context.fingerprint, scopeId);
  return jobMatchesContextAndScope(stored, context, selectedGroupId) ? stored : null;
}

async function syncResearchBatchSelection(): Promise<void> {
  const key = context?.supported ? researchBatchScopeKey(context.fingerprint, selectedGroupId) : '';
  if (key === researchBatchKey) return;
  researchBatchKey = key;
  selectedResearchBatch = 1;
  if (!key) return;
  const stored = await getLocalStorage([key]).catch((): Record<string, unknown> => ({}));
  if (key !== researchBatchKey) return;
  selectedResearchBatch = restoreResearchBatchSelection(
    stored[key], job?.phase === 'completed' ? job.hydratedCount : null,
  );
}

function routeLabel(): string {
  if (!context?.route.supported) return 'Unsupported page';
  const labels: Record<string, string> = {
    catalog: 'Auction catalog', livecatalog: 'Live catalog', search: 'Lot search', lot: 'Single lot',
    watchlist: 'Watchlist', 'currentbids-winning': 'Winning bids', 'currentbids-outbid': 'Outbid bids',
    pastbids: 'Past bids', pastwatchlist: 'Past watchlist',
    'sale-catalog': 'AuctionNinja sale', 'category-search': 'AuctionNinja category',
    'item-detail': 'AuctionNinja item', 'followed-items': 'AuctionNinja followed items',
    'items-won': 'AuctionNinja won items', 'bid-history': 'AuctionNinja bid history',
    'auction-search': 'AuctionNinja auctions'
  };
  return labels[context.route.kind] || context.route.kind;
}

function statusClass(): string {
  if (job?.phase === 'failed' || job?.phase === 'stale') return 'failed';
  return busy() ? 'busy' : '';
}

function scrapeStatusText(current: number, count: number | null | undefined): string {
  if (context?.noMatches) return 'No matching lots';
  if (!job) return 'Ready';
  if (busy()) return count ? `Scanning ${current} of ${count}` : 'Scanning this page';
  if (job.phase === 'completed') return `${job.hydratedCount} lot${job.hydratedCount === 1 ? '' : 's'} ready`;
  if (job.phase === 'stopped') return 'Scan stopped';
  if (job.phase === 'stale') return 'Page changed. Scan again';
  if (job.phase === 'failed') return 'Could not finish the scan';
  return 'Ready';
}

function analysisStatusText(analysis: PageContext['analysis']): string {
  if (analysis.phase === 'scanning' || analysis.phase === 'retail') {
    return 'Checking prices';
  }
  if (analysis.phase === 'complete') {
    if (analysis.mixedLots || analysis.quantityReview) return 'Prices ready; some lots need review';
    return analysis.retailMatched ? 'Prices ready' : 'No verified prices found';
  }
  if (analysis.phase === 'error') return 'Price check needs attention';
  if (analysis.phase === 'unsupported-currency') return 'USD comparison unavailable';
  return analysis.message === 'Automatic price checks are off' ? 'Automatic checks are off' : 'Ready';
}

function currentHtml(): string {
  if (!context?.supported) return `<section class="panel"><div class="card"><div class="eyebrow">Scraper</div><h1>Open a supported auction page</h1><p class="route">HiBid and AuctionNinja catalogs, searches, item pages, and account lists can be copied here.</p></div></section>`;
  const count = job?.expectedTotal ?? context.visibleExpectedTotal;
  const current = job?.hydratedCount || job?.enumeratedCount || 0;
  const percent = count && count > 0 ? Math.min(100, Math.round(current / count * 100)) : (job?.phase === 'completed' ? 100 : 0);
  let groupSelect = context.auctionGroups.length ? `<label for="auction-group">Past auction</label><select id="auction-group"><option value="">Select an auction</option>${context.auctionGroups.map((group) => `<option value="${escapeHtml(group.id)}" ${selectedGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.title)}${group.location ? ` — ${escapeHtml(group.location)}` : ''}</option>`).join('')}</select>` : '';
  const terminalFailure = Boolean(job && ['failed', 'stale', 'stopped'].includes(job.phase));
  const canStart = !busy() && !terminalFailure && (!(context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist') || Boolean(selectedGroupId));
  const complete = jobMatchesSelection() && job?.phase === 'completed';
  const batchLotCount = complete ? job?.hydratedCount ?? 0 : 0;
  const totalBatches = researchBatchCount(batchLotCount);
  if (totalBatches > 1) {
    const batch = clampResearchBatch(selectedResearchBatch, batchLotCount);
    groupSelect += `<label for="research-batch">AI research batch</label><select id="research-batch" aria-label="AI research batch">${Array.from({ length: totalBatches }, (_, index) => `<option value="${index + 1}" ${batch === index + 1 ? 'selected' : ''}>Batch ${index + 1} of ${totalBatches} · lots ${index * 8 + 1}–${Math.min((index + 1) * 8, batchLotCount)}</option>`).join('')}</select>`;
  }
  const analysis = context.analysis;
  const analysisPercent = analysis.total > 0 ? Math.min(100, Math.round(analysis.analyzed / analysis.total * 100)) : 0;
  const analysisHtml = ['catalog', 'livecatalog', 'search', 'lot', 'watchlist', 'currentbids-winning', 'currentbids-outbid', 'sale-catalog', 'category-search', 'item-detail', 'followed-items', 'items-won', 'bid-history'].includes(context.route.kind)
    ? `<div class="analysis"><div class="analysis-head"><strong>Price research</strong><span>${escapeHtml(analysisStatusText(analysis))}</span></div>${analysis.phase === 'scanning' || analysis.phase === 'retail' ? `<div class="progress"><i style="width:${analysisPercent}%"></i></div>` : ''}<div class="actions compact"><button id="rerun-analysis" class="button" ${analysis.phase === 'scanning' || analysis.phase === 'retail' ? 'disabled' : ''}>Check again</button><button id="clear-retail-cache" class="button">Clear saved prices</button></div></div>`
    : '';
  const booksHtml = context.route.kind === 'lot' && /(^|\.)hibid\.com$/i.test(new URL(context.url).hostname)
    ? `<div class="book-tools"><div class="analysis-head"><strong>Books</strong><span>Complete photo handoff</span></div><p class="section-copy">Send this lot and every seller photo to the local book analyzer.</p><div class="actions compact"><button id="analyze-books" class="button" ${bookHandoffBusy ? 'disabled' : ''}>${bookHandoffBusy ? 'Sending photos…' : 'Analyze this lot'}</button></div><div class="section-status ${bookHandoffFailed ? 'failed' : ''}" role="status" aria-live="${bookHandoffFailed ? 'assertive' : 'polite'}">${escapeHtml(bookHandoffStatus)}</div></div>`
    : '';
  return `<section class="panel"><div class="card"><div class="eyebrow">Scraper</div><h1>${escapeHtml(routeLabel())}</h1>${groupSelect}<div class="status ${statusClass()}"><span class="dot"></span><span>${escapeHtml(scrapeStatusText(current, count))}</span></div>${busy() || job?.phase === 'completed' ? `<div class="progress"><i style="width:${percent}%"></i></div>` : ''}<div class="actions"><button id="copy-llm" class="button primary" ${!canStart && !complete ? 'disabled' : ''}>Copy for AI</button><button id="copy-json" class="button" ${!canStart && !complete ? 'disabled' : ''}>Copy JSON</button>${busy() ? '<button id="stop" class="button danger">Stop</button>' : ''}${job?.phase === 'failed' || job?.phase === 'stale' || job?.phase === 'stopped' ? '<button id="retry" class="button">Try again</button>' : ''}</div><div class="toast">${escapeHtml(toast)}</div>${analysisHtml}${booksHtml}${debugHtml()}</div></section>`;
}

function debugHtml(): string {
  return document.documentElement.dataset.debug === 'true' && job
    ? `<div class="debug"><button id="copy-debug" class="button">Copy Diagnostic</button><button id="download-debug" class="button">Download Diagnostic</button></div>`
    : '';
}

function shell(body: string): string {
  const checking = updateCheckState.phase === 'checking';
  const updateStatus = updateCheckState.phase === 'idle'
    ? ''
    : `<div class="update-status ${escapeHtml(updateCheckState.phase)}" role="status" aria-live="polite">${escapeHtml(updateCheckState.message)}</div>`;
  return `<div class="shell"><header class="topbar"><span class="brand">Flippah by ALOS</span><span class="version">v${escapeHtml(currentVersion)}</span><button id="check-updates" class="icon-button update-button ${checking ? 'checking' : ''}" title="Check Chrome Web Store for a Flippah update" aria-label="Check for Flippah updates" ${checking ? 'disabled' : ''}>↻</button><button id="settings" class="icon-button" title="Open Flippah settings" aria-label="Open settings">⚙</button></header>${updateStatus}<nav class="tabs" aria-label="Flippah sections"><button class="tab" data-tab="watchlist" aria-selected="${selectedTab === 'watchlist'}">Watchlist</button><button class="tab" data-tab="current" aria-selected="${selectedTab === 'current'}">Scraper</button></nav>${body}</div>`;
}

function currentRenderKey(): string {
  return JSON.stringify([
    currentViewRenderKey(selectedTab, context, selectedGroupId, job?.phase ?? null),
    job?.phase === 'completed' ? job.jobId : null,
    job?.phase === 'completed' ? job.hydratedCount : null,
    job?.phase === 'completed' ? job.expectedTotal : null,
  ]);
}

function patchCurrentView(): void {
  const status = app.querySelector<HTMLElement>('.status');
  if (status) {
    status.className = `status ${statusClass()}`;
    const statusText = status.querySelector('span:last-child');
    if (statusText) statusText.textContent = scrapeStatusText(job?.hydratedCount || job?.enumeratedCount || 0, job?.expectedTotal ?? context?.visibleExpectedTotal);
  }

  const scraperProgress = status?.nextElementSibling?.classList.contains('progress') ? status.nextElementSibling : null;
  const count = job?.expectedTotal ?? context?.visibleExpectedTotal;
  const current = job?.hydratedCount || job?.enumeratedCount || 0;
  const percent = count && count > 0 ? Math.min(100, Math.round(current / count * 100)) : (job?.phase === 'completed' ? 100 : 0);
  if (scraperProgress) {
    scraperProgress.querySelector<HTMLElement>('i')!.style.width = `${percent}%`;
    scraperProgress.toggleAttribute('hidden', !(busy() || job?.phase === 'completed'));
  }

  const complete = jobMatchesSelection() && job?.phase === 'completed';
  const terminalFailure = Boolean(job && ['failed', 'stale', 'stopped'].includes(job.phase));
  const canStart = !busy() && !terminalFailure && (!(context?.route.kind === 'pastbids' || context?.route.kind === 'pastwatchlist') || Boolean(selectedGroupId));
  app.querySelectorAll<HTMLButtonElement>('#copy-llm, #copy-json').forEach((button) => { button.disabled = !canStart && !complete; });
  const toastNode = app.querySelector<HTMLElement>('.toast');
  if (toastNode) toastNode.textContent = toast;

  const analysis = context?.analysis;
  const analysisNode = app.querySelector<HTMLElement>('.analysis');
  if (analysis && analysisNode) {
    const analysisStatus = analysisNode.querySelector<HTMLElement>('.analysis-head span');
    if (analysisStatus) analysisStatus.textContent = analysisStatusText(analysis);
    const analysisProgress = analysisNode.querySelector<HTMLElement>('.progress');
    if (analysisProgress) {
      const analysisPercent = analysis.total > 0 ? Math.min(100, Math.round(analysis.analyzed / analysis.total * 100)) : 0;
      analysisProgress.querySelector<HTMLElement>('i')!.style.width = `${analysisPercent}%`;
    }
    const rerun = analysisNode.querySelector<HTMLButtonElement>('#rerun-analysis');
    if (rerun) rerun.disabled = analysis.phase === 'scanning' || analysis.phase === 'retail';
  }
}

async function render(options: { preserveCurrent?: boolean } = {}): Promise<void> {
  if (options.preserveCurrent && selectedTab === 'current' && lastCurrentRenderKey === currentRenderKey() && app.querySelector('.shell')) {
    patchCurrentView();
    return;
  }
  if (selectedTab === 'current') {
    replaceMarkup(app, shell(currentHtml()));
    lastCurrentRenderKey = currentRenderKey();
  } else {
    const [watchlist, outcomes] = await Promise.all([
      legacyMessage<any[]>({ kind: 'watch:list' }).catch(() => []),
      legacyMessage<DealOutcome[]>({ kind: 'outcome:list' }).catch(() => []),
    ]);
    const exportActions = `<div class="actions" style="margin:0 0 10px"><button id="export-watchlist" class="button primary">Export watchlist</button>${outcomes.length ? `<button id="export-outcomes" class="button">Export outcomes (${outcomes.length})</button>` : ''}</div>`;
    const cards = watchlist.length
      ? `<section class="panel">${exportActions}<div class="watch-list">${watchlist.map((item) => `<article class="watch"><div>${safeHiBidUrl(item.imageUrl, '') ? `<img src="${escapeHtml(safeHiBidUrl(item.imageUrl, ''))}" alt="">` : ''}</div><div><a class="watch-title" href="${escapeHtml(safeHiBidUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || `Lot ${item.lotId}`)}</a><div class="watch-meta">${escapeHtml(item.auctioneerName || 'Unknown auctioneer')}</div><div class="watch-meta">${Number.isFinite(item.currentBidCents) ? `$${(item.currentBidCents / 100).toFixed(2)} bid` : 'Bid unavailable'}${Number.isFinite(item.maxBidCents) ? ` · max $${(item.maxBidCents / 100).toFixed(2)}` : ''}</div><div class="watch-meta countdown" data-ends-at="${escapeHtml(item.endsAt ?? '')}">${escapeHtml(formatCountdown(item.endsAt))}</div>${item.note ? `<div class="watch-note">${escapeHtml(item.note)}</div>` : ''}</div><button class="icon-button remove-watch" data-lot-id="${escapeHtml(item.lotId)}" title="Remove watched lot">×</button></article>`).join('')}</div></section>`
      : `<section class="panel">${exportActions}<div class="empty">No watched lots yet.</div></section>`;
    replaceMarkup(app, shell(cards));
    lastCurrentRenderKey = null;
  }
  bind();
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = selectedTab === 'watchlist' ? window.setInterval(refreshCountdowns, 1000) : null;
}

function bind(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    selectedTab = button.dataset.tab as 'current' | 'watchlist'; void render();
  }));
  app.querySelector('#check-updates')?.addEventListener('click', () => void checkForUpdates());
  app.querySelector('#settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  app.querySelector<HTMLSelectElement>('#auction-group')?.addEventListener('change', async (event) => {
    copyCoordinator.begin();
    pendingCopy = null;
    selectedGroupId = (event.currentTarget as HTMLSelectElement).value;
    job = await loadMatchingJob();
    await syncResearchBatchSelection();
    toast = '';
    await render();
  });
  app.querySelector<HTMLSelectElement>('#research-batch')?.addEventListener('change', async (event) => {
    copyCoordinator.begin();
    pendingCopy = null;
    selectedResearchBatch = clampResearchBatch(Number((event.currentTarget as HTMLSelectElement).value), job?.hydratedCount ?? 0);
    if (researchBatchKey) await setLocalStorage({ [researchBatchKey]: selectedResearchBatch });
    toast = '';
    await render();
  });
  app.querySelector('#copy-json')?.addEventListener('click', () => void copyOrStart('json'));
  app.querySelector('#copy-llm')?.addEventListener('click', () => void copyOrStart('llm'));
  app.querySelector('#stop')?.addEventListener('click', () => void command('flippah:job.stop'));
  app.querySelector('#retry')?.addEventListener('click', () => void command('flippah:job.retry'));
  app.querySelector('#rerun-analysis')?.addEventListener('click', () => void analysisCommand('flippah:analysis.rerun', 'Checking prices again'));
  app.querySelector('#clear-retail-cache')?.addEventListener('click', () => void analysisCommand('flippah:analysis.clear-cache', 'Saved prices cleared; checking again'));
  app.querySelector('#analyze-books')?.addEventListener('click', () => void analyzeBooks());
  app.querySelector('#copy-debug')?.addEventListener('click', () => void copyDiagnostic(false));
  app.querySelector('#download-debug')?.addEventListener('click', () => void copyDiagnostic(true));
  app.querySelector('#export-watchlist')?.addEventListener('click', () => void exportWatchlist());
  app.querySelector('#export-outcomes')?.addEventListener('click', () => void exportOutcomes());
  app.querySelectorAll<HTMLButtonElement>('.remove-watch').forEach((button) => button.addEventListener('click', async () => {
    await legacyMessage({ kind: 'watch:remove', lotId: button.dataset.lotId }); await render();
  }));
}

async function checkForUpdates(): Promise<void> {
  if (updateCheckState.phase === 'checking') return;
  const runtime = chrome.runtime as typeof chrome.runtime & {
    requestUpdateCheck?: () => Promise<RuntimeUpdateCheckResultLike>;
  };
  if (typeof runtime.requestUpdateCheck !== 'function') {
    updateCheckState = unsupportedUpdateState(currentVersion);
    await setLocalStorage({ [UPDATE_STATE_STORAGE_KEY]: updateCheckState }).catch(() => undefined);
    await render();
    return;
  }

  updateCheckState = checkingUpdateState(currentVersion);
  await render();
  try {
    const result = await runtime.requestUpdateCheck.call(chrome.runtime);
    updateCheckState = runtimeResultUpdateState(result, currentVersion);
  } catch {
    updateCheckState = failedUpdateState(currentVersion);
  }
  await setLocalStorage({ [UPDATE_STATE_STORAGE_KEY]: updateCheckState }).catch(() => undefined);
  await render();
}

async function analyzeBooks(): Promise<void> {
  if (currentTabId === null || context?.route.kind !== 'lot' || !/(^|\.)hibid\.com$/i.test(new URL(context.url).hostname) || bookHandoffBusy) return;
  bookHandoffBusy = true;
  bookHandoffFailed = false;
  bookHandoffStatus = 'Reading and reconciling seller photos…';
  await render();
  try {
    const result = await tabMessage<AuctionRelayAcceptedV1>(currentTabId, 'flippah:auction.handoff.start', {});
    bookHandoffStatus = `Opened lot ${result.lot_id} in the book analyzer`;
  } catch (error) {
    bookHandoffFailed = true;
    bookHandoffStatus = error instanceof Error ? error.message : String(error);
  } finally {
    bookHandoffBusy = false;
  }
  await render();
}

async function analysisCommand(type: string, message: string): Promise<void> {
  if (currentTabId === null) return;
  try {
    await tabMessage(currentTabId, type, {});
    toast = message;
    await updateContextFromTab();
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  await render();
}

async function command(type: string): Promise<void> {
  if (currentTabId === null) return;
  try {
    job = await tabMessage<ScrapeJobSummary>(currentTabId, type, { groupId: selectedGroupId });
    toast = type.endsWith('stop') ? 'Stopping…' : 'Retrying…';
    startPolling();
  } catch (error) { toast = error instanceof Error ? error.message : String(error); }
  await render();
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fallback below */ }
  const area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied');
  } finally {
    area.remove();
  }
}

const copyCoordinator = createCopyCoordinator(copyText);

async function copyCompleted(format: 'json' | 'llm', requestedBatch: number, request: number): Promise<void> {
  if (!copyCoordinator.isCurrent(request)) return;
  if (!context || !job || !jobMatchesSelection()) throw new Error('No completed scrape matches this page and selection');
  const sourceJob = job;
  const sourceContext = context;
  const sourceGroupId = selectedGroupId;
  const sourceBatchKey = researchBatchKey;
  const settings = normalizeSettings(await getSyncStorage());
  const items = await getRecords(sourceJob.jobId);
  const savedStorage = await getLocalStorage(hibidSavedResearchStorageKeys(items));
  const savedResearch = buildHibidSavedResearchSnapshot(items, savedStorage);
  const auctionNinja = /(^|\.)auctionninja\.com$/i.test(new URL(sourceContext.url).hostname);
  const route = auctionNinja ? resolveAuctionNinjaPage(sourceContext.url) : null;
  const scope = sourceJob.scopeId || (route?.kind === 'sale-catalog' ? route.saleId : route?.kind === 'category-search' ? route.categorySlug : route?.kind === 'item-detail' ? route.productId : null);
  const identities: ResearchSessionIdentity[] = auctionNinja
    ? buildAuctionNinjaResearchQueue(items as unknown as AuctionNinjaExportRecord[], savedResearch).map((row, index) => ({
      auctionId: route?.saleId || (items[index] as unknown as { saleUrl?: string }).saleUrl || null,
      sourceId: row.id,
      query: row.query,
      condition: String((items[index] as unknown as { descriptionFields?: { condition?: string } }).descriptionFields?.condition || ''),
    }))
    : buildHibidResearchQueue(items as unknown as HiBidLotRecord[], savedResearch).map((row, index) => ({
      auctionId: (items[index] as HiBidLotRecord).auctionId,
      sourceId: row.id,
      query: row.query,
      condition: String((items[index] as HiBidLotRecord & { descriptionFields?: { Condition?: string } }).descriptionFields?.Condition || ''),
    }));
  const sessionStartedAt = await resolveResearchSessionStartedAt({
    provider: auctionNinja ? 'AuctionNinja' : 'HiBid',
    pageKind: sourceContext.route.kind,
    routeFingerprint: sourceJob.fingerprint,
    scope,
    identities,
  });
  const payload = auctionNinja
    ? buildAuctionNinjaExportPayload({
      source: 'AuctionNinja',
      pageKind: sourceContext.route.kind as AuctionNinjaExportContext['pageKind'],
      url: sourceContext.url,
      title: sourceContext.title,
      fingerprint: sourceContext.fingerprint,
      expectedTotal: sourceContext.visibleExpectedTotal,
      scopeId: null,
      route: route!,
    } as AuctionNinjaExportContext, sourceJob, items as unknown as AuctionNinjaExportRecord[], settings, savedResearch, sessionStartedAt)
    : buildHibidExportPayload(sourceContext, sourceJob, items as unknown as HiBidLotRecord[], settings, savedResearch, sessionStartedAt);
  const copied = buildResearchCopyText(payload, settings, format, requestedBatch);
  if (!copyCoordinator.isCurrent(request) || job?.jobId !== sourceJob.jobId || context?.fingerprint !== sourceContext.fingerprint
    || selectedGroupId !== sourceGroupId || researchBatchKey !== sourceBatchKey
    || (format === 'llm' && selectedResearchBatch !== requestedBatch)) {
    throw new Error('Page or AI batch changed while copying; select it and try again');
  }
  if (!await copyCoordinator.write(request, copied.text) || !copyCoordinator.isCurrent(request)
    || (format === 'llm' && selectedResearchBatch !== requestedBatch)) return;
  toast = `${copied.batchNumber > 0 ? `Copied AI batch ${copied.batchNumber}/${copied.batchCount} (${Math.min(8, items.length - (copied.batchNumber - 1) * 8)} lots)` : `Copied ${items.length} lot${items.length === 1 ? '' : 's'}`} · descriptions on ${payload.audit.fidelity.metrics.description.percent}% · image links on ${payload.audit.fidelity.metrics.images.percent}%${auctionNinja ? ' · gallery total unverified' : ''}`;
}

async function copyOrStart(format: 'json' | 'llm'): Promise<void> {
  const request = copyCoordinator.begin();
  try {
    const requestedBatch = selectedResearchBatch;
    const requestedScope = researchBatchKey;
    await updateContextFromTab();
    if (!copyCoordinator.isCurrent(request)) return;
    if (requestedScope && requestedScope !== researchBatchKey) throw new Error('Page changed while copying; try again');
    if (jobMatchesSelection() && job?.phase === 'completed') await copyCompleted(format, requestedBatch, request);
    else if (job && ['failed', 'stale', 'stopped'].includes(job.phase)) throw new Error('Retry this scrape before exporting');
    else {
      pendingCopy = { format, batch: requestedBatch, request };
      await command('flippah:job.start');
      toast = 'Scanning the current page…';
    }
  } catch (error) { if (copyCoordinator.isCurrent(request)) toast = error instanceof Error ? error.message : String(error); }
  await render();
}

async function copyDiagnostic(download: boolean): Promise<void> {
  try {
    if (!job) throw new Error('No scrape diagnostic is available yet');
    const diagnostic = await getDiagnostic(job.jobId);
    if (!diagnostic) throw new Error('No diagnostic is stored for this scrape; run or retry it with this version first');
    if (download) await runtimeMessage('flippah:diagnostic.download', { diagnostic });
    else await copyText(JSON.stringify(diagnostic, null, 2));
    toast = download ? 'Diagnostic downloaded' : 'Diagnostic copied';
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  await render();
}

async function exportWatchlist(): Promise<void> {
  try {
    const rows = await legacyMessage<any[]>({ kind: 'watch:list' });
    const csv = buildCsv([
      ['title', 'url', 'current_bid', 'max_bid', 'note'],
      ...rows.map((item) => [item.title, item.url, Number(item.currentBidCents || 0) / 100, item.maxBidCents == null ? '' : Number(item.maxBidCents) / 100, item.note])
    ]);
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.href = objectUrl;
    link.download = 'flippah-watchlist.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    toast = `Downloaded ${rows.length} watched lot${rows.length === 1 ? '' : 's'}`;
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  await render();
}

function downloadCsv(filename: string, rows: unknown[][]): void {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(new Blob([buildCsv(rows)], { type: 'text/csv' }));
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

async function exportOutcomes(): Promise<void> {
  try {
    const outcomes = await legacyMessage<DealOutcome[]>({ kind: 'outcome:list' });
    downloadCsv('flippah-resale-outcomes.csv', [
      ['lot', 'title', 'url', 'actual_all_in', 'sold_price', 'selling_costs', 'actual_profit', 'predicted_resale', 'prediction_error', 'channel', 'updated_at'],
      ...outcomes.map((outcome) => {
        const result = calculateDealOutcome(outcome);
        return [outcome.lotNumber, outcome.title, outcome.url, outcome.actualAllInCost ?? '', outcome.soldPrice ?? '', outcome.sellingCosts ?? '', result.profit ?? '', outcome.predictedResale ?? '', result.predictionError ?? '', outcome.channel, new Date(outcome.updatedAt).toISOString()];
      }),
    ]);
    toast = `Downloaded ${outcomes.length} resale outcome${outcomes.length === 1 ? '' : 's'}`;
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
  }
  await render();
}

function startPolling(): void {
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(() => void refreshContext(), 800);
}

function pageContextFromTab(tabId: number): Promise<PageContext> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Auction page is still loading')), 20_000);
    tabMessage<PageContext>(tabId, 'flippah:page.get-context', {}).then(
      (value) => { window.clearTimeout(timeout); resolve(value); },
      (error) => { window.clearTimeout(timeout); reject(error); },
    );
  });
}

async function updateContextFromTab(): Promise<void> {
  if (currentTabId === null) return;
  const previousFingerprint = context?.fingerprint;
  const nextContext = await pageContextFromTab(currentTabId);
  if (previousFingerprint && previousFingerprint !== nextContext.fingerprint) {
    copyCoordinator.begin();
    toast = '';
    pendingCopy = null;
    selectedGroupId = '';
    bookHandoffBusy = false;
    bookHandoffFailed = false;
    bookHandoffStatus = 'Ready to send every seller photo';
  }
  context = nextContext;
  job = await loadMatchingJob();
  await syncResearchBatchSelection();
}

async function refreshContext(): Promise<void> {
  if (currentTabId === null || refreshInFlight) return;
  refreshInFlight = true;
  try {
    await updateContextFromTab();
    if (toastFromRefreshError) {
      toast = '';
      toastFromRefreshError = false;
    }
    if (job && ['completed', 'failed', 'stopped', 'stale'].includes(job.phase)) {
      if (job.phase === 'completed' && pendingCopy) {
        const { format, batch, request } = pendingCopy; pendingCopy = null;
        await copyCompleted(format, batch, request);
      }
    }
    await render({ preserveCurrent: true });
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
    toastFromRefreshError = true;
    await render();
  } finally {
    refreshInFlight = false;
  }
}

async function init(): Promise<void> {
  replaceMarkup(app, shell('<section class="panel"><div class="empty">Loading watchlist</div></section>'));
  bind();
  void render().catch((error) => {
    replaceMarkup(app, shell(`<section class="panel"><div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div></section>`));
    bind();
  });
  const settings = normalizeSettings(await getSyncStorage().catch(() => ({})));
  const localState: Record<string, unknown> = await getLocalStorage([UPDATE_STATE_STORAGE_KEY])
    .catch((): Record<string, unknown> => ({}));
  updateCheckState = normalizeStoredUpdateState(localState[UPDATE_STATE_STORAGE_KEY], currentVersion);
  document.documentElement.dataset.debug = String(settings.debugMode || Boolean(context?.url && new URL(context.url).hash === '#flipperdebug'));
  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  if (currentTabId !== null) {
    try {
      context = await pageContextFromTab(currentTabId);
      document.documentElement.dataset.debug = String(settings.debugMode || new URL(context.url).hash === '#flipperdebug');
      selectedGroupId = '';
      job = await loadMatchingJob();
      await syncResearchBatchSelection();
    } catch (error) {
      toast = error instanceof Error ? error.message : String(error);
      context = null;
    }
  }
  startPolling();
  await render();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[UPDATE_STATE_STORAGE_KEY]) return;
  updateCheckState = normalizeStoredUpdateState(changes[UPDATE_STATE_STORAGE_KEY]?.newValue, currentVersion);
  void render();
});

void init().catch((error) => {
  const box = document.createElement('div');
  box.className = 'empty';
  box.setAttribute('role', 'alert');
  box.textContent = `Flippah could not open: ${error instanceof Error ? error.message : String(error)}`;
  app.replaceChildren(box);
});
