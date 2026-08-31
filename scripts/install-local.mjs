import { createHash, randomUUID } from 'node:crypto';
import { copyFile, cp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
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
const parent = path.dirname(target);
const base = path.basename(target);
const nonce = `${process.pid}-${randomUUID()}`;
const staging = path.join(parent, `.${base}.flippah-staging-${nonce}`);
const backup = path.join(parent, `.${base}.flippah-backup-${nonce}`);
let priorMoved = false;
let published = false;

try {
  // Stage and verify a complete replacement before the live path changes. Copy
  // the manifest last so even the staging tree never advertises partial bytes.
  await cp(source, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (entry) => path.basename(entry).toLowerCase() !== 'manifest.json'
  });
  await copyFile(manifestPath, path.join(staging, 'manifest.json'));
  await assertExactTree(source, staging);

  if (await exists(target)) {
    await rename(target, backup);
    priorMoved = true;
  }
  await rename(staging, target);
  published = true;
  await assertExactTree(source, target);
  if (priorMoved) await rm(backup, { recursive: true, force: true });
} catch (error) {
  if (published) {
    await rm(target, { recursive: true, force: true });
    if (priorMoved) await rename(backup, target);
  } else if (priorMoved && !(await exists(target))) {
    await rename(backup, target);
  }
  await rm(staging, { recursive: true, force: true });
  throw error;
}

console.log(`Installed Flippah v${manifest.version} to ${target}`);
