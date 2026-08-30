import assert from 'node:assert/strict';
import test from 'node:test';
import { endingAlarmSpecs, markEndingAlertNotified } from '../src/core/watch-alerts.js';

test('ending alarms are scheduled once until their durable notification flag is set', () => {
  const now = 1_000_000;
  const lot = { lotId: '42', endsAt: now + 20 * 60_000 };
  assert.deepEqual(endingAlarmSpecs(lot, now).map((item) => item.suffix), ['15m', '2m']);

  const after15 = markEndingAlertNotified(lot, '15m')!;
  assert.equal(after15.notifiedT15, true);
  assert.deepEqual(endingAlarmSpecs(after15, now).map((item) => item.suffix), ['2m']);
  assert.equal(markEndingAlertNotified(after15, '15m'), null);

  const after2 = markEndingAlertNotified(after15, '2m')!;
  assert.deepEqual(endingAlarmSpecs(after2, now), []);
});

test('ending alarms are not scheduled for invalid or ended lots', () => {
  assert.deepEqual(endingAlarmSpecs({ endsAt: null }, 100), []);
  assert.deepEqual(endingAlarmSpecs({ endsAt: 99 }, 100), []);
});
