import { createHash, randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const targetIndex = process.argv.indexOf('--target');
const targetArg = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.FLIPPAH_CHROME_PATH;
if (!targetArg) {
  throw new Error('Pass --target <stable-unpacked-extension-directory> or set FLIPPAH_CHROME_PATH');
}

const source = path.resolve('dist', 'chrome');
const target = path.resolve(targetArg);
const sourceInsideTarget = path.relative(target, source);
const targetInsideSource = path.relative(source, target);
if (
  target === source
  || (!targetInsideSource.startsWith('..') && !path.isAbsolute(targetInsideSource))
  || (!sourceInsideTarget.startsWith('..') && !path.isAbsolute(sourceInsideTarget))
) {
  throw new Error('The install target and dist/chrome must be disjoint');
}

async function exists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function inventory(root) {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Extension artifacts must not contain symbolic links: ${relative}`);
      }
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        files.push({
          path: relative,
          sha256: createHash('sha256').update(bytes).digest('hex')
        });
      } else {
        throw new Error(`Unsupported extension artifact entry: ${relative}`);
      }
    }
  }
  await visit(root);
  return files;
}

async function assertExactTree(expectedRoot, actualRoot) {
  const [expected, actual] = await Promise.all([inventory(expectedRoot), inventory(actualRoot)]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Installed extension does not exactly match dist/chrome');
  }
}

const manifestPath = path.join(source, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
function normalizedManifestKey(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : null;
}

function manifestIdentity(manifestValue) {
  if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue)) {
    throw new Error('Extension manifest must be a JSON object');
  }
  if (manifestValue.manifest_version !== 3
    || typeof manifestValue.name !== 'string'
    || !manifestValue.name.trim()
    || typeof manifestValue.version !== 'string'
    || !manifestValue.version.trim()) {
    throw new Error('Extension manifest is missing required fields');
  }
  if (Object.hasOwn(manifestValue, 'key') && typeof manifestValue.key !== 'string') {
    throw new Error('Extension manifest key must be a string');
  }
  const key = Object.hasOwn(manifestValue, 'key') ? normalizedManifestKey(manifestValue.key) : null;
  if (Object.hasOwn(manifestValue, 'key') && !key) {
    throw new Error('Extension manifest key must not be empty');
  }
  return key;
}

const sourceIdentity = manifestIdentity(manifest);
const parent = path.dirname(target);
const base = path.basename(target);
const nonce = `${process.pid}-${randomUUID()}`;
const staging = path.join(parent, `.${base}.flippah-staging-${nonce}`);
const backup = path.join(parent, `.${base}.flippah-backup-${nonce}`);
const lock = path.join(parent, `.${base}.flippah-install-lock`);
let priorMoved = false;
let published = false;
let stagingOwned = false;
let lockOwned = false;

function assertTemporaryPath(candidate) {
  const relative = path.relative(parent, path.resolve(candidate));
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove a temporary path outside the install parent');
  }
}

async function removeTemporary(candidate) {
  assertTemporaryPath(candidate);
  await rm(candidate, { recursive: true, force: true });
}

async function acquireInstallLock() {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await mkdir(lock);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST' || Date.now() >= deadline) {
        throw new Error('Unable to acquire the install lock for the target directory');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function readTargetIdentity() {
  try {
    const targetManifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
    return manifestIdentity(targetManifest);
  } catch {
    throw new Error('Refusing to replace an existing target with an unreadable or invalid manifest');
  }
}

await acquireInstallLock();
lockOwned = true;

try {
  const targetExistedAtPreflight = await exists(target);
  if (targetExistedAtPreflight) {
    const targetIdentity = await readTargetIdentity();
    if (targetIdentity !== sourceIdentity) {
      throw new Error('Refusing to replace an existing target with a different extension identity');
    }
  }

  // Stage and verify a complete replacement before the live path changes. Copy
  // the manifest last so even the staging tree never advertises partial bytes.
  if (await exists(staging)) throw new Error('Refusing to use an existing staging path');
  stagingOwned = true;
  await cp(source, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (entry) => path.basename(entry).toLowerCase() !== 'manifest.json'
  });
  await copyFile(manifestPath, path.join(staging, 'manifest.json'));
  await assertExactTree(source, staging);

  const freshSourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const freshSourceIdentity = manifestIdentity(freshSourceManifest);
  if (freshSourceIdentity !== sourceIdentity) {
    throw new Error('Source manifest identity changed during staging');
  }
  const stagedManifest = JSON.parse(await readFile(path.join(staging, 'manifest.json'), 'utf8'));
  if (manifestIdentity(stagedManifest) !== sourceIdentity) {
    throw new Error('Staged manifest identity does not match the source preflight');
  }

  const targetExistsImmediatelyBeforeReplacement = await exists(target);
  if (targetExistsImmediatelyBeforeReplacement !== targetExistedAtPreflight) {
    throw new Error('Install target changed during staging');
  }
  if (targetExistsImmediatelyBeforeReplacement) {
    const freshTargetIdentity = await readTargetIdentity();
    if (freshTargetIdentity !== sourceIdentity) {
      throw new Error('Install target identity changed during staging');
    }
  }

  if (targetExistsImmediatelyBeforeReplacement) {
    await rename(target, backup);
    priorMoved = true;
  }
  await rename(staging, target);
  published = true;
  await assertExactTree(source, target);
  if (priorMoved) await removeTemporary(backup);
} catch (error) {
  let cleanupError = null;
  try {
    if (published) {
      await rm(target, { recursive: true, force: true });
      if (priorMoved) await rename(backup, target);
    } else if (priorMoved && !(await exists(target))) {
      await rename(backup, target);
    }
  } catch (rollbackError) {
    cleanupError = rollbackError;
  }
  try {
    if (stagingOwned) await removeTemporary(staging);
  } catch (stagingCleanupError) {
    cleanupError ??= stagingCleanupError;
  }
  try {
    if (lockOwned) await removeTemporary(lock);
  } catch (lockCleanupError) {
    cleanupError ??= lockCleanupError;
  }
  if (cleanupError) throw new AggregateError([error, cleanupError], 'Install failed and cleanup was incomplete');
  throw error;
}

if (lockOwned) await removeTemporary(lock);

console.log(`Installed Flippah v${manifest.version} to ${target}`);
