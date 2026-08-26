import { resolveHiBidRoute } from '../core/route.js';
import type { AuctionRelayAcceptedV1 } from '../core/auction-relay.js';

export type AuctionHandoffPhase = 'idle' | 'enumerating' | 'sending' | 'accepted' | 'failure';

export interface AuctionHandoffAction {
  update(): void;
  remove(): void;
  phase(): AuctionHandoffPhase;
}

export function installHibidAuctionHandoffAction(
  document: Document,
  window: Window,
  analyze: (onSending: (pictureCount: number) => void) => Promise<AuctionRelayAcceptedV1>,
): AuctionHandoffAction {
  let currentPhase: AuctionHandoffPhase = 'idle';
  let root: HTMLElement | null = null;
  let style: HTMLStyleElement | null = null;
  let renderedHref = '';
  let acceptedUrl: string | null = null;

  const remove = () => {
    root?.remove();
    style?.remove();
    root = null;
    style = null;
    renderedHref = '';
    currentPhase = 'idle';
    acceptedUrl = null;
  };

  const render = () => {
    if (root && !root.isConnected) {
      root = null;
      style?.remove();
      style = null;
    }
    if (root || resolveHiBidRoute(window.location.href).kind !== 'lot') return;
    style = document.createElement('style');
    style.textContent = `
      #flippah-auction-handoff{display:grid;box-sizing:border-box;gap:5px;width:min(100%,420px);margin:12px 0;padding:10px;border:1px solid #b9c8db;border-radius:12px;background:#fff;color:#182235;box-shadow:0 3px 12px rgba(15,23,42,.14);font:600 13px/1.35 system-ui,sans-serif}
      #flippah-auction-handoff button{min-height:44px;border:0;border-radius:9px;background:#1557d6;color:#fff;padding:10px 15px;font:800 14px/1.2 system-ui,sans-serif;cursor:pointer}
      #flippah-auction-handoff button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
      #flippah-auction-handoff button:disabled{cursor:not-allowed;opacity:.72}
      #flippah-auction-handoff[data-phase="enumerating"] button:disabled,#flippah-auction-handoff[data-phase="sending"] button:disabled{cursor:wait}
      #flippah-auction-handoff [data-status]{min-height:18px;color:#475569;font-weight:650}
      #flippah-auction-handoff[data-phase="failure"] [data-status]{color:#a11b1b}
      @media(max-width:480px){#flippah-auction-handoff{width:100%;margin:10px 0}}
      @media(prefers-reduced-motion:reduce){#flippah-auction-handoff *{scroll-behavior:auto!important}}
    `;
    style.dataset.flippahAuctionHandoffStyle = 'true';
    const container = document.createElement('aside');
    container.id = 'flippah-auction-handoff';
    container.dataset.flippahOwned = 'true';
    container.dataset.phase = 'idle';
    container.setAttribute('aria-label', 'Flippah book lot analysis');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Analyze books in Flippah';
    const status = document.createElement('div');
    status.dataset.status = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Imports every seller photo';
    container.append(button, status);
    document.head.append(style);
    const heading = document.querySelector<HTMLElement>('main h1, h1');
    if (heading?.parentElement) heading.insertAdjacentElement('afterend', container);
    else (document.querySelector<HTMLElement>('main') || document.body).prepend(container);
    root = container;
    renderedHref = window.location.href;

    const setPhase = (phase: AuctionHandoffPhase, message: string) => {
      currentPhase = phase;
      container.dataset.phase = phase;
      status.textContent = message;
      status.setAttribute('aria-live', phase === 'failure' ? 'assertive' : 'polite');
      button.disabled = phase === 'enumerating' || phase === 'sending' || (phase === 'accepted' && !acceptedUrl);
      button.textContent = phase === 'accepted'
        ? acceptedUrl ? 'Open accepted lot' : 'Opened in Flippah'
        : 'Analyze books in Flippah';
    };

    button.addEventListener('click', () => {
      if (acceptedUrl) {
        window.open(acceptedUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      setPhase('enumerating', 'Enumerating exact HiBid photos…');
      void analyze((pictureCount) => setPhase('sending', `Sending ${pictureCount} photo${pictureCount === 1 ? '' : 's'} securely…`))
        .then((result) => {
          const needsOwnerOpen = result.opener_state === 'missing' || result.opener_state === 'navigated';
          acceptedUrl = needsOwnerOpen ? result.lot_url : null;
          setPhase('accepted', needsOwnerOpen
            ? `Accepted ${result.lot_id}; use Open accepted lot to view it.`
            : `Accepted ${result.lot_id}; Flippah is opening…`);
        })
        .catch((error) => setPhase('failure', error instanceof Error ? error.message : 'Flippah could not analyze this lot'));
    });
  };

  render();
  return {
    update() {
      if (resolveHiBidRoute(window.location.href).kind === 'lot') {
        if (renderedHref && renderedHref !== window.location.href) remove();
        render();
      }
      else remove();
    },
    remove() {
      remove();
    },
    phase: () => currentPhase,
  };
}
