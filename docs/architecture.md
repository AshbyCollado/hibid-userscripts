# Flippah extension architecture

Flippah is a read-only HiBid WebExtension. One TypeScript source tree produces
Chrome and Waterfox packages.

## Runtime boundaries

- The content script owns route observation, canonical DOM parsing, the existing
  lot-page calculator, and a keepalive port for an active scrape.
- The background runtime owns cross-origin requests, retries, job coordination,
  IndexedDB checkpoints, downloads, watch refreshes, alarms, and notifications.
- The background runtime also owns Amazon.com fetching, response validation,
  challenge cooldowns, duplicate joining, and an epoch-aware IndexedDB cache.
  Content scripts send a validated product identity and receive only normalized
  quote evidence; privileged HTML never crosses that boundary.
- The toolbar popup is a client. Closing it never cancels a scrape. Reopening it
  reconnects by tab ID and route fingerprint.
- The options page owns durable user preferences. Existing Flippah storage keys
  retain their meaning; scraper and research settings use namespaced keys.

All runtime messages are discriminated records with a version, kind, request ID,
and validated payload. Page-world messages are treated as untrusted input.

## Scrape invariant

For a public catalog or search, a normal export is available only when:

1. the API reports an authoritative total;
2. enumeration returns that many unique `eventItemId` values;
3. hydration returns exactly those IDs and no others;
4. all requested pages and batches succeeded after retries; and
5. the current route/filter fingerprint still matches the job's start value.

Personalized account pages use their dedicated DOM contracts. They never fall
back to broad embedded state or unrelated page tiles.

## Failure behavior

Terminal failures leave the job in `failed`, expose the exact coverage reason,
and allow Retry. A sanitized diagnostic is copied automatically when possible;
download is the fallback. Full event tracing is opt-in through settings or
`#flipperdebug`.

## Deal-intelligence invariant

Deal intelligence is additive and keyed by HiBid `eventItemId`. It may append
extension-owned chips, a short all-in line, or a Shadow DOM panel section, but
it must not replace, hide, move, resize, fade, relabel, or disable a HiBid node.
Late retail responses are rejected after route-fingerprint changes. Mixed lots
never receive a single automatic retail value, multi-unit lots require a
confirmed quantity, and CAD lots are never converted or compared to USD.
