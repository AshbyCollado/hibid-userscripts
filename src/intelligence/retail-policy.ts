import type { ProductIdentity } from './us-deal-intelligence.js';

export const AMAZON_CHALLENGE_RE = /(?:enter the characters you see below|sorry, we just need to make sure|robot check|captcha)/i;
export const RETAIL_BATCH_SIZE = 6;
export const RETAIL_BATCH_DELAY_MS = 350;

export function isAmazonChallengeHtml(html: string): boolean {
  return AMAZON_CHALLENGE_RE.test(html);
}

export function retailIdentityCacheKey(identity: ProductIdentity, epoch: number): string {
  return `amazon-us:${epoch}:${[
    identity.query, identity.brand, identity.model, identity.model2, identity.kind, ...identity.capacities
  ].map((item) => String(item || '').toLocaleLowerCase('en-US')).join('|')}`;
}

export function partitionRetailBatches<T>(items: readonly T[], size = 6): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Retail batch size must be a positive integer');
  return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

export function retailCacheTtl(status: string): number {
  if (status === 'matched') return 12 * 60 * 60 * 1000;
  if (status === 'blocked' || status === 'rate_limited') return 5 * 60 * 1000;
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
