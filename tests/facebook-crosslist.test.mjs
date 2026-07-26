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


function photoManifest(itemId, count, expectedCount = count) {
  const hex = index => String(index).padStart(2, '0').repeat(32);
  return {
    schema_version: 'fliptracker.crosslist.photos.v1',
    item_id: itemId,
    expected_count: expectedCount,
    archived_count: count,
    facebook_upload_count: Math.min(expectedCount, 10),
    photos: Array.from({ length: count }, (_, offset) => {
      const sequence = offset + 1;
      const sourceName = `${String(sequence).padStart(2, '0')}-source-${hex(sequence).slice(0, 12)}.jpg`;
      const optimizedName = `${String(sequence).padStart(2, '0')}-facebook-2048-${hex(sequence + 20).slice(0, 12)}.jpg`;
      return {
        sequence,
        filename: sourceName,
        relative_path: `photos/${itemId}/${sourceName}`,
        sha256: hex(sequence),
        width: 1600,
        height: 1200,
        bytes: 100000 + sequence,
        mime_type: 'image/jpeg',
        variants: {
          2048: {
            filename: optimizedName,
            relative_path: `photos/${itemId}/${optimizedName}`,
            sha256: hex(sequence + 20),
            width: 2048,
            height: 1536,
            bytes: 200000 + sequence,
            mime_type: 'image/jpeg',
          },
        },
      };
    }),
  };
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
    imageEvidence: 'product-json-ld',
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
  assert.equal(envelope.image_mode, 'verified-original');
  assert.equal(envelope.listing.image_mode, 'verified-original');
  assert.equal(envelope.facebook_draft.image_mode, 'verified-original');
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


test('cross-list envelope suppresses a seller description with a conflicting size variant', () => {
  const core = loadCore();
  const envelope = core.buildCrosslistEnvelope({
    itemId: '336701097242',
    title: 'TWIN BEDGEAR Dri-Tec Waterproof Performance Mattress Protector White',
    price: 29.99,
    description: 'eBay Bedgear Queen Dri-Tec Waterproof Mattress Protector',
    condition: 'New',
    categoryPath: ['Home & Garden', 'Bedding'],
    itemSpecifics: {},
    imageUrls: ['https://i.ebayimg.com/images/g/U2k/s-l1600.jpg'],
    imageEvidence: 'open-graph',
  }, {}, { location: 'Carteret, NJ' });

  assert.doesNotMatch(envelope.listing.description, /Queen/i);
  assert.match(envelope.listing.description, /TWIN BEDGEAR/);
  assert.ok(envelope.warnings.some(warning => /description says queen/i.test(warning)));
});


test('uses only the item Product gallery and rejects recommendation-module images', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <meta property="og:image" content="https://i.ebayimg.com/images/g/primary/s-l500.jpg">
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Bedgear Dri-Tec Mattress Protector",
      "image":[
        {"@type":"ImageObject","url":"https://i.ebayimg.com/images/g/actual-one/s-l500.jpg"},
        {"@type":"ImageObject","contentUrl":"https://i.ebayimg.com/images/g/actual-two/s-l1200.jpg"}
      ],
      "offers":{"price":"29.99"}
    }</script>
    <section aria-label="Sponsored recommendations">
      <img src="https://i.ebayimg.com/images/g/cat-photo/s-l500.jpg">
      <img src="https://i.ebayimg.com/images/g/other-mattress/s-l500.jpg">
    </section>
  `, { itemId: '336701097242' });

  assert.equal(detail.imageEvidence, 'product-json-ld');
  assert.deepEqual(plain(detail.imageUrls), [
    'https://i.ebayimg.com/images/g/actual-one/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/actual-two/s-l1600.jpg',
  ]);
});


test('recovers the complete eBay item gallery when JSON-LD contains only the lead photo', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <meta property="og:image" content="https://i.ebayimg.com/images/g/armani-one/s-l500.jpg">
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Emporio Armani EA 9037/S Sunglasses",
      "image":"https://i.ebayimg.com/images/g/armani-one/s-l500.jpg",
      "offers":{"price":"65.00"}
    }</script>
    <div aria-label="Picture 1 of 4"><img src="https://i.ebayimg.com/images/g/armani-one/s-l225.jpg"></div>
    <div aria-label="Picture 2 of 4"><img data-zoom-src="https://i.ebayimg.com/images/g/armani-two/s-l1200.jpg"></div>
    <div aria-label="Picture 3 of 4"><img src="https://i.ebayimg.com/images/g/armani-three/s-l500.jpg"></div>
    <div aria-label="Picture 4 of 4"><img src="https://i.ebayimg.com/images/g/armani-four/s-l500.jpg"></div>
    <section aria-label="Sponsored recommendations">
      <div aria-label="Picture 1 of 12"><img src="https://i.ebayimg.com/images/g/not-this-listing/s-l500.jpg"></div>
      <div aria-label="Picture 2 of 12"><img src="https://i.ebayimg.com/images/g/not-this-listing-two/s-l500.jpg"></div>
    </section>
  `, { itemId: '336701097241' });

  assert.equal(detail.imageEvidence, 'item-gallery');
  assert.equal(detail.imageExpectedCount, 4);
  assert.deepEqual(plain(detail.imageUrls), [
    'https://i.ebayimg.com/images/g/armani-one/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/armani-two/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/armani-three/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/armani-four/s-l1600.jpg',
  ]);
});


