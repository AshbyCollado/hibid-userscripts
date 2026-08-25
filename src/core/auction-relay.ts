import type { HibidLotHandoffV1 } from './types.js';
import { payloadBytes } from './messages.js';
import { validateHibidLotHandoffV1 } from '../hibid/handoff.js';

export const FLIPPAH_AUCTION_RELAY_DEFAULT_PORT = 8000;
export const FLIPPAH_AUCTION_PWA_DEFAULT_PORT = 8080;
export const FLIPPAH_AUCTION_RELAY_PATH = '/v1/auction-lots/handoffs/hibid';
export const FLIPPAH_AUCTION_RELAY_TOKEN_KEY = 'flippahAuctionRelayToken';
export const FLIPPAH_AUCTION_RELAY_PORT_KEY = 'flippahAuctionRelayPort';
export const FLIPPAH_AUCTION_PWA_PORT_KEY = 'flippahAuctionPwaPort';
export const FLIPPAH_AUCTION_RELAY_MAX_BYTES = 180_000;

export interface AuctionRelayAcceptedV1 {
  lot_id: string;
  lot_url: string;
  accepted_at: string;
}

export function normalizeAuctionRelayToken(value: unknown): string {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) throw new Error('Pair this Chrome extension with Flippah before analyzing a lot');
  if (token.length < 32 || token.length > 512 || /\s/.test(token)) throw new Error('The saved Flippah pairing token is invalid; pair the extension again');
  return token;
}

export function normalizeLoopbackPort(value: unknown, fallback: number): number {
  const port = value === null || value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('The saved Flippah port is invalid');
  return port;
}

export function auctionRelayUrl(portValue: unknown): string {
  const port = normalizeLoopbackPort(portValue, FLIPPAH_AUCTION_RELAY_DEFAULT_PORT);
  return `http://127.0.0.1:${port}${FLIPPAH_AUCTION_RELAY_PATH}`;
}

export function validateAuctionRelayResponse(value: unknown, expectedPwaPort = FLIPPAH_AUCTION_PWA_DEFAULT_PORT): AuctionRelayAcceptedV1 {
  if (!value || typeof value !== 'object') throw new Error('Flippah relay returned a malformed response');
  const response = value as Partial<AuctionRelayAcceptedV1>;
  if (!response.lot_id || !response.lot_url || !response.accepted_at) throw new Error('Flippah relay response is missing the created lot');
  const lotUrl = new URL(response.lot_url);
  if (lotUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(lotUrl.hostname)) throw new Error('Flippah relay returned a non-local lot URL');
  const lotPort = Number(lotUrl.port || 80);
  if (lotPort !== normalizeLoopbackPort(expectedPwaPort, FLIPPAH_AUCTION_PWA_DEFAULT_PORT)) throw new Error('Flippah relay returned a lot URL on an unexpected port');
  const match = lotUrl.pathname.match(/^\/auction-lots\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  if (!match) throw new Error('Flippah relay returned an unexpected lot URL path');
  if (match[1]!.toLowerCase() !== response.lot_id.toLowerCase()) throw new Error('Flippah relay lot URL does not match the accepted lot ID');
  if (Number.isNaN(Date.parse(response.accepted_at))) throw new Error('Flippah relay response has an invalid acceptance timestamp');
  return { lot_id: response.lot_id, lot_url: lotUrl.href, accepted_at: response.accepted_at };
}

export async function postHibidLotToAuctionRelay(
  manifest: HibidLotHandoffV1,
  tokenValue: unknown,
  portValue: unknown = FLIPPAH_AUCTION_RELAY_DEFAULT_PORT,
  pwaPortValue: unknown = FLIPPAH_AUCTION_PWA_DEFAULT_PORT,
  fetcher: typeof fetch = fetch,
): Promise<AuctionRelayAcceptedV1> {
  validateHibidLotHandoffV1(manifest);
  if (payloadBytes(manifest) > FLIPPAH_AUCTION_RELAY_MAX_BYTES) throw new Error('HiBid lot handoff exceeds the local relay size limit');
  const token = normalizeAuctionRelayToken(tokenValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const relayUrl = new URL(auctionRelayUrl(portValue));
    const response = await fetcher(relayUrl.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify(manifest),
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      throw new Error(`Flippah relay returned HTTP ${response.status}${message ? `: ${message}` : ''}`);
    }
    return validateAuctionRelayResponse(await response.json(), normalizeLoopbackPort(pwaPortValue, FLIPPAH_AUCTION_PWA_DEFAULT_PORT));
  } finally {
    clearTimeout(timer);
  }
}
