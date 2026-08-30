import { assertEbayLifecycleEnvelope, serializeEbayLifecycleEnvelope, type EbayLifecycleEnvelope } from './lifecycle.js';

export interface EbayDeliveryResult { delivered: boolean; downloaded: boolean; duplicate: boolean; status: number | null; reason: string; }

export async function deliverEbayLifecycleEnvelope(
  envelope: EbayLifecycleEnvelope,
  token: string,
  post: (serialized: string, token: string) => Promise<{ ok: boolean; status: number; duplicate?: boolean; reason?: string }>,
  download: (serialized: string, filename: string) => Promise<void>
): Promise<EbayDeliveryResult> {
  assertEbayLifecycleEnvelope(envelope);
  if (!envelope.completeness.complete) throw new Error(envelope.completeness.reason || 'Incomplete eBay lifecycle snapshot');
  const serialized = serializeEbayLifecycleEnvelope(envelope);
  let result: { ok: boolean; status: number; duplicate?: boolean; reason?: string } = { ok: false, status: 0, reason: 'Bridge token is not configured' };
  if (token.trim()) {
    try { result = await post(serialized, token.trim()); }
    catch (error) { result = { ok: false, status: 0, reason: error instanceof Error ? error.message : String(error) }; }
  }
  if (result.ok) return { delivered: true, downloaded: false, duplicate: Boolean(result.duplicate), status: result.status, reason: '' };
  const filename = `FlipTracker-ebay-${envelope.page_kind}-${envelope.export_id.slice(-7)}.json`;
  await download(serialized, filename);
  return { delivered: false, downloaded: true, duplicate: false, status: result.status || null, reason: result.reason || `HTTP ${result.status}` };
}