test('extracts fallback eBay condition and breadcrumb category evidence', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <meta property="og:title" content="Emporio Armani EA 9037/S Sunglasses | eBay">
    <script>window.__state={"conditionDisplayName":"Pre-Owned","categoryName":"Sunglasses"};</script>
    <nav aria-label="Breadcrumb">
      <a>Clothing, Shoes &amp; Accessories</a><a>Men</a><a>Men's Accessories</a><a>Sunglasses</a>
    </nav>
  `, { itemId: '336701097241', price: 65 });

  assert.equal(detail.condition, 'Pre-Owned');
  assert.deepEqual(plain(detail.categoryPath), [
    'Clothing, Shoes & Accessories', 'Men', "Men's Accessories", 'Sunglasses',
  ]);
});


test('extracts unquoted live eBay JSON-LD and elevated condition evidence', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <button aria-label="Pre-owned - Excellent - About this item condition">Pre-owned - Excellent</button>
    <script type=application/ld+json data-module=SEOBREADCRUMBS>
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"eBay","item":"https://www.ebay.com"},
        {"@type":"ListItem","position":2,"name":"Clothing, Shoes & Accessories"},
        {"@type":"ListItem","position":3,"name":"Sunglasses"}
      ]}
    </script>
    <script type=application/ld+json>
      {"@context":"https://schema.org","@type":"Product","name":"Emporio Armani EA 9037/S Sunglasses","offers":{"price":"65.00"}}
    </script>
  `, { itemId: '336701097241' });

  assert.equal(detail.condition, 'Pre-owned - Excellent');
  assert.equal(detail.price, 65);
  assert.deepEqual(plain(detail.categoryPath), ['eBay', 'Clothing, Shoes & Accessories', 'Sunglasses']);
});


test('prefers the richest eBay Product JSON and reads nested live condition evidence', () => {
  const core = loadCore();
  const detail = core.extractEbayItemDetailHtml(`
    <script type="application/ld+json">
      {"@type":"Product","name":"Torque Wrench","offers":{"price":"120.00"}}
    </script>
    <script type="application/ld+json">
      {"@type":"Product","name":"Torque Wrench","description":"New old stock torque wrench.","itemCondition":"https://schema.org/NewCondition","image":["https://i.ebayimg.com/images/g/one/s-l500.jpg"],"offers":{"price":"120.00"}}
    </script>
    <script>
      {"name":"CONDITION","displayLabel":{"textSpans":[{"text":"Condition:"}]},"displayValue":{"icon":{"accessibilityText":"More information - About this item condition"},"text":{"textSpans":[{"text":"New"}]}}}
    </script>
  `, { itemId: '336701097243' });

  assert.equal(detail.condition, 'New');
  assert.equal(detail.description, 'New old stock torque wrench.');
  assert.equal(detail.imageUrls.length, 1);
});


