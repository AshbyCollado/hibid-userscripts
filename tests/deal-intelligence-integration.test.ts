import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';
import { visibleLotIdSignature } from '../src/content/deal-intelligence.js';
import { shouldReloadExtension } from '../src/background/dev-auto-reload.js';

test('Chrome and Waterfox use direct background Amazon transport without opening helper tabs', async () => {
  const chrome = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  const waterfox = JSON.parse(await readFile('dist/waterfox/manifest.json', 'utf8'));
  assert.equal(chrome.version, '0.4.0');
  assert.ok(chrome.host_permissions.includes('https://www.amazon.com/*'));
  assert.equal(chrome.host_permissions.includes('https://www.ebay.com/*'), false);
  assert.equal(chrome.permissions.includes('offscreen'), false);
  assert.equal(chrome.permissions.includes('declarativeNetRequest'), false);
  assert.equal(waterfox.permissions.includes('offscreen'), false);
  assert.equal(waterfox.permissions.includes('declarativeNetRequest'), false);
  assert.equal(chrome.content_scripts.some((entry: any) => entry.matches?.includes('https://www.amazon.com/*')), false);
  assert.equal(chrome.content_scripts.some((entry: any) => entry.matches?.some((value: string) => /ebay/i.test(value))), false);
  assert.equal(chrome.host_permissions.some((value: string) => /bestbuy|amazon\.ca/i.test(value)), false);
  assert.deepEqual(chrome.host_permissions, waterfox.host_permissions);
  const background = await readFile('src/background/index.ts', 'utf8');
  assert.match(background, /fetch\(url\.href/);
  assert.match(background, /credentials: 'include'/);
  assert.match(background, /cache: 'default'/);
  assert.doesNotMatch(background, /credentials: 'omit'/);
  assert.doesNotMatch(background, /AmazonHelper|chrome\.windows\.|flippahToken|amazon\.browser\.result/);
  assert.equal('web_accessible_resources' in chrome, false);
  assert.deepEqual(await readdir('dist/chrome/assets'), ['index-uNBN1arP.css']);
});

test('unpacked builds self-reload only when the installed semantic version changes', () => {
  assert.equal(shouldReloadExtension('0.3.51', '0.3.51'), false);
  assert.equal(shouldReloadExtension('0.3.51', '0.4.0'), true);
  assert.equal(shouldReloadExtension('0.3.51', 'not-a-version'), false);
});

test('HiBid redraws with the same stable lot IDs do not look like a new catalog', () => {
  const first = new JSDOM('<app-lot-tile id="lot-30"></app-lot-tile><app-lot-tile id="lot-10"></app-lot-tile>');
  const redraw = new JSDOM('<section><app-lot-tile id="lot-10"></app-lot-tile><app-lot-tile id="lot-30"></app-lot-tile></section>');
  const changed = new JSDOM('<app-lot-tile id="lot-10"></app-lot-tile><app-lot-tile id="lot-40"></app-lot-tile>');
  assert.equal(visibleLotIdSignature(first.window.document), '10|30');
  assert.equal(visibleLotIdSignature(redraw.window.document), '10|30');
  assert.equal(visibleLotIdSignature(changed.window.document), '10|40');
});

test('personalized watchlist exports use the account DOM and never extension-origin GraphQL', async () => {
  const content = await readFile('src/content/index.ts', 'utf8');
  assert.match(content, /\['watchlist', 'currentbids-winning'/);
  assert.match(content, /Watchlist changed during capture; refreshing snapshot/);
  assert.doesNotMatch(content, /abortableRuntime\('flippah:network\.account-watchlist'/);
});

test('retail transport returns normalized lookups and never exposes raw HTML or cache writes to content', async () => {
  const background = await readFile('src/background/index.ts', 'utf8');
  const policy = await readFile('src/intelligence/retail-policy.ts', 'utf8');
  assert.match(background, /flippah:retail\.lookup/);
  assert.doesNotMatch(background, /flippah:retail\.amazon-search|flippah:retail\.cache\.get|flippah:retail\.cache\.set/);
  assert.match(background, /fetch\(url\.href/);
  assert.match(background, /AMAZON_BODY_LIMIT/);
  assert.match(background, /joinInflight\(amazonInflight/);
  assert.match(background, /providerStateStorageKey/);
  assert.doesNotMatch(background, /flippah:ebay\.lookup/);
  assert.doesNotMatch(background, /const retailQueue:/);
  assert.match(background, /rejectionReasons\.every\(\(reason\) => \/\^attribute-/);
  assert.doesNotMatch(background, /evaluation\.matchedEvidence\.length >=/);
});

test('deal annotations are additive, stable-ID scoped, and do not rewrite HiBid layout', async () => {
  const content = await readFile('src/content/deal-intelligence.ts', 'utf8');
  const intelligence = await readFile('src/intelligence/us-deal-intelligence.ts', 'utf8');
  assert.match(content, /data-flippah-retail-for/);
  assert.match(content, /flippah-deal-dot/);
  assert.match(content, /flippah-deal-pill\.search/);
  assert.match(content, /flippah-search-pill/);
  assert.match(content, /buildRetailSearchPresentation\('amazon'/);
  assert.match(content, /buildRetailSearchPresentation\('ebay'/);
  assert.match(content, /buildRetailIndicatorTooltip/);
  assert.match(content, /explainHibidStatus/);
  assert.doesNotMatch(content, /Amazon: --|eBay: --/);
  assert.match(content, /content\.insertAdjacentElement\('beforebegin', strip\)/);
  assert.match(content, /if \(!strip\.isConnected\) return/);
  assert.match(content, /tileFor\(record\.lot\.id\)/);
  assert.match(content, /links\.amazon/);
  assert.match(content, /links\.ebay/);
  assert.match(content, /Sold and Completed results to verify/);
  assert.match(content, /eBay resale \(manual\)/);
  assert.doesNotMatch(content, /flippah:ebay\.lookup/);
  assert.match(content, /pill\.target = '_blank'/);
  assert.match(content, /focus-visible/);
  assert.doesNotMatch(content, /\.innerHTML\s*=/);
  assert.doesNotMatch(content, /\.remove\(\)|style\.display\s*=|style\.opacity\s*=|replaceWith\(|outerHTML\s*=/);
  assert.doesNotMatch(content, /querySelectorAll\([^)]*\)\.forEach\([^)]*hidden/);
  assert.match(content, /Condition warning:/);
  assert.match(content, /Mixed\/group lot:/);
  assert.match(content, /CAD - no USD comparison/);
  assert.match(intelligence, /\\d\[\\d,.\]\*\\s\+Can\\b/);
  assert.doesNotMatch(content, /details\('Auction Terms'\)|details\('Fee Evidence'\)/);
});

test('built lot calculator omits shipping UI and saved shipping cannot enter fee math', async () => {
  const legacy = await readFile('dist/chrome/legacy-content.js', 'utf8');
  assert.doesNotMatch(legacy, /<label for="lotlens-shipping">Shipping<\/label>/);
  assert.doesNotMatch(legacy, /shipCents:i\.shipCents|shipCents:wi\.shipCents|Budget is below shipping/);
});

test('scraper keeps simple price-check controls below its export actions', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');
  const options = await readFile('src/options/index.ts', 'utf8');
  assert.match(popup, /Price research/);
  assert.match(popup, /return 'Checking prices'/);
  assert.doesNotMatch(popup, /Amazon \$\{analysis\.amazonAnalyzed\}/);
  assert.doesNotMatch(popup, /eBay \$\{analysis\.ebayAnalyzed\}/);
  assert.match(popup, />Check again</);
  assert.match(popup, /Clear saved prices/);
  assert.match(popup, /Copy for AI/);
  assert.match(popup, /Copy JSON/);
  assert.ok(popup.indexOf('id="copy-llm"') < popup.indexOf('${analysisHtml}'));
  assert.doesNotMatch(popup, /analysis-counts|Amazon matches|US Deal Intelligence/);
  assert.match(options, /Automatically research Amazon\.com on supported HiBid pages/);
  assert.equal(DEFAULT_SETTINGS.amazonAutoLookup, true);
  assert.equal(normalizeSettings({}).retailTargetPct, 50);
  assert.equal(normalizeSettings({}).retailWarningPct, 25);
});

test('open-source QoL additions stay optional, local, and visible through end-user controls', async () => {
  const content = await readFile('src/content/deal-intelligence.ts', 'utf8');
  const page = await readFile('src/content/index.ts', 'utf8');
  const popup = await readFile('src/popup/index.ts', 'utf8');
  const exports = await readFile('src/hibid/exports.ts', 'utf8');
  assert.match(page, /installHibidImagePreview/);
  assert.match(content, /Record resale outcome/);
  assert.match(content, /flippah-outcome-save/);
  assert.match(popup, /Export outcomes/);
  assert.match(popup, /details \$\{payload\.audit\.fidelity\.metrics\.description\.percent\}%/);
  assert.match(exports, /auditHibidRecordFidelity/);
});
