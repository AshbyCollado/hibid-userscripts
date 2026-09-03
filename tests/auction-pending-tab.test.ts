import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  AuctionPendingTabController,
  FLIPPAH_AUCTION_PENDING_TTL_MS,
  auctionPendingUrl,
  reservationKey,
  validateAuctionHandoffNonce,
  validateAuctionPendingReservation,
  type AuctionPendingReservationStore,
  type AuctionPendingTabApi,
  type AuctionPendingTabSnapshot,
} from '../src/core/auction-pending-tab.js';
import { runHibidAuctionHandoff } from '../src/content/auction-handoff-flow.js';
import type { HiBidTransport } from '../src/core/types.js';

const sourceUrl = 'https://hibid.com/lot/317135308/books?ref=catalog';
const nonce = '11111111-1111-4111-8111-111111111111';
const lotId = '22222222-2222-4222-8222-222222222222';
const initiatedAt = '2026-08-26T12:00:00.000Z';
const owner = { sourceTabId: 17, sourceEventItemId: '317135308', nonce, initiatedAt };

class MemoryStore implements AuctionPendingReservationStore {
  readonly values = new Map<string, unknown>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async remove(key: string) { this.values.delete(key); }
}

class MemoryTabs implements AuctionPendingTabApi {
  readonly tabs = new Map<number, AuctionPendingTabSnapshot>();
  readonly calls: string[] = [];
  nextId = 90;
  async create(properties: { url: string; active: true }) {
    this.calls.push(`create:${properties.url}`);
    const tab = { id: this.nextId++, url: properties.url };
    this.tabs.set(tab.id, tab);
    return tab;
  }
  async get(tabId: number) {
    this.calls.push(`get:${tabId}`);
    return this.tabs.get(tabId) || null;
  }
  async update(tabId: number, properties: { url: string; active: true }) {
    this.calls.push(`update:${tabId}:${properties.url}`);
    const current = this.tabs.get(tabId);
    if (!current) throw new Error('missing tab');
    const tab = { id: tabId, url: properties.url };
    this.tabs.set(tabId, tab);
    return tab;
  }
  async remove(tabId: number) {
    this.calls.push(`remove:${tabId}`);
    this.tabs.delete(tabId);
  }
}

function controller(tabs = new MemoryTabs(), store = new MemoryStore()) {
  return { tabs, store, value: new AuctionPendingTabController(tabs, store, () => '2026-08-26T12:00:00.000Z') };
}

function rawLot() {
  return {
    id: 317135308,
    itemId: 99123,
    lotNumber: '308',
    lead: 'Books',
    description: 'Book lot',
    pictureCount: 1,
    pictures: [{
      description: 'Seller photo 1',
      fullSizeLocation: 'https://cdn.hibid.com/lot-317135308-1.jpg',
      width: 1600,
      height: 1200,
    }],
    auction: { id: 765226, currencyAbbreviation: 'USD' },
    lotState: { status: 'OPEN' },
  };
}

test('pending route is exact and carries no authentication secret in the URL', () => {
  assert.equal(
    auctionPendingUrl(8080, owner),
    `http://localhost:8080/auction-lots?pendingProvider=hibid&pendingEventItemId=317135308&pendingSince=2026-08-26T12%3A00%3A00.000Z&launch=${nonce}`,
  );
  assert.equal(validateAuctionHandoffNonce(nonce), nonce);
  assert.equal(reservationKey(nonce), `flippahAuctionPendingV1:${nonce}`);
  assert.doesNotMatch(auctionPendingUrl(8080, owner), /token|authorization|cookie|bearer/i);
  assert.throws(() => auctionPendingUrl(80, owner), /port is invalid/i);
  assert.throws(() => validateAuctionHandoffNonce('guessable'), /nonce is invalid/i);
});

