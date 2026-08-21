import { HIBID_GRAPHQL_ENDPOINT, HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, HIBID_SEARCH_ENDPOINT } from '../hibid/api.js';
import { failure, isEnvelope, payloadBytes, success, type MessageEnvelope } from '../core/messages.js';
import { getJob, getJobForFingerprint, pruneJobs, putDiagnostic, putJobIfNewer, putRecordBatch } from '../core/job-db.js';
import type { HiBidLotRecord, ScrapeJobSummary } from '../core/types.js';

const MAX_REQUEST_BYTES = 180_000;
const MAX_RECORD_BATCH = 100;
const WATCH_REFRESH_ALARM = 'flippah:watch-refresh';

function localGet(): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => chrome.storage.local.get(null, (value) => {
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

async function handleLegacyMessage(message: any): Promise<unknown> {
  if (!message || typeof message !== 'object' || typeof message.kind !== 'string') return undefined;
  const state = await localGet();
  const watchlist = state.watchlist && typeof state.watchlist === 'object' ? state.watchlist : {};
  const premiums = state.premiums && typeof state.premiums === 'object' ? state.premiums : {};
  if (message.kind === 'watch:list') return Object.values(watchlist);
  if (message.kind === 'watch:add') {
    const lot = message.lot;
    if (!lot || typeof lot !== 'object' || !String(lot.lotId || '')) return { ok: false, error: 'invalid_lot' };
    await localSet({ watchlist: { ...watchlist, [String(lot.lotId)]: lot } });
    await scheduleWatchAlarms(lot);
    await updateBadge();
    return { ok: true };
  }
  if (message.kind === 'watch:remove') {
    const next = { ...watchlist };
    delete next[String(message.lotId || '')];
    await localSet({ watchlist: next });
    await updateBadge();
    return { ok: true };
  }
  if (message.kind === 'premium:get') return premiums[String(message.auctioneerKey || '')] || null;
  if (message.kind === 'premium:set') {
    const key = String(message.auctioneerKey || '');
    const ratePct = Number(message.ratePct);
    if (!key || !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 30) return { ok: false, error: 'invalid_premium' };
    await localSet({ premiums: { ...premiums, [key]: { ratePct, source: message.source || 'user', parsedAt: Date.now() } } });
    return { ok: true };
  }
  return undefined;
}

function ensureHiBidSender(sender: chrome.runtime.MessageSender): void {
  if (!sender.tab || sender.frameId !== 0) throw new Error('HiBid operation rejected outside the top page frame');
  const url = new URL(sender.url || sender.tab.url || 'https://invalid.invalid');
  if (!/(^|\.)hibid\.com$/i.test(url.hostname)) throw new Error('HiBid operation rejected for this host');
}

function validateSearchBody(body: any): void {
  if (!body || typeof body !== 'object' || !body.options || typeof body.options !== 'object') throw new Error('Malformed HiBid search request');
  if (!Number.isInteger(body.options.page) || body.options.page < 1) throw new Error('Invalid HiBid search page');
  if (!Number.isInteger(body.options.size) || body.options.size < 1 || body.options.size > 100) throw new Error('Invalid HiBid search size');
}

function validateHydrationBody(body: any): void {
  if (!body || typeof body !== 'object' || !body.variables || typeof body.variables !== 'object') throw new Error('Malformed HiBid hydration request');
  if (String(body.operationName || '') !== HIBID_LOT_SEARCH_OPERATION) throw new Error('Unknown HiBid GraphQL operation');
  const ids = body.variables.eventItemIds;
  if (ids !== null && (!Array.isArray(ids) || ids.length > 100 || ids.some((id: unknown) => !Number.isInteger(id)))) {
    throw new Error('Invalid HiBid event item IDs');
  }
}

async function postJson(url: string, body: unknown, credentials: RequestCredentials): Promise<unknown> {
  if (payloadBytes(body) > MAX_REQUEST_BYTES) throw new Error('HiBid request is too large');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials,
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HiBid returned HTTP ${response.status}`);
    const result = await response.json();
    if (Array.isArray(result?.errors) && result.errors.length) throw new Error(String(result.errors[0]?.message || 'HiBid GraphQL error'));
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function safeDiagnostic(value: any): Record<string, unknown> {
  const source = value && typeof value === 'object' ? value : {};
  const coverage = source.coverage && typeof source.coverage === 'object' ? source.coverage : {};
  return {
    generatedAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
    sourceUrl: String(source.sourceUrl || '').slice(0, 2000),
    fingerprint: String(source.fingerprint || '').slice(0, 4000),
    phase: String(source.phase || ''),
    reason: String(source.reason || source.errorCode || '').slice(0, 300),
    expectedTotal: Number.isFinite(Number(source.expectedTotal)) ? Number(source.expectedTotal) : null,
    enumeratedCount: Number(source.enumeratedCount) || 0,
    hydratedCount: Number(source.hydratedCount) || 0,
    coverage: {
      reason: String(coverage.reason || '').slice(0, 300),
      expectedCount: Number.isFinite(Number(coverage.expectedCount)) ? Number(coverage.expectedCount) : null,
      uniqueEnumeratedCount: Number(coverage.uniqueEnumeratedCount) || 0,
      uniqueHydratedCount: Number(coverage.uniqueHydratedCount) || 0,
      duplicateIds: Array.isArray(coverage.duplicateIds) ? coverage.duplicateIds.slice(0, 1000).map(String) : [],
      missingIds: Array.isArray(coverage.missingIds) ? coverage.missingIds.slice(0, 1000).map(String) : [],
      unexpectedIds: Array.isArray(coverage.unexpectedIds) ? coverage.unexpectedIds.slice(0, 1000).map(String) : []
    },
    failures: Array.isArray(source.failures) ? source.failures.slice(0, 100).map((item: unknown) => String(item).slice(0, 500)) : []
  };
}

async function downloadDiagnostic(diagnostic: unknown): Promise<number | null> {
  const text = JSON.stringify(diagnostic, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  return new Promise((resolve, reject) => chrome.downloads.download({
    url,
    filename: `flippah-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    saveAs: false
  }, (id) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(id ?? null);
  }));
}

