import type { AuctionRelayAcceptedV1 } from '../core/auction-relay.js';
import { eventItemIdFromHibidLotUrl, hydrateHibidLotHandoff, isHibidChallengeDocument } from '../hibid/handoff.js';
import type { HiBidTransport } from '../core/types.js';

export interface AuctionHandoffRuntime {
  send<T>(type: string, payload: unknown): Promise<T>;
  nonce(): string;
  currentUrl(): string;
}

export async function runHibidAuctionHandoff(
  document: Document,
  transport: HiBidTransport,
  runtime: AuctionHandoffRuntime,
  onSending: (pictureCount: number) => void,
): Promise<AuctionRelayAcceptedV1> {
  if (isHibidChallengeDocument(document)) throw new Error('HiBid is showing a challenge; complete it before sending this lot');
  const sourceUrl = runtime.currentUrl();
  const eventItemId = eventItemIdFromHibidLotUrl(sourceUrl);
  const nonce = runtime.nonce();
  const initiatedAt = new Date().toISOString();
  const owner = { eventItemId, nonce, initiatedAt };
  let prepared = false;
  try {
    // Mark the attempt before messaging. If the worker stores the reservation but
    // restarts before replying, the catch path can still cancel this exact nonce.
    prepared = true;
    await runtime.send('flippah:auction.prepare', owner);
    const manifest = await hydrateHibidLotHandoff(transport, sourceUrl, { initiatedAt });
    if (runtime.currentUrl() !== sourceUrl) throw new Error('The HiBid page changed during photo enumeration; try again on the current lot');
    onSending(manifest.pictures.length);
    const accepted = await runtime.send<AuctionRelayAcceptedV1>('flippah:auction.handoff', { manifest, ...owner });
    prepared = false;
    return accepted;
  } catch (error) {
    if (prepared) await runtime.send('flippah:auction.cancel', owner).catch(() => undefined);
    throw error;
  }
}
