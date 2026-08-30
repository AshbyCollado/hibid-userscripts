import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  assertEbayLifecycleEnvelope, buildEbayLifecycleEnvelope, collectEbayLifecycle,
  parseEbayLifecycleDocument, resolveEbayLifecycleRoute, serializeEbayLifecycleEnvelope
} from '../src/ebay/lifecycle.js';
import { deliverEbayLifecycleEnvelope } from '../src/ebay/delivery.js';
import { listingPage, sellerHubActiveGridPage, soldPage, transactionPage } from './fixtures/ebay-lifecycle.js';

function page(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document, url };
}

function mapFetcher(pages: Record<string, string>) {
  return async (url: string) => {
    const html = pages[url];
    if (!html) throw new Error(`Unexpected fixture URL: ${url}`);
    return page(html, url);
  };
}

test('detects only the four signed-in eBay lifecycle routes', () => {
  assert.equal(resolveEbayLifecycleRoute('https://www.ebay.com/sh/lst/active').pageKind, 'active');
  assert.equal(resolveEbayLifecycleRoute('https://www.ebay.com/sh/lst/ended?status=ENDED').pageKind, 'ended');
  assert.equal(resolveEbayLifecycleRoute('https://www.ebay.com/mys/sold/rf/filter').pageKind, 'sold');
  assert.equal(resolveEbayLifecycleRoute('https://www.ebay.com/mes/transactionlist?sh=true').pageKind, 'transactions');
  assert.equal(resolveEbayLifecycleRoute('https://www.ebay.com/sch/i.html?_nkw=laptop').supported, false);
  assert.equal(resolveEbayLifecycleRoute('https://ebay.com/sh/lst/active').supported, false);
});

test('active collection follows pagination beyond 25 rows with consistent completeness', async () => {
  const first = 'https://www.ebay.com/sh/lst/active';
  const second = 'https://www.ebay.com/sh/lst/active?page=2';
  const envelope = await collectEbayLifecycle('active', first, {
    fetchPage: mapFetcher({ [first]: listingPage('active', 1, 25, 30, second), [second]: listingPage('active', 26, 5, 30) }),
    generatedAt: '2026-08-30T12:00:00.000Z'
  });
  assert.equal(envelope.records.length, 30);
  assert.equal(new Set(envelope.records.map((record) => record.event_id)).size, 30);
  assert.deepEqual(envelope.completeness, {
    expected_count: 30, count_known: true, parsed_count: 30, review_required_count: 0,
    has_next_page: false, page_count: 2, complete: true, reason: ''
  });
});

test('current Seller Hub grid parses rows and ignores misleading filter counts', async () => {
  const url = 'https://www.ebay.com/sh/lst/active';
  const envelope = await collectEbayLifecycle('active', url, {
    fetchPage: mapFetcher({ [url]: sellerHubActiveGridPage(2, 46) }),
    generatedAt: '2026-08-30T12:00:00.000Z'
  });
  assert.equal(envelope.completeness.expected_count, 2);
  assert.equal(envelope.completeness.parsed_count, 2);
  assert.equal(envelope.completeness.complete, true);
  assert.deepEqual(envelope.records.map((record) => ({
    customLabel: record.custom_label,
    price: record.price,
    quantity: record.quantity_available,
    views: record.views,
    watchers: record.watchers
  })), [
    { customLabel: 'TEST-1', price: 41, quantity: 1, views: 11, watchers: 1 },
    { customLabel: 'TEST-2', price: 42, quantity: 2, views: 12, watchers: 2 }
  ]);
});

test('ended collection retains its proven full-pagination behavior', async () => {
  const first = 'https://www.ebay.com/sh/lst/ended';
  const second = 'https://www.ebay.com/sh/lst/ended?page=2';
  const envelope = await collectEbayLifecycle('ended', first, {
    fetchPage: mapFetcher({ [first]: listingPage('ended', 1, 2, 3, second), [second]: listingPage('ended', 3, 1, 3) })
  });
  assert.equal(envelope.completeness.complete, true);
  assert.equal(envelope.completeness.page_count, 2);
  assert.equal(envelope.records.length, 3);
});