test('removes eBay branding and formats compressed listing specifications for Facebook', () => {
  const core = loadCore();
  const description = core.cleanEbayCrosslistDescription(
    'eBay \u200bAuthentic Emporio Armani Sunglasses (Model EA 9037/S) '
      + '\u200bSpecifications: \u200bModel Number: EA 9037/S \u200bColor Code: 000 '
      + '\u200bTemple Length: 125mm \u200bOrigin: Made in Italy '
      + '\u200bDesign: Eagle logo on the center bridge bridge. \u200bCondition: Excellent',
  );

  assert.doesNotMatch(description, /\beBay\b/i);
  assert.equal(description, [
    'Authentic Emporio Armani Sunglasses (Model EA 9037/S)',
    '',
    'Specifications',
    '- Model Number: EA 9037/S',
    '- Color Code: 000',
    '- Temple Length: 125mm',
    '- Origin: Made in Italy',
    '- Design: Eagle logo on the center bridge.',
    '- Condition: Excellent',
  ].join('\n'));
});


test('blocks a cross-list draft when eBay gallery evidence is incomplete', () => {
  const core = loadCore();
  const envelope = {
    listing: {
      title: 'Emporio Armani EA 9037/S Sunglasses',
      price: 65,
      description: 'Clean listing description.',
      condition: 'Pre-Owned',
      category_path: ['Sunglasses'],
      image_urls: ['https://i.ebayimg.com/images/g/one/s-l1600.jpg'],
      image_expected_count: 4,
    },
  };

  assert.deepEqual(plain(core.crosslistEnvelopeMissingEvidence(envelope)), ['photos (1/4)']);
  envelope.listing.image_urls.push(
    'https://i.ebayimg.com/images/g/two/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/three/s-l1600.jpg',
    'https://i.ebayimg.com/images/g/four/s-l1600.jpg',
  );
  assert.deepEqual(plain(core.crosslistEnvelopeMissingEvidence(envelope)), []);
});


test('removes eBay executable page state from seller descriptions', async () => {
  const core = loadCore();
  const envelope = await core.enrichEbayListingForCrosslist({
    itemId: '336701097243',
    title: 'Armstrong Torque Wrench | eBay',
    price: 120,
  }, {
    location: 'Carteret, NJ',
    fetchText: async () => `
      <meta property="og:title" content="Armstrong Torque Wrench | eBay">
      <iframe id="desc_ifr" src="https://itm.ebaydesc.com/itmdesc/336701097243"></iframe>`,
    fetchDescriptionText: async () => `
      <script>$ssgST=new Date().getTime();</script>
      <style>body { font-family: sans-serif; }</style>
      <div>New old stock torque wrench. Includes certificate and original packaging.</div>
      <script>$M_123_C=(window.$M_123_C||[]).concat({"meta":{"name":"SELLER_ITEM_DESC"}})</script>`,
  });

  assert.equal(envelope.listing.title, 'Armstrong Torque Wrench');
  assert.equal(
    envelope.listing.description,
    'New old stock torque wrench. Includes certificate and original packaging.',
  );
  assert.doesNotMatch(envelope.listing.description, /SELLER_ITEM_DESC|\$ssgST|trackingList/);
});


test('resolves dedicated Facebook draft and published routes', () => {
  const core = loadCore();
  const create = new URL('https://www.facebook.com/marketplace/create/item');
  const createHub = new URL('https://www.facebook.com/marketplace/create');
  const published = new URL('https://www.facebook.com/marketplace/item/123456789012345/');
  assert.equal(core.resolveFlipTrackerPage(create).kind, 'fliptracker-facebook-create');
  assert.equal(core.resolveFlipTrackerPage(createHub).kind, 'fliptracker-facebook-create-hub');
  assert.equal(core.resolveFlipTrackerPage(published).kind, 'fliptracker-facebook-published');
  assert.equal(core.isFlipTrackerListingPage(create), true);
  assert.equal(core.isFlipTrackerListingPage(createHub), true);
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
  assert.match(ebayHtml, /Create Facebook Draft/);
  assert.match(ebayHtml, /Advanced sync tools/);
  assert.match(ebayHtml, /Facebook draft source/);
  assert.match(ebayHtml, /Verified archive \(default\)/);
  assert.match(ebayHtml, /2048px optimized \(experimental\)/);
  assert.match(ebayHtml, /Facebook uploads at most 10 photos/);
  assert.doesNotMatch(ebayHtml, />Scan Page</);
  assert.doesNotMatch(ebayHtml, />Copy JSON</);
  assert.doesNotMatch(ebayHtml, /Open \+ Fill Next/);
  assert.match(facebookHtml, /Open \+ Fill Next/);
  assert.doesNotMatch(facebookHtml, /Sync All eBay/);
});


