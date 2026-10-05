import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
// @ts-expect-error Build-time patch modules are JavaScript without declarations.
import { patchLegacyEbayQueryModule, patchLegacyRemoveCatalogChips, patchLegacyRemoveShipping } from '../scripts/legacy-ebay-query.mjs';
// @ts-expect-error Build-time patch modules are JavaScript without declarations.
import { patchLegacyAuctionEconomics } from '../scripts/legacy-auction-economics.mjs';
import { i as inverseBudget, n as forwardCost } from '../src/legacy/money-compat.js';

const root = process.cwd();
const asset = path.join(root, 'reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js');
const compat = path.join(root, 'src/legacy/money-compat.ts');
const options = {
  premium: { ratePct: 15, source: 'user' },
  settings: { stateCode: 'DE', taxPctOverride: 0, taxOnPremium: true, taxExempt: false, ebayFeePct: 0, ebayFeeFixedCents: 0 },
  isPro: false,
};
const lot = { lotId: '123', currency: 'USD', title: 'Buda test item', currentBidCents: 1250, shipping: 'pickup_only', auctioneerKey: 'buda' };
type Controller = { updateBid(value: number): void; destroy(): void };
type Message = { kind: string; lot?: { shipCents: number; maxBidCents: number; note: string; [key: string]: unknown }; [key: string]: unknown };
type Bridge = { lotId?: string; fee?: string; premium?: string; complete?: boolean; warnings?: string };

async function patchedLegacy() {
  return patchLegacyAuctionEconomics(patchLegacyRemoveCatalogChips(patchLegacyRemoveShipping(patchLegacyEbayQueryModule(await readFile(asset, 'utf8')))));
}

const bundle = (async () => {
  const result = await build({
    entryPoints: [asset], bundle: true, write: false, format: 'iife', globalName: 'LegacyCalculator', platform: 'browser', target: 'firefox128',
    plugins: [{ name: 'legacy-calculator-harness', setup(api) {
      api.onResolve({ filter: /money-ip6lU9wJ\.js$/ }, (args) => args.importer === compat ? undefined : { path: compat });
      api.onResolve({ filter: /taxRates-B3rE_xel\.js$/ }, () => ({ path: path.join(root, 'src/legacy/tax-rates-compat.ts') }));
      api.onLoad({ filter: /index\.ts-BuCXDImd\.js$/ }, async () => {
        const source = await patchedLegacy();
        // Expose the actual mount without automatic route startup; no calculator code is replaced.
        const startup = 'n(null),Q();export{ge as stopRouteWatcher};';
        assert.equal(source.split(startup).length, 2);
        return { contents: source.replace(startup, 'n(null);export{D as mount,ge as stopRouteWatcher};'), loader: 'js' };
      });
    } }],
  });
  return result.outputFiles[0]!.text;
})();

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(t: TestContext, config: { bridge?: Bridge; saved?: Record<string, unknown>; missingBid?: boolean; deferred?: boolean; premiumSource?: 'parsed' | 'user' } = {}) {
  const dom = new JSDOM('<main id="hibid"><a href="/lot/456">Next lot</a><input value="native value"></main>', { url: 'https://hibid.com/lot/123/test-item', runScripts: 'outside-only' });
  const { window } = dom;
  const messages: Message[] = [];
  const storageWrites: unknown[] = [];
  const saved = config.saved ? { ...lot, shipCents: 9900, resaleCents: 5000, maxBidCents: 1250, note: 'Saved note', ...config.saved } : null;
  let releaseWatch!: (value: unknown[]) => void;
  const watch = config.deferred ? new Promise<unknown[]>((resolve) => { releaseWatch = resolve; }) : Promise.resolve(saved ? [saved] : []);
  Object.assign(window, { chrome: {
    runtime: { sendMessage: async (message: Message) => { messages.push(message); return message.kind === 'watch:list' ? watch : { ok: true }; }, openOptionsPage() {} },
    storage: { sync: { get: (_: unknown, callback: (value: unknown) => void) => callback(options.settings), set: (value: unknown, callback: () => void) => { storageWrites.push(value); callback(); } } },
  } });
  window.eval(`${await bundle}\nglobalThis.LegacyCalculator = LegacyCalculator;`);
  const calculator = (window as unknown as { LegacyCalculator: { mount(host: HTMLElement, props: unknown): Controller; stopRouteWatcher(): void } }).LegacyCalculator;
  calculator.stopRouteWatcher();
  const host = window.document.createElement('div');
  host.id = 'lotlens-root';
  window.document.body.append(host);
  const nativeMarkup = window.document.getElementById('hibid')!.outerHTML;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = host.addEventListener.bind(host);
  const remove = host.removeEventListener.bind(host);
  host.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opt?: boolean | AddEventListenerOptions) => { if (type === 'flippah:economics') listeners.add(listener); add(type, listener, opt); }) as typeof host.addEventListener;
  host.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opt?: boolean | EventListenerOptions) => { if (type === 'flippah:economics') listeners.delete(listener); remove(type, listener, opt); }) as typeof host.removeEventListener;
  function bridge(value: Bridge, dispatch = true) {
    host.dataset.flippahEconomicsLotId = value.lotId ?? '123';
    if (value.fee === undefined) delete host.dataset.flippahFixedFeeCents; else host.dataset.flippahFixedFeeCents = value.fee;
    host.dataset.flippahPremiumPct = value.premium ?? '';
    host.dataset.flippahEconomicsComplete = String(value.complete ?? false);
    host.dataset.flippahEconomicsWarnings = value.warnings ?? '[]';
    if (dispatch) host.dispatchEvent(new window.Event('flippah:economics'));
  }
  if (config.bridge) bridge(config.bridge, false);
  const controllers: Controller[] = [];
  function mount(lotId = '123', missingBid = false) {
    const parsed = { ...lot, lotId, currentBidCents: missingBid ? null : lot.currentBidCents };
    const controller = calculator.mount(host, { ...structuredClone(options), premium: { ratePct: 15, source: config.premiumSource ?? 'user' }, parseResult: missingBid ? { status: 'degraded', partial: parsed } : { status: 'ok', lot: parsed } });
    controllers.push(controller);
    return controller;
  }
  const controller = mount('123', config.missingBid);
  t.after(() => { controllers.forEach((value) => value.destroy()); window.close(); });
  await settle();
  function element<T extends Element = HTMLElement>(selector: string): T {
    const value = host.shadowRoot!.querySelector<T>(selector);
    assert.ok(value, `Missing ${selector}`);
    return value;
  }
  function input(selector: string, value: string) {
    element<HTMLInputElement>(selector).value = value;
    element(selector).dispatchEvent(new window.Event('input'));
  }
  return { window, host, controller, mount, element, input, bridge, listeners, messages, storageWrites, saved, releaseWatch, nativeMarkup,
    text: (selector: string) => element(selector).textContent ?? '',
    value: (selector: string) => element<HTMLInputElement>(selector).value,
  };
}

