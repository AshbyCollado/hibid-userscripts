import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

type Manifest = {
  host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};

const ebayOrigin = /(?:^|\.)ebay\.com$/i;
const productResearchRuntimeSignatures = [
  'FlippahEbayParser',
  'runProductResearch',
  'soldCompletedProven',
  '.research-table-row',
  "files: ['parser.js']",
];

function isEbayMatchPattern(pattern: string): boolean {
  try {
    const hostname = new URL(pattern.replace('*://', 'https://').replace('/*', '/')).hostname;
    return ebayOrigin.test(hostname);
  } catch {
    return /ebay\.com/i.test(pattern);
  }
}

test('generated packages cannot acquire eBay origins or inject Seller Hub scripts', async () => {
  for (const target of ['chrome', 'waterfox']) {
    const manifest = JSON.parse(
      await readFile(`dist/${target}/manifest.json`, 'utf8'),
    ) as Manifest;
    const hostPermissions = manifest.host_permissions ?? [];
    const contentScriptMatches = (manifest.content_scripts ?? []).flatMap(
      (entry) => entry.matches ?? [],
    );

    assert.equal(
      hostPermissions.some(isEbayMatchPattern),
      false,
      `${target} must not request an eBay origin`,
    );
    assert.equal(
      contentScriptMatches.some(isEbayMatchPattern),
      false,
      `${target} must not inject a content script on eBay`,
    );
    assert.ok(contentScriptMatches.length > 0, `${target} must inject a supported auction runtime`);
    assert.ok(
      contentScriptMatches.every((pattern) => /(?:hibid|auctionninja)\.com/i.test(pattern)),
      `${target} content scripts must remain scoped to HiBid and AuctionNinja`,
    );
  }
});

test('generated HiBid runtimes exclude the dedicated Product Research parser', async () => {
  for (const target of ['chrome', 'waterfox']) {
    const manifest = JSON.parse(
      await readFile(`dist/${target}/manifest.json`, 'utf8'),
    ) as Manifest;
    const scriptPaths = new Set([
      'background.js',
      ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
    ]);
    const runtime = (
      await Promise.all(
        [...scriptPaths].map((scriptPath) =>
          readFile(`dist/${target}/${scriptPath}`, 'utf8'),
        ),
      )
    ).join('\n');

    for (const signature of productResearchRuntimeSignatures) {
      assert.doesNotMatch(
        runtime,
        new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${target} unexpectedly contains Product Research runtime signature ${signature}`,
      );
    }
  }
});

test('generated packages load one modern runtime containing the visible lot-page action', async () => {
  for (const target of ['chrome', 'waterfox']) {
    const manifest = JSON.parse(
      await readFile(`dist/${target}/manifest.json`, 'utf8'),
    ) as Manifest;
    const contentScripts = (manifest.content_scripts ?? []).flatMap(
      (entry) => entry.js ?? [],
    );
    const modernRuntime = await readFile(`dist/${target}/content.js`, 'utf8');
    const auctionNinjaRuntime = await readFile(`dist/${target}/auctionninja-content.js`, 'utf8');
    const legacyRuntime = await readFile(`dist/${target}/legacy-content.js`, 'utf8');

    assert.equal(
      contentScripts.filter((scriptPath) => scriptPath === 'content.js').length,
      1,
      `${target} must load the modern content runtime exactly once`,
    );
    assert.match(modernRuntime, /Analyze books in Flippah/);
    assert.match(modernRuntime, /flippah-auction-handoff/);
    assert.doesNotMatch(legacyRuntime, /Analyze books in Flippah/);
    assert.doesNotMatch(legacyRuntime, /flippah-auction-handoff/);
    assert.equal(
      contentScripts.filter((scriptPath) => scriptPath === 'auctionninja-content.js').length,
      1,
      `${target} must load the AuctionNinja runtime exactly once`,
    );
    assert.match(auctionNinjaRuntime, /AuctionNinja/);
    assert.doesNotMatch(auctionNinjaRuntime, /Analyze books in Flippah|flippah-auction-handoff/);
  }
});