test('builds a one-shot Facebook auto-fill URL and detects existing draft content', () => {
  const core = loadCore({ URL });
  const nextUrl = core.facebookNextDraftUrl(
    { origin: 'https://www.facebook.com' },
    '336701097241',
  );
  assert.equal(nextUrl, 'https://www.facebook.com/marketplace/create/item?flipperaddon_autofill=1&flipperaddon_item_id=336701097241');
  assert.equal(core.facebookAutofillRequested({ href: nextUrl }), true);
  assert.equal(core.facebookAutofillItemId({ href: nextUrl }), '336701097241');
  assert.equal(core.facebookAutofillItemId({ href: `${nextUrl}x` }), '');
  assert.equal(core.facebookAutofillRequested({ href: 'https://www.facebook.com/marketplace/create/item' }), false);

  const titleControl = {
    value: 'Prepared listing',
    getAttribute(name) { return name === 'aria-label' ? 'Title' : ''; },
    closest() { return null; },
  };
  const root = {
    querySelectorAll(selector) { return selector === 'label' ? [] : [titleControl]; },
  };
  assert.equal(core.facebookDraftHasContent(root), true);
});


test('selected Facebook draft flow claims the selected eBay item id', () => {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  assert.match(source, /crosslistBridgeRequest\('\/crosslist\/claim', \{ item_id: requestedItemId \}\)/);
  assert.match(source, /fillNextCrosslistDraft\(requestedItemId, \{ autoSave \}\)/);
});


