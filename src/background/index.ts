import { HIBID_GRAPHQL_ENDPOINT, HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, HIBID_SEARCH_ENDPOINT } from '../hibid/api.js';
import { failure, isEnvelope, payloadBytes, success, type MessageEnvelope } from '../core/messages.js';
import { getJob, getJobForFingerprint, pruneJobs, putDiagnostic, putJobIfNewer, putRecordBatch } from '../core/job-db.js';
import { endingAlarmSpecs, markEndingAlertNotified } from '../core/watch-alerts.js';
import type { HiBidLotRecord, ScrapeJobSummary } from '../core/types.js';
import { clearRetailCache, getRetailCache, putRetailCache } from '../core/retail-db.js';
import { detectProductKind, evaluateRetailCandidate, extractProductDiscriminators, matchAmazonCandidates, parseAmazonCandidates, type ProductIdentity, type RetailCandidateEvaluation } from '../intelligence/us-deal-intelligence.js';
import { enrichAmazonCandidateFromDetail, parseAmazonDocumentCandidates } from '../intelligence/amazon-document-parser.js';
import { nextProviderFailureState, normalizeProviderThrottle, providerStateStorageKey, successfulProviderState, type ProviderThrottleState, type RetailProviderName } from '../intelligence/provider-state.js';
import { isAmazonChallengeHtml, joinInflight, retailCacheTtl, retailCandidateList, retailProviderCacheKey, reusableRetailSnapshot } from '../intelligence/retail-policy.js';
import { DEV_RELOAD_ALARM, installUnpackedAutoReload } from './dev-auto-reload.js';

const MAX_REQUEST_BYTES = 180_000;
const MAX_RECORD_BATCH = 100;
const WATCH_REFRESH_ALARM = 'flippah:watch-refresh';
const AMAZON_BODY_LIMIT = 5_000_000;
const AMAZON_HELPER_KEY = 'flippahAmazonHelperV1';
const AMAZON_REQUEST_KEY = 'flippahAmazonRequestV1';
const AMAZON_HELPER_CLOSE_ALARM = 'flippah:amazon-helper-close';
const amazonInflight = new Map<string, Promise<RetailProviderSnapshot>>();
let amazonProviderTail: Promise<void> = Promise.resolve();
const amazonBrowserPending = new Map<string, {
  resolve: (snapshot: RetailProviderSnapshot) => void;
  timer: ReturnType<typeof setTimeout>;
  query: string;
}>();
const unpackedAutoReload = installUnpackedAutoReload();

type RetailLookupStatus = 'matched' | 'no_match' | 'blocked' | 'rate_limited' | 'network_error' | 'parse_error' | 'low_confidence';
interface RetailLookupResult {
  status: RetailLookupStatus;
  query: string;
  match: ReturnType<typeof matchAmazonCandidates>;
  candidates: ReturnType<typeof parseAmazonCandidates>;
  fetchedAt: number;
  cached: boolean;
  message: string;
  retryAfterMs?: number;
  candidateAudit?: Array<Pick<RetailCandidateEvaluation, 'accepted' | 'score' | 'rejectionReasons' | 'matchedEvidence'> & { asin: string; title: string }>;
}

interface RetailProviderSnapshot {
  status: 'ok' | 'no_results' | 'blocked' | 'rate_limited' | 'parse_error' | 'network_error';
  query: string;
  candidates: ReturnType<typeof parseAmazonCandidates>;
  fetchedAt: number;
  message: string;
  retryAfterMs?: number;
}