test('actual patched calculator visibly qualifies profit, ROI, budget and max outputs', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200', warnings: '["Tax on the fee is unverified."]' } });
  f.input('#lotlens-resale', '50');
  f.input('#lotlens-budget', '16.38');
  assert.equal(f.text('.lotlens-true-cost'), '$16.38');
  assert.match(f.text('.lotlens-profit-output'), /Estimated profit.*\$33\.62.*Estimated.*205% ROI.*extra costs excluded/i);
  assert.match(f.text('.lotlens-max-bid'), /Estimated max bid.*\$12\.50.*extra costs excluded/i);
  assert.match(f.text('label[for="lotlens-budget"]'), /Estimated budget.*extras excluded/i);
  assert.match(f.text('.lotlens-economics-status'), /Tax on the fee is unverified/);
  assert.equal(f.text('.lotlens-total-row span'), 'Bid subtotal');
  assert.doesNotMatch(f.element('.lotlens-panel').getAttribute('aria-label')!, /true cost/i);
  f.bridge({ fee: '200', complete: true });
  assert.doesNotMatch(f.text('.lotlens-profit-output'), /Estimated|excluded/i);
  assert.doesNotMatch(f.text('.lotlens-max-bid'), /Estimated|excluded/i);
  assert.equal(f.text('.lotlens-economics-status'), '');
});

