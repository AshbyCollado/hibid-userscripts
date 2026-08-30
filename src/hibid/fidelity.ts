import type { HiBidLotRecord } from '../core/types.js';

export type HibidFidelityField =
  | 'identity'
  | 'title'
  | 'url'
  | 'description'
  | 'images'
  | 'category'
  | 'pricing'
  | 'statusOrTime';

export interface HibidFidelityMetric {
  present: number;
  total: number;
  percent: number;
  missingIds: string[];
}

export interface HibidFidelityAudit {
  score: number;
  coreComplete: boolean;
  metrics: Record<HibidFidelityField, HibidFidelityMetric>;
}

function recordId(item: HiBidLotRecord, index: number): string {
  return String(item.eventItemId || item.id || item.lot || `row-${index + 1}`);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function metric(items: HiBidLotRecord[], predicate: (item: HiBidLotRecord) => boolean): HibidFidelityMetric {
  const missingIds: string[] = [];
  let present = 0;
  items.forEach((item, index) => {
    if (predicate(item)) present += 1;
    else missingIds.push(recordId(item, index));
  });
  return {
    present,
    total: items.length,
    percent: items.length ? Math.round((present / items.length) * 100) : 100,
    missingIds,
  };
}

export function auditHibidRecordFidelity(items: HiBidLotRecord[]): HibidFidelityAudit {
  const metrics: Record<HibidFidelityField, HibidFidelityMetric> = {
    identity: metric(items, (item) => hasText(item.eventItemId || item.id) && hasText(item.lot)),
    title: metric(items, (item) => hasText(item.lead || item.title)),
    url: metric(items, (item) => {
      try {
        const url = new URL(item.url);
        return url.protocol === 'https:' && /(^|\.)hibid\.com$/i.test(url.hostname);
      } catch {
        return false;
      }
    }),
    description: metric(items, (item) => hasText(item.description) || hasText(item.descriptionHtml)),
    images: metric(items, (item) => Boolean(item.image) || (Array.isArray(item.images) && item.images.some(hasText))),
    category: metric(items, (item) => hasText(item.category) || (Array.isArray(item.categories) && item.categories.some(hasText))),
    pricing: metric(items, (item) => Number.isFinite(item.currentBid) || Number.isFinite(item.nextBid)),
    statusOrTime: metric(items, (item) => hasText(item.status) || hasText(item.timeLeft)),
  };
  const values = Object.values(metrics);
  return {
    score: values.length ? Math.round(values.reduce((sum, item) => sum + item.percent, 0) / values.length) : 100,
    coreComplete: metrics.identity.percent === 100 && metrics.title.percent === 100 && metrics.url.percent === 100,
    metrics,
  };
}