test('prepare persists a source/event/nonce/target reservation and service-worker restart reuses one tab', async () => {
  const { tabs, store, value } = controller();
  const first = await value.prepare(owner, 8080);
  assert.equal(first.target_tab_id, 90);
  assert.equal(first.pending_url, auctionPendingUrl(8080, owner));
  assert.deepEqual(validateAuctionPendingReservation(store.values.get(reservationKey(nonce))), first);
  const restarted = new AuctionPendingTabController(tabs, store, () => '2026-08-26T12:00:00.000Z');
  const recovered = await restarted.prepare(owner, 8080);
  assert.deepEqual(recovered, first);
  assert.equal(tabs.calls.filter((call) => call.startsWith('create:')).length, 1);
});

test('accepted handoff leaves the pending document in place for in-app resolution', async () => {
  const { tabs, store, value } = controller();
  const reservation = await value.prepare(owner, 8080);
  await value.assertReady(owner);
  assert.equal(await value.complete(owner, `http://localhost:8080/auction-lots/${lotId}`), 'pending');
  assert.equal(tabs.tabs.get(90)?.url, reservation.pending_url);
  assert.equal(tabs.calls.filter((call) => call.startsWith('create:')).length, 1);
  assert.equal(tabs.calls.filter((call) => call.startsWith('update:')).length, 0);
  assert.equal(store.values.has(reservationKey(nonce)), false);
});

test('completion recognizes an in-document route replacement without navigating the tab', async () => {
  const { tabs, value } = controller();
  await value.prepare(owner, 8080);
  tabs.tabs.set(90, { id: 90, url: `http://localhost:8080/auction-lots/${lotId}` });
  assert.equal(await value.complete(owner, `http://localhost:8080/auction-lots/${lotId}`), 'resolved');
  assert.equal(tabs.calls.some((call) => call.startsWith('update:')), false);
});

test('owner, event, nonce, port, and accepted-path mismatches fail closed', async () => {
  const { value } = controller();
  await value.prepare(owner, 8080);
  await assert.rejects(value.assertReady({ ...owner, sourceTabId: 18 }), /owner does not match/i);
  await assert.rejects(value.assertReady({ ...owner, sourceEventItemId: '317135307' }), /owner does not match/i);
  await assert.rejects(value.assertReady({ ...owner, initiatedAt: '2026-08-26T12:00:01.000Z' }), /owner does not match/i);
  await assert.rejects(value.assertReady({ ...owner, nonce: '33333333-3333-4333-8333-333333333333' }), /reservation is missing/i);
  await assert.rejects(value.complete(owner, `http://localhost:9000/auction-lots/${lotId}`), /does not match/i);
  await assert.rejects(value.complete(owner, 'http://localhost:8080/settings'), /does not match/i);
  await assert.rejects(value.complete(owner, `https://localhost:8080/auction-lots/${lotId}`), /does not match/i);
});

test('a user-navigated target is never updated, closed, or replaced', async () => {
  const { tabs, store, value } = controller();
  await value.prepare(owner, 8080);
  tabs.tabs.set(90, { id: 90, url: 'https://example.com/user-page' });
  assert.equal(await value.complete(owner, `http://localhost:8080/auction-lots/${lotId}`), 'navigated');
  assert.equal(tabs.tabs.get(90)?.url, 'https://example.com/user-page');
  assert.equal(tabs.calls.some((call) => call.startsWith('update:')), false);
  assert.equal(tabs.calls.some((call) => call.startsWith('remove:')), false);
  assert.equal(tabs.calls.filter((call) => call.startsWith('create:')).length, 1);
  assert.equal(store.values.has(reservationKey(nonce)), false);
});

test('a closed target reports missing and never creates a replacement popup', async () => {
  const { tabs, value } = controller();
  await value.prepare(owner, 8080);
  tabs.tabs.delete(90);
  assert.equal(await value.complete(owner, `http://localhost:8080/auction-lots/${lotId}`), 'missing');
  assert.equal(tabs.calls.filter((call) => call.startsWith('create:')).length, 1);
});