test('sold and transaction routes collect every page', async () => {
  const sold1 = 'https://www.ebay.com/mys/sold';
  const sold2 = 'https://www.ebay.com/mys/sold?page=2';
  const sold = await collectEbayLifecycle('sold', sold1, {
    fetchPage: mapFetcher({ [sold1]: soldPage('12-11111-11111', '130000000001', 1, 2, sold2), [sold2]: soldPage('12-22222-22222', '130000000002', 2, 2) })
  });
  assert.equal(sold.completeness.complete, true);
  assert.deepEqual(sold.records.map((record) => record.record_type), ['sold_order_line', 'sold_order_line']);

  const tx1 = 'https://www.ebay.com/mes/transactionlist?sh=true';
  const tx2 = 'https://www.ebay.com/mes/transactionlist?sh=true&page=2';
  const transactions = await collectEbayLifecycle('transactions', tx1, {
    fetchPage: mapFetcher({ [tx1]: transactionPage('TX-REDACTED-1', 1, 2, tx2), [tx2]: transactionPage('TX-REDACTED-2', 2, 2) })
  });
  assert.equal(transactions.completeness.complete, true);
  assert.equal(transactions.records.length, 2);
  assert.ok(transactions.records.every((record) => record.record_type === 'transaction'));
});

test('count mismatch is rejected as incomplete', async () => {
  const url = 'https://www.ebay.com/sh/lst/ended';
  const envelope = await collectEbayLifecycle('ended', url, { fetchPage: mapFetcher({ [url]: listingPage('ended', 1, 2, 3) }) });
  assert.equal(envelope.completeness.complete, false);
  assert.match(envelope.completeness.reason, /Expected 3 record\(s\), parsed 2/);
  await assert.rejects(() => deliverEbayLifecycleEnvelope(envelope, 'token', async () => ({ ok: true, status: 200 }), async () => undefined), /Expected 3/);
});

test('zero-active snapshot is complete and deliverable', async () => {
  const url = 'https://www.ebay.com/sh/lst/active';
  const envelope = await collectEbayLifecycle('active', url, {
    fetchPage: mapFetcher({ [url]: '<html><body><h1>Active listings (0)</h1><p>No active listings</p></body></html>' })
  });
  assert.equal(envelope.records.length, 0);
  assert.equal(envelope.completeness.complete, true);
  assert.doesNotThrow(() => assertEbayLifecycleEnvelope(envelope));
});

test('buyer PII is rejected by parser and envelope validation', () => {
  const url = 'https://www.ebay.com/sh/lst/active';
  const unsafe = page(listingPage('active', 1, 1, 1).replace('Redacted test item 1', 'Buyer email: person@example.invalid'), url);
  assert.throws(() => parseEbayLifecycleDocument(unsafe.document, 'active'), /Buyer PII/);
  const safe = buildEbayLifecycleEnvelope(parseEbayLifecycleDocument(page(listingPage('active', 1, 1, 1), url).document, 'active'), {
    pageKind: 'active', pageUrl: url, expectedCount: 1, pageCount: 1
  });
  (safe.records[0] as Record<string, unknown>).buyer_email = 'person@example.invalid';
  assert.throws(() => assertEbayLifecycleEnvelope(safe), /Buyer PII/);
});

test('bridge offline fallback downloads the exact serialized JSON', async () => {
  const url = 'https://www.ebay.com/sh/lst/active';
  const records = parseEbayLifecycleDocument(page(listingPage('active', 1, 1, 1), url).document, 'active');
  const envelope = buildEbayLifecycleEnvelope(records, { pageKind: 'active', pageUrl: url, expectedCount: 1, pageCount: 1, generatedAt: '2026-08-30T12:00:00.000Z' });
  let downloaded = '';
  const result = await deliverEbayLifecycleEnvelope(envelope, 'configured-token', async () => { throw new Error('bridge offline'); }, async (serialized) => { downloaded = serialized; });
  assert.equal(result.downloaded, true);
  assert.equal(downloaded, serializeEbayLifecycleEnvelope(envelope));
});

test('repeated sync preserves event IDs, ordering, and export dedupe ID', async () => {
  const url = 'https://www.ebay.com/sh/lst/active';
  const html = listingPage('active', 1, 3, 3);
  const first = await collectEbayLifecycle('active', url, { fetchPage: mapFetcher({ [url]: html }), generatedAt: '2026-08-30T12:00:00.000Z' });
  const second = await collectEbayLifecycle('active', url, { fetchPage: mapFetcher({ [url]: html }), generatedAt: '2026-08-30T13:00:00.000Z' });
  assert.equal(first.export_id, second.export_id);
  assert.deepEqual(first.records.map((record) => record.event_id), second.records.map((record) => record.event_id));
  assert.notEqual(first.generated_at, second.generated_at);
});
