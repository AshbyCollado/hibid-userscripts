import { FLIPPAH_AUCTION_PWA_DEFAULT_PORT, normalizeLoopbackPort } from './auction-relay.js';

export const FLIPPAH_AUCTION_PENDING_RESERVATION_PREFIX = 'flippahAuctionPendingV1:';
export const FLIPPAH_AUCTION_PENDING_ALARM_PREFIX = 'flippah:auction-pending-expire:';
export const FLIPPAH_AUCTION_PENDING_TTL_MS = 5 * 60 * 1_000;
export const FLIPPAH_AUCTION_PENDING_PATH = '/auction-lots';

export interface AuctionPendingReservationV1 {
  schema_version: 1;
  nonce: string;
  source_tab_id: number;
  source_event_item_id: string;
  initiated_at: string;
  target_tab_id: number;
  pending_url: string;
  created_at: string;
}

export interface AuctionPendingTabSnapshot {
  id?: number;
  url?: string;
  pendingUrl?: string;
}

export interface AuctionPendingTabApi {
  create(properties: { url: string; active: true }): Promise<AuctionPendingTabSnapshot>;
  get(tabId: number): Promise<AuctionPendingTabSnapshot | null>;
  remove(tabId: number): Promise<void>;
}

export type AuctionPendingOpenerState = 'pending' | 'resolved' | 'missing' | 'navigated';

export interface AuctionPendingReservationStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: AuctionPendingReservationV1): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AuctionPendingOwner {
  sourceTabId: number;
  sourceEventItemId: string;
  nonce: string;
  initiatedAt: string;
}

export function validateAuctionHandoffNonce(value: unknown): string {
  const nonce = typeof value === 'string' ? value : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) {
    throw new Error('Auction handoff nonce is invalid');
  }
  return nonce.toLowerCase();
}

export function validateAuctionEventItemId(value: unknown): string {
  const eventItemId = typeof value === 'string' ? value : '';
  if (!/^[1-9][0-9]{0,19}$/.test(eventItemId)) throw new Error('Auction handoff event-item ID is invalid');
  return eventItemId;
}

export function validateAuctionInitiatedAt(value: unknown): string {
  const initiatedAt = typeof value === 'string' ? value : '';
  const timestamp = Date.parse(initiatedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== initiatedAt) {
    throw new Error('Auction handoff initiation timestamp is invalid');
  }
  return initiatedAt;
}

export function auctionPendingUrl(
  portValue: unknown,
  ownerValue: Pick<AuctionPendingOwner, 'sourceEventItemId' | 'nonce' | 'initiatedAt'>,
): string {
  const port = normalizeLoopbackPort(portValue, FLIPPAH_AUCTION_PWA_DEFAULT_PORT);
  const eventItemId = validateAuctionEventItemId(ownerValue.sourceEventItemId);
  const nonce = validateAuctionHandoffNonce(ownerValue.nonce);
  const initiatedAt = validateAuctionInitiatedAt(ownerValue.initiatedAt);
  const search = new URLSearchParams({
    pendingProvider: 'hibid',
    pendingEventItemId: eventItemId,
    pendingSince: initiatedAt,
    launch: nonce,
  });
  return `http://localhost:${port}${FLIPPAH_AUCTION_PENDING_PATH}?${search.toString()}`;
}

export function reservationKey(nonceValue: unknown): string {
  return `${FLIPPAH_AUCTION_PENDING_RESERVATION_PREFIX}${validateAuctionHandoffNonce(nonceValue)}`;
}

function validateOwner(owner: AuctionPendingOwner): AuctionPendingOwner {
  if (!Number.isInteger(owner.sourceTabId) || owner.sourceTabId <= 0) throw new Error('Auction handoff source tab is invalid');
  return {
    sourceTabId: owner.sourceTabId,
    sourceEventItemId: validateAuctionEventItemId(owner.sourceEventItemId),
    nonce: validateAuctionHandoffNonce(owner.nonce),
    initiatedAt: validateAuctionInitiatedAt(owner.initiatedAt),
  };
}