test('reconciled auction premium reaches the panel without replacing a user correction', async (t) => {
  const f = await fixture(t, { premiumSource: 'parsed', bridge: { fee: '0', premium: '20', warnings: '["Payment rate needs confirmation."]' } });
  assert.equal(f.value('#lotlens-premium'), '20');
  assert.equal(f.text('.lotlens-true-cost'), '$15.00');
  assert.match(f.text('.lotlens-premium-source'), /premium reconciled: 20%/i);
  f.input('#lotlens-premium', '18');
  f.bridge({ fee: '0', premium: '25' });
  assert.equal(f.value('#lotlens-premium'), '18');
  assert.equal(f.text('.lotlens-true-cost'), '$14.75');
  assert.match(f.text('.lotlens-premium-source'), /premium set by you: 18%/i);
});

test('lost or wrong-lot premium evidence restores the parsed rate without erasing user edits', async (t) => {
  const f = await fixture(t, { premiumSource: 'parsed', bridge: { fee: '0', premium: '20' } });
  assert.equal(f.value('#lotlens-premium'), '20');
  f.bridge({ lotId: '456', fee: '0', premium: '30' });
  assert.equal(f.value('#lotlens-premium'), '15');
  assert.equal(f.text('.lotlens-true-cost'), '$14.38');
  assert.doesNotMatch(f.text('.lotlens-premium-source'), /reconciled/i);
  f.bridge({ fee: '0', premium: '21' });
  assert.equal(f.value('#lotlens-premium'), '21');
  f.bridge({ fee: '0', premium: 'invalid' });
  assert.equal(f.value('#lotlens-premium'), '15');
  f.input('#lotlens-premium', '18');
  f.bridge({ fee: '0', premium: '25' });
  f.bridge({ fee: '0', premium: '' });
  assert.equal(f.value('#lotlens-premium'), '18');
  assert.match(f.text('.lotlens-premium-source'), /premium set by you: 18%/i);
});

test('host events refresh forward, inverse and current-bid paths without doubling fees or writing state', async (t) => {
  const f = await fixture(t);
  f.input('#lotlens-budget', '16.38');
  f.input('#lotlens-resale', '50');
  f.input('#lotlens-note', 'My note');
  f.input('#lotlens-comps-query', 'Custom query');
  const fields = ['#lotlens-budget', '#lotlens-resale', '#lotlens-note', '#lotlens-premium', '#lotlens-state', '#lotlens-comps-query'];
  const values = fields.map(f.value);
  f.bridge({ fee: '200' });
  assert.equal(f.text('.lotlens-true-cost'), '$16.38');
  assert.match(f.text('.lotlens-max-bid'), /\$12\.50/);
  f.bridge({ fee: '300' });
  assert.equal(f.text('.lotlens-true-cost'), '$17.38');
  assert.match(f.text('.lotlens-max-bid'), /\$11\.63/);
  f.bridge({ fee: '300' });
  assert.equal(f.text('.lotlens-true-cost'), '$17.38');
  f.controller.updateBid(2000);
  assert.equal(f.text('.lotlens-current-bid-output'), '$20.00');
  assert.equal(f.text('.lotlens-true-cost'), '$26.00');
  assert.match(f.text('.lotlens-max-bid'), /\$11\.63/);
  assert.deepEqual(fields.map(f.value), values);
  assert.deepEqual(f.messages.map((m) => m.kind), ['watch:list']);
  assert.deepEqual(f.storageWrites, []);
  assert.equal(f.window.document.getElementById('hibid')!.outerHTML, f.nativeMarkup);
});

test('wrong-lot and absent/invalid fee data cannot verify zero or reuse stale fees', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200', complete: true } });
  f.input('#lotlens-budget', '16.38');
  f.bridge({ lotId: '456', fee: '900', complete: true });
  assert.equal(f.text('.lotlens-true-cost'), '$14.38');
  assert.match(f.text('.lotlens-max-bid'), /Estimated.*\$14\.24/);
  assert.match(f.text('.lotlens-economics-status'), /fees.*not verified/i);
  for (const fee of [undefined, '', ' ', '-1', '2.5', '1e2', 'NaN', 'Infinity', '9007199254740992']) {
    f.bridge({ fee, complete: true });
    assert.equal(f.text('.lotlens-true-cost'), '$14.38', `fee ${fee}`);
    assert.match(f.text('.lotlens-economics-status'), /fees.*not verified/i, `fee ${fee}`);
  }
  f.bridge({ fee: '0', complete: true });
  assert.equal(f.text('.lotlens-economics-status'), '');
});

