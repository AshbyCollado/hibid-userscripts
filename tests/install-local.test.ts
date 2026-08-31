import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repository, 'scripts', 'install-local.mjs');

async function fileInventory(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await fileInventory(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

test('local install atomically replaces stale build output with the exact current artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flippah-install-local-'));
  try {
    const source = path.join(root, 'dist', 'chrome');
    const target = path.join(root, 'installed-extension');
    await mkdir(path.join(source, 'assets'), { recursive: true });
    await mkdir(path.join(target, 'assets'), { recursive: true });
    await writeFile(path.join(source, 'manifest.json'), '{"manifest_version":3,"version":"9.8.7"}\n');
    await writeFile(path.join(source, 'current.js'), 'current bytes\n');
    await writeFile(path.join(source, 'assets', 'current.css'), 'current styles\n');
    await writeFile(path.join(target, 'manifest.json'), '{"manifest_version":3,"version":"1.0.0"}\n');
    await writeFile(path.join(target, 'current.js'), 'outdated bytes\n');
    await writeFile(path.join(target, 'obsolete.js'), 'stale top-level file\n');
    await writeFile(path.join(target, 'assets', 'obsolete.js'), 'stale nested file\n');

    const output = execFileSync(process.execPath, [installer, '--target', target], {
      cwd: root,
      encoding: 'utf8'
    });

    assert.match(output, /Installed Flippah v9\.8\.7/);
    assert.deepEqual(await fileInventory(target), [
      'assets/current.css',
      'current.js',
      'manifest.json'
    ]);
    assert.equal(await readFile(path.join(target, 'current.js'), 'utf8'), 'current bytes\n');
    assert.equal(await readFile(path.join(target, 'manifest.json'), 'utf8'), '{"manifest_version":3,"version":"9.8.7"}\n');
    const siblings = await readdir(root);
    assert.equal(siblings.some((entry) => entry.includes('.flippah-staging-')), false);
    assert.equal(siblings.some((entry) => entry.includes('.flippah-backup-')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
