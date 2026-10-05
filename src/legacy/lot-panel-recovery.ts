export interface LotPanelRecoveryOptions {
  host: HTMLElement;
  signal: AbortSignal;
  routeHref: string;
  getBidNode: () => Element | null;
  parseBid: () => number | null;
  updateBid: (bidCents: number) => void;
  insertHost: (host: HTMLElement) => void;
}

export interface LotPanelRecoveryHandle {
  disconnect(): void;
}

function sameRoute(expectedHref: string): boolean {
  try {
    const expected = new URL(expectedHref, globalThis.location?.href);
    const current = new URL(globalThis.location.href);
    expected.hash = '';
    current.hash = '';
    return expected.href === current.href;
  } catch {
    return globalThis.location.href === expectedHref;
  }
}

export function installLotPanelRecovery(options: LotPanelRecoveryOptions): LotPanelRecoveryHandle {
  let stopped = options.signal.aborted;
  let scheduled = false;
  let bidNode: Element | null = null;
  let bidObserver: MutationObserver | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    documentObserver.disconnect();
    bidObserver?.disconnect();
    bidObserver = null;
    bidNode = null;
    options.signal.removeEventListener('abort', stop);
  };

  const active = (): boolean => !stopped && !options.signal.aborted && sameRoute(options.routeHref);

  const updateFromNative = (): void => {
    if (!active()) {
      stop();
      return;
    }
    const bid = options.parseBid();
    if (bid !== null) options.updateBid(bid);
  };

  const connectBidObserver = (): void => {
    if (!active()) {
      stop();
      return;
    }
    const nextBidNode = options.getBidNode();
    if (nextBidNode === bidNode) return;
    bidObserver?.disconnect();
    bidObserver = null;
    bidNode = nextBidNode;
    if (!bidNode) return;
    bidObserver = new MutationObserver(() => scheduleCheck(true));
    bidObserver.observe(bidNode, { characterData: true, childList: true, subtree: true });
    updateFromNative();
  };

  const recoverHost = (): void => {
    if (options.host.isConnected) return;
    if (document.getElementById(options.host.id) && document.getElementById(options.host.id) !== options.host) return;
    options.insertHost(options.host);
  };

  const check = (bidChanged: boolean): void => {
    scheduled = false;
    if (!active()) {
      stop();
      return;
    }
    recoverHost();
    connectBidObserver();
    if (bidChanged) updateFromNative();
  };

  const scheduleCheck = (bidChanged = false): void => {
    if (!active()) {
      stop();
      return;
    }
    if (bidChanged) pendingBidChange = true;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      const changed = pendingBidChange;
      pendingBidChange = false;
      check(changed);
    });
  };

  let pendingBidChange = false;
  const documentObserver = new MutationObserver(() => scheduleCheck());
  if (stopped) return { disconnect: stop };
  options.signal.addEventListener('abort', stop, { once: true });
  documentObserver.observe(document, { childList: true, subtree: true, characterData: true });
  check(false);
  return { disconnect: stop };
}
