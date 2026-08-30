export interface MessageEnvelope<T = unknown> {
  v: 1;
  requestId: string;
  type: string;
  payload: T;
}

export type MessageResponse<T = unknown> =
  | { v: 1; requestId: string; ok: true; data: T }
  | { v: 1; requestId: string; ok: false; error: { code: string; message: string } };

export function requestId(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

export function envelope<T>(type: string, payload: T): MessageEnvelope<T> {
  return { v: 1, requestId: requestId(), type, payload };
}

export function isEnvelope(value: unknown): value is MessageEnvelope {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MessageEnvelope>;
  return item.v === 1
    && typeof item.requestId === 'string'
    && item.requestId.length > 0
    && item.requestId.length <= 100
    && typeof item.type === 'string'
    && item.type.startsWith('flippah:')
    && item.type.length <= 80;
}

export function success<T>(message: MessageEnvelope, data: T): MessageResponse<T> {
  return { v: 1, requestId: message.requestId, ok: true, data };
}

export function failure(message: MessageEnvelope, code: string, error: unknown): MessageResponse {
  const text = error instanceof Error ? error.message : String(error || 'Unknown error');
  return { v: 1, requestId: message.requestId, ok: false, error: { code, message: text.slice(0, 500) } };
}

export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
