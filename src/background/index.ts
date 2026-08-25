import { HIBID_GRAPHQL_ENDPOINT, HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, HIBID_SEARCH_ENDPOINT } from '../hibid/api.js';
import { failure, isEnvelope, payloadBytes, success, type MessageEnvelope } from '../core/messages.js';
import { getJob, getJobForFingerprint, pruneJobs, putDiagnostic, putJobIfNewer, putRecordBatch } from '../core/job-db.js';
import { collectStoredOutcomes } from '../core/outcomes.js';
import type { HiBidLotRecord, ScrapeJobSummary } from '../core/types.js';
import { clearRetailCache, getRetailCache, putRetailCache } from '../core/retail-db.js';
import { detectProductKind, evaluateAmazonCandidateEvidence, evaluateRetailCandidate, extractProductDiscriminators, matchAmazonCandidates, parseAmazonCandidates, type ProductIdentity, type RetailCandidateEvaluation } from '../intelligence/us-deal-intelligence.js';
import { enrichAmazonCandidateFromDetail, parseAmazonDocumentCandidates } from '../intelligence/amazon-document-parser.js';
import { nextProviderFailureState, normalizeProviderThrottle, providerStateStorageKey, successfulProviderState, type ProviderThrottleState, type RetailProviderName } from '../intelligence/provider-state.js';
import { isAmazonChallengeHtml, joinInflight, retailCacheTtl, retailProviderCacheKey, reusableRetailSnapshot } from '../intelligence/retail-policy.js';
import { DEV_RELOAD_ALARM, installUnpackedAutoReload } from './dev-auto-reload.js';
import { FLIPPAH_AUCTION_PWA_PORT_KEY, FLIPPAH_AUCTION_RELAY_PORT_KEY, FLIPPAH_AUCTION_RELAY_TOKEN_KEY, postHibidLotToAuctionRelay } from '../core/auction-relay.js';
import { eventItemIdFromHibidLotUrl, validateHibidLotHandoffV1 } from '../hibid/handoff.js';
import type { HibidLotHandoffV1 } from '../core/types.js';

const MAX_REQUEST_BYTES = 180_000;
const MAX_RECORD_BATCH = 100;
const AMAZON_BODY_LIMIT = 5_000_000;
const amazonInflight = new Map<string, Promise<RetailProviderSnapshot>>();
let amazonProviderTail: Promise<void> = Promise.resolve();
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

function localGetKeys(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => chrome.storage.local.get(keys, (value) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}

async function handleLegacyMessage(message: any): Promise<unknown> {
  if (!message || typeof message !== 'object' || typeof message.kind !== 'string') return undefined;
  const state = await localGet();
  const watchlist = state.watchlist && typeof state.watchlist === 'object' ? state.watchlist : {};
  const premiums = state.premiums && typeof state.premiums === 'object' ? state.premiums : {};
  if (message.kind === 'watch:list') return Object.values(watchlist);
  if (message.kind === 'outcome:list') return collectStoredOutcomes(state);
  if (message.kind === 'watch:add') {
    const lot = message.lot;
    if (!lot || typeof lot !== 'object' || !String(lot.lotId || '')) return { ok: false, error: 'invalid_lot' };
    await localSet({ watchlist: { ...watchlist, [String(lot.lotId)]: lot } });
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
  if (url.protocol !== 'https:' || !/(^|\.)hibid\.com$/i.test(url.hostname)) throw new Error('HiBid operation rejected for this host');
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
    ...evaluateAmazonCandidateEvidence(candidate, identity),
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
      return { cleared: true };
    case 'flippah:auction.handoff': {
      ensureHiBidSender(sender);
      const extensionBase = chrome.runtime.getURL('');
      if (!extensionBase.startsWith('chrome-extension://')) throw new Error('Paired auction handoff currently requires the installed Chrome extension');
      const manifest = (message.payload as any)?.manifest as HibidLotHandoffV1;
      validateHibidLotHandoffV1(manifest);
      const senderUrl = sender.url || sender.tab?.url || '';
      if (eventItemIdFromHibidLotUrl(senderUrl) !== manifest.source.provider_event_item_id) throw new Error('The HiBid page changed before the lot handoff was accepted');
      const state = await localGetKeys([FLIPPAH_AUCTION_RELAY_TOKEN_KEY, FLIPPAH_AUCTION_RELAY_PORT_KEY, FLIPPAH_AUCTION_PWA_PORT_KEY]);
      const accepted = await postHibidLotToAuctionRelay(
        manifest,
        state[FLIPPAH_AUCTION_RELAY_TOKEN_KEY],
        state[FLIPPAH_AUCTION_RELAY_PORT_KEY],
        state[FLIPPAH_AUCTION_PWA_PORT_KEY],
      );
      await chrome.tabs.create({ url: accepted.lot_url, active: true });
      return accepted;
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

async function updateBadge(): Promise<void> {
  const state = await localGet();
  const soon = Object.values(state.watchlist || {}).filter((lot: any) => Number.isFinite(Number(lot.endsAt)) && Number(lot.endsAt) > Date.now() && Number(lot.endsAt) <= Date.now() + 3_600_000).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#b64032' });
  await chrome.action.setBadgeText({ text: soon ? String(soon) : '' });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DEV_RELOAD_ALARM) {
    void unpackedAutoReload.check();
  }
});
void pruneJobs(20);
void updateBadge();
