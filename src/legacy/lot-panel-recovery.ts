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
    const currentHref = globalThis.location?.href;
    if (!currentHref) return false;
    const current = new URL(currentHref);
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
  let lastFocused: HTMLElement | null = null;

  const shadow = options.host.shadowRoot;
  const focusIn = (): void => {
    const target = shadow?.activeElement;
    if (target) lastFocused = target as HTMLElement;
  };
  options.host.addEventListener('focusin', focusIn);

  // Keep the legacy panel visually aligned with the current HiBid surface without
  // depending on page CSS or loading an external font.
  if (shadow && !shadow.querySelector('[data-flippah-recovery-style]')) {
    const style = document.createElement('style');
    style.dataset.flippahRecoveryStyle = 'true';
    style.textContent = ':host{display:block;width:100%;max-width:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif} .lotlens-panel{border:1px solid #dfe3e1;border-radius:8px;margin:8px 0;padding:12px;background:#fff;box-shadow:none}';
    shadow.append(style);
  }

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    documentObserver.disconnect();
    bidObserver?.disconnect();
    bidObserver = null;
    bidNode = null;
    options.host.removeEventListener('focusin', focusIn);
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
    if (options.host.isConnected && lastFocused && shadow?.contains(lastFocused)) {
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) {
        lastFocused.focus({ preventScroll: true });
      }
    }
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
