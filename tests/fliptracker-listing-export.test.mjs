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
      customLabel: '',
      quantityTotal: null,
      quantityAvailable: null,
      offersEnabled: false,
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
            <td><span>Promoted listing fee $13.05</span><span>Current price $25.00</span></td>
            <td>Custom label: RV-DM17 Total quantity: 4 Available quantity: 1</td>
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
      price: 25,
      url: 'https://www.ebay.com/itm/336677465197',
      status: 'Active',
      listedDateText: '',
      shippingText: '',
      views: 12,
      watchers: 2,
      clicks: null,
      customLabel: 'RV-DM17',
      quantityTotal: 4,
      quantityAvailable: 1,
      offersEnabled: false,
      bids: null,
      listingFormat: '',
      listingDuration: '',
      endedAtText: '',
      soldStatus: '',
    },
  ]);
});

test('parses the first Seller Hub grid row when the header omits Item number and shows two prices', () => {
  const core = loadCore();
  const rows = core.parseEbayActiveListingsHtml(`
    <main><h1>Manage active listings (1)</h1>
      <table><thead><tr>
        <th>Actions</th><th>Item</th><th>Custom label (SKU)</th><th>Current price</th><th>Available quantity</th>
      </tr></thead><tbody><tr data-id="336701036874" class="grid-row">
        <td><a href="/sl/list?mode=ReviseItem&amp;itemId=336701036874">Edit</a></td>
        <td><a href="/itm/336701036874">Rev-A-Shelf Door Mounting Kit</a></td>
        <td></td>
        <td><span class="sh-neg">$13.05</span><span>$25.00</span><span>Buy It Now</span></td>
        <td>1</td>
      </tr></tbody></table>
    </main>
  `);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemId, '336701036874');
  assert.equal(rows[0].price, 13.05);
  assert.equal(rows[0].title, 'Rev-A-Shelf Door Mounting Kit');
});

test('rejects Seller Hub markup fragments as custom labels', () => {
  const core = loadCore();
  const html = `
    <table>
      <thead><tr><th>Item</th><th>Custom label (SKU)</th><th>Current price</th></tr></thead>
      <tbody><tr data-testid="listing-row">
        <td><a href="/itm/336701097241">Emporio Armani Sunglasses</a></td>
        <td>shui-dt--left editable inline-editable&quot;&gt;</td>
        <td>$65.00</td>
      </tr></tbody>
    </table>
  `;

  const rows = core.parseFlipTrackerActiveListingsHtml(html, {
    url: 'https://www.ebay.com/sh/lst/active',
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].customLabel, '');
});

test('resolves and parses eBay bulk-sell revise rows with full listing fields', () => {
  const core = loadCore();
  const url = new URL('https://www.ebay.com/bulksell?workspaceId=4208669753366&ru=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Factive');
  const html = `
    <table class="bg-grid">
      <tr><th>Title</th><th>Price</th></tr>
      <tr class="bg-grid row">
        <td><input id="draft-checkbox-5334866976011" aria-label="Select item to bulk edit - ThermoWorks Saf-T-Log HACCP Temperature Logger 292-701 Probe Kit Case" type="checkbox"></td>
        <td><img src="https://i.ebayimg.com/images/g/example/s-l1600.jpg"><textarea aria-labelledby="itemTitle">ThermoWorks Saf-T-Log HACCP Temperature Logger 292-701 Probe Kit Case</textarea></td>
        <td><input aria-labelledby="customLabel" value="thermoworks"></td>
        <td><input aria-labelledby="price" value="150.00"></td>
        <td><input aria-labelledby="startPrice" value="150.00"></td>
        <td><input aria-labelledby="availableQuantity" value="2"></td>
        <td><button>Buy It Now</button><button>Good 'Til Canceled</button></td>
        <td>Used Buyer pays calculated fee (USPS Ground Advantage) 2 business days Promoted: General (2.0%) 3 recommendations Edit description</td>
      </tr>
    </table>
  `;

  assert.equal(core.isEbayBulkSellPage(url), true);
  assert.equal(core.shouldInitOnLocation(url), true);
  assert.deepEqual(plain(core.resolveFlipTrackerPage(url)), {
    supported: true,
    kind: 'fliptracker-ebay-bulk',
    source: 'ebay',
    host: 'www.ebay.com',
    reason: 'eBay bulk-sell listing export route',
  });

  const rows = core.parseEbayBulkSellListingsHtml(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'eBay');
  assert.equal(rows[0].pageKind, 'ebay-bulk-sell');
  assert.equal(rows[0].title, 'ThermoWorks Saf-T-Log HACCP Temperature Logger 292-701 Probe Kit Case');
  assert.equal(rows[0].draftId, '5334866976011');
  assert.equal(rows[0].price, 150);
  assert.equal(rows[0].startPrice, 150);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].customLabel, 'thermoworks');
  assert.equal(rows[0].format, 'Buy It Now');
  assert.equal(rows[0].duration, "Good 'Til Canceled");
  assert.equal(rows[0].image, 'https://i.ebayimg.com/images/g/example/s-l1600.jpg');
  assert.equal(rows[0].descriptionAvailable, true);
  assert.equal(rows[0].recommendations, 3);
  assert.equal(rows[0].fields.itemTitle, 'ThermoWorks Saf-T-Log HACCP Temperature Logger 292-701 Probe Kit Case');

  const panel = core.buildPanelHtml({ mode: 'fliptracker', route: core.resolveFlipTrackerPage(url) });
  assert.match(panel, /id="ebay-bulk-sell-export-mode"/);
  assert.match(panel, /id="ebay-bulk-copy-json"/);
  assert.match(panel, /id="ebay-bulk-copy-llm"/);
  assert.match(core.buildEbayBulkSellLlmBrief(rows, core.getEbayBulkSellContext(url, { title: 'Revise listings' })), /ThermoWorks Saf-T-Log/);
});

