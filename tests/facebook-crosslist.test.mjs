import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';


function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


function loadCore(overrides = {}) {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  const sandbox = { console, globalThis: {}, ...overrides };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_BID_ASSISTANT_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-bid-assistant.user.js' });
  return sandbox.HiBidBidAssistantCore;
}


test('extracts deterministic cross-list evidence from an eBay item page', () => {
  const core = loadCore();
  const html = `
    <html><head>
      <meta property="og:title" content="Fallback title">
      <script type="application/ld+json">{
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Omega 1000 Centrifugal Juicer",
        "description":"Clean, tested and working. &lt;b&gt;Includes pusher.&lt;/b&gt;",
        "image":[
          "https://i.ebayimg.com/images/g/aaa/s-l500.jpg",
          "https://i.ebayimg.com/images/g/bbb/s-l1200.webp"
        ],
        "itemCondition":"https://schema.org/UsedCondition",
        "offers":{"price":"60.00","priceCurrency":"USD"},
        "additionalProperty":[{"@type":"PropertyValue","name":"Brand","value":"Omega"}]
      }</script>
      <script type="application/ld+json">{
        "@context":"https://schema.org",
        "@type":"BreadcrumbList",
        "itemListElement":[
          {"item":{"name":"Home &amp; Garden"}},
          {"item":{"name":"Kitchen Appliances"}},
          {"item":{"name":"Juicers"}}
        ]
      }</script>
    </head><body data-item-id="336677465197">
      <iframe id="desc_ifr" src="https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&amp;item=336677465197"></iframe>
    </body></html>`;

  const detail = core.extractEbayItemDetailHtml(html, { itemId: '336677465197' });
  assert.deepEqual(plain(detail), {
    itemId: '336677465197',
    itemUrl: 'https://www.ebay.com/itm/336677465197',
    title: 'Omega 1000 Centrifugal Juicer',
    price: 60,
    description: 'Clean, tested and working. Includes pusher.',
    descriptionUrl: 'https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=336677465197',
    condition: 'Used',
    categoryPath: ['Home & Garden', 'Kitchen Appliances', 'Juicers'],
    itemSpecifics: { Brand: 'Omega' },
    imageUrls: [
      'https://i.ebayimg.com/images/g/aaa/s-l1600.jpg',
      'https://i.ebayimg.com/images/g/bbb/s-l1600.webp',
    ],
  });
});


test('cross-list envelope keeps Seller Hub price and surfaces missing evidence', () => {
  const core = loadCore();
  const envelope = core.buildCrosslistEnvelope({
    itemId: '336677465197',
    title: 'Omega Juicer',
    price: 75,
    description: '',
    condition: '',
    categoryPath: [],
    itemSpecifics: {},
    imageUrls: [],
  }, {
    itemId: '336677465197',
    title: 'Omega Juicer',
    price: 60,
    quantityAvailable: 1,
    customLabel: 'BIN-A1',
  }, {
    location: 'Carteret, NJ',
    generatedAt: '2026-07-18T12:00:00Z',
  });

  assert.equal(envelope.schema_version, 'fliptracker.crosslist.draft.v1');
  assert.equal(envelope.listing.price, 60);
  assert.equal(envelope.listing.custom_label, 'BIN-A1');
  assert.equal(envelope.facebook_draft.location, 'Carteret, NJ');
  assert.equal(envelope.warnings.length, 4);
});


