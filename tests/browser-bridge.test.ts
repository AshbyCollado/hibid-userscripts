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
