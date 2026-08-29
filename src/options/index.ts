import { getLocalStorage, getSyncStorage, setLocalStorage, setSyncStorage } from '../core/browser.js';
import { normalizeSettings } from '../core/settings.js';
import { auctionRelayUrl, FLIPPAH_AUCTION_PWA_DEFAULT_PORT, FLIPPAH_AUCTION_PWA_PORT_KEY, FLIPPAH_AUCTION_RELAY_DEFAULT_PORT, FLIPPAH_AUCTION_RELAY_PORT_KEY, FLIPPAH_AUCTION_RELAY_TOKEN_KEY, normalizeAuctionRelayToken, normalizeLoopbackPort } from '../core/auction-relay.js';

const app = document.querySelector<HTMLElement>('#app')!;
const states = ['', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function replaceMarkup(target: Element, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  target.replaceChildren(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)));
}

async function init(): Promise<void> {
  const [sync, local] = await Promise.all([
    getSyncStorage(),
    getLocalStorage([FLIPPAH_AUCTION_RELAY_TOKEN_KEY, FLIPPAH_AUCTION_RELAY_PORT_KEY, FLIPPAH_AUCTION_PWA_PORT_KEY]),
  ]);
  const settings = normalizeSettings(sync);
  const relayPaired = typeof local[FLIPPAH_AUCTION_RELAY_TOKEN_KEY] === 'string' && Boolean(String(local[FLIPPAH_AUCTION_RELAY_TOKEN_KEY]).trim());
  const savedRelayPort = Number(local[FLIPPAH_AUCTION_RELAY_PORT_KEY]);
  const relayPort = Number.isInteger(savedRelayPort) && savedRelayPort >= 1024 && savedRelayPort <= 65_535
    ? savedRelayPort
    : FLIPPAH_AUCTION_RELAY_DEFAULT_PORT;
  const savedPwaPort = Number(local[FLIPPAH_AUCTION_PWA_PORT_KEY]);
  const pwaPort = Number.isInteger(savedPwaPort) && savedPwaPort >= 1024 && savedPwaPort <= 65_535
    ? savedPwaPort
    : FLIPPAH_AUCTION_PWA_DEFAULT_PORT;
  const paymentOptions = [
    ['unspecified', 'Not specified — use conservative auction rate'],
    ['card', 'Credit / debit card'],
    ['cash', 'Cash'],
    ['check', 'Check'],
  ].map(([value, label]) => `<option value="${value}" ${settings.auctionPaymentMethod === value ? 'selected' : ''}>${label}</option>`).join('');
  const markup = `
    <header class="header">
      <div class="brand">Flippah by ALOS</div>
      <div class="subtitle">True cost, resale research, watchlist, and verified HiBid export settings.</div>
    </header>
    <form id="settings-form">
      <section class="section">
        <h2>Purchase costs</h2>
        <p class="hint">These values are inserted into every copied AI brief. Auction-specific terms take priority over fallbacks.</p>
        <div class="grid">
          <label>Tax state<select name="stateCode">${states.map((state) => `<option value="${state}" ${settings.stateCode === state ? 'selected' : ''}>${state || 'No state selected'}</option>`).join('')}</select></label>
          <label>Tax override (%)<input name="taxPctOverride" type="number" min="0" max="20" step="0.01" value="${settings.taxPctOverride ?? ''}" placeholder="Use state estimate"></label>
          <label>Default buyer premium (%)<input name="defaultBuyerPremiumPct" type="number" min="0" max="50" step="0.01" value="${settings.defaultBuyerPremiumPct ?? ''}" placeholder="Only when auction data is missing"></label>
          <label>Auction payment method<select name="auctionPaymentMethod">${paymentOptions}</select></label>
          <label>eBay fee (%)<input name="ebayFeePct" type="number" min="0" max="40" step="0.01" value="${settings.ebayFeePct}"></label>
          <label>eBay fixed fee (cents)<input name="ebayFeeFixedCents" type="number" min="0" max="1000" step="1" value="${settings.ebayFeeFixedCents}"></label>
          <label>Seller-paid shipping default ($)<input name="outboundShippingUsd" type="number" min="0" max="10000" step="0.01" value="${settings.outboundShippingUsd}"></label>
          <label>Packing reserve per item ($)<input name="packingReserveUsd" type="number" min="0" max="10000" step="0.01" value="${settings.packingReserveUsd}"></label>
          <label>Promoted listing fee (%)<input name="promotedListingPct" type="number" min="0" max="40" step="0.01" value="${settings.promotedListingPct}"></label>
          <label>Return / loss reserve (%)<input name="returnReservePct" type="number" min="0" max="100" step="0.01" value="${settings.returnReservePct}"></label>
        </div>
        <p><label class="check"><input name="taxOnPremium" type="checkbox" ${settings.taxOnPremium ? 'checked' : ''}>Apply sales tax to buyer premium</label></p>
        <p><label class="check"><input name="taxExempt" type="checkbox" ${settings.taxExempt ? 'checked' : ''}>My auction purchases are tax exempt</label></p>
      </section>
      <section class="section">
        <h2>AI resale brief</h2>
        <p class="hint">Flippah gives the AI your economics and a Sold/Completed search link for every lot. Saved lot query corrections, quantities, resale hypotheses, maximum bids, and auction premium corrections are included automatically with their source. The AI must verify visible sold evidence before assigning resale value.</p>
        <div class="grid">
          <label>Pickup origin / city<input name="originLabel" value="${escapeHtml(settings.originLabel)}" placeholder="Example: Carteret, NJ"></label>
          <label>Origin ZIP<input name="originZip" inputmode="numeric" value="${escapeHtml(settings.originZip)}" placeholder="Example: 07008"></label>
          <label>Maximum pickup radius (miles)<input name="radiusMiles" type="number" min="1" max="500" value="${settings.radiusMiles}"></label>
          <label>Target profit per item ($)<input name="targetProfitUsd" type="number" min="0" max="100000" step="1" value="${settings.targetProfitUsd}"></label>
          <label>Bulky-item target profit ($)<input name="bulkyItemProfitUsd" type="number" min="0" max="100000" step="1" value="${settings.bulkyItemProfitUsd ?? ''}" placeholder="Use normal target"></label>
          <label>Minimum ROI (%)<input name="minimumRoiPct" type="number" min="0" max="1000" step="1" value="${settings.minimumRoiPct}"></label>
          <label>Sold comps requested per lead<input name="soldCompTarget" type="number" min="1" max="10" step="1" value="${settings.soldCompTarget}"></label>
          <label>Preferred resale channels<input name="resaleChannels" value="${escapeHtml(settings.resaleChannels)}" placeholder="eBay, local pickup, Facebook Marketplace"></label>
          <label>Vehicle / pickup capability<input name="transportDescription" value="${escapeHtml(settings.transportDescription)}" placeholder="Vehicle size, trailer, lifting help, stairs limits"></label>
        </div>
        <label style="margin-top:14px">Additional AI instructions<textarea name="customInstructions" placeholder="Categories, brands, risk limits, or other personal rules">${escapeHtml(settings.customInstructions)}</textarea></label>
      </section>
      <section class="section">
        <h2>US deal intelligence</h2>
        <p><label class="check"><input name="amazonAutoLookup" type="checkbox" ${settings.amazonAutoLookup ? 'checked' : ''}>Automatically research Amazon.com on supported HiBid pages</label></p>
        <div class="grid">
          <label>Target all-in (% of new retail)<input name="retailTargetPct" type="number" min="1" max="95" step="1" value="${settings.retailTargetPct}"></label>
          <label>Strong-warning floor (%)<input name="retailWarningPct" type="number" min="1" max="95" step="1" value="${settings.retailWarningPct}"></label>
        </div>
        <p class="hint">Checks run at a paced rate. Genuine CAD listings are left unconverted and receive no USD comparison.</p>
      </section>
      <section class="section">
        <h2>HiBid behavior</h2>
        <p><label class="check"><input name="fullSizeImageHover" type="checkbox" ${settings.fullSizeImageHover ? 'checked' : ''}>Show full-size lot photos on hover</label></p>
        <p><label class="check"><input name="nativeWatchSync" type="checkbox" ${settings.nativeWatchSync ? 'checked' : ''}>Mirror native HiBid watch actions into Flippah</label></p>
        <p><label class="check"><input name="includePrivateWatchNotes" type="checkbox" ${settings.includePrivateWatchNotes ? 'checked' : ''}>Include private watch notes in exports</label></p>
      </section>
      <section class="section">
        <h2>Flippah lot handoff</h2>
        <p class="hint">${relayPaired ? 'Paired on this browser profile.' : 'Not paired. Copy the separate auction relay token from local Flippah.'} The token stays in local extension storage and is never synced or exported.</p>
        <div class="grid">
          <label>Pairing token<input name="auctionRelayToken" type="password" autocomplete="new-password" placeholder="${relayPaired ? 'Saved — enter only to replace' : 'Paste pairing token'}"></label>
          <label>Local API port<input name="auctionRelayPort" type="number" min="1024" max="65535" step="1" value="${relayPort}"></label>
          <label>Local PWA port<input name="auctionPwaPort" type="number" min="1024" max="65535" step="1" value="${pwaPort}"></label>
        </div>
        <p><label class="check"><input name="unpairAuctionRelay" type="checkbox">Remove saved lot-handoff pairing</label></p>
      </section>
      <section class="section"><h2>Diagnostics</h2><label class="check"><input name="debugMode" type="checkbox" ${settings.debugMode ? 'checked' : ''}>Enable verbose Flippah diagnostics</label></section>
      <div class="actions"><button type="submit">Save settings</button><span id="status" role="status"></span></div>
    </form>`;
  replaceMarkup(app, markup);
  document.querySelector<HTMLFormElement>('#settings-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const checkbox = (name: string) => Boolean(document.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked);
    const number = (name: string) => { const value = String(form.get(name) || '').trim(); return value ? Number(value) : null; };
    const next = normalizeSettings({
      stateCode: String(form.get('stateCode') || '') || null,
      taxPctOverride: number('taxPctOverride'), taxOnPremium: checkbox('taxOnPremium'), taxExempt: checkbox('taxExempt'),
      defaultBuyerPremiumPct: number('defaultBuyerPremiumPct'), auctionPaymentMethod: String(form.get('auctionPaymentMethod') || ''),
      ebayFeePct: number('ebayFeePct'), ebayFeeFixedCents: number('ebayFeeFixedCents'),
      outboundShippingUsd: number('outboundShippingUsd'), packingReserveUsd: number('packingReserveUsd'),
      promotedListingPct: number('promotedListingPct'), returnReservePct: number('returnReservePct'),
      catalogChips: false, fullSizeImageHover: checkbox('fullSizeImageHover'), nativeWatchSync: checkbox('nativeWatchSync'),
      includePrivateWatchNotes: checkbox('includePrivateWatchNotes'), debugMode: checkbox('debugMode'),
      amazonAutoLookup: checkbox('amazonAutoLookup'), retailTargetPct: number('retailTargetPct'),
      retailWarningPct: number('retailWarningPct'),
      originLabel: String(form.get('originLabel') || ''), originZip: String(form.get('originZip') || ''),
      radiusMiles: number('radiusMiles'), targetProfitUsd: number('targetProfitUsd'), minimumRoiPct: number('minimumRoiPct'),
      soldCompTarget: number('soldCompTarget'), bulkyItemProfitUsd: number('bulkyItemProfitUsd'), resaleChannels: String(form.get('resaleChannels') || ''),
      transportDescription: String(form.get('transportDescription') || ''), customInstructions: String(form.get('customInstructions') || '')
    });
    const status = document.querySelector<HTMLElement>('#status')!;
    try {
      const token = String(form.get('auctionRelayToken') || '').trim();
      const port = number('auctionRelayPort') ?? FLIPPAH_AUCTION_RELAY_DEFAULT_PORT;
      const nextPwaPort = number('auctionPwaPort') ?? FLIPPAH_AUCTION_PWA_DEFAULT_PORT;
      auctionRelayUrl(port);
      normalizeLoopbackPort(nextPwaPort, FLIPPAH_AUCTION_PWA_DEFAULT_PORT);
      const relaySettings: Record<string, unknown> = {
        [FLIPPAH_AUCTION_RELAY_PORT_KEY]: port,
        [FLIPPAH_AUCTION_PWA_PORT_KEY]: nextPwaPort,
      };
      if (checkbox('unpairAuctionRelay')) relaySettings[FLIPPAH_AUCTION_RELAY_TOKEN_KEY] = '';
      else if (token) relaySettings[FLIPPAH_AUCTION_RELAY_TOKEN_KEY] = normalizeAuctionRelayToken(token);
      await setSyncStorage(next as unknown as Record<string, unknown>);
      await setLocalStorage(relaySettings);
      status.textContent = 'Saved';
      window.setTimeout(() => { status.textContent = ''; }, 1800);
    } catch (error) {
      status.textContent = error instanceof Error ? `Could not save: ${error.message}` : 'Could not save settings';
    }
  });
}

void init().catch((error) => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = `Flippah settings could not open: ${error instanceof Error ? error.message : String(error)}`;
  app.replaceChildren(message);
});
