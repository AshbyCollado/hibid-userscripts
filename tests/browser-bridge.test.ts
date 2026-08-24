import assert from 'node:assert/strict';
import test from 'node:test';

test('active tab discovery falls back to Firefox last-focused popup ownership', async () => {
  const queries: chrome.tabs.QueryInfo[] = [];
  (globalThis as any).chrome = {
    runtime: { lastError: null },
    tabs: {
      query(queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
        queries.push(queryInfo);
        callback(queryInfo.currentWindow
          ? []
          : [{ id: 42, active: true, url: 'https://hibid.com/catalog/765226/example' } as chrome.tabs.Tab]);
      }
    }
  };
  const { activeTab } = await import(`../src/core/browser.js?test=${Date.now()}`);
  const tab = await activeTab();
  assert.equal(tab?.id, 42);
  assert.deepEqual(queries, [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true }
  ]);
});

test('direct popup debugging reconnects to the most recently accessed HiBid tab', async () => {
  (globalThis as any).chrome = {
    runtime: { lastError: null },
    tabs: {
      query(queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
        if (queryInfo.active) callback([{ id: 9, active: true, url: 'chrome-extension://abc/popup/index.html' } as chrome.tabs.Tab]);
        else callback([
          { id: 20, active: false, lastAccessed: 100, url: 'https://hibid.com/catalog/20/older' },
          { id: 30, active: false, lastAccessed: 200, url: 'https://hibid.com/lot/30/newer' },
        ] as chrome.tabs.Tab[]);
      }
    }
  };
  const { activeTab } = await import(`../src/core/browser.js?direct=${Date.now()}`);
  assert.equal((await activeTab())?.id, 30);
});
