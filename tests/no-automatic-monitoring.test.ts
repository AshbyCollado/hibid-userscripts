import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the extension never schedules automatic HiBid monitoring or bid alerts', () => {
  const background = readFileSync(new URL('../src/background/index.ts', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(background, /watch-refresh|refreshWatchlist|flippah:overmax|flippah:ending/);
  assert.doesNotMatch(background, /chrome\.notifications/);
  assert.doesNotMatch(build, /['"]notifications['"]/);
});
