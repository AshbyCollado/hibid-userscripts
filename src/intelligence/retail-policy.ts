import type { ProductIdentity } from './us-deal-intelligence.js';

export const AMAZON_CHALLENGE_RE = /(?:enter the characters you see below|sorry, we just need to make sure|robot check|captcha)/i;

export function isAmazonChallengeHtml(html: string): boolean {
  return AMAZON_CHALLENGE_RE.test(html);
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
  return `amazon-us:provider-v6:${query.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')}`;
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
