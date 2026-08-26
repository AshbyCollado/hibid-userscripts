import type { AuctionRelayAcceptedV1 } from '../core/auction-relay.js';
import type { HibidLotHandoffV1, HiBidTransport } from '../core/types.js';
import { hydrateHibidLotHandoff, isHibidChallengeDocument } from '../hibid/handoff.js';

export interface HibidAuctionHandoffOptions {
  document: Document;
  sourceUrl: string;
  currentUrl: () => string;
  transport: HiBidTransport;
  send: (manifest: HibidLotHandoffV1) => Promise<AuctionRelayAcceptedV1>;
  initiatedAt?: string;
}

export async function runHibidAuctionHandoff(options: HibidAuctionHandoffOptions): Promise<AuctionRelayAcceptedV1> {
  if (isHibidChallengeDocument(options.document)) {
    throw new Error('HiBid is showing a challenge; complete it before sending this lot');
  }
  const manifest = await hydrateHibidLotHandoff(options.transport, options.sourceUrl, {
    initiatedAt: options.initiatedAt || new Date().toISOString(),
  });
  if (options.currentUrl() !== options.sourceUrl) {
    throw new Error('The HiBid page changed during photo enumeration; try again on the current lot');
  }
  return options.send(manifest);
}
