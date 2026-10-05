import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repository, 'scripts', 'install-local.mjs');

async function fixture(sourceManifest: string, targetManifest?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flippah-install-local-identity-'));
  const source = path.join(root, 'dist', 'chrome');
  const target = path.join(root, 'old-target');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), sourceManifest);
  await writeFile(path.join(source, 'background.js'), 'current bytes\n');
  if (targetManifest !== undefined) {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'manifest.json'), targetManifest);
    await writeFile(path.join(target, 'old.js'), 'old bytes\n');
  }
  return { root, source, target };
}

async function assertNoTemporarySiblings(root: string) {
  const siblings = await readdir(root);
  assert.equal(siblings.some((entry) => entry.includes('.flippah-staging-')), false);
  assert.equal(siblings.some((entry) => entry.includes('.flippah-backup-')), false);
  assert.equal(siblings.some((entry) => entry.includes('.flippah-install-lock')), false);
}

async function removeFixtureRoot(root: string) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  await rm(resolved, { recursive: true, force: true });
}

function childResult(child: ReturnType<typeof spawn>) {
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function stopAndAwaitChild(child: ReturnType<typeof spawn> | null, done: Promise<unknown> | null) {
  if (!child || !done) return;
  if (child.exitCode === null) child.kill();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      done,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for installer child teardown')), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForFile(candidate: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(candidate);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.fail(`Timed out waiting for ${candidate}`);
}

function fails(root: string, target: string) {
  try {
    execFileSync(process.execPath, [installer, '--target', target], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe'
    });
  } catch (error) {
    return error as { stdout?: string; stderr?: string };
  }
  assert.fail('installer unexpectedly succeeded');
}

