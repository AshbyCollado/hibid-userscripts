import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { currentViewRenderKey } from '../src/popup/render-key.js';
import type { PageContext } from '../src/core/types.js';

test('popup polling preserves the current view for same-phase progress updates', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');

  assert.match(popup, /lastCurrentRenderKey/);
  assert.match(popup, /function patchCurrentView\(\): void/);
  assert.match(popup, /status\?\.nextElementSibling\?\.classList\.contains\('progress'\)/);
  assert.match(popup, /#copy-llm, #copy-json/);
  assert.match(popup, /await render\(\{ preserveCurrent: true \}\);/);
  assert.match(popup, /toastFromRefreshError = true;[\s\S]*await render\(\);/);
});

test('past-auction groups appearing after initial load force a selector rerender', () => {
  const base = {
    supported: true,
    fingerprint: 'past-auction-route',
    url: 'https://hibid.com/account/pastbidsm',
    route: { kind: 'pastbids' },
    analysis: { phase: 'idle' },
  } as PageContext;
  const before = currentViewRenderKey('current', { ...base, auctionGroups: [] }, '', null);
  const after = currentViewRenderKey('current', {
    ...base,
    auctionGroups: [{ id: 'auction-1', title: 'Sale One', location: 'TX' }],
  }, '', null);
  assert.notEqual(before, after);
  assert.equal(after, currentViewRenderKey('current', {
    ...base,
    auctionGroups: [{ id: 'auction-1', title: 'Sale One', location: 'TX' }],
  }, '', null));
});
