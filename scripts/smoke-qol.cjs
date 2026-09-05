const { chromium } = require('C:/Users/ashby/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'dist', 'chrome');
const expectedVersion = String(require(path.join(root, 'package.json')).version);
const artifacts = path.join(root, 'artifacts', 'acceptance', `v${expectedVersion}`);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flippah-qol-'));
const fixtureUrl = 'https://hibid.com/lot/317882346/magcubic-4k-smart-projector--wifi-bt';
const watchlistUrl = 'https://hibid.com/account/watchlist';
fs.mkdirSync(artifacts, { recursive: true });

const fixture = `<!doctype html><html><head><title>Magcubic 4K Smart Projector</title><meta property="og:image" content="https://media.sandhills.com/img.axd?id=7012043483&wid=&p=&ext=&w=0&h=0&sz=Max&checksum=abc&h=200&w=200"><style>body{margin:0;font:16px system-ui;color:#17201c}main{max-width:1180px;margin:auto;padding:24px}#lot-information{border-collapse:collapse}th,td{padding:5px 8px;text-align:left}.lot-images{margin-top:16px}.native-bid-panel{position:fixed;right:24px;top:80px;width:280px;padding:18px;border:1px solid #ccd5cf;border-radius:12px;background:#fff}</style></head><body>
  <main>
    <h1>MAGCUBIC 4K Smart Projector, WiFi BT</h1>
    <table id="lot-information">
      <tr><th>Lot #</th><td>291</td></tr>
      <tr><th>Lead</th><td>MAGCUBIC 4K Smart Projector, WiFi BT</td></tr>
      <tr><th>Group - Category</th><td>Computers & Electronics - Projectors</td></tr>
      <tr><th>Description</th><td>Est. Retail Price: $9999.00</td></tr>
      <tr><th>Condition</th><td>New - Factory Sealed</td></tr>
      <tr><th>Damaged?</th><td>No</td></tr>
      <tr><th>Functional?</th><td>Yes</td></tr>
      <tr><th>Missing Parts?</th><td>No</td></tr>
    </table>
    <div class="lot-images"><img id="fixture-lot-photo" width="128" height="128" src="https://media.sandhills.com/img.axd?id=7012043483&wid=&p=&ext=&w=0&h=0&sz=Max&checksum=abc&h=200&w=200" alt="MAGCUBIC projector"></div>
    <section class="native-bid-panel"><div>High Bid: 20.00 USD</div><button>Bid 22.00 USD</button><div>OPEN</div></section>
  </main>
</body></html>`;

const watchlistFixture = `<!doctype html><html><head><title>HiBid Watch List</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f5f4;font:15px system-ui;color:#17201c}.watch-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;max-width:1180px;margin:auto;padding:28px}.current-bids-card{display:grid;grid-template-rows:auto 1fr auto;min-width:0;min-height:260px;border:1px solid #cbd5cf;border-radius:12px;background:#fff;overflow:hidden}.native-heading{padding:14px 16px;border-bottom:1px solid #e3e9e5;font-weight:800}.current-bids-card-content{display:grid;align-content:start;gap:9px;min-width:0;padding:12px 16px}.native-metadata{display:flex;flex-wrap:wrap;gap:8px}.native-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e3e9e5}.native-actions button{min-height:34px}
</style></head><body><main class="watch-grid">
  <article id="lot-0" class="bid-status-border current-bids-card" data-fixture-watch-tile>
    <header class="native-heading">Lot 291 | MAGCUBIC 4K Smart Projector, WiFi BT</header>
    <div class="current-bids-card-content"><a href="/lot/317882346/magcubic-4k-smart-projector">MAGCUBIC 4K Smart Projector, WiFi BT</a><div class="native-metadata"><span>Current Bid: 20.00 USD</span><span>Bid 22.00 USD</span><span>OPEN</span></div></div>
    <footer class="native-actions"><button>Unwatch</button><button>Notes</button><button>Bid 22.00 USD</button></footer>
  </article>
</main></body></html>`;

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromium.executablePath(),
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => new Promise((resolve) => chrome.storage.sync.set({ amazonAutoLookup: false, fullSizeImageHover: true }, resolve)));

    const page = await context.newPage();
    page.on('pageerror', (error) => console.error('[fixture pageerror]', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.error('[fixture console]', message.text()); });
    await page.route(fixtureUrl, (route) => route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: fixture })
      : route.continue());
    await page.route(watchlistUrl, (route) => route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: watchlistFixture })
      : route.continue());
    await page.route('https://media.sandhills.com/img.axd*', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fs.readFileSync(path.join(root, 'assets', 'icons', 'flippah-source.png')),
    }));
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction((version) => document.documentElement.dataset.flippahContentVersion === version, expectedVersion);
    await page.locator('#fixture-lot-photo').hover();
    const preview = page.locator('#flippah-fullsize-image-preview[data-visible="true"]');
    await preview.waitFor({ timeout: 15_000 });
    const previewSrc = await preview.locator('img').getAttribute('src');
    if (!previewSrc || /h=200&w=200/.test(previewSrc)) throw new Error(`Full-size preview kept thumbnail dimensions: ${previewSrc}`);
    await page.waitForFunction(() => {
      const preview = document.querySelector('#flippah-fullsize-image-preview[data-visible="true"]');
      const image = preview?.querySelector('img');
      const bounds = preview?.getBoundingClientRect();
      return Boolean(image?.complete && image.naturalWidth >= 500 && bounds && bounds.width >= 300 && bounds.height >= 300);
    }, { timeout: 15_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(artifacts, 'fullsize-hover.png'), fullPage: false });

    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'lotlens-root'; document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<section class="lotlens-panel"><input id="lotlens-comps-query"><input id="lotlens-resale"><input id="lotlens-premium" value="15"><div class="lotlens-actions"></div></section>';
    });

    const outcome = page.locator('#lotlens-root').locator('#flippah-intelligence');
    await page.waitForTimeout(1_000);
    console.log('[fixture state]', await page.evaluate(() => {
      const host = document.querySelector('#lotlens-root');
      return {
        contentVersion: document.documentElement.dataset.flippahContentVersion,
        host: Boolean(host), shadow: Boolean(host?.shadowRoot),
        shadowText: host?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '',
        intelligence: Boolean(host?.shadowRoot?.querySelector('#flippah-intelligence')),
      };
    }));
    await outcome.getByText('Record resale outcome', { exact: true }).waitFor({ timeout: 30_000 });
    await outcome.getByText('Record resale outcome', { exact: true }).click();
    await outcome.locator('#flippah-outcome-cost').fill('25');
    await outcome.locator('#flippah-outcome-sold').fill('80');
    await outcome.locator('#flippah-outcome-costs').fill('10');
    await outcome.locator('#flippah-outcome-channel').selectOption('ebay');
    await outcome.locator('#flippah-outcome-save').click();
    await outcome.getByText('Resale outcome saved', { exact: true }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(artifacts, 'outcome-saved.png'), fullPage: false });

    await page.goto(watchlistUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction((version) => document.documentElement.dataset.flippahContentVersion === version, expectedVersion);
    const fixtureTile = page.locator('[data-fixture-watch-tile]');
    await page.waitForFunction(() => Boolean(
      document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882346"]')?.shadowRoot?.querySelector('.flippah-deal-strip'),
    ), { timeout: 15_000 });
    await page.evaluate(() => document.querySelector('[data-fixture-watch-tile] a[href*="/lot/"]')?.setAttribute('href', '/lot/317882347/recycled-slot'));
    await page.waitForFunction(() => Boolean(
      document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882347"]')
      && !document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882346"]'),
    ), { timeout: 15_000 });
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882347"]');
      const strip = host?.shadowRoot?.querySelector('.flippah-deal-strip');
      return Boolean(strip && strip.getAttribute('aria-busy') === null && /Amazon/.test(strip.textContent || '') && /eBay/.test(strip.textContent || ''));
    }, { timeout: 15_000 });
    await page.evaluate(() => document.querySelector('[data-fixture-watch-tile] a[href*="/lot/"]')?.setAttribute('href', '/lot/317882346/magcubic-4k-smart-projector'));
    await page.waitForFunction(() => Boolean(
      document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882346"]')
      && !document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882347"]'),
    ), { timeout: 15_000 });
    await page.evaluate(() => {
      const tile = document.querySelector('[data-fixture-watch-tile]');
      if (!tile) throw new Error('Fixture watch tile missing');
      tile.innerHTML = '<header class="native-heading">Lot 291 | MAGCUBIC 4K Smart Projector, WiFi BT</header><div class="current-bids-card-content"><a href="/lot/317882346/magcubic-4k-smart-projector">MAGCUBIC 4K Smart Projector, WiFi BT</a><div class="native-metadata"><span>Current Bid: 20.00 USD</span><span>Bid 22.00 USD</span><span>OPEN</span></div></div><footer class="native-actions"><button>Unwatch</button><button>Notes</button><button>Bid 22.00 USD</button></footer>';
    });
    await page.waitForTimeout(2_000);
    console.log('[watch redraw state]', await page.evaluate(() => {
      const tile = document.querySelector('[data-fixture-watch-tile]');
      const host = tile?.querySelector('[data-flippah-retail-host-for]');
      const strip = host?.shadowRoot?.querySelector('.flippah-deal-strip');
      return {
        tileText: tile?.textContent?.replace(/\s+/g, ' ').trim(),
        hostFor: host?.getAttribute('data-flippah-retail-host-for'),
        stripText: strip?.textContent?.replace(/\s+/g, ' ').trim(),
        stripBusy: strip?.getAttribute('aria-busy'),
      };
    }));
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-fixture-watch-tile] [data-flippah-retail-host-for="317882346"]');
      const strip = host?.shadowRoot?.querySelector('.flippah-deal-strip');
      const text = strip?.textContent || '';
      return Boolean(strip
        && /Amazon/.test(text)
        && /eBay/.test(text)
        && /Condition/.test(text)
        && /All-in/.test(text)
        && !/Retail\s+\$9,?999/.test(text)
        && !/MAGCUBIC 4K Smart Projector/.test(text));
    }, { timeout: 15_000 });
    const watchLayout = await page.evaluate(() => {
      const card = document.querySelector('[data-fixture-watch-tile]');
      const body = card?.querySelector('.current-bids-card-content');
      const heading = card?.querySelector('.native-heading');
      const actions = card?.querySelector('.native-actions');
      const host = card?.querySelector('[data-flippah-retail-host-for="317882346"]');
      const hostRect = host?.getBoundingClientRect();
      const bodyRect = body?.getBoundingClientRect();
      const headingRect = heading?.getBoundingClientRect();
      const actionsRect = actions?.getBoundingClientRect();
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        cardDisplay: card ? getComputedStyle(card).display : '',
        hostInsideBody: Boolean(hostRect && bodyRect && hostRect.left >= bodyRect.left && hostRect.right <= bodyRect.right && hostRect.top >= bodyRect.top && hostRect.bottom <= bodyRect.bottom),
        overlapsHeading: overlaps(hostRect, headingRect),
        overlapsActions: overlaps(hostRect, actionsRect),
        nativeActions: [...(actions?.querySelectorAll('button') || [])].map((button) => button.textContent?.trim()),
        hostCount: card?.querySelectorAll('[data-flippah-retail-host-for]').length || 0,
      };
    });
    if (watchLayout.overflow > 1 || watchLayout.cardDisplay !== 'grid' || !watchLayout.hostInsideBody || watchLayout.overlapsHeading || watchLayout.overlapsActions || watchLayout.hostCount !== 1 || watchLayout.nativeActions.join('|') !== 'Unwatch|Notes|Bid 22.00 USD') {
      throw new Error(`Watch-list layout isolation failed: ${JSON.stringify(watchLayout)}`);
    }
    console.log('[watch layout metrics]', watchLayout);
    await fixtureTile.screenshot({ path: path.join(artifacts, 'watch-redraw-restored.png') });

    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction((version) => document.documentElement.dataset.flippahContentVersion === version, expectedVersion);
    const detailLayout = await page.evaluate(() => {
      const gallery = document.querySelector('.lot-images')?.getBoundingClientRect();
      const bidPanel = document.querySelector('.native-bid-panel')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        galleryVisible: Boolean(gallery && gallery.width > 0 && gallery.height > 0),
        bidPanelVisible: Boolean(bidPanel && bidPanel.width > 0 && bidPanel.height > 0),
        nativeAnnotationHosts: document.querySelectorAll('[data-flippah-retail-host-for]').length,
      };
    });
    if (detailLayout.overflow > 1 || !detailLayout.galleryVisible || !detailLayout.bidPanelVisible || detailLayout.nativeAnnotationHosts !== 0) {
      throw new Error(`Lot-detail layout isolation failed: ${JSON.stringify(detailLayout)}`);
    }
    await page.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    const updateButton = popup.getByRole('button', { name: 'Check for Flippah updates' });
    await updateButton.waitFor({ timeout: 15_000 });
    await updateButton.click();
    const updateStatus = popup.locator('.update-status');
    await updateStatus.waitFor({ timeout: 15_000 });
    const updateText = (await updateStatus.textContent() || '').trim();
    if (!updateText || /Checking the Chrome Web Store/i.test(updateText)) {
      throw new Error(`Update check did not reach a terminal user-facing state: ${updateText}`);
    }
    await popup.getByRole('button', { name: /Export outcomes \(1\)/ }).waitFor({ timeout: 15_000 });
    await popup.getByRole('button', { name: 'Scraper' }).click();
    await popup.getByRole('button', { name: 'Copy JSON' }).click();
    await popup.getByText(/Copied 1 lot.*details.*photos/i).waitFor({ timeout: 45_000 });
    const copied = JSON.parse(await popup.evaluate(() => navigator.clipboard.readText()));
    if (copied.audit?.fidelity?.metrics?.description?.percent !== 100) throw new Error('Description fidelity was not exported');
    if (copied.audit?.fidelity?.metrics?.images?.percent !== 100) throw new Error('Image fidelity was not exported');
    await popup.screenshot({ path: path.join(artifacts, 'popup-fidelity.png'), fullPage: true });

    console.log(JSON.stringify({
      browser: 'Chrome Playwright', extensionId, version: await worker.evaluate(() => chrome.runtime.getManifest().version),
      fullSizePreview: true, outcomeSaved: true, watchRedrawRestored: true, auctioneerRetailIgnored: true, conditionPill: true, outcomeExportVisible: true,
      updateCheck: updateText,
      fidelity: copied.audit.fidelity, screenshots: artifacts,
    }));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
