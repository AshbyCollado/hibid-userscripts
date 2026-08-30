import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readTitleCorpusFile(corpusPath: string): Promise<string> {
  const contents = await readFile(corpusPath);
  if (!corpusPath.toLowerCase().endsWith('.gz')) return contents.toString('utf8');

  try {
    return (await gunzipAsync(contents)).toString('utf8');
  } catch (error) {
    throw new Error(
      `Failed to decompress gzip title corpus "${corpusPath}": ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