export function validateAuctionPendingReservation(value: unknown): AuctionPendingReservationV1 {
  if (!value || typeof value !== 'object') throw new Error('Auction handoff reservation is missing');
  const item = value as Partial<AuctionPendingReservationV1>;
  const owner = validateOwner({
    sourceTabId: Number(item.source_tab_id),
    sourceEventItemId: item.source_event_item_id || '',
    nonce: item.nonce || '',
    initiatedAt: item.initiated_at || '',
  });
  if (item.schema_version !== 1) throw new Error('Auction handoff reservation version is invalid');
  if (!Number.isInteger(item.target_tab_id) || Number(item.target_tab_id) <= 0) throw new Error('Auction handoff target tab is invalid');
  const pending = new URL(String(item.pending_url || ''));
  if (pending.href !== auctionPendingUrl(pending.port || undefined, owner)) throw new Error('Auction handoff pending URL is invalid');
  const createdAt = String(item.created_at || '');
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== createdAt) {
    throw new Error('Auction handoff reservation timestamp is invalid');
  }
  return {
    schema_version: 1,
    nonce: owner.nonce,
    source_tab_id: owner.sourceTabId,
    source_event_item_id: owner.sourceEventItemId,
    initiated_at: owner.initiatedAt,
    target_tab_id: Number(item.target_tab_id),
    pending_url: pending.href,
    created_at: createdAt,
  };
}

function requireOwner(reservation: AuctionPendingReservationV1, ownerValue: AuctionPendingOwner): void {
  const owner = validateOwner(ownerValue);
  if (reservation.nonce !== owner.nonce
    || reservation.source_tab_id !== owner.sourceTabId
    || reservation.source_event_item_id !== owner.sourceEventItemId
    || reservation.initiated_at !== owner.initiatedAt) {
    throw new Error('Auction handoff reservation owner does not match');
  }
}

function isStillOwned(tab: AuctionPendingTabSnapshot | null, pendingUrl: string): boolean {
  if (!tab) return false;
  return tab.url === pendingUrl || tab.pendingUrl === pendingUrl;
}

