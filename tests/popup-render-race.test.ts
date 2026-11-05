import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = (async () => {
  const result = await build({
    entryPoints: ['src/popup/index.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
  });
  return result.outputFiles[0]!.text;
})();

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a stale watchlist render cannot replace the scraper selected while it is pending', async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: 'chrome-extension://test/popup/index.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const pending = new Map<string, Array<(response: unknown) => void>>();
  const calls = new Map<string, number>();
  const watchlist = [{
    title: 'Old watchlist card',
    lotId: 'old-1',
    url: 'https://hibid.com/lot/1/old-watchlist-card',
    imageUrl: '',
    auctioneerName: 'Old auctioneer',
    currentBidCents: 100,
    maxBidCents: null,
    endsAt: Date.now() + 60_000,
    note: '',
  }];
  const sendMessage = (message: { kind?: string }, callback: (response: unknown) => void) => {
    const kind = message.kind || '';
    calls.set(kind, (calls.get(kind) || 0) + 1);
    const queue = pending.get(kind) || [];
    queue.push(callback);
    pending.set(kind, queue);
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      lastError: undefined,
      sendMessage,
      openOptionsPage() {},
    },
    storage: {
      sync: {
        get: (_keys: unknown, callback: (value: Record<string, unknown>) => void) => callback({}),
        set: (_value: unknown, callback: () => void) => callback(),
      },
      local: {
        get: (_keys: unknown, callback: (value: Record<string, unknown>) => void) => callback({}),
        set: (_value: unknown, callback: () => void) => callback(),
      },
      onChanged: { addListener() {} },
    },
    tabs: {
      query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback([]),
      sendMessage,
    },
  };
  Object.assign(window, { chrome });
  window.eval(await bundle);

  const resolveNext = (kind: string, response: unknown) => {
    const callback = pending.get(kind)?.shift();
    assert.ok(callback, `Expected pending ${kind} callback`);
    callback(response);
  };
  const waitForCalls = async (kind: string, count: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((calls.get(kind) || 0) >= count) return;
      await settle();
    }
    assert.fail(`Timed out waiting for ${count} ${kind} calls`);
  };

  try {
    await waitForCalls('watch:list', 2);
    await waitForCalls('outcome:list', 2);
    resolveNext('watch:list', watchlist);
    resolveNext('outcome:list', []);
    await settle();

    const watchlistTab = window.document.querySelector<HTMLButtonElement>('[data-tab="watchlist"]');
    assert.ok(watchlistTab);
    watchlistTab.click();
    await waitForCalls('watch:list', 3);
    await waitForCalls('outcome:list', 3);

    const scraperTab = window.document.querySelector<HTMLButtonElement>('[data-tab="current"]');
    assert.ok(scraperTab);
    scraperTab.click();
    resolveNext('watch:list', watchlist);
    resolveNext('outcome:list', []);
    await settle();
    await settle();

    assert.equal(window.document.querySelector<HTMLButtonElement>('[data-tab="current"]')?.getAttribute('aria-selected'), 'true');
    assert.equal(window.document.querySelector('.watch-title'), null);
    assert.match(window.document.querySelector('.panel')?.textContent || '', /Open a supported auction page/);
  } finally {
    window.close();
  }
});
