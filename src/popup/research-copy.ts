import type { FlippahSettings } from '../core/settings.js';
import { buildHibidLlmBrief, type HiBidExportPayload } from '../hibid/exports.js';
import { buildAuctionNinjaLlmBrief, type AuctionNinjaExportPayload } from '../auctionninja/exports.js';
import { buildHibidResearchBatchPacket, renderHibidResearchBatchPacket } from '../testing/research-batch-packet.js';
import { buildAuctionNinjaResearchBatchPacket, renderAuctionNinjaResearchBatchPacket } from '../testing/auctionninja-research-batch-packet.js';
import { clampResearchBatch, researchBatchCount, RESEARCH_BATCH_SIZE } from './research-batch-selection.js';

export type ResearchCopyPayload = HiBidExportPayload | AuctionNinjaExportPayload;

function isHiBidPayload(payload: ResearchCopyPayload): payload is HiBidExportPayload {
  return payload.context.source === 'HiBid';
}

export function buildResearchCopyText(
  payload: ResearchCopyPayload,
  settings: FlippahSettings,
  format: 'json' | 'llm',
  requestedBatch: number,
): { text: string; batchNumber: number; batchCount: number } {
  const count = payload.items.length;
  if (format === 'json') return { text: JSON.stringify(payload, null, 2), batchNumber: 0, batchCount: researchBatchCount(count) };
  if (count <= RESEARCH_BATCH_SIZE) {
    return {
      text: isHiBidPayload(payload)
        ? buildHibidLlmBrief(payload, settings)
        : buildAuctionNinjaLlmBrief(payload, settings),
      batchNumber: 0,
      batchCount: researchBatchCount(count),
    };
  }
  const batchNumber = clampResearchBatch(requestedBatch, count);
  return {
    text: isHiBidPayload(payload)
      ? renderHibidResearchBatchPacket(buildHibidResearchBatchPacket(payload, batchNumber))
      : renderAuctionNinjaResearchBatchPacket(buildAuctionNinjaResearchBatchPacket(payload, batchNumber)),
    batchNumber,
    batchCount: researchBatchCount(count),
  };
}
