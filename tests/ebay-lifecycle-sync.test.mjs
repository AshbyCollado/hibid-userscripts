import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCore(overrides = {}) {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  const sandbox = { console, URL, globalThis: {}, ...overrides };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_BID_ASSISTANT_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-bid-assistant.user.js' });
  return sandbox.HiBidBidAssistantCore;
}

test('resolves only dedicated eBay lifecycle routes', () => {
  const core = loadCore();

  assert.equal(core.resolveFlipTrackerPage(new URL('https://www.ebay.com/sh/lst/active')).kind, 'fliptracker-ebay-active');
  assert.equal(core.resolveFlipTrackerPage(new URL('https://www.ebay.com/mys/active')).kind, 'fliptracker-ebay-active');
  assert.equal(core.resolveFlipTrackerPage(new URL('https://www.ebay.com/sh/lst/ended?status=ENDED&timePeriod=LAST_90_DAYS')).kind, 'fliptracker-ebay-ended');
  assert.equal(core.resolveFlipTrackerPage(new URL('https://www.ebay.com/mys/sold')).kind, 'fliptracker-ebay-sold');
  assert.equal(core.resolveFlipTrackerPage(new URL('https://www.ebay.com/mes/transactionlist?sh=true')).kind, 'fliptracker-ebay-transactions');

  [
    'https://www.ebay.com/sh/lst',
    'https://www.ebay.com/sh/lst/active/revise',
    'https://www.ebay.com/mys/overview',
    'https://www.ebay.com/mys/active/archive',
  ].forEach((href) => {
    assert.equal(core.resolveFlipTrackerPage(new URL(href)).supported, false, href);
    assert.equal(core.isFlipTrackerListingPage(new URL(href)), false, href);
  });
});

test('parses a sold order without leaking buyer PII into sale_date or other values', () => {
  const core = loadCore();
  const html = `
    <main><h1>Sold (1)</h1><div data-testid="order-card" data-order-id="12-34567-89012">
      <a href="https://www.ebay.com/itm/336677465197">Omega 1000 Centrifugal Juicer</a>
      <span>Order number: 12-34567-89012</span><span>Sale date: Jul 12, 2026 Buyer: [REDACTED BUYER]</span>
      <span>Quantity: 2</span><span>Item total $120.00</span><span>Shipping $18.50</span>
      <span>Sales tax $9.17</span><span>Order total $147.67</span><span>Paid</span>
      <span>buyer-redacted@example.invalid</span><span>Phone: 212-555-0100</span>
      <span>Shipping address: 123 Example Street, Example, NJ 00000</span>
    </div></main>`;

  const rows = core.parseEbaySoldOrdersHtml(html);
  assert.deepEqual(plain(rows), [{
    record_type: 'sold_order_line',
    order_id: '12-34567-89012',
    order_line_id: '12-34567-89012:336677465197',
    item_id: '336677465197',
    custom_label: '',
    title: 'Omega 1000 Centrifugal Juicer',
    item_url: 'https://www.ebay.com/itm/336677465197',
    sale_date: 'Jul 12, 2026',
    quantity: 2,
    item_subtotal: 120,
    shipping_charged: 18.5,
    sales_tax: 9.17,
    order_total: 147.67,
    status: 'Paid',
  }]);
  assert.doesNotMatch(JSON.stringify(rows), /REDACTED BUYER|buyer-redacted|212-555|Example Street/i);
});

