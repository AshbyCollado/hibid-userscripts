import { activeTab, getSyncStorage, runtimeMessage, tabMessage } from '../core/browser.js';
import { getDiagnostic, getJobForFingerprint, getRecords } from '../core/job-db.js';
import { normalizeSettings } from '../core/settings.js';
import { jobMatchesContextAndScope } from '../core/job-scope.js';
import type { PageContext, ScrapeJobSummary } from '../core/types.js';
import { buildHibidExportPayload, buildHibidLlmBrief } from '../hibid/exports.js';

const app = document.querySelector<HTMLElement>('#app')!;
let currentTabId: number | null = null;
let context: PageContext | null = null;
let job: ScrapeJobSummary | null = null;
let selectedTab: 'current' | 'watchlist' = 'watchlist';
let selectedGroupId = '';
let toast = '';
let toastFromRefreshError = false;
let pendingCopy: 'json' | 'llm' | null = null;
let pollTimer: number | null = null;
let countdownTimer: number | null = null;

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

function routeLabel(): string {
  if (!context?.route.supported) return 'Unsupported page';
  const labels: Record<string, string> = {
    catalog: 'Auction catalog', livecatalog: 'Live catalog', search: 'Lot search', lot: 'Single lot',
    watchlist: 'Watchlist', 'currentbids-winning': 'Winning bids', 'currentbids-outbid': 'Outbid bids',
    pastbids: 'Past bids', pastwatchlist: 'Past watchlist'
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
    return analysis.total ? `Checking ${analysis.analyzed} of ${analysis.total}` : 'Checking visible lots';
  }
  if (analysis.phase === 'complete') {
    const review = analysis.mixedLots ? ` · ${analysis.mixedLots} need review` : '';
    return `${analysis.retailMatched} price${analysis.retailMatched === 1 ? '' : 's'} found${review}`;
  }
  return analysis.message === 'Amazon auto-lookup is off' ? 'Automatic checks are off' : 'Ready';
}

function currentHtml(): string {
  if (!context?.supported) return `<section class="panel"><div class="card"><div class="eyebrow">Scraper</div><h1>Open a HiBid research page</h1><p class="route">Catalogs, searches, watchlists, and bid pages can be copied here.</p></div></section>`;
  const count = job?.expectedTotal ?? context.visibleExpectedTotal;
  const current = job?.hydratedCount || job?.enumeratedCount || 0;
  const percent = count && count > 0 ? Math.min(100, Math.round(current / count * 100)) : (job?.phase === 'completed' ? 100 : 0);
  const groupSelect = context.auctionGroups.length ? `<label for="auction-group">Past auction</label><select id="auction-group"><option value="">Select an auction</option>${context.auctionGroups.map((group) => `<option value="${escapeHtml(group.id)}" ${selectedGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.title)}${group.location ? ` — ${escapeHtml(group.location)}` : ''}</option>`).join('')}</select>` : '';
  const terminalFailure = Boolean(job && ['failed', 'stale', 'stopped'].includes(job.phase));
  const canStart = !busy() && !terminalFailure && (!(context.route.kind === 'pastbids' || context.route.kind === 'pastwatchlist') || Boolean(selectedGroupId));
  const complete = jobMatchesSelection() && job?.phase === 'completed';
  const analysis = context.analysis;
  const analysisPercent = analysis.total > 0 ? Math.min(100, Math.round(analysis.analyzed / analysis.total * 100)) : 0;
  const analysisHtml = ['catalog', 'livecatalog', 'search', 'lot', 'watchlist', 'currentbids-winning', 'currentbids-outbid'].includes(context.route.kind)
    ? `<div class="analysis"><div class="analysis-head"><strong>Price check</strong><span>${escapeHtml(analysisStatusText(analysis))}</span></div>${analysis.phase === 'scanning' || analysis.phase === 'retail' ? `<div class="progress"><i style="width:${analysisPercent}%"></i></div>` : ''}<div class="actions compact"><button id="rerun-analysis" class="button" ${analysis.phase === 'scanning' || analysis.phase === 'retail' ? 'disabled' : ''}>Check prices again</button><button id="clear-retail-cache" class="button">Clear saved prices</button></div></div>`
    : '';
  return `<section class="panel"><div class="card"><div class="eyebrow">Scraper</div><h1>${escapeHtml(routeLabel())}</h1>${groupSelect}<div class="status ${statusClass()}"><span class="dot"></span><span>${escapeHtml(scrapeStatusText(current, count))}</span></div>${busy() || job?.phase === 'completed' ? `<div class="progress"><i style="width:${percent}%"></i></div>` : ''}<div class="actions"><button id="copy-llm" class="button primary" ${!canStart && !complete ? 'disabled' : ''}>Copy for AI</button><button id="copy-json" class="button" ${!canStart && !complete ? 'disabled' : ''}>Copy JSON</button>${busy() ? '<button id="stop" class="button danger">Stop</button>' : ''}${job?.phase === 'failed' || job?.phase === 'stale' || job?.phase === 'stopped' ? '<button id="retry" class="button">Try again</button>' : ''}</div><div class="toast">${escapeHtml(toast)}</div>${analysisHtml}${debugHtml()}</div></section>`;
}

