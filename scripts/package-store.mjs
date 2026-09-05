import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, 'dist', 'chrome');
const outputDirectory = path.join(root, 'artifacts', 'chrome-web-store');
const output = path.join(outputDirectory, `flippah-by-alos-${packageJson.version}-chrome-web-store.zip`);
const fixedMtime = new Date('2000-01-01T00:00:00.000Z');

async function collect(directory, prefix = '') {
  const files = {};
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await collect(absolute, relative));
    else files[relative] = [new Uint8Array(await readFile(absolute)), { mtime: fixedMtime }];
  }
  return files;
}

await mkdir(outputDirectory, { recursive: true });
const archive = zipSync(await collect(source), { level: 9 });
await writeFile(output, archive);
const hash = createHash('sha256').update(archive).digest('hex').toUpperCase();
console.log(`${output}\nSHA256 ${hash}`);
