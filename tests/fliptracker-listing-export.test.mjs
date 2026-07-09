import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCore() {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  const sandbox = {
    console,
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_BID_ASSISTANT_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-bid-assistant.user.js' });
  return sandbox.HiBidBidAssistantCore;
}

test('parses active eBay listing cards for FlipTracker export', () => {
  const core = loadCore();
  const html = `
    <div qa-id="active-item-336677465197" class="active-item">
      <div class="meui-item-tile">
        <h3 class="item-title undefined">
          <a href="https://www.ebay.com/itm/336677465197">
            <span>Omega 1000 Centrifugal Juicer 1150W White Electric Dishwasher Safe</span>
          </a>
        </h3>
        <div class="item__itemid"><span class="normal">Item ID: 336677465197</span></div>
        <div class="item__price"><span class="normal bold">$60.00</span><span class="normal"> Buy It Now</span></div>
        <div class="item__shipping-price">+ Shipping</div>
        <div class="item__listing-status">Listed today</div>
        <div class="item__time-left">Auto-renews in 30d 20h</div>
        <div class="me-item-activity__column"><span class="me-item-activity__column-count">1</span><span class="me-item-activity__column-label">View</span></div>
        <div class="me-item-activity__column"><span class="me-item-activity__column-count">0</span><span class="me-item-activity__column-label">Watchers</span></div>
      </div>
    </div>
  `;

  const rows = core.parseFlipTrackerActiveListingsHtml(html, {
    url: 'https://www.ebay.com/sh/lst/active',
  });

  assert.deepEqual(plain(rows), [
    {
      source: 'eBay',
      itemId: '336677465197',
      title: 'Omega 1000 Centrifugal Juicer 1150W White Electric Dishwasher Safe',
      price: 60,
      url: 'https://www.ebay.com/itm/336677465197',
      status: 'Active',
      listedDateText: 'Listed today',
      shippingText: '+ Shipping',
      views: 1,
      watchers: 0,
      clicks: null,
    },
  ]);
});

test('parses active eBay Seller Hub table rows for FlipTracker export', () => {
  const core = loadCore();
  const html = `
    <main>
      <h1>Manage active listings (15)</h1>
      <table>
        <thead><tr><th>Item</th><th>Current price</th><th>Available quantity</th><th>Views</th></tr></thead>
        <tbody>
          <tr data-testid="listing-row-photo">
            <td><a href="/itm/336677465197">eBay | Item photo. Show Listing Details new. Listing Rcv A Shelf RV DM17 KIT 5 Door Mounting Kit 278234 Pull Out Cabinet</a></td>
            <td><span>$41.00</span></td>
          </tr>
          <tr data-testid="listing-row">
            <td><input type="checkbox"></td>
            <td><a href="/sh/lst?mode=ReviseItem&amp;itemId=336677465197&amp;ReturnURL=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Factive">Edit</a></td>
            <td><a href="/itm/336677465197">eBay | Bids: 0. Show Bid History. Listing Rev-A-Shelf RV-DM17 KIT 5 Door Mounting Kit 278234 Pull Out Cabinet</a></td>
            <td><span>$13.05</span><span>$25.00</span></td>
            <td>1</td>
            <td><span>12 views</span><span>2 watchers</span></td>
          </tr>
        </tbody>
      </table>
    </main>
  `;

  const rows = core.parseFlipTrackerActiveListingsHtml(html, {
    url: 'https://www.ebay.com/sh/lst/active',
  });

  assert.deepEqual(plain(rows), [
    {
      source: 'eBay',
      itemId: '336677465197',
      title: 'Rev-A-Shelf RV-DM17 KIT 5 Door Mounting Kit 278234 Pull Out Cabinet',
      price: 13.05,
      url: 'https://www.ebay.com/itm/336677465197',
      status: 'Active',
      listedDateText: '',
      shippingText: '',
      views: 12,
      watchers: 2,
      clicks: null,
    },
  ]);
});

test('assistant panel defaults to minimized before a stored preference exists', () => {
  const core = loadCore();
  assert.equal(core.getStoredMinimized(), true);
});

test('panel markup exposes modern drawer shell and stable controls', () => {
  const core = loadCore();
  const html = core.buildPanelHtml({ mode: 'fliptracker', debugEnabled: false });

  assert.match(html, /hiba-drawer/);
  assert.match(html, /hiba-launcher/);
  assert.match(html, /FlipperAddon by ALOS/);
  assert.match(html, /id="fliptracker-listing-download"/);
  assert.match(html, /data-mode-tab="fliptracker"/);
  assert.doesNotMatch(html, /id="hibid-bid-load"/);
  assert.doesNotMatch(html, /id="hibid-live-copy-llm"/);
});

test('parses Facebook Marketplace manager listing cards for FlipTracker export', () => {
  const core = loadCore();
  const html = `
    <div aria-label="Fancy standing lamp" role="button">
      <span>Fancy standing lamp</span><span>$20</span>
      <span>Active · Listed on 7/7</span>
      <span>Listed on Marketplace · 4 clicks on listing</span>
      <a href="https://www.facebook.com/marketplace/item/1234567890123456/">Open</a>
    </div>
    <div aria-label="Mark as sold Fancy standing lamp" role="button">Mark as sold</div>
    <div aria-label="ASUS ROG Ally X (Black) - Z1 Extreme, 24GB RAM, 1TB SSD - Excellent Condition" role="button">
      <span>ASUS ROG Ally X (Black) - Z1 Extreme, 24GB RAM, 1TB SSD - Excellent Condition</span><span>$650</span>
      <span>Active · Listed on 7/5</span>
      <span>Listed on Marketplace · 171 clicks on listing</span>
      <a href="https://www.facebook.com/marketplace/item/9876543210987654/">Open</a>
    </div>
    <div aria-label="Mark as sold ASUS ROG Ally X (Black) - Z1 Extreme, 24GB RAM, 1TB SSD - Excellent Condition" role="button">Mark as sold</div>
  `;

  const rows = core.parseFlipTrackerActiveListingsHtml(html, {
    url: 'https://www.facebook.com/marketplace/you/selling',
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows.map((row) => ({
    source: row.source,
    title: row.title,
    price: row.price,
    status: row.status,
    clicks: row.clicks,
    url: row.url,
  }))), [
    {
      source: 'Facebook Marketplace',
      title: 'Fancy standing lamp',
      price: 20,
      status: 'Active',
      clicks: 4,
      url: 'https://www.facebook.com/marketplace/item/1234567890123456/',
    },
    {
      source: 'Facebook Marketplace',
      title: 'ASUS ROG Ally X (Black) - Z1 Extreme, 24GB RAM, 1TB SSD - Excellent Condition',
      price: 650,
      status: 'Active',
      clicks: 171,
      url: 'https://www.facebook.com/marketplace/item/9876543210987654/',
    },
  ]);
});

test('builds a FlipTracker import HTML export with metadata and listing cards', () => {
  const core = loadCore();
  const html = core.buildFlipTrackerListingsExportHtml([
    {
      source: 'eBay',
      itemId: '336677465197',
      title: 'Omega 1000 Centrifugal Juicer 1150W White Electric Dishwasher Safe',
      price: 60,
      url: 'https://www.ebay.com/itm/336677465197',
      status: 'Active',
      listedDateText: 'Listed today',
      shippingText: '+ Shipping',
      views: 1,
      watchers: 0,
      clicks: null,
    },
  ], { pageUrl: 'https://www.ebay.com/sh/lst/active', generatedAt: '2026-07-08T12:00:00.000Z' });

  assert.match(html, /FlipTracker Active Listing Export/);
  assert.match(html, /data-fliptracker-export="active-listings"/);
  assert.match(html, /active-item-336677465197/);
  assert.match(html, /Omega 1000 Centrifugal Juicer/);
  assert.match(html, /https:\/\/www\.ebay\.com\/itm\/336677465197/);
});