function debugHtml(): string {
  return document.documentElement.dataset.debug === 'true' && job
    ? `<div class="debug"><button id="copy-debug" class="button">Copy Diagnostic</button><button id="download-debug" class="button">Download Diagnostic</button></div>`
    : '';
}

function shell(body: string): string {
  return `<div class="shell"><header class="topbar"><span class="brand">Flippah by ALOS</span><span class="version">v${escapeHtml(chrome.runtime.getManifest().version)}</span><button id="settings" class="icon-button" title="Open Flippah settings" aria-label="Open settings">⚙</button></header><nav class="tabs" aria-label="Flippah sections"><button class="tab" data-tab="watchlist" aria-selected="${selectedTab === 'watchlist'}">Watchlist</button><button class="tab" data-tab="current" aria-selected="${selectedTab === 'current'}">Scraper</button></nav>${body}</div>`;
}

async function render(): Promise<void> {
  if (selectedTab === 'current') {
    replaceMarkup(app, shell(currentHtml()));
  } else {
    const watchlist = await legacyMessage<any[]>({ kind: 'watch:list' }).catch(() => []);
    const cards = watchlist.length ? `<section class="panel"><div class="actions" style="margin:0 0 10px"><button id="export-watchlist" class="button primary">Export CSV</button></div><div class="watch-list">${watchlist.map((item) => `<article class="watch"><div>${safeHiBidUrl(item.imageUrl, '') ? `<img src="${escapeHtml(safeHiBidUrl(item.imageUrl, ''))}" alt="">` : ''}</div><div><a class="watch-title" href="${escapeHtml(safeHiBidUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || `Lot ${item.lotId}`)}</a><div class="watch-meta">${escapeHtml(item.auctioneerName || 'Unknown auctioneer')}</div><div class="watch-meta">${Number.isFinite(item.currentBidCents) ? `$${(item.currentBidCents / 100).toFixed(2)} bid` : 'Bid unavailable'}${Number.isFinite(item.maxBidCents) ? ` · max $${(item.maxBidCents / 100).toFixed(2)}` : ''}</div><div class="watch-meta countdown" data-ends-at="${escapeHtml(item.endsAt ?? '')}">${escapeHtml(formatCountdown(item.endsAt))}</div>${item.note ? `<div class="watch-note">${escapeHtml(item.note)}</div>` : ''}</div><button class="icon-button remove-watch" data-lot-id="${escapeHtml(item.lotId)}" title="Remove watched lot">×</button></article>`).join('')}</div></section>` : '<div class="empty">No watched lots yet.</div>';
    replaceMarkup(app, shell(cards));
  }
  bind();
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = selectedTab === 'watchlist' ? window.setInterval(refreshCountdowns, 1000) : null;
}

function bind(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    selectedTab = button.dataset.tab as 'current' | 'watchlist'; void render();
  }));
  app.querySelector('#settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  app.querySelector<HTMLSelectElement>('#auction-group')?.addEventListener('change', async (event) => {
    selectedGroupId = (event.currentTarget as HTMLSelectElement).value;
    job = await loadMatchingJob();
    toast = '';
    await render();
  });
  app.querySelector('#copy-json')?.addEventListener('click', () => void copyOrStart('json'));
  app.querySelector('#copy-llm')?.addEventListener('click', () => void copyOrStart('llm'));
  app.querySelector('#stop')?.addEventListener('click', () => void command('flippah:job.stop'));
  app.querySelector('#retry')?.addEventListener('click', () => void command('flippah:job.retry'));
  app.querySelector('#rerun-analysis')?.addEventListener('click', () => void analysisCommand('flippah:analysis.rerun', 'Checking prices again'));
  app.querySelector('#clear-retail-cache')?.addEventListener('click', () => void analysisCommand('flippah:analysis.clear-cache', 'Saved prices cleared; checking again'));
  app.querySelector('#copy-debug')?.addEventListener('click', () => void copyDiagnostic(false));
  app.querySelector('#download-debug')?.addEventListener('click', () => void copyDiagnostic(true));
  app.querySelector('#export-watchlist')?.addEventListener('click', () => void exportWatchlist());
  app.querySelectorAll<HTMLButtonElement>('.remove-watch').forEach((button) => button.addEventListener('click', async () => {
    await legacyMessage({ kind: 'watch:remove', lotId: button.dataset.lotId }); await render();
  }));
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
  if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied');
  area.remove();
}