export class AuctionPendingTabController {
  constructor(
    private readonly tabs: AuctionPendingTabApi,
    private readonly reservations: AuctionPendingReservationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private isExpired(reservation: AuctionPendingReservationV1): boolean {
    const age = Date.parse(this.now()) - Date.parse(reservation.created_at);
    return !Number.isFinite(age) || age < -30_000 || age >= FLIPPAH_AUCTION_PENDING_TTL_MS;
  }

  private async removeOwned(reservation: AuctionPendingReservationV1): Promise<boolean> {
    const target = await this.tabs.get(reservation.target_tab_id).catch(() => null);
    if (!isStillOwned(target, reservation.pending_url)) return false;
    await this.tabs.remove(reservation.target_tab_id).catch(() => undefined);
    return true;
  }

  private async requireFresh(key: string): Promise<AuctionPendingReservationV1> {
    const reservation = validateAuctionPendingReservation(await this.reservations.get(key));
    if (!this.isExpired(reservation)) return reservation;
    await this.removeOwned(reservation);
    await this.reservations.remove(key);
    throw new Error('Auction handoff reservation expired');
  }

  async prepare(ownerValue: AuctionPendingOwner, pwaPortValue: unknown): Promise<AuctionPendingReservationV1> {
    const owner = validateOwner(ownerValue);
    const key = reservationKey(owner.nonce);
    const existingValue = await this.reservations.get(key);
    if (existingValue !== undefined) {
      const existing = await this.requireFresh(key);
      requireOwner(existing, owner);
      const existingTab = await this.tabs.get(existing.target_tab_id);
      if (!isStillOwned(existingTab, existing.pending_url)) {
        throw new Error('The reserved Flippah tab was closed or changed; no replacement tab was opened');
      }
      return existing;
    }

    const pendingUrl = auctionPendingUrl(pwaPortValue, owner);
    const target = await this.tabs.create({ url: pendingUrl, active: true });
    if (!Number.isInteger(target.id) || Number(target.id) <= 0) throw new Error('Chrome did not return the reserved Flippah tab');
    const reservation: AuctionPendingReservationV1 = {
      schema_version: 1,
      nonce: owner.nonce,
      source_tab_id: owner.sourceTabId,
      source_event_item_id: owner.sourceEventItemId,
      initiated_at: owner.initiatedAt,
      target_tab_id: Number(target.id),
      pending_url: pendingUrl,
      created_at: this.now(),
    };
    try {
      await this.reservations.set(key, reservation);
    } catch (error) {
      const current = await this.tabs.get(reservation.target_tab_id).catch(() => null);
      if (isStillOwned(current, pendingUrl)) await this.tabs.remove(reservation.target_tab_id).catch(() => undefined);
      throw error;
    }
    return reservation;
  }

  async assertReady(ownerValue: AuctionPendingOwner): Promise<AuctionPendingReservationV1> {
    const owner = validateOwner(ownerValue);
    const reservation = await this.requireFresh(reservationKey(owner.nonce));
    requireOwner(reservation, owner);
    const target = await this.tabs.get(reservation.target_tab_id);
    if (!isStillOwned(target, reservation.pending_url)) {
      throw new Error('The reserved Flippah tab was closed or changed; the lot was not sent');
    }
    return reservation;
  }

  async complete(ownerValue: AuctionPendingOwner, acceptedLotUrl: string): Promise<AuctionPendingOpenerState> {
    const owner = validateOwner(ownerValue);
    const key = reservationKey(owner.nonce);
    const reservation = await this.requireFresh(key);
    requireOwner(reservation, owner);
    const accepted = new URL(acceptedLotUrl);
    const pending = new URL(reservation.pending_url);
    if (accepted.protocol !== pending.protocol
      || accepted.hostname !== pending.hostname
      || accepted.port !== pending.port
      || !/^\/auction-lots\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i.test(accepted.pathname)
      || accepted.search || accepted.hash) {
      throw new Error('Accepted Flippah lot URL does not match the reserved local application');
    }
    try {
      const target = await this.tabs.get(reservation.target_tab_id);
      if (!target) return 'missing';
      if (target.url === accepted.href) return 'resolved';
      if (isStillOwned(target, reservation.pending_url)) return 'pending';
      return 'navigated';
    } finally {
      await this.reservations.remove(key);
    }
  }

  async cancel(ownerValue: AuctionPendingOwner): Promise<{ closed: boolean }> {
    const owner = validateOwner(ownerValue);
    const key = reservationKey(owner.nonce);
    const value = await this.reservations.get(key);
    if (value === undefined) return { closed: false };
    const reservation = validateAuctionPendingReservation(value);
    requireOwner(reservation, owner);
    const target = await this.tabs.get(reservation.target_tab_id).catch(() => null);
    let closed = false;
    if (isStillOwned(target, reservation.pending_url)) {
      await this.tabs.remove(reservation.target_tab_id).catch(() => undefined);
      closed = true;
    }
    await this.reservations.remove(key);
    return { closed };
  }

  async expire(nonceValue: unknown): Promise<{ expired: boolean; closed: boolean }> {
    const key = reservationKey(nonceValue);
    const value = await this.reservations.get(key);
    if (value === undefined) return { expired: false, closed: false };
    const reservation = validateAuctionPendingReservation(value);
    if (!this.isExpired(reservation)) return { expired: false, closed: false };
    const closed = await this.removeOwned(reservation);
    await this.reservations.remove(key);
    return { expired: true, closed };
  }
}