test('decodes numeric HTML entities from live eBay titles after JSON parsing', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Microsoft Surface Laptop 3 13.5&#034; i5 8GB",
      "offers":{"price":"229.99"}
    }</script>
  `, { itemId: '336694211286' });

  assert.equal(detail.title, 'Microsoft Surface Laptop 3 13.5" i5 8GB');
});


test('full-resolution image normalization accepts only eBay image hosts', () => {
  const core = loadCore();
  assert.equal(
    core.normalizeEbayCrosslistImageUrl('https://i.ebayimg.com/images/g/test/s-l225.jpg'),
    'https://i.ebayimg.com/images/g/test/s-l1600.jpg',
  );
  assert.equal(core.normalizeEbayCrosslistImageUrl('https://example.com/image.jpg'), '');
  assert.equal(core.normalizeEbayCrosslistImageUrl('http://i.ebayimg.com/image.jpg'), '');
});


test('recognizes current eBay description host and prefers the seller description', async () => {
  const core = loadCore();
  const itemHtml = `
    <meta property="og:description" content="Microsoft Surface Laptop 3 13.5 inch i5 8GB 128GB SSD Windows 11">
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Microsoft Surface Laptop 3",
      "image":[{"@type":"ImageObject","url":"https://i.ebayimg.com/images/g/live/s-l1600.jpg"}],
      "offers":{"price":"229.99"}
    }</script>
    <iframe id="desc_ifr" src="https://itm.ebaydesc.com/itmdesc/336694211286?t=0&amp;category=177"></iframe>`;
  const envelope = await core.enrichEbayListingForCrosslist({
    itemId: '336694211286',
    title: 'Microsoft Surface Laptop 3',
    price: 229.99,
  }, {
    location: 'Carteret, NJ',
    generatedAt: '2026-07-18T12:00:00Z',
    fetchText: async () => itemHtml,
    fetchDescriptionText: async url => {
      assert.equal(url, 'https://itm.ebaydesc.com/itmdesc/336694211286?t=0&category=177');
      return '<div>Fully tested. Includes charger. Minor cosmetic wear shown in photos.</div>';
    },
  });

  assert.equal(envelope.listing.description, 'Fully tested. Includes charger. Minor cosmetic wear shown in photos.');
  assert.deepEqual(plain(envelope.listing.image_urls), [
    'https://i.ebayimg.com/images/g/live/s-l1600.jpg',
  ]);
});


test('resolves dedicated Facebook draft and published routes', () => {
  const core = loadCore();
  const create = new URL('https://www.facebook.com/marketplace/create/item');
  const published = new URL('https://www.facebook.com/marketplace/item/123456789012345/');
  assert.equal(core.resolveFlipTrackerPage(create).kind, 'fliptracker-facebook-create');
  assert.equal(core.resolveFlipTrackerPage(published).kind, 'fliptracker-facebook-published');
  assert.equal(core.isFlipTrackerListingPage(create), true);
  assert.equal(core.isFlipTrackerListingPage(published), true);
});


test('renders cross-list controls only on their matching workflow pages', () => {
  const core = loadCore();
  const ebayHtml = core.buildPanelHtml({
    mode: 'fliptracker',
    route: { kind: 'fliptracker-ebay-active', source: 'ebay' },
  });
  const facebookHtml = core.buildPanelHtml({
    mode: 'fliptracker',
    route: { kind: 'fliptracker-facebook-create', source: 'facebook' },
  });
  assert.match(ebayHtml, /Queue Facebook Draft/);
  assert.match(ebayHtml, /Facebook draft source/);
  assert.doesNotMatch(ebayHtml, /Fill Next eBay Draft/);
  assert.match(facebookHtml, /Fill Next eBay Draft/);
  assert.doesNotMatch(facebookHtml, /Sync All eBay/);
});


test('fills required Facebook draft fields and leaves category warnings reviewable', async () => {
  const core = loadCore();
  const setCalls = [];
  const selectCalls = [];
  const result = await core.fillFacebookMarketplaceDraft({
    item_id: '336677465197',
    evidence_hash: 'evidence-1',
    facebook_draft: {
      title: 'Omega Juicer',
      price: 60,
      description: 'Tested and working.',
      category: 'Home Goods',
      condition: 'Used - Good',
      location: 'Carteret, NJ',
      image_urls: ['https://i.ebayimg.com/images/g/test/s-l1600.jpg'],
    },
    warnings: ['Verify category.'],
  }, {
    setField: async (label, value) => {
      setCalls.push([label, value]);
      return { ok: true, reason: '' };
    },
    selectField: async (label, value) => {
      selectCalls.push([label, value]);
      return label === 'Category'
        ? { ok: false, reason: 'Category requires manual selection.' }
        : { ok: true, reason: '' };
    },
    uploadPhotos: async () => ({ ok: true, count: 1, reason: '' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.photo_count, 1);
  assert.deepEqual(plain(setCalls), [
    ['Title', 'Omega Juicer'],
    ['Price', '60'],
    ['Description', 'Tested and working.'],
    ['Location', 'Carteret, NJ'],
  ]);
  assert.deepEqual(plain(selectCalls), [['Category', 'Home Goods'], ['Condition', 'Used - Good']]);
  assert.match(result.warnings.join(' '), /manual selection/);
});


test('accepts Facebook whole-dollar price formatting after input events', async () => {
  const core = loadCore();
  let storedValue = '';
  const control = {
    tagName: 'INPUT',
    getAttribute(name) {
      return name === 'aria-label' ? 'Price' : null;
    },
    dispatchEvent() {},
  };
  Object.defineProperty(control, 'value', {
    get: () => storedValue,
    set: value => { storedValue = `$${Math.round(Number(value))}`; },
  });
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('input')) return [control];
      return [];
    },
  };

  const result = await core.setFacebookTextField(root, 'Price', '230');
  assert.equal(result.ok, true);
  assert.equal(storedValue, '$230');
});


test('opens the Facebook category group before selecting its leaf row', async () => {
  const core = loadCore({ setTimeout });
  let parentSelected = false;
  let selected = false;
  const categoryControl = {
    tagName: 'LABEL',
    textContent: '',
    getAttribute(name) {
      if (name === 'aria-label') return 'Category';
      if (name === 'role') return 'combobox';
      return null;
    },
    click() {},
  };
  const parentRow = {
    textContent: 'Electronics',
    getAttribute() { return null; },
    click() { parentSelected = true; },
  };
  const categoryRow = {
    textContent: 'Electronics & computersShipping available',
    getAttribute() { return null; },
    click() { selected = true; },
  };
  const dropdown = {
    querySelectorAll(selector) {
      if (selector !== '[aria-disabled="false"]') return [];
      return parentSelected ? [categoryRow] : [parentRow];
    },
  };
  const root = {
    querySelector(selector) {
      return selector.includes('[role="dialog"]') ? dropdown : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('input, textarea')) return [categoryControl];
      return [];
    },
  };

  const result = await core.chooseFacebookDropdownValue(root, 'Category', 'Electronics & computers', { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(parentSelected, true);
  assert.equal(selected, true);
});

test('maps Facebook leaf categories to their current parent groups', () => {
  const core = loadCore();
  assert.equal(core.facebookCategoryParent('Electronics & computers'), 'electronics');
  assert.equal(core.facebookCategoryParent('Video Games'), 'entertainment');
  assert.equal(core.facebookCategoryParent('Tools'), 'home & garden');
  assert.equal(core.facebookCategoryParent('Used - Good'), '');
});

test('selects Facebook leaf text even when only group rows expose aria-disabled', async () => {
  const core = loadCore({ setTimeout });
  let selected = false;
  const categoryControl = {
    tagName: 'LABEL',
    textContent: '',
    getAttribute(name) {
      if (name === 'aria-label') return 'Category';
      if (name === 'role') return 'combobox';
      return null;
    },
    click() {},
  };
  const groupRow = {
    textContent: 'Electronics',
    getAttribute() { return null; },
    click() {},
  };
  const leafText = {
    textContent: 'Electronics & computers',
    getAttribute() { return null; },
    click() { selected = true; },
  };
  const dropdown = {
    querySelectorAll(selector) {
      if (selector === '[aria-disabled="false"]') return [groupRow];
      if (selector === 'div, span') return [groupRow, leafText];
      return [];
    },
  };
  const root = {
    querySelector(selector) {
      return selector.includes('[role="dialog"]') ? dropdown : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('input, textarea')) return [categoryControl];
      return [];
    },
  };

  const result = await core.chooseFacebookDropdownValue(root, 'Category', 'Electronics & computers', { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(selected, true);
});


test('commits Facebook location through its autocomplete suggestion', async () => {
  const core = loadCore({
    Event: class Event { constructor(type) { this.type = type; } },
    KeyboardEvent: class KeyboardEvent { constructor(type) { this.type = type; } },
    setTimeout,
  });
  let storedValue = '';
  let expanded = 'false';
  const locationControl = {
    tagName: 'INPUT',
    focus() {},
    click() { expanded = 'true'; },
    dispatchEvent() {},
    getAttribute(name) {
      if (name === 'aria-label') return 'Location';
      if (name === 'role') return 'combobox';
      if (name === 'aria-expanded') return expanded;
      return null;
    },
  };
  Object.defineProperty(locationControl, 'value', {
    get: () => storedValue,
    set: value => { storedValue = String(value); },
  });
  const locationOption = {
    textContent: 'Carteret, New Jersey',
    getAttribute() { return null; },
    click() {
      storedValue = 'Carteret, NJ';
      expanded = 'false';
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('input, textarea')) return [locationControl];
      if (selector.includes('[role="option"]')) return [locationOption];
      return [];
    },
  };

  const result = await core.chooseFacebookLocationValue(root, 'Carteret, NJ', { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(storedValue, 'Carteret, NJ');
  assert.equal(expanded, 'false');
});


test('preserves a matching Facebook-owned default location', async () => {
  const core = loadCore();
  const locationSummary = {
    tagName: 'DIV',
    textContent: 'Carteret',
    getAttribute(name) {
      if (name === 'role') return 'button';
      if (name === 'aria-disabled') return 'true';
      return null;
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('[aria-disabled="true"]')) return [locationSummary];
      return [];
    },
  };

  const result = await core.chooseFacebookLocationValue(root, 'Carteret, NJ');
  assert.equal(result.ok, true);
  assert.equal(result.preserved, true);
});


test('fails a Facebook draft when a required value or photo upload is missing', async () => {
  const core = loadCore();
  const result = await core.fillFacebookMarketplaceDraft({
    item_id: '336677465197',
    evidence_hash: 'evidence-1',
    facebook_draft: { title: '', price: 60, description: 'Description', image_urls: [] },
  }, {
    setField: async () => ({ ok: true, reason: '' }),
    selectField: async () => ({ ok: true, reason: '' }),
    uploadPhotos: async () => ({ ok: false, count: 0, reason: 'No photos.' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Title is missing/);
  assert.match(result.errors.join(' '), /No photos/);
});


test('posts cross-list bridge requests with the local token', async () => {
  let request = null;
  const core = loadCore({
    GM_xmlhttpRequest(options) {
      request = options;
      options.onload({ status: 200, responseText: '{"ok":true,"action":"created"}' });
    },
  });
  const result = await core.crosslistBridgeRequest('/crosslist/queue', { value: 1 }, 'token-1');
  assert.equal(result.ok, true);
  assert.equal(request.url, 'http://127.0.0.1:8468/crosslist/queue');
  assert.equal(request.headers['X-FlipTracker-Token'], 'token-1');
  assert.equal(request.data, '{"value":1}');
});