test('failure cleanup closes only an exact pending or still-loading pending page', async () => {
  const exact = controller();
  await exact.value.prepare(owner, 8080);
  assert.deepEqual(await exact.value.cancel(owner), { closed: true });
  assert.equal(exact.tabs.tabs.has(90), false);

  const loading = controller();
  await loading.value.prepare(owner, 8080);
  loading.tabs.tabs.set(90, { id: 90, url: 'chrome-error://chromewebdata/', pendingUrl: auctionPendingUrl(8080, owner) });
  assert.deepEqual(await loading.value.cancel(owner), { closed: true });
  assert.equal(loading.tabs.tabs.has(90), false);

  const navigated = controller();
  await navigated.value.prepare(owner, 8080);
  navigated.tabs.tabs.set(90, { id: 90, url: 'https://example.com/' });
  assert.deepEqual(await navigated.value.cancel(owner), { closed: false });
  assert.equal(navigated.tabs.tabs.get(90)?.url, 'https://example.com/');
});

test('an existing closed reservation never spawns an automatic replacement popup', async () => {
  const { tabs, value } = controller();
  await value.prepare(owner, 8080);
  tabs.tabs.delete(90);
  await assert.rejects(value.prepare(owner, 8080), /no replacement tab was opened/i);
  assert.equal(tabs.calls.filter((call) => call.startsWith('create:')).length, 1);
});

test('an expired crash reservation closes only its still-owned pending tab', async () => {
  const tabs = new MemoryTabs();
  const store = new MemoryStore();
  let now = '2026-08-26T12:00:00.000Z';
  const value = new AuctionPendingTabController(tabs, store, () => now);
  await value.prepare(owner, 8080);
  now = new Date(Date.parse(now) + FLIPPAH_AUCTION_PENDING_TTL_MS).toISOString();
  assert.deepEqual(await value.expire(nonce), { expired: true, closed: true });
  assert.equal(tabs.tabs.has(90), false);
  assert.equal(store.values.has(reservationKey(nonce)), false);
  assert.deepEqual(await value.expire(nonce), { expired: false, closed: false });

  const navigated = new AuctionPendingTabController(tabs, store, () => now);
  const laterOwner = { ...owner, nonce: '44444444-4444-4444-8444-444444444444',
    initiatedAt: now };
  await navigated.prepare(laterOwner, 8080);
  tabs.tabs.set(91, { id: 91, url: 'https://example.com/owner-navigation' });
  now = new Date(Date.parse(now) + FLIPPAH_AUCTION_PENDING_TTL_MS).toISOString();
  assert.deepEqual(await navigated.expire(laterOwner.nonce), { expired: true, closed: false });
  assert.equal(tabs.tabs.get(91)?.url, 'https://example.com/owner-navigation');
});

test('content flow reserves the PWA before exact GraphQL hydration, then hands off once', async () => {
  const events: string[] = [];
  const transport: HiBidTransport = {
    searchLots: async () => { throw new Error('unused'); },
    hydrateLots: async () => {
      events.push('hydrate');
      return { data: { lot: { accessability: 'ACCESSIBLE', lot: rawLot() } } };
    },
  };
  const dom = new JSDOM('<title>Books</title><body>Book lot</body>', { url: sourceUrl });
  const accepted = await runHibidAuctionHandoff(dom.window.document, transport, {
    currentUrl: () => sourceUrl,
    nonce: () => nonce,
    send: async <T>(type: string) => {
      events.push(type);
      if (type === 'flippah:auction.handoff') return { lot_id: lotId, lot_url: `http://localhost:8080/auction-lots/${lotId}`, accepted_at: '2026-08-26T12:00:00Z' } as T;
      return { prepared: true } as T;
    },
  }, (count) => events.push(`sending:${count}`));
  assert.equal(accepted.lot_id, lotId);
  assert.deepEqual(events, ['flippah:auction.prepare', 'hydrate', 'sending:1', 'flippah:auction.handoff']);
});

