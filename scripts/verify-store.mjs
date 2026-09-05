import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outdir = path.join(root, 'dist', 'chrome');
const manifest = JSON.parse(await readFile(path.join(outdir, 'manifest.json'), 'utf8'));
const background = await readFile(path.join(outdir, 'background.js'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.name, 'Flippah by ALOS');
assert.equal(manifest.permissions.includes('activeTab'), false, 'Store package must not request unused activeTab access');
assert.equal(manifest.permissions.includes('storage'), true);
assert.equal(manifest.permissions.includes('tabs'), true);
assert.equal(manifest.permissions.includes('downloads'), true);
assert.equal(manifest.permissions.includes('clipboardWrite'), true);
assert.equal(manifest.host_permissions.includes('https://www.ebay.com/*'), false);
assert.equal(manifest.host_permissions.includes('http://127.0.0.1/*'), true);
assert.doesNotMatch(background, /flippah:dev-auto-reload|flippahReload=/, 'Store service worker contains unpacked-only polling');
assert.doesNotMatch(background, /eval\s*\(|new\s+Function\s*\(/, 'Store service worker contains dynamic code execution');

for (const relative of [
  'manifest.json',
  'background.js',
  'content.js',
  'legacy-content.js',
  'auctionninja-content.js',
  'icons/icon-128.png',
  'popup/index.html',
  'popup/popup.js',
  'options/index.html',
  'options/options.js',
]) {
  const info = await stat(path.join(outdir, relative));
  assert.equal(info.isFile(), true, `Missing Store package file: ${relative}`);
  assert.ok(info.size > 0, `Empty Store package file: ${relative}`);
}

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

const inventory = await walk(outdir);
assert.equal(inventory.some((file) => /(?:^|\/)\.DS_Store$|\.map$|\.pem$|private|secret/i.test(file)), false);
console.log(`Verified Chrome Web Store build v${manifest.version}: ${inventory.length} packaged files.`);