test('detects Best Offer on active eBay listing exports', () => {
  const core = loadCore();
  const html = `
    <div qa-id="active-item-336677465198" class="active-item">
      <h3 class="item-title"><a href="/itm/336677465198"><span>Offer-enabled fixture</span></a></h3>
      <div class="item__price"><span>$70.00</span><span> Buy It Now</span></div>
      <div class="item__price-attrs">Or best offer</div>
    </div>
  `;

  const rows = core.parseFlipTrackerActiveListingsHtml(html, {
    url: 'https://www.ebay.com/mys/active',
  });

  assert.equal(rows[0].offersEnabled, true);
  assert.equal(core.parseEbayActiveLifecycleHtml(html)[0].offers_enabled, true);
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
  assert.match(html, /FlipperAddon/);
  assert.doesNotMatch(html, /hiba-subtitle/);
  assert.doesNotMatch(html, /id="hiba-current-mode-pill"/);
  assert.match(html, /id="fliptracker-listing-download"/);
  assert.match(html, /id="flipperaddon-site-switcher-toggle"/);
  assert.match(html, /id="flipperaddon-site-switcher-menu"/);
  assert.doesNotMatch(html, /ebay\.com|facebook\.com\/marketplace/i);
  assert.doesNotMatch(html, /id="hibid-bid-load"/);
  assert.doesNotMatch(html, /id="hibid-live-copy-llm"/);
  assert.doesNotMatch(html, /id="hibid-bid-results"/);
  assert.doesNotMatch(html, /id="fliptracker-listing-results"/);
  assert.match(html, /id="flipperaddon-toast"/);
});

test('eBay lifecycle panel exposes page and all-page sync actions', () => {
  const core = loadCore();
  const html = core.buildPanelHtml({
    mode: 'fliptracker',
    debugEnabled: false,
    route: { kind: 'fliptracker-ebay-sold', source: 'ebay' },
  });
  assert.match(html, /eBay Sold Orders/);
  assert.match(html, /id="fliptracker-lifecycle-sync-page"/);
  assert.match(html, /id="fliptracker-lifecycle-sync-all"/);
  assert.match(html, /id="fliptracker-lifecycle-connect"/);
  assert.match(html, /Copy JSON/);
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

test('blocks FlipTracker exports when current route source does not match rows', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'fliptracker-dom',
    context: { source: 'eBay', pageKind: 'fliptracker' },
    listings: [{ source: 'eBay', title: 'Active eBay listing', price: 40 }],
  }, 'fliptracker', { kind: 'fliptracker-ebay-active', source: 'ebay' })), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'fliptracker-dom',
    context: { source: 'Facebook Marketplace', pageKind: 'fliptracker' },
    listings: [{ source: 'Facebook Marketplace', title: 'Marketplace listing', price: 40 }],
  }, 'fliptracker', { kind: 'fliptracker-ebay-active', source: 'ebay' })), {
    ok: false,
    reason: 'fliptracker-source-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'fliptracker-dom',
    context: { source: 'eBay', pageKind: 'fliptracker' },
    listings: [{ source: 'eBay', title: 'Active eBay listing', price: 40 }],
  }, 'fliptracker', { kind: 'fliptracker-facebook', source: 'facebook' })), {
    ok: false,
    reason: 'fliptracker-source-mismatch',
  });
});