function sanitizeAmazonCandidates(value: unknown): ReturnType<typeof parseAmazonCandidates> {
  return retailCandidateList<any>(value).slice(0, 30).flatMap((candidate) => {
    const asin = String(candidate?.asin || '').toUpperCase();
    const title = String(candidate?.title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const matchText = String(candidate?.matchText || title).replace(/\s+/g, ' ').trim().slice(0, 800);
    const price = candidate?.price == null ? null : Number(candidate.price);
    if (!/^[A-Z0-9]{10}$/.test(asin) || !title || (price !== null && (!Number.isFinite(price) || price <= 0))) return [];
    return [{
      asin,
      title,
      matchText,
      price,
      used: Boolean(candidate?.used),
      sponsored: Boolean(candidate?.sponsored),
      url: `https://www.amazon.com/dp/${asin}`
    }];
  });
}

interface AmazonHelperState { tabId: number; windowId: number; }
interface AmazonRequestState { token: string; query: string; tabId: number; createdAt: number; }

function supportsAmazonHelperWindow(): boolean {
  return typeof chrome.windows !== 'undefined' && typeof chrome.tabs !== 'undefined';
}

async function readAmazonHelper(): Promise<AmazonHelperState | null> {
  const stored = await chrome.storage.local.get(AMAZON_HELPER_KEY);
  const helper = stored[AMAZON_HELPER_KEY] as Partial<AmazonHelperState> | undefined;
  if (!Number.isInteger(helper?.tabId) || !Number.isInteger(helper?.windowId)) return null;
  try {
    const tab = await chrome.tabs.get(helper!.tabId!);
    if (tab.windowId !== helper!.windowId) return null;
    return { tabId: helper!.tabId!, windowId: helper!.windowId! };
  } catch {
    await chrome.storage.local.remove(AMAZON_HELPER_KEY);
    return null;
  }
}

async function ensureAmazonHelper(): Promise<AmazonHelperState> {
  const existing = await readAmazonHelper();
  if (existing) return existing;
  const created = await chrome.windows.create({
    url: 'about:blank',
    type: 'popup',
    focused: false,
    state: 'minimized',
  });
  if (!created) throw new Error('Amazon research helper could not be created');
  const tab = created.tabs?.[0];
  if (!created.id || !tab?.id) throw new Error('Amazon research helper could not be created');
  const helper = { windowId: created.id, tabId: tab.id };
  await chrome.storage.local.set({ [AMAZON_HELPER_KEY]: helper });
  return helper;
}

async function closeAmazonHelper(): Promise<void> {
  const helper = await readAmazonHelper();
  await chrome.storage.local.remove([AMAZON_HELPER_KEY, AMAZON_REQUEST_KEY]);
  if (!helper) return;
  try { await chrome.windows.remove(helper.windowId); } catch { /* already closed */ }
}

async function scheduleAmazonHelperClose(): Promise<void> {
  await chrome.alarms.create(AMAZON_HELPER_CLOSE_ALARM, { when: Date.now() + 60_000 });
}

async function loadAmazonBrowser(query: string): Promise<RetailProviderSnapshot> {
  const helper = await ensureAmazonHelper();
  const token = crypto.randomUUID();
  const url = new URL('https://www.amazon.com/s');
  url.searchParams.set('k', query);
  url.searchParams.set('flippahToken', token);
  await chrome.storage.local.set({
    [AMAZON_REQUEST_KEY]: { token, query, tabId: helper.tabId, createdAt: Date.now() } satisfies AmazonRequestState,
  });
  return new Promise<RetailProviderSnapshot>((resolve) => {
    const timer = setTimeout(() => {
      amazonBrowserPending.delete(token);
      void chrome.storage.local.remove(AMAZON_REQUEST_KEY);
      resolve({
        status: 'network_error', query, candidates: [], fetchedAt: Date.now(), retryAfterMs: 5_000,
        message: 'Amazon.com background research timed out'
      });
    }, 18_000);
    amazonBrowserPending.set(token, { resolve, timer, query });
    void chrome.windows.update(helper.windowId, { state: 'minimized' })
      .then(() => chrome.tabs.update(helper.tabId, { url: url.href, active: false }))
      .then(() => scheduleAmazonHelperClose())
      .catch((error) => {
        const pending = amazonBrowserPending.get(token);
        if (!pending) return;
        clearTimeout(pending.timer);
        amazonBrowserPending.delete(token);
        void chrome.storage.local.remove(AMAZON_REQUEST_KEY);
        resolve({
          status: 'network_error', query, candidates: [], fetchedAt: Date.now(), retryAfterMs: 5_000,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

async function completeAmazonBrowser(message: any, sender: chrome.runtime.MessageSender): Promise<void> {
  const senderUrl = new URL(sender.url || 'https://invalid.invalid');
  if (!/(^|\.)amazon\.com$/i.test(senderUrl.hostname) || !sender.tab?.id || sender.frameId !== 0) throw new Error('Rejected Amazon helper result sender');
  const token = String(message.token || '');
  const stored = await chrome.storage.local.get(AMAZON_REQUEST_KEY);
  const request = stored[AMAZON_REQUEST_KEY] as Partial<AmazonRequestState> | undefined;
  if (!request || request.token !== token || request.tabId !== sender.tab.id || Date.now() - Number(request.createdAt || 0) > 60_000) {
    throw new Error('Rejected stale Amazon helper result');
  }
  const query = retailQuery(request.query);
  const pending = amazonBrowserPending.get(token);
  const status = ['ok', 'no_results', 'blocked', 'parse_error'].includes(String(message.status))
    ? message.status as RetailProviderSnapshot['status']
    : 'parse_error';
  const snapshot: RetailProviderSnapshot = {
    status,
    query,
    candidates: status === 'ok' ? sanitizeAmazonCandidates(message.candidates) : [],
    fetchedAt: Date.now(),
    message: String(message.message || 'Amazon.com background research returned no details').slice(0, 300)
  };
  await putRetailCache(retailProviderCacheKey(query), snapshot, retailCacheTtl(status === 'ok' ? 'matched' : status));
  await chrome.storage.local.remove(AMAZON_REQUEST_KEY);
  await scheduleAmazonHelperClose();
  if (!pending) return;
  clearTimeout(pending.timer);
  amazonBrowserPending.delete(token);
  pending.resolve(snapshot);
}

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

async function readProviderThrottle(provider: RetailProviderName): Promise<ProviderThrottleState> {
  const key = providerStateStorageKey(provider);
  const state = await localGet();
  return normalizeProviderThrottle(state[key]);
}

async function writeProviderThrottle(provider: RetailProviderName, next: ProviderThrottleState): Promise<ProviderThrottleState> {
  const key = providerStateStorageKey(provider);
  await localSet({ [key]: next });
  return next;
}

async function markProviderFailure(provider: RetailProviderName, status: string, minimumDelayMs: number): Promise<number> {
  const current = await readProviderThrottle(provider);
  const now = Date.now();
  const next = nextProviderFailureState(current, status, minimumDelayMs, now);
  await writeProviderThrottle(provider, next);
  return next.nextAllowedAt - now;
}

async function markProviderSuccess(provider: RetailProviderName, minimumDelayMs = 0): Promise<void> {
  await writeProviderThrottle(provider, successfulProviderState(Date.now(), minimumDelayMs));
}

async function withAmazonProviderLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = amazonProviderTail;
  let release!: () => void;
  amazonProviderTail = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try { return await work(); } finally { release(); }
}

function ensureHiBidSender(sender: chrome.runtime.MessageSender): void {
  if (!sender.tab || sender.frameId !== 0) throw new Error('HiBid operation rejected outside the top page frame');
  const url = new URL(sender.url || sender.tab.url || 'https://invalid.invalid');
  if (!/(^|\.)hibid\.com$/i.test(url.hostname)) throw new Error('HiBid operation rejected for this host');
}

function retailQuery(value: unknown): string {
  const query = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (query.length < 2) throw new Error('Amazon search query is too short');
  return query;
}

function validateRetailIdentity(value: unknown): ProductIdentity {
  if (!value || typeof value !== 'object') throw new Error('Malformed retail identity');
  const source = value as ProductIdentity;
  const query = retailQuery(source.query);
  const clean = (item: unknown, max: number) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const discriminators = extractProductDiscriminators(clean(source.name, 300));
  if (source.model || discriminators.gpuModels.length || discriminators.cpuModels.length) discriminators.seriesSignatures = [];
  const identity: ProductIdentity = {
    name: clean(source.name, 300), query, brand: clean(source.brand, 80),
    model: source.model ? clean(source.model, 60) : null,
    model2: source.model2 ? clean(source.model2, 60) : null,
    kind: detectProductKind(source.name),
    capacities: Array.isArray(source.capacities) ? source.capacities.slice(0, 8).map((item) => clean(item, 30)) : [],
    discriminators,
    tokens: Array.isArray(source.tokens) ? source.tokens.slice(0, 20).map((item) => clean(item, 40)) : []
  };
  if (Number.isFinite(Number(source.statedRetail)) && Number(source.statedRetail) > 0) identity.statedRetail = Number(source.statedRetail);
  return identity;
}

async function readResponseText(response: Response): Promise<string> {
  if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('Amazon.com returned a non-HTML response');
  if (!response.body) return (await response.text()).slice(0, AMAZON_BODY_LIMIT);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > AMAZON_BODY_LIMIT) { await reader.cancel(); throw new Error('Amazon.com response exceeded the safe size limit'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function evaluateProviderSnapshot(identity: ProductIdentity, snapshot: RetailProviderSnapshot, cached: boolean): RetailLookupResult {
  if (snapshot.status !== 'ok') {
    const status: RetailLookupStatus = snapshot.status === 'no_results' ? 'no_match' : snapshot.status;
    return { status, query: snapshot.query, match: null, candidates: snapshot.candidates.slice(0, 8), fetchedAt: snapshot.fetchedAt, cached, message: snapshot.message, retryAfterMs: snapshot.retryAfterMs };
  }
  const candidateAudit = snapshot.candidates.slice(0, 8).map((candidate) => ({
    asin: candidate.asin,
    title: candidate.title,
    ...evaluateRetailCandidate(candidate.matchText || candidate.title, identity),
  }));
  const match = matchAmazonCandidates(snapshot.candidates, identity);
  const status: RetailLookupStatus = match ? (match.score >= 3 ? 'matched' : 'low_confidence') : 'no_match';
  const topRejection = candidateAudit.find((entry) => entry.rejectionReasons.length)?.rejectionReasons[0];
  return {
    status,
    query: snapshot.query,
    match,
    candidates: snapshot.candidates.slice(0, 8),
    candidateAudit,
    fetchedAt: snapshot.fetchedAt,
    cached,
    message: match ? `Matched ${match.candidate.title}` : `No conservative Amazon.com match${topRejection ? ` (${topRejection})` : ''}`,
  };
}

async function providerSnapshot(query: string): Promise<{ snapshot: RetailProviderSnapshot; cached: boolean }> {
  const providerKey = retailProviderCacheKey(query);
  const cached = await getRetailCache<RetailProviderSnapshot>(providerKey);
  if (cached && reusableRetailSnapshot(cached.status)) return { snapshot: cached, cached: true };

  const snapshot = await joinInflight(amazonInflight, providerKey, async (): Promise<RetailProviderSnapshot> => {
    const url = new URL('https://www.amazon.com/s');
    url.searchParams.set('k', query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url.href, {
        // Match the donor userscript's GM_xmlhttpRequest behavior: research through
        // the user's normal Amazon session instead of an anonymous cold request.
        method: 'GET', credentials: 'include', cache: 'default', redirect: 'follow',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: controller.signal
      });
      const finalUrl = new URL(response.url || url.href);
      if (!/(^|\.)amazon\.com$/i.test(finalUrl.hostname)) throw new Error('Amazon lookup redirected outside Amazon.com');
      if (response.status === 429 || response.status === 503) {
        return { status: 'rate_limited', query, candidates: [], fetchedAt: Date.now(), message: `Amazon.com returned HTTP ${response.status}` };
      }
      if (!response.ok) throw new Error(`Amazon.com returned HTTP ${response.status}`);
      const html = await readResponseText(response);
      if (isAmazonChallengeHtml(html)) {
        return { status: 'blocked', query, candidates: [], fetchedAt: Date.now(), message: 'Amazon.com returned a challenge page' };
      }
      const candidates = parseAmazonDocumentCandidates(html).slice(0, 30);
      const explicitNoResults = /(?:did not match any products|no results for|try checking your spelling)/i.test(html);
      const status: RetailProviderSnapshot['status'] = candidates.length ? 'ok' : explicitNoResults ? 'no_results' : 'parse_error';
      const result: RetailProviderSnapshot = {
        status, query, candidates, fetchedAt: Date.now(),
        message: status === 'ok' ? `Parsed ${candidates.length} Amazon.com candidate(s)` : status === 'no_results' ? 'Amazon.com returned no product results' : 'Amazon.com results could not be parsed; no no-match decision was made',
      };
      await putRetailCache(providerKey, result, retailCacheTtl(status === 'ok' ? 'matched' : status));
      return result;
    } catch (error) {
      return {
        status: 'network_error', query, candidates: [], fetchedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  });
  return { snapshot, cached: false };
}

async function lookupAmazonNow(identity: ProductIdentity): Promise<RetailLookupResult> {
  const query = retailQuery(identity.query);
  try {
    const provider = await providerSnapshot(query);
    let result = evaluateProviderSnapshot(identity, provider.snapshot, provider.cached);
    if (result.status === 'no_match' && provider.snapshot.status === 'ok') {
      const candidates = provider.snapshot.candidates
        .map((candidate) => ({ candidate, evaluation: evaluateRetailCandidate(candidate.matchText || candidate.title, identity) }))
        .filter(({ candidate, evaluation }) => !candidate.sponsored && !candidate.used && candidate.price != null
          && evaluation.rejectionReasons.length > 0
          && evaluation.rejectionReasons.every((reason) => /^attribute-(?:missing|conflict):/.test(reason)))
        .slice(0, 2);
      if (candidates.length) {
        const enrichedByAsin = new Map<string, ReturnType<typeof enrichAmazonCandidateFromDetail>>();
        await Promise.all(candidates.map(async ({ candidate }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          try {
            const response = await fetch(candidate.url, { credentials: 'include', cache: 'default', redirect: 'follow', signal: controller.signal });
            if (!response.ok) return;
            const html = await readResponseText(response);
            if (!isAmazonChallengeHtml(html)) enrichedByAsin.set(candidate.asin, enrichAmazonCandidateFromDetail(candidate, html));
          } catch { /* retain the conservative search-card result */ }
          finally { clearTimeout(timer); }
        }));
        if (enrichedByAsin.size) {
          const enrichedSnapshot = {
            ...provider.snapshot,
            candidates: provider.snapshot.candidates.map((candidate) => enrichedByAsin.get(candidate.asin) || candidate),
            fetchedAt: Date.now(),
          };
          await putRetailCache(retailProviderCacheKey(query), enrichedSnapshot, retailCacheTtl('matched'));
          result = evaluateProviderSnapshot(identity, enrichedSnapshot, false);
        }
      }
    }
    return result;
  } catch (error) {
    const retryAfterMs = await markProviderFailure('amazon', 'network-error', 5_000);
    return { status: 'network_error', query, match: null, candidates: [], fetchedAt: Date.now(), cached: false, retryAfterMs, message: error instanceof Error ? error.message : String(error) };
  }
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
    case 'flippah:retail.lookup':
      ensureHiBidSender(sender);
      return lookupAmazonNow(validateRetailIdentity((message.payload as any)?.identity));
    case 'flippah:retail.cache.clear':
      ensureHiBidSender(sender);
      await clearRetailCache();
      await closeAmazonHelper();
      return { cleared: true };
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
  if ((message as any)?.type === 'flippah:amazon.browser.result') {
    completeAmazonBrowser(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
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
  for (const { suffix, when } of endingAlarmSpecs(lot)) {
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
  if (alarm.name === DEV_RELOAD_ALARM) {
    void unpackedAutoReload.check();
    return;
  }
  if (alarm.name === AMAZON_HELPER_CLOSE_ALARM) {
    void closeAmazonHelper();
    return;
  }
  if (alarm.name === WATCH_REFRESH_ALARM) {
    void refreshWatchlist();
    return;
  }
  const match = /^flippah:ending:(\d+):(15m|2m)$/.exec(alarm.name);
  if (!match) return;
  void localGet().then((state) => {
    const lotId = match[1]!;
    const suffix = match[2] as '15m' | '2m';
    const lot = state.watchlist?.[lotId];
    if (!lot) return;
    const nextLot = markEndingAlertNotified(lot, suffix);
    if (!nextLot) return;
    void localSet({ watchlist: { ...state.watchlist, [lotId]: nextLot } }).then(() => {
      chrome.notifications.create(alarm.name, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: `${suffix === '15m' ? '15 minutes' : '2 minutes'} remaining`,
        message: String(lot.title || `Lot ${lotId}`)
      });
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