async function handleMessage(message: MessageEnvelope, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'flippah:network.search':
      ensureHiBidSender(sender);
      validateSearchBody((message.payload as any)?.body);
      return postJson(HIBID_SEARCH_ENDPOINT, (message.payload as any).body, 'omit');
    case 'flippah:network.hydrate': {
      ensureHiBidSender(sender);
      const incoming = (message.payload as any)?.body;
      validateHydrationBody(incoming);
      const senderUrl = new URL(sender.url || sender.tab?.url || HIBID_GRAPHQL_ENDPOINT);
      const endpoint = new URL('/graphql', senderUrl.origin).href;
      return postJson(endpoint, { ...incoming, query: HIBID_LOT_SEARCH_QUERY }, 'include');
    }
    case 'flippah:job.put': {
      ensureHiBidSender(sender);
      const job = (message.payload as any)?.job as ScrapeJobSummary;
      if (!job?.jobId || (job.tabId !== null && job.tabId !== sender.tab?.id)) throw new Error('Invalid scrape job owner');
      const stored = { ...job, tabId: sender.tab!.id! };
      const accepted = await putJobIfNewer(stored);
      return { stored: accepted.revision === stored.revision, job: accepted };
    }
    case 'flippah:job.records': {
      ensureHiBidSender(sender);
      const { jobId, records, replace } = (message.payload as any) || {};
      if (!jobId || !Array.isArray(records) || records.length > MAX_RECORD_BATCH) throw new Error('Invalid record checkpoint');
      await putRecordBatch(String(jobId), records as HiBidLotRecord[], Boolean(replace));
      return { stored: records.length };
    }
    case 'flippah:job.get': {
      const { jobId, tabId, fingerprint } = (message.payload as any) || {};
      if (jobId) return getJob(String(jobId));
      return getJobForFingerprint(Number.isInteger(tabId) ? tabId : null, String(fingerprint || ''));
    }
    case 'flippah:diagnostic.store': {
      ensureHiBidSender(sender);
      const diagnostic = safeDiagnostic((message.payload as any)?.diagnostic);
      const jobId = String((message.payload as any)?.jobId || 'unknown');
      await putDiagnostic(jobId, diagnostic);
      return { stored: true, diagnostic };
    }
    case 'flippah:diagnostic.download': {
      const diagnostic = safeDiagnostic((message.payload as any)?.diagnostic);
      return { downloadId: await downloadDiagnostic(diagnostic) };
    }
    default:
      throw new Error('Unknown Flippah message');
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isEnvelope(message)) {
    if ((message as any)?.kind) {
      handleLegacyMessage(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'storage_error' }));
      return true;
    }
    return false;
  }
  handleMessage(message, sender)
    .then((data) => sendResponse(success(message, data)))
    .catch((error) => sendResponse(failure(message, 'operation_failed', error)));
  return true;
});

// Content scripts send a real heartbeat while a scrape is active. This does not
// promise an immortal MV3 worker; it gives Chrome useful activity while every
// durable checkpoint remains recoverable from IndexedDB.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'flippah-scrape-owner') return;
  port.onMessage.addListener(() => undefined);
});

