import { runtimeMessage } from '../core/browser.js';
import {
  collectEbayLifecycle, lifecycleRoutes, resolveEbayLifecycleRoute,
  type EbayLifecycleEnvelope, type EbayLifecyclePageKind, type LifecyclePage
} from './lifecycle.js';
import { EBAY_LIFECYCLE_CSS } from './content-css.js';

const ROOT_ID = 'flippah-ebay-lifecycle-root';
const BLOCKED_ROUTES_KEY = 'flippah-ebay-lifecycle-blocked-routes';
const AUTO_SYNC_KEY = 'flippah-ebay-lifecycle-auto-sync';
let busy = false;
let abortController: AbortController | null = null;
let lastHref = '';
let domPageIndex = 1;

type BlockedRoute = { pageKind: EbayLifecyclePageKind; pageUrl: string; reason: string };

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<LifecyclePage> {
  const route = resolveEbayLifecycleRoute(url);
  if (!route.supported) throw new Error('Refused to fetch outside eBay seller lifecycle pages');
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'follow', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const responseRoute = resolveEbayLifecycleRoute(response.url || url);
  if (!responseRoute.supported || responseRoute.pageKind !== route.pageKind) throw new Error('eBay redirected outside the requested seller lifecycle page');
  return { document: parseHtml(await response.text()), url: response.url || url };
}

function pageSignature(root: Document = document): string {
  return [...root.querySelectorAll<HTMLElement>('[qa-id^="active-item-"], [data-order-id], [data-transaction-id], .sold-itemcard, .transaction-row-v2, tbody > tr')]
    .map((node) => node.getAttribute('qa-id') || node.getAttribute('data-order-id') || node.getAttribute('data-transaction-id') || node.textContent?.slice(0, 100) || '')
    .join('|');
}

async function clickPagerAndWait(control: HTMLElement, signal?: AbortSignal): Promise<void> {
  const before = pageSignature();
  control.click();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Collection cancelled');
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const after = pageSignature();
    if (after && after !== before) return;
  }
  throw new Error('eBay did not render the requested page before timeout');
}

async function rewindDomToFirstPage(signal?: AbortSignal): Promise<void> {
  for (let step = 0; step < 100; step += 1) {
    const previous = document.querySelector<HTMLElement>('button.pagination__previous:not([disabled]), button[aria-label*="Previous page" i]:not([disabled])');
    if (!previous || previous.getAttribute('aria-disabled') === 'true') return;
    await clickPagerAndWait(previous, signal);
  }
  throw new Error('Could not return eBay pagination to the first page');
}

function firstLifecyclePageUrl(value: string): string {
  const url = new URL(value);
  for (const key of ['page', 'pageNumber', 'paginationInput', 'offset', 'start']) url.searchParams.delete(key);
  return url.href;
}

async function advanceDomPage(signal?: AbortSignal): Promise<LifecyclePage | null> {
  const control = document.querySelector<HTMLElement>('button.pagination__next:not([disabled]), button[aria-label*="Next page" i]:not([disabled])');
  if (!control || control.getAttribute('aria-disabled') === 'true') return null;
  await clickPagerAndWait(control, signal);
  domPageIndex += 1;
  const url = new URL(firstLifecyclePageUrl(location.href));
  url.searchParams.set('flippah_dom_page', String(domPageIndex));
  return { document, url: url.href };
}

function getUi(): { root: HTMLElement; status: HTMLElement; page: HTMLButtonElement; all: HTMLButtonElement; stop: HTMLButtonElement; resume: HTMLButtonElement } | null {
  const host = document.getElementById(ROOT_ID);
  const shadow = host?.shadowRoot;
  if (!host || !shadow) return null;
  return {
    root: host, status: shadow.querySelector<HTMLElement>('[role="status"]')!,
    page: shadow.querySelector<HTMLButtonElement>('[data-action="page"]')!,
    all: shadow.querySelector<HTMLButtonElement>('[data-action="all"]')!,
    stop: shadow.querySelector<HTMLButtonElement>('[data-action="stop"]')!,
    resume: shadow.querySelector<HTMLButtonElement>('[data-action="resume"]')!
  };
}

function blockedRoutes(): BlockedRoute[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(BLOCKED_ROUTES_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry): entry is BlockedRoute => Boolean(
      entry && typeof entry.pageUrl === 'string' && typeof entry.reason === 'string'
      && ['active', 'ended', 'sold', 'transactions'].includes(entry.pageKind)
    )) : [];
  } catch {
    return [];
  }
}

function storeBlockedRoutes(routes: BlockedRoute[]): void {
  if (routes.length) sessionStorage.setItem(BLOCKED_ROUTES_KEY, JSON.stringify(routes));
  else sessionStorage.removeItem(BLOCKED_ROUTES_KEY);
  const ui = getUi();
  if (ui) {
    ui.resume.hidden = routes.length === 0;
    ui.resume.textContent = routes.length > 1 ? `Open next required page (${routes.length})` : 'Open required page';
  }
}

function finishQueuedRoute(pageKind: EbayLifecyclePageKind): void {
  const queue = blockedRoutes();
  if (queue[0]?.pageKind === pageKind) queue.shift();
  storeBlockedRoutes(queue);
}

function openNextBlockedRoute(): void {
  const next = blockedRoutes()[0];
  if (!next) return;
  sessionStorage.setItem(AUTO_SYNC_KEY, next.pageKind);
  location.assign(next.pageUrl);
}

function setStatus(message: string): void {
  const ui = getUi();
  if (ui) ui.status.textContent = message;
}

function setBusy(next: boolean): void {
  busy = next;
  const ui = getUi();
  if (!ui) return;
  ui.page.disabled = next;
  ui.all.disabled = next;
  ui.resume.disabled = next;
  ui.stop.hidden = !next;
}