test('parses nested multi-item sold orders into one stable line per item', () => {
  const core = loadCore();
  const html = `
    <main><h1>Sold (2)</h1>
      <div data-testid="order-card" data-order-id="22-33333-44444">
        <div class="order-summary">Sold Jul 11, 2026 Order total $92.50 Shipping charged $12.50 Sales tax $5.00 Paid</div>
        <div data-testid="order-line-item" data-order-line-id="LINE-A">
          <a href="/itm/111111111111">First redacted fixture item</a>
          <span>Custom label: SHELF-A1</span><span>Quantity 2</span><span>Item subtotal $50.00</span>
        </div>
        <div data-testid="order-line-item">
          <a href="/itm/222222222222">Second redacted fixture item</a>
          <span>SKU: BIN-B2</span><span>Qty 1</span><span>Item total $25.00</span>
        </div>
      </div>
    </main>`;

  const rows = core.parseEbaySoldOrdersHtml(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows.map((row) => ({
    order_line_id: row.order_line_id,
    item_id: row.item_id,
    custom_label: row.custom_label,
    title: row.title,
    quantity: row.quantity,
    item_subtotal: row.item_subtotal,
    sale_date: row.sale_date,
  }))), [
    {
      order_line_id: 'LINE-A',
      item_id: '111111111111',
      custom_label: 'SHELF-A1',
      title: 'First redacted fixture item',
      quantity: 2,
      item_subtotal: 50,
      sale_date: 'Jul 11, 2026',
    },
    {
      order_line_id: '22-33333-44444:222222222222',
      item_id: '222222222222',
      custom_label: 'BIN-B2',
      title: 'Second redacted fixture item',
      quantity: 1,
      item_subtotal: 25,
      sale_date: 'Jul 11, 2026',
    },
  ]);
});

test('parses the current My eBay sold card shape with yearless dates and All counts', () => {
  const core = loadCore();
  const html = `
    <main><button>All (1)</button>
      <div class="sold-itemcard">
        <div class="meui-item-tile sold-item--content" qa-id="sold-item--content-111111111111">
          <a href="/itm/111111111111">Current sold card fixture</a>
          <a href="/sh/ord/details?orderid=13-11111-22222&amp;sh=true">Order: 13-11111-22222</a>
          <div>Sold Jul 14</div><div>$120.00 Subtotal</div>
          <div>+ Shipping (buyer paid $12.00)</div><div>Canceled</div>
          <div>Buyer: Redacted Fixture Person</div>
        </div>
      </div>
    </main>`;

  const rows = core.parseEbaySoldOrdersHtml(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_id, '13-11111-22222');
  assert.equal(rows[0].item_id, '111111111111');
  assert.match(rows[0].sale_date, /^Jul 14, \d{4}$/);
  assert.equal(rows[0].item_subtotal, 120);
  assert.equal(rows[0].shipping_charged, 12);
  assert.equal(rows[0].status, 'Canceled');
  assert.equal(core.expectedEbayLifecycleCount(html, 'sold'), 1);
  assert.doesNotMatch(JSON.stringify(rows), /Redacted Fixture Person/i);
});

test('recursively sanitizes and asserts every lifecycle export value before posting', async () => {
  let postedPayload = null;
  const core = loadCore({
    GM_xmlhttpRequest(request) {
      postedPayload = JSON.parse(request.data);
      request.onload({ status: 200, responseText: '{}' });
    },
  });
  const unsafe = {
    page_kind: 'sold',
    records: [{
      sale_date: 'Jul 12, 2026 Buyer: [REDACTED BUYER]',
      buyer_email: 'buyer-redacted@example.invalid',
      buyerName: '[REDACTED BUYER NAME]',
      nested: {
        message: 'Please call 212-555-0100',
        note: 'Ship to 123 Example Street',
        shippingAddress: '123 Example Street',
        emailAddress: 'nested-redacted@example.invalid',
      },
    }],
  };

  assert.throws(() => core.assertEbayLifecycleValueSafe(unsafe), /unsafe buyer pii/i);
  const safe = core.prepareEbayLifecycleEnvelopeForExport(unsafe);
  assert.doesNotThrow(() => core.assertEbayLifecycleValueSafe(safe));
  assert.doesNotMatch(JSON.stringify(safe), /REDACTED BUYER|buyer-redacted|212-555|Example Street/i);

  const result = await core.postEbayLifecycleEnvelope(unsafe, 'test-token');
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(postedPayload), /REDACTED BUYER|buyer-redacted|212-555|Example Street/i);
});

