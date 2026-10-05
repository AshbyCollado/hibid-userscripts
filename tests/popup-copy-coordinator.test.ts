import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopyCoordinator } from '../src/popup/copy-coordinator.js';

test('a newer copy skips an older queued write', async () => {
  const clipboard: string[] = [];
  const coordinator = createCopyCoordinator(async (value) => { clipboard.push(value); });
  const first = coordinator.begin();
  const stale = coordinator.write(first, 'batch 1');
  const second = coordinator.begin();
  const latest = coordinator.write(second, 'batch 2');
  assert.equal(await stale, false);
  assert.equal(await latest, true);
  assert.deepEqual(clipboard, ['batch 2']);
});

test('a newer copy wins after an older clipboard write is already in flight', async () => {
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let clipboard = '';
  const coordinator = createCopyCoordinator(async (value) => {
    if (value === 'batch 1') { firstStarted(); await gate; }
    clipboard = value;
  });
  const first = coordinator.begin();
  const earlier = coordinator.write(first, 'batch 1');
  await started;
  const second = coordinator.begin();
  const latest = coordinator.write(second, 'batch 2');
  releaseFirst();
  assert.equal(await earlier, true);
  assert.equal(await latest, true);
  assert.equal(clipboard, 'batch 2');
});

test('a failed clipboard write does not prevent a later copy', async () => {
  let clipboard = '';
  const coordinator = createCopyCoordinator(async (value) => {
    if (value === 'denied') throw new Error('Clipboard denied');
    clipboard = value;
  });
  const first = coordinator.begin();
  await assert.rejects(coordinator.write(first, 'denied'), /Clipboard denied/);
  const second = coordinator.begin();
  assert.equal(await coordinator.write(second, 'batch 2'), true);
  assert.equal(clipboard, 'batch 2');
});