async function scheduleWatchAlarms(lot: any): Promise<void> {
  const endsAt = Number(lot?.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return;
  for (const [suffix, minutes] of [['15m', 15], ['2m', 2]] as const) {
    const when = Math.max(Date.now() + 1000, endsAt - minutes * 60_000);
    await chrome.alarms.create(`flippah:ending:${String(lot.lotId)}:${suffix}`, { when });
  }
}

async function refreshWatchlist(): Promise<void> {
  const state = await localGet();
  const list = Object.values(state.watchlist || {}) as any[];
  const ids = list.map((lot) => Number(lot.lotId)).filter(Number.isFinite);
  if (!ids.length) return;
  const next = { ...(state.watchlist || {}) };
  const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++]!;
      try {
        const response: any = await postJson(HIBID_GRAPHQL_ENDPOINT, {
      operationName: HIBID_LOT_SEARCH_OPERATION,
      variables: {
        auctionId: null, pageNumber: 1, pageLength: batch.length, category: null,
        searchText: null, zip: null, miles: null, shippingOffered: false,
        countryName: null, state: null, status: 'ALL', sortOrder: 'LOT_NUMBER',
        filter: null, isArchive: false, countAsView: false, hideGoogle: false,
        eventItemIds: batch
      },
      query: HIBID_LOT_SEARCH_QUERY
    }, 'omit');
        const results = response?.data?.lotSearch?.pagedResults?.results || [];
        const returned = new Set<string>();
        for (const result of results) {
          const key = String(result.id || '');
          if (!key || !next[key]) continue;
          returned.add(key);
          const seconds = Number(result.lotState?.timeLeftSeconds);
          const previous = next[key];
          const currentBidCents = Number.isFinite(Number(result.lotState?.highBid)) ? Math.round(Number(result.lotState.highBid) * 100) : previous.currentBidCents;
          next[key] = {
            ...previous,
            currentBidCents,
            endsAt: Number.isFinite(seconds) ? Date.now() + seconds * 1000 : previous.endsAt,
            stale: false,
            consecutiveRefreshFailures: 0,
            lastRefreshedAt: Date.now()
          };
          if (!previous.notifiedOverMax && Number.isFinite(previous.maxBidCents) && currentBidCents > previous.maxBidCents) {
            next[key].notifiedOverMax = true;
            await chrome.notifications.create(`flippah:overmax:${key}`, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
              title: `Over your max: ${String(previous.title || `Lot ${key}`)}`,
              message: `Current bid $${(currentBidCents / 100).toFixed(2)} exceeds your saved max.`
            });
          }
          await scheduleWatchAlarms(next[key]);
        }
        for (const id of batch) {
          const key = String(id);
          if (returned.has(key) || !next[key]) continue;
          const failures = Number(next[key].consecutiveRefreshFailures || 0) + 1;
          next[key] = { ...next[key], consecutiveRefreshFailures: failures, stale: failures >= 2 };
        }
      } catch {
        for (const id of batch) {
          const key = String(id);
          if (!next[key]) continue;
          const failures = Number(next[key].consecutiveRefreshFailures || 0) + 1;
          next[key] = { ...next[key], consecutiveRefreshFailures: failures, stale: failures >= 2 };
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => worker()));
  await localSet({ watchlist: next });
  await updateBadge();
}

async function updateBadge(): Promise<void> {
  const state = await localGet();
  const soon = Object.values(state.watchlist || {}).filter((lot: any) => Number.isFinite(Number(lot.endsAt)) && Number(lot.endsAt) > Date.now() && Number(lot.endsAt) <= Date.now() + 3_600_000).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#b64032' });
  await chrome.action.setBadgeText({ text: soon ? String(soon) : '' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(WATCH_REFRESH_ALARM, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCH_REFRESH_ALARM) {
    void refreshWatchlist();
    return;
  }
  const match = /^flippah:ending:(\d+):(15m|2m)$/.exec(alarm.name);
  if (!match) return;
  void localGet().then((state) => {
    const lotId = match[1]!;
    const lot = state.watchlist?.[lotId];
    if (!lot) return;
    chrome.notifications.create(alarm.name, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `${match[2] === '15m' ? '15 minutes' : '2 minutes'} remaining`,
      message: String(lot.title || `Lot ${lotId}`)
    });
  });
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const lotId = /^flippah:(?:ending|overmax):(\d+)/.exec(notificationId)?.[1];
  if (!lotId) return;
  void localGet().then((state) => {
    const url = state.watchlist?.[lotId]?.url;
    if (url) chrome.tabs.create({ url: String(url) });
  });
});

chrome.alarms.get(WATCH_REFRESH_ALARM, (alarm) => {
  if (!alarm) void chrome.alarms.create(WATCH_REFRESH_ALARM, { periodInMinutes: 5 });
});
void pruneJobs(20);
void updateBadge();
