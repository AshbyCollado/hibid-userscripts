import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { readTitleCorpusFile } from '../scripts/title-corpus/corpus-io.js';

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'title-corpus-io-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('plain JSONL and gzip title corpus files load identically', async (t) => {
  const directory = await temporaryDirectory(t);
  const plainPath = path.join(directory, 'corpus.jsonl');
  const gzipPath = path.join(directory, 'corpus.jsonl.gz');
  const content = [
    JSON.stringify({ provider: 'hibid', eventItemId: '1', title: 'Cordless drill' }),
    JSON.stringify({ provider: 'hibid', eventItemId: '2', title: 'Camera & lens' }),
    '',
  ].join('\n');

  await Promise.all([
    writeFile(plainPath, content, 'utf8'),
    writeFile(gzipPath, gzipSync(content)),
  ]);

  const [plain, compressed] = await Promise.all([
    readTitleCorpusFile(plainPath),
    readTitleCorpusFile(gzipPath),
  ]);
  assert.equal(plain, content);
  assert.equal(compressed, plain);
});

test('malformed gzip title corpus files fail with a clear diagnostic', async (t) => {
  const directory = await temporaryDirectory(t);
  const corpusPath = path.join(directory, 'broken.jsonl.gz');
  await writeFile(corpusPath, Buffer.from('not a gzip archive', 'utf8'));

  await assert.rejects(
    readTitleCorpusFile(corpusPath),
    /Failed to decompress gzip title corpus .*broken\.jsonl\.gz/u,
  );
});
