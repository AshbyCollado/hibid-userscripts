import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installLotPanelRecovery } from '../src/legacy/lot-panel-recovery.js';
// @ts-expect-error Build-time patch module is JavaScript without declarations.
import { patchLegacyEbayQueryModule, patchLegacyRemoveCatalogChips, patchLegacyRemoveShipping } from '../scripts/legacy-ebay-query.mjs';
// @ts-expect-error Build-time patch module is JavaScript without declarations.
import { patchLegacyAuctionEconomics } from '../scripts/legacy-auction-economics.mjs';
// @ts-expect-error Build-time patch module is JavaScript without declarations.
import { patchLegacyLotPanelRecovery } from '../scripts/legacy-lot-panel-recovery.mjs';

type TestWindow = Window & typeof globalThis;

function useDom(html = '<main><div class="target"></div><div class="bid">$1.00</div></main>'): { dom: JSDOM; window: TestWindow; cleanup: () => void } {
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://hibid.com/lot/123/example' });
  const window = dom.window as unknown as TestWindow;
  const previous = new Map<string, unknown>();
  for (const key of ['document', 'MutationObserver', 'location']) {
    previous.set(key, (globalThis as Record<string, unknown>)[key]);
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof TestWindow] });
  }
  return {
    dom,
    window,
    cleanup: () => {
      for (const [key, value] of previous) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
        else Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      dom.window.close();
    },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

const legacyIndexAsset = path.resolve('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js');
const legacyHelperPath = path.resolve('src/legacy/lot-panel-recovery.ts');

async function transformedLegacyIndex(): Promise<string> {
  const source = await readFile(legacyIndexAsset, 'utf8');
  return patchLegacyAuctionEconomics(patchLegacyRemoveCatalogChips(patchLegacyRemoveShipping(patchLegacyEbayQueryModule(source))));
}

function host(document: Document): HTMLElement {
  const value = document.createElement('div');
  value.id = 'lotlens-root';
  value.attachShadow({ mode: 'open' }).innerHTML = '<input value="">';
  return value;
}

function install(document: Document, value: HTMLElement, signal: AbortSignal, updates: number[], insertHost = (next: HTMLElement) => document.querySelector('.target')?.after(next)) {
  return installLotPanelRecovery({
    host: value,
    signal,
    routeHref: document.location.href,
    getBidNode: () => document.querySelector('.bid'),
    parseBid: () => Number.parseFloat(document.querySelector('.bid')?.textContent?.replace('$', '') ?? '') * 100,
    updateBid: (bid) => updates.push(bid),
    insertHost,
  });
}

test('keeps the original host identity when nothing removes it', () => {
  const env = useDom();
  try {
    const value = host(env.window.document);
    env.window.document.querySelector('.target')!.after(value);
    const updates: number[] = [];
    const handle = install(env.window.document, value, new AbortController().signal, updates);
    assert.equal(env.window.document.querySelector('#lotlens-root'), value);
    assert.equal(updates.at(-1), 100);
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('recovers the same host and preserves shadow inputs and handlers after same-URL removal', async () => {
  const env = useDom();
  try {
    const value = host(env.window.document);
    const input = value.shadowRoot!.querySelector('input')! as HTMLInputElement;
    input.value = 'typed budget';
    let clicks = 0;
    input.addEventListener('change', () => clicks += 1);
    env.window.document.querySelector('.target')!.after(value);
    const handle = install(env.window.document, value, new AbortController().signal, []);
    value.remove();
    await settle();
    assert.equal(env.window.document.querySelector('#lotlens-root'), value);
    assert.equal((value.shadowRoot!.querySelector('input') as HTMLInputElement).value, 'typed budget');
    input.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    assert.equal(clicks, 1);
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('waits for a missing insertion target and recovers when it returns', async () => {
  const env = useDom('<div class="bid">$1.00</div>');
  try {
    const value = host(env.window.document);
    const handle = install(env.window.document, value, new AbortController().signal, []);
    await settle();
    assert.equal(value.isConnected, false);
    const target = env.window.document.createElement('div');
    target.className = 'target';
    env.window.document.body.append(target);
    await settle();
    assert.equal(value.isConnected, true);
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('refreshes the bid callback when the native bid node is replaced', async () => {
  const env = useDom();
  try {
    const value = host(env.window.document);
    env.window.document.querySelector('.target')!.after(value);
    const updates: number[] = [];
    const handle = install(env.window.document, value, new AbortController().signal, updates);
    const replacement = env.window.document.createElement('div');
    replacement.className = 'bid';
    replacement.textContent = '$2.50';
    env.window.document.querySelector('.bid')!.replaceWith(replacement);
    await settle();
    assert.equal(updates.at(-1), 250);
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('keeps ordered native selector priority across preferred-node replacement and mutation', async () => {
  const env = useDom('<div class="target"></div><div class="fallback">$1.00</div><div class="preferred">$2.00</div>');
  try {
    const value = host(env.window.document);
    env.window.document.querySelector('.target')!.after(value);
    const updates: number[] = [];
    const handle = installLotPanelRecovery({
      host: value,
      signal: new AbortController().signal,
      routeHref: env.window.document.location.href,
      getBidNode: () => env.window.document.querySelector('.preferred') ?? env.window.document.querySelector('.fallback'),
      parseBid: () => Number.parseFloat((env.window.document.querySelector('.preferred') ?? env.window.document.querySelector('.fallback'))?.textContent?.replace('$', '') ?? '') * 100,
      updateBid: (bid) => updates.push(bid),
      insertHost: (next) => env.window.document.querySelector('.target')?.after(next),
    });
    assert.equal(updates.at(-1), 200);
    const replacement = env.window.document.createElement('div');
    replacement.className = 'preferred';
    replacement.textContent = '$3.00';
    env.window.document.querySelector('.preferred')!.replaceWith(replacement);
    await settle();
    replacement.textContent = '$4.00';
    await settle();
    assert.equal(updates.at(-1), 400);
    assert.ok(updates.includes(300));
    assert.ok(!updates.includes(100));
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('stops recovery after abort or route drift', async () => {
  const env = useDom();
  try {
    const value = host(env.window.document);
    env.window.document.querySelector('.target')!.after(value);
    const controller = new AbortController();
    const handle = install(env.window.document, value, controller.signal, []);
    value.remove();
    controller.abort();
    await settle();
    assert.equal(value.isConnected, false);
    handle.disconnect();

    const second = host(env.window.document);
    env.window.document.querySelector('.target')!.after(second);
    const secondHandle = install(env.window.document, second, new AbortController().signal, []);
    env.window.history.pushState({}, '', '/lot/999/other');
    second.remove();
    await settle();
    assert.equal(second.isConnected, false);
    secondHandle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('does not create duplicate hosts or repeated insertion loops', async () => {
  const env = useDom();
  try {
    const value = host(env.window.document);
    env.window.document.querySelector('.target')!.after(value);
    let insertions = 0;
    const handle = install(env.window.document, value, new AbortController().signal, [], (next) => {
      insertions += 1;
      env.window.document.querySelector('.target')?.after(next);
    });
    value.remove();
    await settle();
    await settle();
    assert.equal(insertions, 1);
    assert.equal(env.window.document.querySelectorAll('#lotlens-root').length, 1);
    handle.disconnect();
  } finally {
    env.cleanup();
  }
});

test('bridges recovery into the transformed legacy index mount with exact emitted symbols', async () => {
  const source = await transformedLegacyIndex();
  const patched = patchLegacyLotPanelRecovery(source, legacyHelperPath);
  assert.match(patched, /installLotPanelRecovery/);
  assert.match(patched, /host:l,signal:n,routeHref:location\.href,getBidNode:\(\)=>e\(document,t\.currentBid\),parseBid:.*parsed=r\(document,location\.href\)/);
  assert.doesNotMatch(patched, /l2|n5|n3\.currentBid|S\(document|currentBid\.join/);
  assert.equal(patched.split('let l=document.createElement(`div`);l.id=L,K(l),B=D(l,{parseResult:i,premium:s,settings:o,isPro:c});').length, 2);
});

test('fails closed when the transformed index mount anchor is missing or duplicated', async () => {
  const source = await transformedLegacyIndex();
  const mount = 'let l=document.createElement(`div`);l.id=L,K(l),B=D(l,{parseResult:i,premium:s,settings:o,isPro:c});';
  assert.throws(() => patchLegacyLotPanelRecovery(source.replace(mount, ''), legacyHelperPath), /found 0/);
  assert.throws(() => patchLegacyLotPanelRecovery(`${source}${mount}`, legacyHelperPath), /found 2/);
});
