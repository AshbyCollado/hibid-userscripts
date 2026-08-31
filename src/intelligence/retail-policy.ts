import type { ProductIdentity } from './us-deal-intelligence.js';

export type AmazonProviderPageStatus = 'ok' | 'no_results' | 'blocked' | 'parse_error';
export type AmazonProviderPageReason = 'parsed_candidates' | 'explicit_no_results' | 'challenge' | 'automated_access' | 'unrecognized_page';

export interface AmazonProviderPageClassification {
  status: AmazonProviderPageStatus;
  reason: AmazonProviderPageReason;
  message: string;
}

export interface AmazonNoMatchCandidate {
  accepted: boolean;
  score: number;
  price: number | null | undefined;
  sponsored?: boolean;
  used?: boolean;
}

export type AmazonNoMatchReason = 'exact_candidate_missing_purchase_price' | 'no_exact_candidate';

export interface AmazonNoMatchClassification {
  status: 'no_match';
  reason: AmazonNoMatchReason;
}

export const AMAZON_EXACT_MATCH_SCORE = 3;

export const AMAZON_CHALLENGE_RE = /(?:<title\b[^>]*>\s*(?:robot check|amazon captcha)\s*<\/title>|(?:enter|type)\s+the\s+characters\s+you\s+see\s+(?:below|in\s+(?:this|the)\s+image)|sorry,?\s+we\s+just\s+need\s+to\s+make\s+sure\s+you(?:'|&#39;|&apos;)?re\s+not\s+a\s+robot|verify\s+(?:that\s+)?you\s+are\s+human|\/errors\/validatecaptcha|(?:id|name)\s*=\s*["']captchacharacters["']|class\s*=\s*["'][^"']*\bauth-captcha-image-container\b[^"']*["'])/i;
export const AMAZON_AUTOMATED_ACCESS_RE = /(?:to\s+discuss\s+automated\s+access\s+to\s+amazon\s+(?:data|services)|automated\s+(?:access|requests?)\b.{0,120}\bamazon\b|api-services-support@amazon\.com|we(?:(?:'|\u2019)ve|\s+have)\s+detected\s+unusual\s+(?:activity|traffic)\s+from\s+your\s+(?:device|network))/i;
export const AMAZON_NO_RESULTS_RE = /(?:\bno\s+results\s+for\b|\b0\s+results\s+for\b|\bdid\s+not\s+match\s+any\s+products\b|\bwe\s+(?:couldn['\u2019]t|could\s+not)\s+find\s+any\s+results\b)/i;

function activeAmazonHtml(html: string): string {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function amazonVisibleText(html: string): string {
  return activeAmazonHtml(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function amazonChallengeReason(html: string): Extract<AmazonProviderPageReason, 'challenge' | 'automated_access'> | null {
  const activeHtml = activeAmazonHtml(html);
  const visibleText = amazonVisibleText(activeHtml);
  if (AMAZON_AUTOMATED_ACCESS_RE.test(visibleText)) return 'automated_access';
  if (AMAZON_CHALLENGE_RE.test(activeHtml) || AMAZON_CHALLENGE_RE.test(visibleText)) return 'challenge';
  return null;
}

export function isAmazonChallengeHtml(html: string): boolean {
  return amazonChallengeReason(html) !== null;
}

export function isAmazonNoResultsHtml(html: string): boolean {
  return AMAZON_NO_RESULTS_RE.test(amazonVisibleText(html));
}

export function classifyAmazonProviderPage(html: string, candidateCount: number): AmazonProviderPageClassification {
  const challenge = amazonChallengeReason(html);
  if (challenge === 'automated_access') {
    return { status: 'blocked', reason: challenge, message: 'Amazon.com returned an automated-access page' };
  }
  if (challenge === 'challenge') {
    return { status: 'blocked', reason: challenge, message: 'Amazon.com returned a challenge page' };
  }
  if (Number.isInteger(candidateCount) && candidateCount > 0) {
    return { status: 'ok', reason: 'parsed_candidates', message: `Parsed ${candidateCount} Amazon.com candidate(s)` };
  }
  if (isAmazonNoResultsHtml(html)) {
    return { status: 'no_results', reason: 'explicit_no_results', message: 'Amazon.com returned no product results' };
  }
  return {
    status: 'parse_error',
    reason: 'unrecognized_page',
    message: 'Amazon.com results could not be parsed; no no-match decision was made',
  };
}

export function classifyAmazonNoMatch(candidates: readonly AmazonNoMatchCandidate[]): AmazonNoMatchClassification {
  const exactCandidateMissingPurchasePrice = candidates.some((candidate) => candidate.accepted
    && candidate.score >= AMAZON_EXACT_MATCH_SCORE
    && !candidate.sponsored
    && !candidate.used
    && !(typeof candidate.price === 'number' && Number.isFinite(candidate.price) && candidate.price > 0));
  return {
    status: 'no_match',
    reason: exactCandidateMissingPurchasePrice ? 'exact_candidate_missing_purchase_price' : 'no_exact_candidate',
  };
}

export function retailCandidateList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function reusableRetailSnapshot(status: unknown): boolean {
  return status === 'ok' || status === 'no_results';
}

export function retailIdentityCacheKey(identity: ProductIdentity, epoch: number): string {
  return `amazon-us:${epoch}:${[
    identity.query, identity.brand, identity.model, identity.model2, identity.kind,
    JSON.stringify(identity.discriminators || {}), ...identity.capacities
  ].map((item) => String(item || '').toLocaleLowerCase('en-US')).join('|')}`;
}

export function retailProviderCacheKey(query: string): string {
  // This epoch describes the parsed Amazon search-card payload, not the
  // identity matcher. Matcher improvements must re-evaluate cached candidates
  // instead of forcing an entire catalog or watchlist back through Amazon.
  return `amazon-us:provider-v16:${query.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')}`;
}

export function retailCacheTtl(status: string): number {
  if (status === 'matched') return 12 * 60 * 60 * 1000;
  if (status === 'blocked' || status === 'rate_limited') return 5 * 60 * 1000;
  if (status === 'parse_error') return 2 * 60 * 1000;
  return 15 * 60 * 1000;
}

export function joinInflight<K, V>(inflight: Map<K, Promise<V>>, key: K, work: () => Promise<V>): Promise<V> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const operation = Promise.resolve().then(work);
  inflight.set(key, operation);
  void operation.finally(() => {
    if (inflight.get(key) === operation) inflight.delete(key);
  }).catch(() => undefined);
  return operation;
}
