import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js';

test('Chrome and Waterfox use direct background Amazon transport without opening helper tabs', async () => {
  const chrome = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  const waterfox = JSON.parse(await readFile('dist/waterfox/manifest.json', 'utf8'));
  assert.equal(chrome.version, '0.3.23');
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
  assert.doesNotMatch(background, /if \(supportsAmazonHelperWindow\(\)\)/);
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
});

test('deal annotations are additive, stable-ID scoped, and do not rewrite HiBid layout', async () => {
  const content = await readFile('src/content/deal-intelligence.ts', 'utf8');
  const intelligence = await readFile('src/intelligence/us-deal-intelligence.ts', 'utf8');
  assert.match(content, /data-flippah-retail-for/);
  assert.match(content, /flippah-deal-dot/);
  assert.match(content, /content\.insertAdjacentElement\('beforebegin', strip\)/);
  assert.match(content, /if \(!strip\.isConnected\) return/);
  assert.match(content, /tileFor\(record\.lot\.id\)/);
  assert.match(content, /links\.amazon/);
  assert.match(content, /links\.ebay/);
  assert.match(content, /Open eBay Sold and Completed results/);
  assert.match(content, /eBay resale \(manual\)/);
  assert.doesNotMatch(content, /flippah:ebay\.lookup/);
  assert.match(content, /pill\.target = '_blank'/);
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