test('challenge detection opens no tab and hydration failure requests owned cleanup', async () => {
  const challenge = new JSDOM('<title>Just a moment...</title><body>Verify you are human</body>', { url: sourceUrl });
  const calls: string[] = [];
  const unused: HiBidTransport = {
    searchLots: async () => { throw new Error('unused'); },
    hydrateLots: async () => { calls.push('hydrate'); return {}; },
  };
  await assert.rejects(runHibidAuctionHandoff(challenge.window.document, unused, {
    currentUrl: () => sourceUrl,
    nonce: () => nonce,
    send: async <T>(type: string) => { calls.push(type); return {} as T; },
  }, () => undefined), /complete it/i);
  assert.deepEqual(calls, []);

  const ordinary = new JSDOM('<title>Books</title><body>Book lot</body>', { url: sourceUrl });
  const failureCalls: string[] = [];
  const failing: HiBidTransport = {
    searchLots: async () => { throw new Error('unused'); },
    hydrateLots: async () => { failureCalls.push('hydrate'); throw new Error('GraphQL unavailable'); },
  };
  await assert.rejects(runHibidAuctionHandoff(ordinary.window.document, failing, {
    currentUrl: () => sourceUrl,
    nonce: () => nonce,
    send: async <T>(type: string) => { failureCalls.push(type); return {} as T; },
  }, () => undefined), /GraphQL unavailable/i);
  assert.deepEqual(failureCalls, ['flippah:auction.prepare', 'hydrate', 'flippah:auction.cancel']);
});

test('a challenge appearing after hydration cancels the reservation without relay handoff', async () => {
  const dom = new JSDOM('<title>Books | HiBid</title><body>Book lot</body>', { url: sourceUrl });
  const messages: string[] = [];
  const transport: HiBidTransport = {
    searchLots: async () => { throw new Error('search is not used'); },
    hydrateLots: async () => {
      dom.window.document.title = 'Just a moment...';
      dom.window.document.body.textContent = 'Verify you are human';
      return { data: { lot: { accessability: 'ACCESSIBLE', lot: rawLot() } } };
    },
  };
  await assert.rejects(
    runHibidAuctionHandoff(dom.window.document, transport, {
      send: async <T>(type: string) => {
        messages.push(type);
        return undefined as T;
      },
      nonce: () => 'challenge-after-hydration',
      currentUrl: () => sourceUrl,
    }, () => undefined),
    /challenge/i,
  );
  assert.deepEqual(messages, ['flippah:auction.prepare', 'flippah:auction.cancel']);
});

test('a challenge appearing immediately before handoff cancels without sending the manifest', async () => {
  const dom = new JSDOM('<title>Books | HiBid</title><body>Book lot</body>', { url: sourceUrl });
  const messages: string[] = [];
  await assert.rejects(
    runHibidAuctionHandoff(dom.window.document, {
      searchLots: async () => { throw new Error('search is not used'); },
      hydrateLots: async () => ({ data: { lot: { accessability: 'ACCESSIBLE', lot: rawLot() } } }),
    }, {
      send: async <T>(type: string) => {
        messages.push(type);
        return undefined as T;
      },
      nonce: () => 'challenge-before-send',
      currentUrl: () => sourceUrl,
    }, () => {
      dom.window.document.title = 'Attention required';
      dom.window.document.body.textContent = 'captcha';
    }),
    /challenge/i,
  );
  assert.deepEqual(messages, ['flippah:auction.prepare', 'flippah:auction.cancel']);
});

test('a lost prepare response still cancels the exact nonce for restart-safe cleanup', async () => {
  const ordinary = new JSDOM('<title>Books</title><body>Book lot</body>', { url: sourceUrl });
  const calls: string[] = [];
  const transport: HiBidTransport = {
    searchLots: async () => { throw new Error('unused'); },
    hydrateLots: async () => { calls.push('hydrate'); return {}; },
  };
  await assert.rejects(runHibidAuctionHandoff(ordinary.window.document, transport, {
    currentUrl: () => sourceUrl,
    nonce: () => nonce,
    send: async <T>(type: string) => {
      calls.push(type);
      if (type === 'flippah:auction.prepare') throw new Error('service worker restarted after storing');
      return {} as T;
    },
  }, () => undefined), /worker restarted/i);
  assert.deepEqual(calls, ['flippah:auction.prepare', 'flippah:auction.cancel']);
});
