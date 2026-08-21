import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const targetIndex = process.argv.indexOf('--target');
const targetArg = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.FLIPPAH_CHROME_PATH;
if (!targetArg) {
  throw new Error('Pass --target <stable-unpacked-extension-directory> or set FLIPPAH_CHROME_PATH');
}

const source = path.resolve('dist', 'chrome');
const target = path.resolve(targetArg);
if (target === source || target.startsWith(`${source}${path.sep}`)) {
  throw new Error('The install target must be outside dist/chrome');
}

const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));

// Copy runtime files first and the manifest last. The live unpacked extension
// directory is never deleted, so an in-progress build cannot strand its popup.
await cp(source, target, {
  recursive: true,
  force: true,
  filter: (entry) => path.basename(entry).toLowerCase() !== 'manifest.json'
});
await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Installed Flippah v${manifest.version} to ${target}`);
