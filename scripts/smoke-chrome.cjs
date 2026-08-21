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
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run']
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto('https://hibid.com/lot/311206926/mahlk-nig-ek43-coffee-grinder', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Flippah', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(artifacts, 'chrome-lot-panel.png'), fullPage: false });

    const catalog = await context.newPage();
    await catalog.goto('https://hibid.com/catalog/765226/mid-summer-deals-overstock---liquidation---returns-w31', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await popup.getByRole('button', { name: 'Copy JSON' }).waitFor({ timeout: 15_000 });
    await popup.screenshot({ path: path.join(artifacts, 'chrome-popup-before.png'), fullPage: true });
    await popup.getByRole('button', { name: 'Copy JSON' }).click();
    await popup.close();

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await reopened.getByText(/Ready to copy \d+ lots|Copied \d+ lots/, { exact: false }).waitFor({ timeout: 120_000 });
    await reopened.getByRole('button', { name: 'Copy JSON' }).click();
    await reopened.getByText(/Copied \d+ lots/, { exact: false }).waitFor({ timeout: 15_000 });
    const clipboard = await reopened.evaluate(() => navigator.clipboard.readText());
    const payload = JSON.parse(clipboard);
    if (!payload.audit?.complete || payload.items.length !== payload.audit.expectedCount) throw new Error('Chrome copied payload failed exact coverage');
    if (new Set(payload.items.map((item) => item.eventItemId)).size !== payload.items.length) throw new Error('Chrome copied payload contains duplicate IDs');
    const probes = [payload.items[0], payload.items[Math.floor(payload.items.length / 2)], payload.items.at(-1)].filter(Boolean);
    if (probes.some((item) => !Array.isArray(item.images) || !item.description)) throw new Error('Chrome copied payload is missing rich probe fields');
    await reopened.screenshot({ path: path.join(artifacts, 'chrome-popup-complete.png'), fullPage: true });
    console.log(JSON.stringify({ browser: 'Chrome', version: await page.evaluate(() => navigator.userAgent), extensionId, count: payload.items.length, exact: true, popupReconnected: true }));
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