async function deliver(envelope: EbayLifecycleEnvelope): Promise<string> {
  if (!envelope.completeness.complete) throw new Error(envelope.completeness.reason || 'Snapshot is incomplete');
  const result = await runtimeMessage<{ delivered: boolean; downloaded: boolean; duplicate: boolean; reason: string }>('flippah:ebay.lifecycle.ingest', { envelope });
  if (result.delivered) return result.duplicate ? 'Already synced; no duplicate created.' : `Synced ${envelope.records.length} ${envelope.page_kind} record(s).`;
  if (result.downloaded) return `Bridge unavailable; downloaded ${envelope.records.length} ${envelope.page_kind} record(s).`;
  throw new Error(result.reason || 'Sync failed');
}

async function collect(pageKind: EbayLifecyclePageKind, pageUrl: string, useCurrentDocument: boolean): Promise<EbayLifecycleEnvelope> {
  domPageIndex = 1;
  return collectEbayLifecycle(pageKind, pageUrl, {
    initialDocument: useCurrentDocument ? document : undefined,
    fetchPage,
    advanceDomPage: useCurrentDocument ? advanceDomPage : undefined,
    signal: abortController?.signal,
    maxPages: 100
  });
}

async function syncThisPage(): Promise<void> {
  const route = resolveEbayLifecycleRoute(location.href);
  if (!route.supported || !route.pageKind) throw new Error('This is not a supported eBay lifecycle page');
  setStatus(`Collecting all ${route.pageKind} pages...`);
  await rewindDomToFirstPage(abortController?.signal);
  const firstUrl = firstLifecyclePageUrl(location.href);
  // eBay seller pages are hydrated with the signed-in account state. Always use
  // the live document after rewinding instead of fetching a generic HTML shell.
  const envelope = await collect(route.pageKind, firstUrl, true);
  setStatus(await deliver(envelope));
  finishQueuedRoute(route.pageKind);
}

async function syncAll(): Promise<void> {
  const current = resolveEbayLifecycleRoute(location.href);
  const summaries: string[] = [];
  const blocked: BlockedRoute[] = [];
  storeBlockedRoutes([]);
  for (const route of lifecycleRoutes()) {
    if (abortController?.signal.aborted) throw new Error('Sync All cancelled');
    setStatus(`Collecting all ${route.pageKind} pages...`);
    const useCurrent = current.pageKind === route.pageKind;
    try {
      if (useCurrent) await rewindDomToFirstPage(abortController?.signal);
      const firstUrl = useCurrent ? firstLifecyclePageUrl(location.href) : route.pageUrl;
      const envelope = await collect(route.pageKind, firstUrl, useCurrent);
      summaries.push(await deliver(envelope));
    } catch (error) {
      blocked.push({
        pageKind: route.pageKind,
        pageUrl: route.pageUrl,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (blocked.length) {
    storeBlockedRoutes(blocked);
    const completed = summaries.length ? `${summaries.length} section(s) synced. ` : '';
    setStatus(`${completed}eBay requires ${blocked.map((route) => route.pageKind).join(', ')} to be opened while signed in.`);
    return;
  }
  setStatus(`Sync All complete. ${summaries.join(' ')}`);
}

async function run(operation: () => Promise<void>): Promise<void> {
  if (busy) return;
  abortController = new AbortController();
  setBusy(true);
  try { await operation(); }
  catch (error) { setStatus(`Sync blocked: ${error instanceof Error ? error.message : String(error)}`); }
  finally { abortController = null; setBusy(false); }
}

function mount(): void {
  const route = resolveEbayLifecycleRoute(location.href);
  const existing = document.getElementById(ROOT_ID);
  if (!route.supported || !route.pageKind) { existing?.remove(); return; }
  if (existing) return;
  const host = document.createElement('aside');
  host.id = ROOT_ID;
  host.setAttribute('aria-label', 'Flippah eBay lifecycle sync');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${EBAY_LIFECYCLE_CSS}</style><div class="panel"><div class="heading"><strong>Flippah</strong><span>${route.pageKind}</span></div>
    <div class="actions"><button type="button" data-action="page">Sync This Page</button><button type="button" data-action="all">Sync All</button><button type="button" data-action="resume" hidden>Open required page</button><button type="button" data-action="stop" hidden>Stop</button></div>
    <p role="status" aria-live="polite">Ready to sync eBay lifecycle data.</p></div>`;
  document.documentElement.append(host);
  shadow.querySelector('[data-action="page"]')?.addEventListener('click', () => void run(syncThisPage));
  shadow.querySelector('[data-action="all"]')?.addEventListener('click', () => void run(syncAll));
  shadow.querySelector('[data-action="resume"]')?.addEventListener('click', openNextBlockedRoute);
  shadow.querySelector('[data-action="stop"]')?.addEventListener('click', () => abortController?.abort());
  storeBlockedRoutes(blockedRoutes());
  const autoSync = sessionStorage.getItem(AUTO_SYNC_KEY);
  if (autoSync === route.pageKind) {
    sessionStorage.removeItem(AUTO_SYNC_KEY);
    window.setTimeout(() => void run(syncThisPage), 500);
  }
}

function routeChanged(): void {
  if (lastHref === location.href) return;
  lastHref = location.href;
  abortController?.abort();
  document.getElementById(ROOT_ID)?.remove();
  mount();
}

document.documentElement.dataset.flippahEbayLifecycleVersion = chrome.runtime.getManifest().version;
lastHref = location.href;
mount();
new MutationObserver(routeChanged).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', routeChanged);
window.addEventListener('hashchange', routeChanged);
window.setInterval(routeChanged, 500);
