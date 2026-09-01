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

const fixture = `<!doctype html><html><head><title>Magcubic 4K Smart Projector</title><meta property="og:image" content="https://media.sandhills.com/img.axd?id=7012043483&wid=&p=&ext=&w=0&h=0&sz=Max&checksum=abc&h=200&w=200"></head><body>
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
    <div>High Bid: 20.00 USD</div><div>Bid 22.00 USD</div><div>OPEN</div>
    <app-lot-tile id="lot-317882346" data-fixture-watch-tile>
      <div class="lot-lead-heading">MAGCUBIC 4K Smart Projector, WiFi BT</div>
      <div class="lot-tile-content"><button class="native-watch">Watch</button></div>
      <button>Bid 22.00 USD</button>
    </app-lot-tile>
  </main>
</body></html>`;

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
      ? route.fulfill({ status: 200, contentType: 'text/html', body: fixture })
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
    await page.evaluate(() => {
      const tile = document.querySelector('[data-fixture-watch-tile]');
      if (!tile) throw new Error('Fixture watch tile missing');
      tile.innerHTML = '<div class="lot-lead-heading">MAGCUBIC 4K Smart Projector, WiFi BT</div><div class="lot-tile-content"><button class="native-watch">Unwatch</button></div><button>Bid 22.00 USD</button>';
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
    await fixtureTile.screenshot({ path: path.join(artifacts, 'watch-redraw-restored.png') });

    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction((version) => document.documentElement.dataset.flippahContentVersion === version, expectedVersion);
    await page.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
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
      fidelity: copied.audit.fidelity, screenshots: artifacts,
    }));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