test('normalizes eBay fee charges and preserves signed net amounts', () => {
  const core = loadCore();
  const html = `
    <table><tbody><tr data-transaction-id="TXN-777">
      <td>Jul 13, 2026</td><td>Order 12-34567-89012</td><td>Item 336677465197</td>
      <td>Sale</td><td>Gross $147.67</td><td>Final value fee -$18.45</td>
      <td>Promoted listing fee -$2.40</td><td>Net $126.82</td><td>Payout PAY-91</td><td>Paid Jul 14, 2026</td>
    </tr></tbody></table>`;

  assert.deepEqual(plain(core.parseEbayTransactionsHtml(html)), [{
    record_type: 'transaction',
    transaction_id: 'TXN-777',
    order_id: '12-34567-89012',
    item_id: '336677465197',
    transaction_type: 'Sale',
    transaction_date: 'Jul 13, 2026',
    gross_amount: 147.67,
    platform_fee: 18.45,
    promoted_fee: 2.4,
    refund_amount: null,
    shipping_label_amount: null,
    net_amount: 126.82,
    payout_id: 'PAY-91',
    payout_date: 'Jul 14, 2026',
    status: 'Paid',
    transaction_id_source: 'explicit',
    identity_stable: true,
  }]);

  const refund = core.parseEbayTransactionsHtml(`
    <table><tr data-transaction-id="TXN-REFUND">
      <td>Transaction date Jul 14, 2026</td><td>Order 12-34567-89012</td><td>Refund</td>
      <td>Refund amount \u2212$25.00</td><td>Net -$25.00</td><td>Reversed</td>
    </tr></table>`)[0];
  assert.equal(refund.refund_amount, 25);
  assert.equal(refund.net_amount, -25);
});

test('parses current My eBay transaction cards with stable query identities and shipping labels', () => {
  const core = loadCore();
  const html = `
    <main>
      <div class="transaction-row-v2 transaction-border"><div class="transaction--content-wrapper">
        <div class="transactions-date">Jul 14, 2026\n10:00 AM</div>
        <div class="transaction--image"></div>
        <div class="transaction--desc"><a href="/sh/ord/details?orderid=13-11111-22222&amp;sh=true">Order</a></div>
        <div class="transaction--amount">$120.00</div><div class="transaction--fees">-$15.00</div>
        <div class="transaction--net">$105.00\nAvailable $105.00</div><div class="transaction--running-total"></div>
        <div class="transaction--details"><a href="/mes/transactiondetails?type=ORDER&amp;uuid=UUID-ORDER-1">Details</a></div>
      </div></div>
      <div class="transaction-row-v2 transaction-border"><div class="transaction--content-wrapper">
        <div class="transactions-date">Jul 14, 2026\n11:00 AM</div>
        <div class="transaction--image"></div>
        <div class="transaction--desc">Shipping label <a href="/sh/ord/details?orderid=13-11111-22222&amp;sh=true">Order</a></div>
        <div class="transaction--amount">-$12.00</div><div class="transaction--fees">-</div>
        <div class="transaction--net">-$12.00\nAvailable $93.00</div><div class="transaction--running-total"></div>
        <div class="transaction--details"><a href="/mes/transactiondetails?type=SHIPPING_LABEL&amp;transactionId=TX-LABEL-1&amp;uuid=UUID-LABEL-1">Details</a></div>
      </div></div>
    </main>`;

  const rows = core.parseEbayTransactionsHtml(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows.map((row) => ({
    transaction_id: row.transaction_id,
    order_id: row.order_id,
    transaction_type: row.transaction_type,
    gross_amount: row.gross_amount,
    platform_fee: row.platform_fee,
    shipping_label_amount: row.shipping_label_amount,
    net_amount: row.net_amount,
    identity_stable: row.identity_stable,
  }))), [
    {
      transaction_id: 'UUID-ORDER-1', order_id: '13-11111-22222', transaction_type: 'Sale',
      gross_amount: 120, platform_fee: 15, shipping_label_amount: null, net_amount: 105, identity_stable: true,
    },
    {
      transaction_id: 'TX-LABEL-1', order_id: '13-11111-22222', transaction_type: 'Shipping label',
      gross_amount: null, platform_fee: null, shipping_label_amount: 12, net_amount: -12, identity_stable: true,
    },
  ]);
  assert.equal(core.expectedEbayLifecycleCount(html, 'transactions'), 2);
  const paged = core.buildEbayLifecycleEnvelope(rows, {
    pageKind: 'transactions', pageUrl: 'https://www.ebay.com/mes/transactionlist', expectedCount: 2, hasNextPage: true,
  });
  assert.equal(paged.completeness.complete, false);
  assert.equal(paged.completeness.has_next_page, true);
  assert.match(paged.completeness.reason, /next page/i);
});