async function copyCompleted(format: 'json' | 'llm'): Promise<void> {
  if (!context || !job || !jobMatchesSelection()) throw new Error('No completed scrape matches this page and selection');
  const settings = normalizeSettings(await getSyncStorage());
  const items = await getRecords(job.jobId);
  const payload = buildHibidExportPayload(context, job, items, settings);
  const text = format === 'json' ? JSON.stringify(payload, null, 2) : buildHibidLlmBrief(payload, settings);
  await copyText(text);
  toast = `Copied ${items.length} lot${items.length === 1 ? '' : 's'}`;
}

async function copyOrStart(format: 'json' | 'llm'): Promise<void> {
  try {
    await updateContextFromTab();
    if (jobMatchesSelection() && job?.phase === 'completed') await copyCompleted(format);
    else if (job && ['failed', 'stale', 'stopped'].includes(job.phase)) throw new Error('Retry this scrape before exporting');
    else {
      pendingCopy = format;
      await command('flippah:job.start');
      toast = 'Scanning the current page…';
    }
  } catch (error) { toast = error instanceof Error ? error.message : String(error); }
  await render();
}

async function copyDiagnostic(download: boolean): Promise<void> {
  if (!job) return;
  const diagnostic = await getDiagnostic(job.jobId);
  if (!diagnostic) throw new Error('No diagnostic is stored for this scrape; run or retry it with this version first');
  if (download) await runtimeMessage('flippah:diagnostic.download', { diagnostic });
  else await copyText(JSON.stringify(diagnostic, null, 2));
  toast = download ? 'Diagnostic downloaded' : 'Diagnostic copied';
  await render();
}

async function exportWatchlist(): Promise<void> {
  const rows = await legacyMessage<any[]>({ kind: 'watch:list' });
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = ['title,url,current_bid,max_bid,note', ...rows.map((item) => [item.title, item.url, Number(item.currentBidCents || 0) / 100, item.maxBidCents == null ? '' : Number(item.maxBidCents) / 100, item.note].map(quote).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'flippah-watchlist.csv'; link.click(); URL.revokeObjectURL(link.href);
}

function startPolling(): void {
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(() => void refreshContext(), 800);
}

async function updateContextFromTab(): Promise<void> {
  if (currentTabId === null) return;
  const previousFingerprint = context?.fingerprint;
  const nextContext = await tabMessage<PageContext>(currentTabId, 'flippah:page.get-context', {});
  if (previousFingerprint && previousFingerprint !== nextContext.fingerprint) {
    toast = '';
    pendingCopy = null;
    selectedGroupId = '';
  }
  context = nextContext;
  job = await loadMatchingJob();
}

async function refreshContext(): Promise<void> {
  if (currentTabId === null) return;
  try {
    await updateContextFromTab();
    if (toastFromRefreshError) {
      toast = '';
      toastFromRefreshError = false;
    }
    if (job && ['completed', 'failed', 'stopped', 'stale'].includes(job.phase)) {
      if (job.phase === 'completed' && pendingCopy) {
        const format = pendingCopy; pendingCopy = null;
        await copyCompleted(format);
      }
    }
    await render();
  } catch (error) {
    toast = error instanceof Error ? error.message : String(error);
    toastFromRefreshError = true;
    await render();
  }
}

async function init(): Promise<void> {
  const settings = normalizeSettings(await getSyncStorage().catch(() => ({})));
  document.documentElement.dataset.debug = String(settings.debugMode || Boolean(context?.url && new URL(context.url).hash === '#flipperdebug'));
  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  if (currentTabId !== null) {
    try {
      context = await tabMessage<PageContext>(currentTabId, 'flippah:page.get-context', {});
      document.documentElement.dataset.debug = String(settings.debugMode || new URL(context.url).hash === '#flipperdebug');
      selectedGroupId = '';
      job = await loadMatchingJob();
    } catch (error) {
      toast = error instanceof Error ? error.message : String(error);
      context = null;
    }
  }
  startPolling();
  await render();
}

void init();