test('saved budget restoration includes the fee, ignores stored shipping and retains hard max after events', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200' }, saved: {} });
  const savedBefore = JSON.stringify(f.saved);
  assert.equal(f.value('#lotlens-budget'), '16.38');
  assert.equal(f.value('#lotlens-note'), 'Saved note');
  assert.equal(f.text('.lotlens-true-cost'), '$16.38');
  assert.match(f.text('.lotlens-max-bid'), /Estimated saved max bid.*\$12\.50.*extra costs excluded/i);
  assert.equal(f.host.shadowRoot!.querySelector('#lotlens-shipping'), null);
  for (const fee of ['300', '0', '200']) {
    f.bridge({ fee });
    assert.match(f.text('.lotlens-max-bid'), /saved max bid.*\$12\.50/i);
    assert.equal(f.value('#lotlens-budget'), '16.38');
  }
  f.input('#lotlens-budget', f.value('#lotlens-budget'));
  assert.match(f.text('.lotlens-max-bid'), /\$12\.50/);
  assert.equal(JSON.stringify(f.saved), savedBefore);
  assert.deepEqual(f.messages.map((m) => m.kind), ['watch:list']);
  f.element('#lotlens-budget').dispatchEvent(new f.window.Event('change'));
  await settle();
  const write = f.messages.find((m) => m.kind === 'watch:add')!.lot!;
  assert.equal(write.shipCents, 0);
  assert.equal(write.maxBidCents, 1250);
  assert.equal(write.note, 'Saved note');
  assert.equal(Object.hasOwn(write, 'fixedFeeCents'), false);
});

test('late bridge preserves a restored saved hard max without changing inputs', async (t) => {
  const f = await fixture(t, { saved: {} });
  const before = f.value('#lotlens-budget');
  f.bridge({ fee: '200' });
  assert.equal(f.text('.lotlens-true-cost'), '$16.38');
  assert.match(f.text('.lotlens-max-bid'), /Estimated saved max bid.*\$12\.50/i);
  assert.equal(f.value('#lotlens-budget'), before);
});

test('economics events preserve a user premium override and tax settings', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200' } });
  f.input('#lotlens-premium', '20');
  f.element('#lotlens-premium').dispatchEvent(new f.window.Event('change'));
  await settle();
  const messages = JSON.stringify(f.messages);
  f.bridge({ fee: '300' });
  assert.equal(f.value('#lotlens-premium'), '20');
  assert.equal(f.text('.lotlens-premium-source'), 'premium set by you: 20%');
  assert.equal(f.text('.lotlens-true-cost'), '$18.00');
  assert.equal(f.value('#lotlens-state'), 'DE');
  assert.equal(JSON.stringify(f.messages), messages);
  assert.deepEqual(f.storageWrites, []);
});

test('missing-bid early return still refreshes status and provisional outputs', async (t) => {
  const f = await fixture(t, { missingBid: true });
  assert.match(f.text('.lotlens-economics-status'), /fees.*not verified/i);
  f.bridge({ fee: '200', complete: true });
  assert.equal(f.text('.lotlens-economics-status'), '');
  f.bridge({ fee: '200', warnings: '["Fee tax is unverified."]' });
  assert.match(f.text('.lotlens-economics-status'), /Fee tax is unverified/);
  assert.match(f.text('.lotlens-profit-output'), /Estimated.*current bid.*extra costs excluded/i);
  assert.match(f.text('.lotlens-max-bid'), /Estimated.*current bid.*extra costs excluded/i);
  f.input('#lotlens-current-bid', '12.50');
  assert.equal(f.text('.lotlens-true-cost'), '$16.38');
  f.input('#lotlens-current-bid', '');
  f.bridge({ fee: '0', complete: true });
  assert.equal(f.text('.lotlens-economics-status'), '');
});

test('destroy removes listener and a same-host SPA remount rejects the previous lot fee', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200' } });
  const oldOutput = f.element('.lotlens-true-cost');
  assert.equal(f.listeners.size, 1);
  f.controller.destroy();
  assert.equal(f.listeners.size, 0);
  f.bridge({ fee: '900' });
  assert.equal(oldOutput.textContent, '$16.38');
  const next = f.mount('456');
  await settle();
  assert.equal(f.text('.lotlens-true-cost'), '$14.38');
  assert.match(f.text('.lotlens-economics-status'), /fees.*not verified/i);
  f.bridge({ lotId: '456', fee: '100' });
  assert.equal(f.text('.lotlens-true-cost'), '$15.38');
  assert.equal(oldOutput.textContent, '$16.38');
  next.destroy();
  assert.equal(f.listeners.size, 0);
});