test('derives stable transaction IDs without row position and flags unstable rows for review', () => {
  const core = loadCore();
  const stableRow = `
    <tr><td>Transaction date Jul 13, 2026</td><td>Order 12-34567-89012</td>
      <td>Item 336677465197</td><td>Sale</td><td>Gross $40.00</td><td>Net $35.00</td></tr>`;
  const first = core.parseEbayTransactionsHtml(`<table>${stableRow}</table>`)[0];
  const shifted = core.parseEbayTransactionsHtml(`
    <table><tr data-transaction-id="TXN-OTHER"><td>Fee</td><td>Amount -$1.00</td></tr>${stableRow}</table>`)
    .find((row) => row.order_id === '12-34567-89012');

  assert.match(first.transaction_id, /^derived-/);
  assert.equal(first.transaction_id, shifted.transaction_id);
  assert.equal(first.identity_stable, true);
  assert.equal(first.transaction_id_source, 'derived');

  const unstable = core.parseEbayTransactionsHtml(`
    <table><tr><td>Jul 13, 2026</td><td>Refund</td><td>Net -$5.00</td></tr></table>`)[0];
  assert.match(unstable.transaction_id, /^review-/);
  assert.equal(unstable.identity_stable, false);
  assert.equal(unstable.review_required, true);

  const envelope = core.buildEbayLifecycleEnvelope([unstable], {
    pageKind: 'transactions',
    pageUrl: 'https://www.ebay.com/mes/transactionlist',
    expectedCount: 1,
  });
  assert.equal(envelope.completeness.complete, false);
  assert.equal(envelope.completeness.review_required_count, 1);
  assert.match(envelope.completeness.reason, /identity review/i);
});

test('extracts active SKU and quantities and chooses the labeled listing price', () => {
  const core = loadCore();
  const html = `
    <main><h1>Manage active listings (1)</h1>
      <div qa-id="active-item-333333333333" class="active-item">
        <h3 class="item-title"><a href="/itm/333333333333"><span>Labeled active fixture</span></a></h3>
        <div>Promoted price $4.25</div>
        <div aria-label="Current price"><span>Current price $85.00</span></div>
        <div>Or best offer</div>
        <div>Custom label (SKU): RACK C3</div>
        <div>Total quantity: 5</div><div>Available quantity: 3</div>
        <div class="item__shipping-price">Free shipping</div><div>7 views</div><div>2 watchers</div>
      </div>
    </main>`;

  const row = core.parseEbayActiveLifecycleHtml(html)[0];
  assert.equal(row.price, 85);
  assert.equal(row.custom_label, 'RACK C3');
  assert.equal(row.quantity_total, 5);
  assert.equal(row.quantity_available, 3);
  assert.equal(row.views, 7);
  assert.equal(row.watchers, 2);
  assert.equal(row.offers_enabled, true);
  assert.equal(row.offers, 'Best Offer');

  const availableOnly = core.parseEbayActiveLifecycleHtml(`
    <div qa-id="active-item-444444444444" class="active-item">
      <h3 class="item-title"><a href="/itm/444444444444"><span>Available-only fixture</span></a></h3>
      <div class="item__price">$20.00</div><div>Available quantity: 3</div>
    </div>`)[0];
  assert.equal(availableOnly.quantity_available, 3);
  assert.equal(availableOnly.quantity_total, null);
});

