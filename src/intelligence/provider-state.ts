export type RetailProviderName = 'amazon';

export interface ProviderThrottleState {
  nextAllowedAt: number;
  consecutiveFailures: number;
  lastStatus: string;
  updatedAt: number;
}

export function providerStateStorageKey(provider: RetailProviderName): string {
  return `flippahRetailProviderStateV1:${provider}`;
}

export function normalizeProviderThrottle(value: unknown): ProviderThrottleState {
  const source = value && typeof value === 'object' ? value as Partial<ProviderThrottleState> : {};
  return {
    nextAllowedAt: Number(source.nextAllowedAt) || 0,
    consecutiveFailures: Number(source.consecutiveFailures) || 0,
    lastStatus: String(source.lastStatus || ''),
    updatedAt: Number(source.updatedAt) || 0,
  };
}

export function nextProviderFailureState(current: ProviderThrottleState, status: string, minimumDelayMs: number, now = Date.now()): ProviderThrottleState {
  const consecutiveFailures = current.consecutiveFailures + 1;
  const delay = Math.min(120_000, Math.max(minimumDelayMs, 5_000 * (2 ** Math.min(5, consecutiveFailures - 1))));
  return { nextAllowedAt: now + delay, consecutiveFailures, lastStatus: status, updatedAt: now };
}

export function successfulProviderState(now = Date.now(), minimumDelayMs = 0): ProviderThrottleState {
  const delay = Math.max(0, minimumDelayMs);
  return { nextAllowedAt: delay ? now + delay : 0, consecutiveFailures: 0, lastStatus: 'ok', updatedAt: now };
}

export function providerWaitMs(state: ProviderThrottleState, now = Date.now()): number {
  return Math.max(0, state.nextAllowedAt - now);
}
