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
    assert.ok(
      contentScriptMatches.length > 0 &&
        contentScriptMatches.every((pattern) => /hibid\.com/i.test(pattern)),
      `${target} content scripts must remain scoped to HiBid`,
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