test('parses ended listings as state evidence without inventing a sale', () => {
  const core = loadCore();
  const pageUrl = 'https://www.ebay.com/sh/lst/ended?status=ENDED&timePeriod=LAST_90_DAYS&source=filterbar&action=search&buyer=redacted';
  const html = `
    <main><h1>Ended (2)</h1><table><tbody>
      <tr data-testid="listing-row">
        <td><a href="/itm/555555555555">Ended sold fixture camera</a></td>
        <td>Custom label (SKU): CAM-A1</td><td>Current price $300.00</td>
        <td>Sold</td><td>Ended on Jul 20, 2026</td><td>Quantity sold: 1</td><td>End reason: Sold</td>
      </tr>
      <tr data-testid="listing-row">
        <td><a href="/itm/666666666666">Ended unsold fixture monitor</a></td>
        <td>SKU: MON-B2</td><td>Unsold</td><td>Listing ended Jul 18, 2026</td><td>Ended by seller</td>
      </tr>
    </tbody></table></main>`;

  const rows = core.parseEbayEndedLifecycleHtml(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows.map(row => ({
    record_type: row.record_type,
    item_id: row.item_id,
    custom_label: row.custom_label,
    status: row.status,
    ended_date_text: row.ended_date_text,
    end_reason: row.end_reason,
    price: row.price,
    quantity_sold: row.quantity_sold,
    sale_evidence: row.sale_evidence,
  }))), [
    {
      record_type: 'ended_listing', item_id: '555555555555', custom_label: 'CAM-A1', status: 'Sold',
      ended_date_text: 'Jul 20, 2026', end_reason: 'Sold', price: 300, quantity_sold: 1,
      sale_evidence: 'ended_snapshot_only',
    },
    {
      record_type: 'ended_listing', item_id: '666666666666', custom_label: 'MON-B2', status: 'Ended - Unsold',
      ended_date_text: 'Jul 18, 2026', end_reason: 'Ended by seller', price: null, quantity_sold: null,
      sale_evidence: 'ended_snapshot_only',
    },
  ]);
  assert.equal(core.expectedEbayLifecycleCount(html, 'ended'), 2);

  const envelope = core.buildEbayLifecycleEnvelope(rows, {
    pageKind: 'ended', pageUrl, expectedCount: 2,
  });
  assert.equal(envelope.completeness.complete, true);
  assert.equal(envelope.page_url, 'https://www.ebay.com/sh/lst/ended?status=ENDED&timePeriod=LAST_90_DAYS&source=filterbar&action=search');
  assert.equal(Object.hasOwn(rows[0], 'order_id'), false);
  assert.equal(Object.hasOwn(rows[0], 'item_subtotal'), false);
});