test('retired Facebook panel timers cannot claim another draft after route cleanup', () => {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  assert.match(source, /const fillNextCrosslistDraft = async[\s\S]*?if \(!panelIsCurrent\(\)\) return;/);
  assert.match(source, /if \(panelIsCurrent\(\) && !state\.busy && !facebookDraftHasContent\(document\)\) \{\s*fillNextCrosslistDraft\(requestedItemId, \{ autoSave \}\);/);
  assert.match(source, /if \(panelIsCurrent\(\) && !state\.busy && !facebookDraftHasContent\(document\)\) \{\s*fillNextCrosslistDraft\('', \{ autoSave: true \}\);/);
});


test('clears the panel busy chip after asynchronous work settles', () => {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!state\.busy\) \{\s*const chip = panel\.querySelector\('#hiba-session-chip'\);\s*if \(chip\?\.textContent === 'busy'\) chip\.textContent = 'idle';/);
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


test('Facebook dropdown selection cannot click FlipperAddon shortcut menus', async () => {
  const core = loadCore({ setTimeout });
  let shortcutClicked = false;
  let conditionSelected = false;
  const conditionControl = {
    tagName: 'LABEL',
    textContent: '',
    getAttribute(name) {
      if (name === 'aria-label') return 'Condition';
      if (name === 'role') return 'combobox';
      return null;
    },
    closest() { return null; },
    click() {},
  };
  const shortcutText = {
    textContent: 'new-listings',
    getAttribute() { return null; },
    closest(selector) { return selector === '#flipperaddon-panel' ? {} : null; },
    click() { shortcutClicked = true; },
  };
  const conditionText = {
    textContent: 'New Shipping available',
    getAttribute() { return null; },
    closest() { return null; },
    click() { conditionSelected = true; },
  };
  const addonMenu = {
    closest(selector) { return selector === '#flipperaddon-panel' ? {} : null; },
    querySelectorAll(selector) { return selector === 'div, span' ? [shortcutText] : []; },
  };
  const facebookDropdown = {
    closest() { return null; },
    querySelectorAll(selector) { return selector === 'div, span' ? [conditionText] : []; },
  };
  const root = {
    querySelector() { return addonMenu; },
    querySelectorAll(selector) {
      if (selector.includes('input, textarea')) return [conditionControl];
      if (selector.includes('[role="dialog"]')) return [addonMenu, facebookDropdown];
      return [];
    },
  };

  const result = await core.chooseFacebookDropdownValue(root, 'Condition', 'New', { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(conditionSelected, true);
  assert.equal(shortcutClicked, false);
});

test('Facebook batch save clicks only the page Save draft control', async () => {
  const core = loadCore({ setTimeout });
  let addonClicked = false;
  let saveClicked = false;
  const addonSave = {
    textContent: 'Save draft',
    matches() { return true; },
    closest(selector) { return selector === '#flipperaddon-panel' ? {} : null; },
    click() { addonClicked = true; },
  };
  const pageSave = {
    textContent: 'Save draft',
    matches() { return true; },
    closest() { return null; },
    click() { saveClicked = true; },
  };
  const root = {
    querySelectorAll() { return [addonSave, pageSave]; },
  };

  const result = await core.saveFacebookMarketplaceDraft(root, { waitMs: 0 });

  assert.equal(result.ok, true);
  assert.equal(saveClicked, true);
  assert.equal(addonClicked, false);
});

test('Facebook draft URL can explicitly enable the no-publish autosave batch', () => {
  const core = loadCore({ URL });
  const url = core.facebookNextDraftUrl(
    { origin: 'https://www.facebook.com' },
    '336701097241',
    { autoSave: true },
  );
  assert.match(url, /flipperaddon_autofill=1/);
  assert.match(url, /flipperaddon_item_id=336701097241/);
  assert.match(url, /flipperaddon_autosave=1/);
});

test('Facebook autosave lease permits one tab and blocks concurrent tabs', () => {
  const core = loadCore();
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const sessionA = {
    getItem() { return 'tab-a'; },
    setItem() {},
  };
  const sessionB = {
    getItem() { return 'tab-b'; },
    setItem() {},
  };

  assert.equal(core.claimFacebookAutoSaveLease(localStorage, sessionA, 1000), true);
  assert.equal(core.facebookAutoSaveLeaseOwned(localStorage, sessionA, 1001), true);
  assert.equal(core.claimFacebookAutoSaveLease(localStorage, sessionB, 1001), false);
  core.releaseFacebookAutoSaveLease(localStorage, sessionA);
  assert.equal(core.claimFacebookAutoSaveLease(localStorage, sessionB, 1002), true);
});

test('Facebook autosave batch marker is tab-scoped instead of profile-wide', () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const storage = values => ({
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  });
  const core = loadCore({
    localStorage: storage(localValues),
    sessionStorage: storage(sessionValues),
  });

  core.setFacebookAutoSaveBatchActive(true);

  assert.equal(core.facebookAutoSaveBatchActive(), true);
  assert.equal(sessionValues.get('flipperaddon_crosslist_autosave_active'), '1');
  assert.equal(localValues.has('flipperaddon_crosslist_autosave_active'), false);
});

test('Facebook autosave reset clears shared batch and per-tab state', () => {
  const core = loadCore();
  const localValues = new Map([
    ['flipperaddon_crosslist_autosave_active', '1'],
    ['flipperaddon_crosslist_autosave_lease', '{"owner":"tab-a"}'],
    ['flipperaddon_crosslist_autosave_pending', '{"item_id":"336701097243"}'],
  ]);
  const sessionValues = new Map([
    ['flipperaddon_crosslist_tab_id', 'tab-a'],
    ['flipperaddon_crosslist_autosave_active', '1'],
    ['flipperaddon_crosslist_autosave_pending', '{"item_id":"336701097243"}'],
  ]);
  const storage = values => ({
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  });

  core.resetFacebookAutoSaveBatch(storage(localValues), storage(sessionValues));

  assert.equal(localValues.size, 0);
  assert.equal(sessionValues.size, 0);
});

test('Facebook autosave confirmation requires the saved title and Draft status', () => {
  const core = loadCore();
  const pending = { title: 'TWIN BEDGEAR Performance Flex & Fit Waterproof Mattress Protector' };
  assert.equal(core.facebookSavedDraftVisible({
    body: { innerText: 'Your listings\nTWIN BEDGEAR Performance Flex & Fit Waterproof Mattress Protector\n$30\nDraft' },
  }, pending), true);
  assert.equal(core.facebookSavedDraftVisible({
    body: { innerText: 'Your listings\nDifferent item\n$30\nDraft' },
  }, pending), false);
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


test('downloads authenticated bridge manifest photos and assigns the full required gallery', async () => {
  class TestFile {
    constructor(parts, name, options = {}) {
      this.parts = parts;
      this.name = name;
      this.type = options.type || '';
    }
  }
  class TestDataTransfer {
    constructor() {
      this.files = [];
      this.items = { add: file => this.files.push(file) };
    }
  }
  const core = loadCore({ File: TestFile, Event: class Event {} });
  let dispatched = 0;
  const photoInput = {
    files: [],
    getAttribute(name) { return name === 'accept' ? 'image/jpeg,image/png,image/webp' : ''; },
    dispatchEvent() { dispatched += 1; },
  };
  const root = {
    querySelectorAll(selector) { return selector === 'input[type="file"]' ? [photoInput] : []; },
  };
  const itemId = '336701097241';
  const record = { item_id: itemId, image_mode: 'verified-original', photo_manifest: photoManifest(itemId, 4) };
  const requested = [];
  const result = await core.uploadFacebookDraftPhotos(root, record, itemId, {
    DataTransferClass: TestDataTransfer,
    requestBlob: async url => {
      requested.push(url);
      const sequence = Number(decodeURIComponent(url).match(/\/(\d{2})-source-/)?.[1] || 0);
      return { type: 'image/jpeg', size: 100000 + sequence, source: url };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 4);
  assert.equal(photoInput.files.length, 4);
  assert.deepEqual(photoInput.files.map(file => file.name), [
    '01-source-010101010101.jpg',
    '02-source-020202020202.jpg',
    '03-source-030303030303.jpg',
    '04-source-040404040404.jpg',
  ]);
  assert.ok(requested.every(url => url.startsWith(`http://127.0.0.1:8468/crosslist/photo/${itemId}/`)));
  assert.ok(dispatched >= 1);
});

test('rejects a bridge photo whose downloaded bytes do not match the manifest', async () => {
  const core = loadCore();
  const itemId = '336701097246';
  await assert.rejects(
    core.downloadCrosslistImageFiles(
      { item_id: itemId, photo_manifest: photoManifest(itemId, 1) },
      itemId,
      { requestBlob: async () => ({ type: 'image/jpeg', size: 99999 }) },
    ),
    /failed byte-count verification \(99999\/100001\)/,
  );
});


test('uses verified source by default and persists the experimental image mode', () => {
  const values = new Map();
  const core = loadCore({
    GM_getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    GM_setValue: (key, value) => values.set(key, value),
  });
  assert.equal(core.getCrosslistImageMode(), 'verified-original');
  assert.equal(core.saveCrosslistImageMode('facebook-optimized'), 'facebook-optimized');
  assert.equal(core.getCrosslistImageMode(), 'facebook-optimized');
  assert.equal(core.saveCrosslistImageMode('unsafe-mode'), 'verified-original');
});


test('selects 2048 optimized manifest files only in experimental mode', () => {
  const core = loadCore();
  const itemId = '336701097242';
  const manifest = photoManifest(itemId, 2);
  const verified = core.selectCrosslistManifestPhotos({ item_id: itemId, photo_manifest: manifest });
  const optimized = core.selectCrosslistManifestPhotos({
    item_id: itemId,
    image_mode: 'facebook-optimized',
    photo_manifest: manifest,
  });
  assert.equal(verified.mode, 'verified-original');
  assert.match(verified.photos[0].filename, /-source-/);
  assert.equal(optimized.mode, 'facebook-optimized');
  assert.match(optimized.photos[0].filename, /-facebook-2048-/);
  assert.equal(optimized.photos[0].width, 2048);
});


test('caps Facebook upload at ten while preserving the source gallery count', () => {
  const core = loadCore();
  const itemId = '336701097243';
  const selected = core.selectCrosslistManifestPhotos({
    item_id: itemId,
    photo_manifest: photoManifest(itemId, 14, 14),
  });
  assert.equal(selected.photos.length, 10);
  assert.equal(selected.upload_count, 10);
  assert.equal(selected.expected_count, 14);
  assert.equal(selected.capped, true);
});


test('rejects incomplete, duplicate, and invalid photo manifests before Facebook upload', () => {
  const core = loadCore();
  const itemId = '336701097244';
  const incomplete = photoManifest(itemId, 3, 4);
  assert.throws(
    () => core.selectCrosslistManifestPhotos({ item_id: itemId, photo_manifest: incomplete }),
    /archive is incomplete/,
  );

  const duplicate = photoManifest(itemId, 2);
  duplicate.photos[1].sha256 = duplicate.photos[0].sha256;
  assert.throws(
    () => core.selectCrosslistManifestPhotos({ item_id: itemId, photo_manifest: duplicate }),
    /duplicates an earlier archived image/,
  );

  const invalid = photoManifest(itemId, 1);
  invalid.photos[0].relative_path = '../../outside.jpg';
  assert.throws(
    () => core.selectCrosslistManifestPhotos({ item_id: itemId, photo_manifest: invalid }),
    /invalid archived path/,
  );

  const invalidBeyondFacebookLimit = photoManifest(itemId, 11, 11);
  invalidBeyondFacebookLimit.photos[10].sha256 = invalidBeyondFacebookLimit.photos[0].sha256;
  assert.throws(
    () => core.selectCrosslistManifestPhotos({ item_id: itemId, photo_manifest: invalidBeyondFacebookLimit }),
    /duplicates an earlier archived image/,
  );
});


test('authenticates loopback photo GET requests with the FlipTracker token', async () => {
  let request = null;
  const core = loadCore({
    GM_getValue: () => 'private-token',
    GM_xmlhttpRequest(options) {
      request = options;
      options.onload({ status: 200, response: { type: 'image/jpeg', size: 5000 } });
    },
  });
  await core.gmCrosslistRequest('http://127.0.0.1:8468/crosslist/photo/336701097245/01.jpg', 'blob');
  assert.equal(request.method, 'GET');
  assert.equal(request.headers['X-FlipTracker-Token'], 'private-token');
});


test('fails a permanently hanging eBay photo request instead of leaving the draft claimed forever', async () => {
  const core = loadCore({ setTimeout, clearTimeout });
  await assert.rejects(
    core.downloadCrosslistImageFiles(
      { item_id: '336701036874', photo_manifest: photoManifest('336701036874', 1) },
      '336701036874',
      {
        imageTimeoutMs: 20,
        requestBlob: () => new Promise(() => {}),
      },
    ),
    /archived photo 1\/1 timed out after 100ms/,
  );
});


test('bounds the complete Facebook photo stage when the uploader never settles', async () => {
  const core = loadCore({ setTimeout, clearTimeout });
  await assert.rejects(
    core.fillFacebookMarketplaceDraft({
      item_id: '336701036874',
      evidence_hash: 'evidence-hang',
      facebook_draft: {
        title: 'Rev-A-Shelf Door Mounting Kit',
        price: 13,
        description: 'New cabinet hardware kit.',
        category: 'Household',
        condition: 'New',
        location: 'Carteret, NJ',
        image_urls: ['https://i.ebayimg.com/images/g/hangs/s-l1600.jpg'],
      },
    }, {
      photoTimeoutMs: 20,
      setField: async () => ({ ok: true, reason: '' }),
      selectField: async () => ({ ok: true, reason: '' }),
      selectLocation: async () => ({ ok: true, reason: '' }),
      uploadPhotos: () => new Promise(() => {}),
    }),
    /Facebook photo upload timed out after 100ms/,
  );
});


test('reveals Facebook More details before locating the location control', async () => {
  const core = loadCore({
    Event: class Event { constructor(type) { this.type = type; } },
    KeyboardEvent: class KeyboardEvent { constructor(type) { this.type = type; } },
    setTimeout,
  });
  let revealed = false;
  let storedValue = '';
  let expanded = 'false';
  const moreDetails = {
    textContent: 'More details Attract more interest by including more',
    getAttribute() { return null; },
    closest() { return null; },
    click() { revealed = true; },
  };
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
      if (selector === 'button, [role="button"], div, span') return [moreDetails];
      if (selector.includes('input, textarea')) return revealed ? [locationControl] : [];
      if (selector.includes('[role="option"]')) return revealed ? [locationOption] : [];
      return [];
    },
  };

  const result = await core.chooseFacebookLocationValue(root, 'Carteret, NJ', { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(revealed, true);
  assert.equal(storedValue, 'Carteret, NJ');
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


test('keeps a Facebook draft reviewable when the live form omits its location control', async () => {
  const core = loadCore();
  const preview = {
    textContent: 'Listed a few seconds ago in Bridgewater',
    getAttribute() { return null; },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === 'div, span') return [preview];
      if (selector === 'button, [role="button"], div, span') return [preview];
      return [];
    },
  };

  const location = await core.chooseFacebookLocationValue(root, 'Carteret, NJ', { timeoutMs: 100 });
  assert.equal(location.ok, false);
  assert.equal(location.warningOnly, true);
  assert.match(location.reason, /preview currently shows Bridgewater/);

  const result = await core.fillFacebookMarketplaceDraft({
    item_id: '336701097243',
    evidence_hash: 'evidence-1',
    facebook_draft: {
      title: 'Armstrong torque wrench',
      price: 120,
      description: 'Clean seller description.',
      location: 'Carteret, NJ',
      image_urls: ['https://i.ebayimg.com/images/g/test/s-l1600.jpg'],
    },
  }, {
    setField: async () => ({ ok: true, reason: '' }),
    selectLocation: async () => location,
    uploadPhotos: async () => ({ ok: true, count: 1, reason: '' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.match(result.warnings.join(' '), /preview currently shows Bridgewater/);
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


test('refreshes the full cross-list queue concurrently without accepting incomplete evidence', async () => {
  const core = loadCore();
  const queued = [];
  const progress = [];
  let active = 0;
  let peak = 0;
  const listings = [1, 2, 3, 4, 5].map(index => ({
    item_id: `33670109724${index}`,
    title: `Listing ${index}`,
  }));

  const result = await core.refreshCrosslistQueueRecords(listings, {
    location: 'Carteret, NJ',
    concurrency: 2,
    onProgress: event => progress.push(event),
    enrich: async listing => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      if (listing.itemId.endsWith('3')) {
        return {
          item_id: listing.itemId,
          listing: { title: listing.title, price: 50, description: 'Description', condition: 'Used', category_path: ['Other'], item_url: `https://www.ebay.com/itm/${listing.itemId}`, image_urls: [] },
          facebook_draft: { title: listing.title, price: 50, description: 'Description', category: 'Other', condition: 'Used - Good', image_urls: [] },
        };
      }
      return {
        item_id: listing.itemId,
        listing: { title: listing.title, price: 50, description: 'Description', condition: 'Used', category_path: ['Other'], item_url: `https://www.ebay.com/itm/${listing.itemId}`, image_urls: ['https://i.ebayimg.com/test.jpg'] },
        facebook_draft: { title: listing.title, price: 50, description: 'Description', category: 'Other', condition: 'Used - Good', image_urls: ['https://i.ebayimg.com/test.jpg'] },
      };
    },
    queue: async envelope => {
      queued.push(envelope.item_id);
      return { ok: true, action: queued.length === 1 ? 'created' : 'updated' };
    },
  });

  assert.equal(peak, 2);
  assert.equal(result.total, 5);
  assert.equal(result.completed, 5);
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.updated, 3);
  assert.equal(result.counts.failed, 1);
  assert.equal(queued.length, 4);
  assert.equal(result.failures[0].itemId, '336701097243');
  assert.match(result.failures[0].error, /incomplete eBay evidence/i);
  assert.ok(progress.some(event => event.completed === 5));
});
