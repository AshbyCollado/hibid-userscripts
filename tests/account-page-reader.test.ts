import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountPageReader, type AccountReaderApis } from '../src/background/account-page-reader.js';

const url = 'https://hibid.com/account/watchlist';
const item = { id: '1', eventItemId: '1' };
const snapshot = (pageUrl = url) => ({
  url: pageUrl,
  expectedTotal: 1,
  visibleCount: 1,
  page: 1,
  items: [item],
});
const selectedGroup = {
  id: '99',
  title: 'Past auction',
  catalogUrl: 'https://hibid.com/catalog/99',
  location: '',
  dateText: '',
};

type Fake = AccountReaderApis & {
  removed: number[];
  sent: unknown[];
  created: chrome.tabs.CreateProperties[];
  setValues: unknown[];
  alarms: number;
  setOwnerUrl(value: string): void;
  setChildUrl(value: string | undefined): void;
  setNow(value: number): void;
};

function fake(overrides: Partial<AccountReaderApis> = {}): Fake {
  let ownerUrl = url;
  let childUrl: string | undefined = url;
  let childUrlOverride = false;
  let registrations: unknown;
  let now = 0;
  const removed: number[] = [];
  const sent: unknown[] = [];
  const created: chrome.tabs.CreateProperties[] = [];
  const setValues: unknown[] = [];
  let alarms = 0;
  const base: AccountReaderApis = {
    createTab: async (properties) => {
      created.push(properties);
      if (!childUrlOverride) childUrl = properties.url;
      return { id: 42, url: properties.url };
    },
    getTab: async (tabId) => tabId === 7
      ? { id: 7, url: ownerUrl }
      : tabId === 42 && childUrl !== undefined ? { id: 42, url: childUrl } : null,
    removeTab: async (tabId) => { removed.push(tabId); },
    sendMessage: async () => { sent.push('message'); return snapshot(childUrl || url); },
    sessionGet: async () => registrations,
    sessionSet: async (value) => { registrations = value; setValues.push(value); },
    sessionRemove: async () => { registrations = undefined; },
    createAlarm: async () => { alarms += 1; },
    now: () => now,
  };
  const apis = { ...base, ...overrides } as Fake;
  apis.removed = removed;
  apis.sent = sent;
  apis.created = created;
  apis.setValues = setValues;
  Object.defineProperty(apis, 'alarms', { get: () => alarms });
  apis.setOwnerUrl = (value) => { ownerUrl = value; };
  apis.setChildUrl = (value) => { childUrlOverride = true; childUrl = value; };
  apis.setNow = (value) => { now = value; };
  return apis;
}

function reader(apis: AccountReaderApis, options: { timeoutMs?: number; pollMs?: number } = {}) {
  return createAccountPageReader(apis, { timeoutMs: 20, pollMs: 1, ...options });
}

test('creates an inactive child from the owner tab and returns a normalized snapshot', async () => {
  const apis = fake();
  const result = await reader(apis).read(7, { url });
  assert.deepEqual(result.items[0], item);
  assert.deepEqual(apis.created, [{ url, active: false }]);
  assert.deepEqual(apis.sent, ['message']);
  assert.deepEqual(apis.removed, [42]);
});

test('allows only apage and selected history auctionid to differ from the source scope', async () => {
  const source = 'https://hibid.com/account/pastbids?filter=active&apage=2';
  const target = `${source}&auctionid=99`;
  const apis = fake();
  apis.setOwnerUrl(source);
  await reader(apis).read(7, { url: target, selectedGroup });
  assert.equal(apis.created[0]?.url, target);
});

test('accepts canonical account route casing and trailing slash variants', async () => {
  const source = 'https://HIBID.com/account/PastBids/';
  const target = 'https://hibid.com/account/pastbids?auctionid=99';
  const apis = fake();
  apis.setOwnerUrl(source);
  await reader(apis).read(7, { url: target, selectedGroup });
  assert.equal(apis.created[0]?.url, target);
});

test('accepts state-prefixed pagination within the same account route scope', async () => {
  const source = 'https://hibid.com/newjersey/account/pastbids?filter=active&apage=2';
  const target = 'https://hibid.com/newjersey/account/pastbids?filter=active&apage=3&auctionid=99';
  const apis = fake();
  apis.setOwnerUrl(source);
  await reader(apis).read(7, { url: target, selectedGroup });
  assert.equal(apis.created[0]?.url, target);
});

test('retries explicit loading failures before accepting content', async () => {
  let attempts = 0;
  const apis = fake({
    sendMessage: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('HiBid account list is still loading');
      return snapshot();
    },
  });
  await reader(apis).read(7, { url });
  assert.equal(attempts, 2);
});

test('rejects a foreign target before creating a child', async () => {
  const apis = fake();
  await assert.rejects(reader(apis).read(7, { url: 'https://hibid.com/account/watchlist?filter=foreign' }), /different source scope/);
  assert.equal(apis.created.length, 0);
  assert.deepEqual(apis.removed, []);
});

