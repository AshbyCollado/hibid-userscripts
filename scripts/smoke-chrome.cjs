const { chromium } = require('C:/Users/ashby/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'dist', 'chrome');
const artifacts = path.join(root, 'artifacts');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flippah-chrome-'));
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Branded Chrome no longer honors --load-extension in current stable
    // builds. Playwright's Chrome-for-Testing binary exercises the same MV3
    // runtime while preserving deterministic unpacked-extension acceptance.
    executablePath: process.env.FLIPPAH_CHROME_EXECUTABLE || chromium.executablePath(),
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run']
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  console.log('chrome-launched');
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;
    console.log(`worker-ready:${extensionId}`);
    const page = await context.newPage();
    await page.goto('https://hibid.com/lot/319523651/sprk150-1-5-hp-71-gpm-115v-cast-iron-pump', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Flippah', { exact: true }).first().waitFor({ timeout: 30_000 });
    console.log('lot-ui-ready');
    const cookieButton = page.getByRole('button', { name: 'Agree and Close' });
    if (await cookieButton.isVisible().catch(() => false)) await cookieButton.click();
    await page.getByText('Flippah', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'chrome-store-lot-1280x800.png'), fullPage: false });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await popup.getByRole('button', { name: 'Scraper' }).click();
    console.log('scraper-tab-open');
    await popup.getByRole('button', { name: 'Copy JSON' }).waitFor({ timeout: 15_000 });
    await popup.screenshot({ path: path.join(artifacts, 'chrome-popup-before.png'), fullPage: true });
    await popup.getByRole('button', { name: 'Copy JSON' }).click();
    console.log('copy-clicked');
    await popup.getByText(/Copied 1 lot/, { exact: false }).waitFor({ timeout: 45_000 });
    console.log('copy-confirmed');
    const clipboard = await popup.evaluate(() => navigator.clipboard.readText());
    const payload = JSON.parse(clipboard);
    if (!payload.audit?.complete || payload.items.length !== payload.audit.expectedCount) throw new Error('Chrome copied payload failed exact coverage');
    if (new Set(payload.items.map((item) => item.eventItemId)).size !== payload.items.length) throw new Error('Chrome copied payload contains duplicate IDs');
    const probes = [payload.items[0], payload.items[Math.floor(payload.items.length / 2)], payload.items.at(-1)].filter(Boolean);
    if (probes.some((item) => !Array.isArray(item.images) || !item.description)) throw new Error('Chrome copied payload is missing rich probe fields');
    await popup.setViewportSize({ width: 640, height: 400 });
    await popup.screenshot({ path: path.join(artifacts, 'chrome-store-popup-640x400.png'), fullPage: false });
    console.log(JSON.stringify({ browser: 'Chrome for Testing', version: await page.evaluate(() => navigator.userAgent), extensionId, count: payload.items.length, exact: true }));
  } finally {
    console.log('closing-chrome');
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
