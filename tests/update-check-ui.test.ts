import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('popup exposes an accessible user-clicked Store update check', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');
  assert.match(popup, /id="check-updates"/);
  assert.match(popup, /aria-label="Check for Flippah updates"/);
  assert.match(popup, /requestUpdateCheck/);
  assert.match(popup, /addEventListener\('click', \(\) => void checkForUpdates\(\)\)/);
  assert.doesNotMatch(popup, /runtime\.reload\(/);
});

test('background remembers a downloaded update without forcing page reloads', async () => {
  const background = await readFile('src/background/index.ts', 'utf8');
  assert.match(background, /onUpdateAvailable\?\.addListener/);
  assert.match(background, /readyUpdateState\(details\.version, currentVersion\)/);
  assert.doesNotMatch(background, /runtime\.reload\(/);
});

test('Store manifest uses Chrome delivery and adds no updater permission', async () => {
  const manifest = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  assert.equal(manifest.version, '0.5.46');
  assert.equal(manifest.update_url, undefined);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'tabs', 'downloads', 'clipboardWrite']);
});
