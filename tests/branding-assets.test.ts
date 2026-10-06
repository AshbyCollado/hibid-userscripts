import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

for (const size of [16, 32, 48, 128]) {
  test(`approved branding export ${size}px is RGBA and reaches both browser packages`, async () => {
    const filename = `icon-${size}.png`;
    const source = await readFile(new URL(`../assets/icons/${filename}`, import.meta.url));
    assert.deepEqual(source.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(source.toString('ascii', 12, 16), 'IHDR');
    assert.equal(source.readUInt32BE(16), size);
    assert.equal(source.readUInt32BE(20), size);
    assert.equal(source[24], 8);
    assert.equal(source[25], 6, 'preserve transparency in the RGBA export');
    for (const browser of ['chrome', 'waterfox']) {
      const manifest = JSON.parse(await readFile(new URL(`../dist/${browser}/manifest.json`, import.meta.url), 'utf8'));
      assert.equal(manifest.icons[String(size)], `icons/${filename}`);
      if (size <= 32) assert.equal(manifest.action.default_icon[String(size)], `icons/${filename}`);
      const bundled = await readFile(new URL(`../dist/${browser}/icons/${filename}`, import.meta.url));
      assert.deepEqual(bundled, source);
    }
  });
}