async function failsAfterCopyRace(fixtureRoot: { root: string; source: string; target: string }, race: 'source' | 'target') {
  const preload = path.join(fixtureRoot.root, 'race-preload.mjs');
  const racePath = race === 'source' ? path.join(fixtureRoot.source, 'manifest.json') : path.join(fixtureRoot.target, 'manifest.json');
  const raceManifest = '{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"race-key"}\n';
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const originalCopy = fs.promises.cp;
fs.promises.cp = async (...args) => {
  const result = await originalCopy(...args);
  fs.writeFileSync(${JSON.stringify(racePath)}, ${JSON.stringify(raceManifest)});
  return result;
};
syncBuiltinESMExports();
`);
  try {
    try {
      execFileSync(process.execPath, ['--import', pathToFileURL(preload).href, installer, '--target', fixtureRoot.target], {
        cwd: fixtureRoot.root,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      return error as { stdout?: string; stderr?: string };
    }
    assert.fail(`${race} race unexpectedly succeeded`);
  } finally {
    await rm(preload, { force: true });
  }
}

test('local install refuses missing or different target identity before replacement', async () => {
  for (const targetManifest of [
    '{"manifest_version":3,"version":"1.0.0","key":"different"}\n',
    '{"manifest_version":3,"version":"1.0.0"}\n'
  ]) {
    const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n', targetManifest.replace('"manifest_version":3,', '"manifest_version":3,"name":"Flippah",'));
    try {
      const result = fails(fixtureRoot.root, fixtureRoot.target);
      assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /Refusing to replace/);
      assert.equal(await readFile(path.join(fixtureRoot.target, 'old.js'), 'utf8'), 'old bytes\n');
      assert.equal(await readFile(path.join(fixtureRoot.target, 'manifest.json'), 'utf8'), targetManifest.replace('"manifest_version":3,', '"manifest_version":3,"name":"Flippah",'));
      await assertNoTemporarySiblings(fixtureRoot.root);
    } finally {
      await removeFixtureRoot(fixtureRoot.root);
    }
  }
});

test('local install fails closed for an invalid existing target manifest', async () => {
  for (const targetManifest of ['{not json\n', '[]\n', '{}\n']) {
    const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n', targetManifest);
    try {
      const result = fails(fixtureRoot.root, fixtureRoot.target);
      assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /unreadable or invalid manifest/);
      assert.equal(await readFile(path.join(fixtureRoot.target, 'old.js'), 'utf8'), 'old bytes\n');
      assert.equal(await readFile(path.join(fixtureRoot.target, 'manifest.json'), 'utf8'), targetManifest);
      await assertNoTemporarySiblings(fixtureRoot.root);
    } finally {
      await removeFixtureRoot(fixtureRoot.root);
    }
  }
});

test('local install fails closed when an existing target manifest is missing', async () => {
  const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n');
  await mkdir(fixtureRoot.target, { recursive: true });
  await writeFile(path.join(fixtureRoot.target, 'old.js'), 'old bytes\n');
  try {
    const result = fails(fixtureRoot.root, fixtureRoot.target);
    assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /unreadable or invalid manifest/);
    assert.equal(await readFile(path.join(fixtureRoot.target, 'old.js'), 'utf8'), 'old bytes\n');
    await assertNoTemporarySiblings(fixtureRoot.root);
  } finally {
    await removeFixtureRoot(fixtureRoot.root);
  }
});

test('local install rejects a keyed target when the store source has no key', async () => {
  const fixtureRoot = await fixture(
    '{"manifest_version":3,"name":"Flippah","version":"2.0.0"}\n',
    '{"manifest_version":3,"name":"Flippah","version":"1.0.0","key":"target-key"}\n'
  );
  try {
    const result = fails(fixtureRoot.root, fixtureRoot.target);
    assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /different extension identity/);
    assert.doesNotMatch(`${result.stdout ?? ''}${result.stderr ?? ''}`, /source-key|target-key/);
    assert.equal(await readFile(path.join(fixtureRoot.target, 'old.js'), 'utf8'), 'old bytes\n');
    await assertNoTemporarySiblings(fixtureRoot.root);
  } finally {
    await removeFixtureRoot(fixtureRoot.root);
  }
});

test('local install rejects malformed source manifests before staging', async () => {
  for (const sourceManifest of [
    '{}\n',
    '[]\n',
    '{"manifest_version":3,"name":"Flippah"}\n',
    '{"manifest_version":3,"name":"Flippah","version":"1.0.0","key":42}\n'
  ]) {
    const fixtureRoot = await fixture(sourceManifest);
    try {
      const result = fails(fixtureRoot.root, fixtureRoot.target);
      assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /manifest/);
      assert.equal(await readdir(fixtureRoot.root).then((entries) => entries.some((entry) => entry.includes('.flippah-staging-'))), false);
    } finally {
      await removeFixtureRoot(fixtureRoot.root);
    }
  }
});

test('local install allows a fresh target and a matching normalized identity key', async () => {
  const fresh = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n');
  try {
    const output = execFileSync(process.execPath, [installer, '--target', fresh.target], { cwd: fresh.root, encoding: 'utf8' });
    assert.match(output, /Installed Flippah v2\.0\.0/);
    assert.equal(await readFile(path.join(fresh.target, 'background.js'), 'utf8'), 'current bytes\n');
  } finally {
    await removeFixtureRoot(fresh.root);
  }

  const matching = await fixture(
    '{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source- key"}\n',
    '{"manifest_version":3,"name":"Flippah","version":"1.0.0","key":" source-key "}\n'
  );
  try {
    const output = execFileSync(process.execPath, [installer, '--target', matching.target], { cwd: matching.root, encoding: 'utf8' });
    assert.match(output, /Installed Flippah v2\.0\.0/);
    assert.equal(await readFile(path.join(matching.target, 'background.js'), 'utf8'), 'current bytes\n');
  } finally {
    await removeFixtureRoot(matching.root);
  }
});

test('local install rejects a source identity change during staging', async () => {
  const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n');
  try {
    const result = await failsAfterCopyRace(fixtureRoot, 'source');
    assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /Source manifest identity changed/);
    assert.equal(await existsForTest(fixtureRoot.target), false);
    await assertNoTemporarySiblings(fixtureRoot.root);
  } finally {
    await removeFixtureRoot(fixtureRoot.root);
  }
});

test('local install rejects a target identity change during staging', async () => {
  const fixtureRoot = await fixture(
    '{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n',
    '{"manifest_version":3,"name":"Flippah","version":"1.0.0","key":"source-key"}\n'
  );
  try {
    const result = await failsAfterCopyRace(fixtureRoot, 'target');
    assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /target identity changed/);
    assert.equal(await readFile(path.join(fixtureRoot.target, 'old.js'), 'utf8'), 'old bytes\n');
    assert.equal(await readFile(path.join(fixtureRoot.target, 'manifest.json'), 'utf8'), '{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"race-key"}\n');
    await assertNoTemporarySiblings(fixtureRoot.root);
  } finally {
    await removeFixtureRoot(fixtureRoot.root);
  }
});

test('local installs targeting the same directory contend cooperatively', async () => {
  const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n');
  const preload = path.join(fixtureRoot.root, 'contention-preload.mjs');
  const ready = path.join(fixtureRoot.root, 'contention-ready');
  const release = path.join(fixtureRoot.root, 'contention-release');
  let first: ReturnType<typeof spawn> | null = null;
  let second: ReturnType<typeof spawn> | null = null;
  let firstDone: Promise<unknown> | null = null;
  let secondDone: Promise<unknown> | null = null;
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const originalCopy = fs.promises.cp;
fs.promises.cp = async (...args) => {
  const result = await originalCopy(...args);
  fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
  while (!fs.existsSync(${JSON.stringify(release)}) ) await new Promise((resolve) => setTimeout(resolve, 10));
  return result;
};
syncBuiltinESMExports();
`);
  try {
    first = spawn(process.execPath, ['--import', pathToFileURL(preload).href, installer, '--target', fixtureRoot.target], {
      cwd: fixtureRoot.root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    firstDone = childResult(first);
    await waitForFile(ready);
    second = spawn(process.execPath, [installer, '--target', fixtureRoot.target], {
      cwd: fixtureRoot.root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    secondDone = childResult(second);
    let secondClosed = false;
    second.once('close', () => { secondClosed = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondClosed, false);
    await writeFile(release, 'release');
    const [firstResult, secondResult] = await Promise.all([firstDone, secondDone]) as [{ code: number | null; stdout: string; stderr: string }, { code: number | null; stdout: string; stderr: string }];
    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.match(firstResult.stdout, /Installed Flippah v2\.0\.0/);
    assert.match(secondResult.stdout, /Installed Flippah v2\.0\.0/);
    await assertNoTemporarySiblings(fixtureRoot.root);
  } finally {
    await writeFile(release, 'release').catch(() => {});
    await stopAndAwaitChild(first, firstDone);
    await stopAndAwaitChild(second, secondDone);
    await removeFixtureRoot(fixtureRoot.root);
  }
});

test('lock is released when staging cleanup fails', async () => {
  const fixtureRoot = await fixture('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"source-key"}\n');
  const preload = path.join(fixtureRoot.root, 'cleanup-failure-preload.mjs');
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const originalCopy = fs.promises.cp;
const originalRm = fs.promises.rm;
fs.promises.cp = async (...args) => {
  const result = await originalCopy(...args);
  fs.writeFileSync(${JSON.stringify(path.join(fixtureRoot.source, 'manifest.json'))}, ${JSON.stringify('{"manifest_version":3,"name":"Flippah","version":"2.0.0","key":"race-key"}\\n')});
  return result;
};
fs.promises.rm = async (candidate, ...args) => {
  if (String(candidate).includes('.flippah-staging-')) throw new Error('forced staging cleanup failure');
  return originalRm(candidate, ...args);
};
syncBuiltinESMExports();
`);
  try {
    const result = failsWithImport(fixtureRoot.root, fixtureRoot.target, preload);
    assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /cleanup was incomplete/);
    const siblings = await readdir(fixtureRoot.root);
    assert.equal(siblings.some((entry) => entry.includes('.flippah-install-lock')), false);
    assert.equal(siblings.some((entry) => entry.includes('.flippah-staging-')), true);
  } finally {
    await removeFixtureRoot(fixtureRoot.root);
  }
});

function failsWithImport(root: string, target: string, preload: string) {
  try {
    execFileSync(process.execPath, ['--import', pathToFileURL(preload).href, installer, '--target', target], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe'
    });
  } catch (error) {
    return error as { stdout?: string; stderr?: string };
  }
  assert.fail('installer unexpectedly succeeded');
}

async function existsForTest(candidate: string) {
  try {
    await readFile(path.join(candidate, 'manifest.json'));
    return true;
  } catch {
    return false;
  }
}