test('late saved-watch responses cannot update a destroyed calculator', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200' }, saved: {}, deferred: true });
  f.controller.destroy();
  f.releaseWatch([f.saved!]);
  await settle();
  assert.equal(f.value('#lotlens-budget'), '');
  assert.equal(f.value('#lotlens-note'), '');
});

test('unverified economics leaves normal sold-comps links clickable', async (t) => {
  const f = await fixture(t);
  f.input('#lotlens-comps-query', 'Buda custom search');
  for (const selector of ['.lotlens-comps-link', '.lotlens-deep-link']) {
    const link = f.element<HTMLAnchorElement>(selector);
    const url = new URL(link.href);
    assert.equal(url.hostname, 'www.ebay.com');
    assert.ok([...url.searchParams.values()].includes('Buda custom search'));
    assert.equal(link.target, '_blank');
    assert.equal(link.hasAttribute('disabled'), false);
    assert.equal(link.getAttribute('aria-disabled'), null);
    assert.equal(link.closest('[hidden]'), null);
    let defaultPrevented: boolean | undefined;
    link.addEventListener('click', (event) => { defaultPrevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.click();
    assert.equal(defaultPrevented, false);
  }
});

test('money wrapper retains baseline validation and forward/inverse rounding', () => {
  const input = { bidCents: 1250, premiumPct: 15, taxPct: 0, shipCents: 0, taxOnPremium: false, fixedFeeCents: 200 };
  assert.equal(forwardCost(input).trueCostCents, 1638);
  assert.equal(inverseBudget(1638, input), 1250);
  assert.equal(inverseBudget(199, input), null);
  for (const budget of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => inverseBudget(budget, input), RangeError);
  }
  assert.throws(() => forwardCost({ ...input, bidCents: Number.MAX_SAFE_INTEGER }), RangeError);
  assert.throws(() => inverseBudget(199, { ...input, premiumPct: -1 }), RangeError);
});

test('empty and below-fee outputs remain visibly provisional', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200' } });
  assert.match(f.text('.lotlens-profit-output'), /Estimated.*enter resale value.*extra costs excluded/i);
  assert.match(f.text('.lotlens-max-bid'), /Estimated.*enter budget.*extra costs excluded/i);
  f.input('#lotlens-budget', '1.99');
  assert.match(f.text('.lotlens-max-bid'), /Estimated.*unavailable.*below fees and tax.*extra costs excluded/i);
});

test('malformed warnings cannot certify economics and warning strings render as text', async (t) => {
  const f = await fixture(t, { bridge: { fee: '200', complete: true } });
  for (const warnings of ['', '{}', '[42]', 'null']) {
    f.bridge({ fee: '200', complete: true, warnings });
    assert.match(f.text('.lotlens-economics-status'), /fees.*not verified/i);
  }
  f.bridge({ fee: '200', warnings: '["<img src=x onerror=alert(1)> fee tax unverified"]' });
  assert.match(f.text('.lotlens-economics-status'), /<img src=x/);
  assert.equal(f.element('.lotlens-economics-status').querySelector('img'), null);
});

test('build patch rejects unexpected math, status, restoration and teardown markers', async () => {
  const baseline = await readFile(asset, 'utf8');
  assert.throws(() => patchLegacyAuctionEconomics(baseline), /RemoveShipping and RemoveCatalog/);
  const ready = patchLegacyRemoveCatalogChips(patchLegacyRemoveShipping(patchLegacyEbayQueryModule(baseline)));
  for (const marker of ['a=ne({...n,bidCents:i.bidCents});', 'let o=te(i.budgetCents,n);i.maxBidCents=o',
    'let F=()=>{let e=t.settings.taxExempt', 'shipCents:0,taxOnPremium:i.taxOnPremium,bidCents:wi.maxBidCents}',
    'destroy(){f.removeEventListener(`input`,I)']) {
    assert.ok(ready.includes(marker));
    assert.throws(() => patchLegacyAuctionEconomics(ready.replace(marker, 'unexpected')), /Unexpected legacy economics/);
    assert.throws(() => patchLegacyAuctionEconomics(ready + marker), /Unexpected legacy economics/);
  }
});
