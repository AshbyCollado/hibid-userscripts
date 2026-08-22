export type ProviderRetryStatus = 'blocked' | 'rate_limited' | 'network_error' | 'parse_error';

export interface ProviderQueueResult {
  status: string;
  cached?: boolean;
  retryAfterMs?: number;
  message?: string;
}

export interface ProviderQueuePolicy {
  delayMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

export interface ProviderQueueProgress<T, R extends ProviderQueueResult> {
  item: T;
  result: R;
  completed: number;
  total: number;
  attempts: number;
}

export interface ProviderQueueRunResult<R extends ProviderQueueResult> {
  completed: number;
  total: number;
  stoppedResult?: R;
}

const RETRYABLE = new Set<ProviderRetryStatus>(['blocked', 'rate_limited', 'network_error', 'parse_error']);

export const DEFAULT_PROVIDER_QUEUE_POLICY: ProviderQueuePolicy = {
  delayMs: 1_500,
  maxRetries: 3,
  retryBaseMs: 5_000,
  retryMaxMs: 60_000,
};

export function providerRetryDelay(result: ProviderQueueResult, attempt: number, policy: ProviderQueuePolicy): number {
  const requested = Number(result.retryAfterMs);
  const exponential = Math.min(policy.retryMaxMs, policy.retryBaseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.max(Number.isFinite(requested) && requested > 0 ? requested : 0, exponential);
}

export function shouldRetryProviderResult(result: ProviderQueueResult, attempt: number, policy: ProviderQueuePolicy): boolean {
  return RETRYABLE.has(result.status as ProviderRetryStatus) && attempt <= policy.maxRetries;
}

export async function runProviderQueue<T, R extends ProviderQueueResult>(options: {
  items: readonly T[];
  lookup: (item: T, attempt: number) => Promise<R>;
  onProgress: (progress: ProviderQueueProgress<T, R>) => void;
  shouldContinue: () => boolean;
  policy?: Partial<ProviderQueuePolicy>;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<ProviderQueueRunResult<R>> {
  const policy = { ...DEFAULT_PROVIDER_QUEUE_POLICY, ...(options.policy || {}) };
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let completed = 0;

  for (const item of options.items) {
    if (!options.shouldContinue()) return { completed, total: options.items.length };
    let attempt = 0;
    while (options.shouldContinue()) {
      attempt += 1;
      const result = await options.lookup(item, attempt);
      if (result.status === 'blocked' || result.status === 'rate_limited') {
        completed += 1;
        options.onProgress({ item, result, completed, total: options.items.length, attempts: attempt });
        return { completed, total: options.items.length, stoppedResult: result };
      }
      if (shouldRetryProviderResult(result, attempt, policy)) {
        await sleep(providerRetryDelay(result, attempt, policy));
        continue;
      }
      completed += 1;
      options.onProgress({ item, result, completed, total: options.items.length, attempts: attempt });
      if (!result.cached && completed < options.items.length) await sleep(policy.delayMs);
      break;
    }
  }
  return { completed, total: options.items.length };
}