test('rejects a child redirected outside the requested scope', async () => {
  const apis = fake();
  apis.setChildUrl('https://hibid.com/account/currentbids');
  await assert.rejects(reader(apis).read(7, { url }), /navigated away/);
  assert.deepEqual(apis.removed, [42]);
});

test('rejects when the owner navigates while the child is fetching', async () => {
  let ownerReads = 0;
  const apis = fake({
    getTab: async (tabId) => {
      if (tabId === 7) {
        ownerReads += 1;
        return { id: 7, url: ownerReads === 1 ? url : 'https://hibid.com/account/currentbids' };
      }
      return { id: 42, url };
    },
  });
  await assert.rejects(reader(apis).read(7, { url }), /navigated away/);
  assert.deepEqual(apis.removed, [42]);
});

test('times out a hung message using the real timer', async () => {
  const apis = fake({ sendMessage: async () => new Promise<never>(() => undefined) });
  await assert.rejects(reader(apis, { timeoutMs: 20 }).read(7, { url }), /timed out after 20ms/);
  assert.deepEqual(apis.removed, [42]);
});

test('cancels while child creation is pending and removes the late child', async () => {
  let release!: (tab: chrome.tabs.Tab) => void;
  const apis = fake({ createTab: async (properties) => {
    apis.created.push(properties);
    return new Promise<chrome.tabs.Tab>((resolve) => { release = resolve; });
  }});
  const accountReader = reader(apis);
  const pending = accountReader.read(7, { url });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await accountReader.cancel(7);
  release({ id: 42, url });
  await assert.rejects(pending, /cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(apis.removed, [42]);
});

test('cancels while a child message is pending', async () => {
  let release!: () => void;
  const apis = fake({ sendMessage: async () => new Promise<never>((_, reject) => { release = () => reject(new Error('message port closed')); }) });
  const accountReader = reader(apis);
  const pending = accountReader.read(7, { url });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await accountReader.cancel(7);
  release();
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(apis.removed, [42]);
});

test('cleans up the child when registration persistence fails', async () => {
  const apis = fake({ sessionSet: async () => { throw new Error('storage unavailable'); } });
  await assert.rejects(reader(apis).read(7, { url }), /storage unavailable/);
  assert.deepEqual(apis.removed, [42]);
});

test('cleans up the child when alarm creation fails', async () => {
  const apis = fake({ createAlarm: async () => { throw new Error('alarm unavailable'); } });
  await assert.rejects(reader(apis).read(7, { url }), /alarm unavailable/);
  assert.deepEqual(apis.removed, [42]);
});

test('rejects a duplicate read while another read is active', async () => {
  const apis = fake({ sendMessage: async () => new Promise<never>(() => undefined) });
  const accountReader = reader(apis, { timeoutMs: 50 });
  const first = accountReader.read(7, { url });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(accountReader.read(8, { url }), /busy/);
  await accountReader.cancel(7);
  await assert.rejects(first, /cancelled/);
});

test('returns an empty snapshot only after it is stable for 200ms', async () => {
  const empty = { url, expectedTotal: 0, visibleCount: 0, page: 1, items: [] };
  const apis = fake({ sendMessage: async () => empty });
  const started = Date.now();
  const result = await reader(apis, { timeoutMs: 500, pollMs: 1 }).read(7, { url });
  assert.deepEqual(result.items, []);
  assert.ok(Date.now() - started >= 190);
});

test('cleanupOnAlarm removes expired records and persists survivors durably', async () => {
  let records: Record<string, { tabId: number; ownerTabId: number; createdAt: number }> = {
    old: { tabId: 42, ownerTabId: 7, createdAt: 74_000 },
    fresh: { tabId: 43, ownerTabId: 8, createdAt: 99_000 },
  };
  const stored: unknown[] = [];
  const apis = fake({
    sessionGet: async () => records,
    sessionSet: async (value) => { records = value as typeof records; stored.push(value); },
  });
  apis.setNow(100_000);
  const accountReader = reader(apis);
  await accountReader.cleanupOnAlarm();
  assert.deepEqual(apis.removed, [42]);
  assert.deepEqual(records, { fresh: { tabId: 43, ownerTabId: 8, createdAt: 99_000 } });
  assert.equal(stored.length, 1);
  assert.equal(apis.alarms, 1);
  await accountReader.cleanupOnAlarm();
  assert.deepEqual(apis.removed, [42]);
  assert.equal(stored.length, 1);
  assert.equal(apis.alarms, 2);
});

test('retains a registration when removal fails, then retries it on the next alarm', async () => {
  let records: Record<string, { tabId: number; ownerTabId: number; createdAt: number }> = {
    old: { tabId: 42, ownerTabId: 7, createdAt: 74_000 },
  };
  let attempts = 0;
  const apis = fake({
    sessionGet: async () => records,
    sessionSet: async (value) => { records = value as typeof records; },
    getTab: async (tabId) => tabId === 43 ? { id: 43, url } : tabId === 42 ? { id: 42, url } : null,
    removeTab: async (tabId) => {
      attempts += 1;
      if (attempts === 1) throw new Error('tab removal unavailable');
      apis.removed.push(tabId);
    },
  });
  apis.setNow(100_000);
  const accountReader = reader(apis);
  await assert.rejects(accountReader.cleanupOnAlarm(), /cleanup failed for tab 42/);
  assert.deepEqual(records, { old: { tabId: 42, ownerTabId: 7, createdAt: 74_000 } });
  await accountReader.cleanupOnAlarm();
  assert.deepEqual(records, {});
  assert.deepEqual(apis.removed, [42]);
});

test('blocks child creation while an abandoned reader remains present', async () => {
  let records: Record<string, { tabId: number; ownerTabId: number; createdAt: number }> = {
    old: { tabId: 42, ownerTabId: 7, createdAt: 0 },
  };
  let closed = false;
  const apis = fake({
    sessionGet: async () => records,
    sessionSet: async (value) => { records = value as typeof records; },
    getTab: async (tabId) => tabId === 7 ? { id: 7, url } : tabId === 43 ? { id: 43, url } : tabId === 42 && !closed ? { id: 42, url } : null,
    removeTab: async (tabId) => {
      if (tabId === 42) throw new Error('tab removal unavailable');
      apis.removed.push(tabId);
    },
    createTab: async (properties) => {
      apis.created.push(properties);
      apis.setChildUrl(properties.url);
      return { id: 43, url: properties.url };
    },
  });
  await assert.rejects(reader(apis).read(7, { url }), /cleanup failed for tab 42/);
  assert.equal(apis.created.length, 0);
  assert.deepEqual(records, { old: { tabId: 42, ownerTabId: 7, createdAt: 0 } });
  closed = true;
  apis.setChildUrl(undefined);
  await reader(apis).read(7, { url });
  assert.equal(apis.created.length, 1);
});

test('failed closure after a successful read retains ownership and rearms cleanup', async () => {
  const apis = fake({ removeTab: async () => { throw new Error('temporary Chrome failure'); } });
  await assert.rejects(reader(apis).read(7, { url }), /cleanup/i);
  assert.ok((await apis.sessionGet() as Record<string, unknown>)['7']);
  assert.ok(apis.alarms >= 2);
});

test('a late-created cancelled reader retains durable ownership if closure fails', async () => {
  let release!: (tab: chrome.tabs.Tab) => void;
  const apis = fake({
    createTab: () => new Promise(resolve => { release = resolve; }),
    removeTab: async () => { throw new Error('temporary Chrome failure'); },
  });
  const accountReader = reader(apis);
  const pending = accountReader.read(7, { url });
  await new Promise(resolve => setTimeout(resolve, 0));
  await accountReader.cancel(7);
  await assert.rejects(pending, /cancelled/);
  release({ id: 42, url });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok((await apis.sessionGet() as Record<string, unknown>)['late:42']);
  assert.ok(apis.alarms > 0);
});

test('serializes alarm cleanup with late cancellation and retains both failed removals', async () => {
  let records: Record<string, { tabId: number; ownerTabId: number; createdAt: number }> = {};
  let sessionReads = 0;
  let releaseCreation!: (tab: chrome.tabs.Tab) => void;
  let releaseAlarmRemoval!: () => void;
  let alarmRemovalStarted!: () => void;
  const alarmRemovalObserved = new Promise<void>(resolve => { alarmRemovalStarted = resolve; });
  const apis = fake({
    sessionGet: async () => {
      sessionReads += 1;
      return sessionReads === 1 ? {} : records;
    },
    sessionSet: async (value) => { records = value as typeof records; },
    createTab: () => new Promise(resolve => { releaseCreation = resolve; }),
    removeTab: async (tabId) => {
      if (tabId === 99) {
        alarmRemovalStarted();
        await new Promise<void>(resolve => { releaseAlarmRemoval = resolve; });
        throw new Error('alarm removal unavailable');
      }
      throw new Error('late removal unavailable');
    },
    getTab: async (tabId) => tabId === 7 || tabId === 99 || tabId === 42 ? { id: tabId, url } : null,
  });
  apis.setNow(100_000);
  const accountReader = reader(apis);
  const pending = accountReader.read(7, { url });
  await new Promise(resolve => setTimeout(resolve, 0));
  records = { alarm: { tabId: 99, ownerTabId: 8, createdAt: 0 } };
  await accountReader.cancel(7);
  const alarm = accountReader.cleanupOnAlarm();
  await alarmRemovalObserved;
  releaseCreation({ id: 42, url });
  releaseAlarmRemoval();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(alarm, /cleanup failed for tab 99/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(Object.keys(records).sort(), ['alarm', 'late:42']);
});
