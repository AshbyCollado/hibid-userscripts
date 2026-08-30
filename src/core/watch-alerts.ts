export type EndingAlertSuffix = '15m' | '2m';
export type EndingAlertFlag = 'notifiedT15' | 'notifiedT2';

export interface EndingAlarmSpec {
  suffix: EndingAlertSuffix;
  minutes: number;
  notifiedKey: EndingAlertFlag;
  when: number;
}

const ENDING_ALERTS: ReadonlyArray<readonly [EndingAlertSuffix, number, EndingAlertFlag]> = [
  ['15m', 15, 'notifiedT15'],
  ['2m', 2, 'notifiedT2']
];

export function endingAlarmSpecs(lot: Record<string, unknown>, now = Date.now()): EndingAlarmSpec[] {
  const endsAt = Number(lot.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= now) return [];
  return ENDING_ALERTS.flatMap(([suffix, minutes, notifiedKey]) => lot[notifiedKey]
    ? []
    : [{ suffix, minutes, notifiedKey, when: Math.max(now + 1000, endsAt - minutes * 60_000) }]);
}

export function markEndingAlertNotified(
  lot: Record<string, unknown>,
  suffix: EndingAlertSuffix
): Record<string, unknown> | null {
  const notifiedKey: EndingAlertFlag = suffix === '15m' ? 'notifiedT15' : 'notifiedT2';
  return lot[notifiedKey] ? null : { ...lot, [notifiedKey]: true };
}