test('represents unknown counts as incomplete and supports complete zero-result snapshots', () => {
  const core = loadCore();
  const unknown = core.buildEbayLifecycleEnvelope([
    { record_type: 'active_listing', item_id: '336677465197', title: 'Unknown-count fixture', price: 60 },
  ], {
    pageKind: 'active',
    pageUrl: 'https://www.ebay.com/mys/active?buyer=redacted',
    generatedAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(unknown.completeness.count_known, false);
  assert.equal(unknown.completeness.complete, false);
  assert.match(unknown.completeness.reason, /unknown/i);
  assert.equal(unknown.page_url, 'https://www.ebay.com/mys/active');

  assert.equal(core.expectedEbayLifecycleCount('<h1>Manage active listings (0)</h1>', 'active'), 0);
  assert.equal(core.expectedEbayLifecycleCount('<button>All (19)</button>', 'active'), 19);
  assert.equal(core.expectedEbayLifecycleCount('<main>No transactions found</main>', 'transactions'), 0);
  assert.equal(core.expectedEbayLifecycleCount('<div>Active 1 view</div>', 'active'), null);
  const zero = core.buildEbayLifecycleEnvelope([], {
    pageKind: 'sold',
    pageUrl: 'https://www.ebay.com/mys/sold',
    expectedCount: 0,
  });
  assert.equal(zero.completeness.count_known, true);
  assert.equal(zero.completeness.complete, true);
  assert.equal(core.canExportEbayLifecycleEnvelope(zero), true);
});

test('marks count mismatches and route-kind mismatches incomplete or blocked', () => {
  const core = loadCore();
  const envelope = core.buildEbayLifecycleEnvelope([], {
    pageKind: 'sold',
    pageUrl: 'https://www.ebay.com/mys/sold',
    expectedCount: 4,
  });
  assert.equal(envelope.completeness.complete, false);
  assert.match(envelope.completeness.reason, /expected 4/i);

  const sold = core.buildEbayLifecycleEnvelope([
    { record_type: 'sold_order_line', order_id: '11-22222-33333', order_line_id: 'LINE-1', item_id: '111111111111' },
  ], { pageKind: 'sold', pageUrl: 'https://www.ebay.com/mys/sold', expectedCount: 1 });
  assert.deepEqual(plain(core.validateScraperExportAgainstRoute(sold, 'fliptracker', {
    kind: 'fliptracker-ebay-active', source: 'ebay',
  })), { ok: false, reason: 'fliptracker-page-kind-mismatch' });

  const ended = core.buildEbayLifecycleEnvelope([
    { record_type: 'ended_listing', item_id: '555555555555', title: 'Ended fixture', status: 'Sold' },
  ], { pageKind: 'ended', pageUrl: 'https://www.ebay.com/sh/lst/ended', expectedCount: 1 });
  assert.deepEqual(plain(core.validateScraperExportAgainstRoute(ended, 'fliptracker', {
    kind: 'fliptracker-ebay-active', source: 'ebay',
  })), { ok: false, reason: 'fliptracker-page-kind-mismatch' });
});

test('Sync All falls back after post errors and always clears busy state', async () => {
  const core = loadCore();
  const envelope = core.buildEbayLifecycleEnvelope([
    { record_type: 'active_listing', item_id: '333333333333', title: 'Sync fixture', price: 85 },
  ], { pageKind: 'active', pageUrl: 'https://www.ebay.com/mys/active', expectedCount: 1 });
  const busy = [];
  const downloaded = [];
  const summary = await core.runEbayLifecycleSyncAll({
    pages: [{ pageKind: 'active', pageUrl: 'https://www.ebay.com/mys/active' }],
    currentRoute: { kind: 'fliptracker-ebay-active', source: 'ebay' },
    scanCurrent: () => envelope,
    setBusy: (value) => busy.push(value),
    postEnvelope: async () => { throw new Error('bridge unavailable'); },
    downloadEnvelope: async (value) => downloaded.push(value.page_kind),
  });

  assert.deepEqual(busy, [true, false]);
  assert.deepEqual(downloaded, ['active']);
  assert.equal(summary.downloaded, 1);
  assert.equal(summary.synced, 0);
  assert.equal(summary.errors[0].stage, 'post');
});

test('Sync All honors cancellation and exports complete zero snapshots', async () => {
  const core = loadCore();
  const busy = [];
  let cancelled = false;
  let postCount = 0;
  const zero = core.buildEbayLifecycleEnvelope([], {
    pageKind: 'active', pageUrl: 'https://www.ebay.com/mys/active', expectedCount: 0,
  });
  const zeroSummary = await core.runEbayLifecycleSyncAll({
    pages: [{ pageKind: 'active', pageUrl: 'https://www.ebay.com/mys/active' }],
    currentRoute: { kind: 'fliptracker-ebay-active', source: 'ebay' },
    scanCurrent: () => zero,
    postEnvelope: async () => { postCount += 1; return { ok: true }; },
  });
  assert.equal(zeroSummary.synced, 1);
  assert.equal(postCount, 1);

  const cancelledSummary = await core.runEbayLifecycleSyncAll({
    pages: [
      { pageKind: 'active', pageUrl: 'https://www.ebay.com/mys/active' },
      { pageKind: 'sold', pageUrl: 'https://www.ebay.com/mys/sold' },
    ],
    currentRoute: { kind: 'unsupported' },
    setBusy: (value) => busy.push(value),
    isCancelled: () => cancelled,
    fetchPage: async () => {
      cancelled = true;
      return zero;
    },
    postEnvelope: async () => { throw new Error('post must not run'); },
  });
  assert.equal(cancelledSummary.cancelled, true);
  assert.equal(cancelledSummary.envelopes.length, 0);
  assert.deepEqual(busy, [true, false]);
});
