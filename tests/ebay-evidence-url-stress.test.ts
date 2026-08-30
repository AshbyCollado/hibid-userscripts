import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessEbayEvidenceUrl,
  classifyEbayEvidenceUrl,
  isVerifiedEbaySoldComp,
  type EbayEvidenceProvenance,
  type EbayEvidenceUrlKind,
  type EbayEvidenceUrlRejectionReason,
  type IndependentEbaySoldEvidence,
  type ManualEstimateProvenance,
} from '../src/intelligence/ebay-evidence-url.js';
import { buildRetailLinks } from '../src/intelligence/us-deal-intelligence.js';

type ExplicitUrlCase = {
  label: string;
  url: string;
  kind: EbayEvidenceUrlKind;
  rejectionReason: EbayEvidenceUrlRejectionReason | null;
};

const URL_CASES: readonly ExplicitUrlCase[] = [
  // Sold + Completed search seeds: flag names are case-insensitive, but every duplicate value must be 1.
  { label: 'sold seed: standard flags', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: reversed flag order', url: 'https://www.ebay.com/sch/i.html?LH_Complete=1&_nkw=receiver&LH_Sold=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: lowercase flag names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&lh_sold=1&lh_complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: uppercase flag names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_SOLD=1&LH_COMPLETE=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: mixed-case flag names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&Lh_SoLd=1&lH_cOmPlEtE=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: duplicate sold flags are all enabled', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: duplicate completed flags are all enabled', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: mixed-case duplicate flags are all enabled', url: 'https://www.ebay.com/sch/i.html?LH_Sold=1&lh_sold=1&LH_Complete=1&lh_complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: encoded underscore in names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH%5FSold=1&LH%5FComplete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: lowercase encoded underscore in names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH%5fSold=1&LH%5fComplete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: encoded letters in names', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&L%48_Sold=1&L%48_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: encoded numeric values', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=%31&LH_Complete=%31', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: encoded surrounding spaces are trimmed', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=%201%20&LH_Complete=%091%09', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: sch root', url: 'https://www.ebay.com/sch?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: sch root trailing slash', url: 'https://www.ebay.com/sch/?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: short s route', url: 'https://www.ebay.com/s?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: short s route trailing slash', url: 'https://www.ebay.com/s/?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: category route', url: 'https://www.ebay.com/sch/293?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: uppercase path', url: 'https://www.ebay.com/SCH/I.HTML?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: bare ebay.com host', url: 'https://ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: mobile subdomain', url: 'https://m.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: trailing DNS dot', url: 'https://www.ebay.com./sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: http eBay route', url: 'http://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: flags precede query', url: 'https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1&_nkw=receiver', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: encoded separators stay inside query value', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver%26LH_Sold%3D0&LH_Sold=1&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },
  { label: 'sold seed: unrelated parameters do not matter', url: 'https://www.ebay.com/sch/i.html?_sacat=0&LH_Sold=1&_nkw=receiver&rt=nc&LH_Complete=1', kind: 'sold-search-seed', rejectionReason: null },

  // Searches with absent, ambiguous, or disabled filters remain active/non-evidence.
  { label: 'active search: no sold flags', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver', kind: 'active', rejectionReason: null },
  { label: 'active search: sold flag only', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1', kind: 'active', rejectionReason: null },
  { label: 'active search: completed flag only', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: sold zero', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=0&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: completed zero', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=0', kind: 'active', rejectionReason: null },
  { label: 'active search: both flags zero', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=0&LH_Complete=0', kind: 'active', rejectionReason: null },
  { label: 'active search: contradictory duplicate sold flag', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Sold=0&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: contradictory duplicate completed flag', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1&LH_Complete=0', kind: 'active', rejectionReason: null },
  { label: 'active search: blank sold value', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: blank completed value', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=', kind: 'active', rejectionReason: null },
  { label: 'active search: both values blank', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=&LH_Complete=', kind: 'active', rejectionReason: null },
  { label: 'active search: true is not one', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=true&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: yes is not one', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=yes', kind: 'active', rejectionReason: null },
  { label: 'active search: leading zero is ambiguous', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=01&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: decimal one is ambiguous', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1.0', kind: 'active', rejectionReason: null },
  { label: 'active search: negative one is disabled', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=-1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: plus one is not exact', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=%2B1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: flags in fragment are ignored', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver#LH_Sold=1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: encoded flags inside query are ignored', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver%26LH_Sold%3D1%26LH_Complete%3D1', kind: 'active', rejectionReason: null },
  { label: 'active search: semicolon does not delimit flags', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1;LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: double-encoded flag name is ignored', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH%255FSold=1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: whitespace in flag name is not normalized', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&%20LH_Sold=1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: similar flag name is ignored', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Soldier=1&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: whitespace-only duplicate makes sold ambiguous', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Sold=%20&LH_Complete=1', kind: 'active', rejectionReason: null },
  { label: 'active search: empty duplicate makes completed ambiguous', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1&LH_Complete', kind: 'active', rejectionReason: null },
  { label: 'active search: category route without flags', url: 'https://www.ebay.com/sch/293?_nkw=receiver', kind: 'active', rejectionReason: null },
  { label: 'active search: short s route without flags', url: 'https://www.ebay.com/s?_nkw=receiver', kind: 'active', rejectionReason: null },
  { label: 'active search: only one enabled flag after fragment', url: 'https://www.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1#LH_Complete=1', kind: 'active', rejectionReason: null },

  // Seller Hub URLs are active only when the route says active. Other records are provenance, not direct item URLs.
  { label: 'seller hub: active route', url: 'https://www.ebay.com/sh/lst/active', kind: 'active', rejectionReason: null },
  { label: 'seller hub: active route trailing slash', url: 'https://www.ebay.com/sh/lst/active/', kind: 'active', rejectionReason: null },
  { label: 'seller hub: active child route', url: 'https://www.ebay.com/sh/lst/active/123456789012', kind: 'active', rejectionReason: null },
  { label: 'seller hub: uppercase active route', url: 'https://www.ebay.com/SH/LST/ACTIVE', kind: 'active', rejectionReason: null },
  { label: 'seller hub: active status query', url: 'https://www.ebay.com/sh/lst?status=ACTIVE', kind: 'active', rejectionReason: null },
  { label: 'seller hub: lowercase active status', url: 'https://www.ebay.com/sh/lst?status=active', kind: 'active', rejectionReason: null },
  { label: 'seller hub: uppercase status key', url: 'https://www.ebay.com/sh/lst?STATUS=active', kind: 'active', rejectionReason: null },
  { label: 'seller hub: encoded active status', url: 'https://www.ebay.com/sh/lst?status=%41CTIVE', kind: 'active', rejectionReason: null },
  { label: 'seller hub: any duplicate active status stays active', url: 'https://www.ebay.com/sh/lst?status=sold&status=active', kind: 'active', rejectionReason: null },
  { label: 'seller hub: active path wins over sold query', url: 'https://www.ebay.com/sh/lst/active?status=sold', kind: 'active', rejectionReason: null },
  { label: 'seller hub: ended route is not a direct item URL', url: 'https://www.ebay.com/sh/lst/ended', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: sold route is not a direct item URL', url: 'https://www.ebay.com/sh/lst/sold', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: unsold route is not a direct item URL', url: 'https://www.ebay.com/sh/lst/unsold', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: ended status is not a direct item URL', url: 'https://www.ebay.com/sh/lst?status=ended', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: sold status is not a direct item URL', url: 'https://www.ebay.com/sh/lst?status=sold', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: spaced active status is ambiguous', url: 'https://www.ebay.com/sh/lst?status=%20active%20', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: orders route is not a direct item URL', url: 'https://www.ebay.com/sh/ord', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: order transaction is not a direct item URL', url: 'https://www.ebay.com/sh/ord/details?orderid=12-34567-89012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: finance transactions are not direct item URLs', url: 'https://www.ebay.com/sh/fin/transactions', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'seller hub: payment transaction is not a direct item URL', url: 'https://www.ebay.com/sh/fin/transactions/123456', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },

  // Canonical item URLs establish listing identity, never sold state by themselves.
  { label: 'item: 12-digit id', url: 'https://www.ebay.com/itm/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: title and 12-digit id', url: 'https://www.ebay.com/itm/Onkyo-TX-SR304/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: minimum 9-digit id', url: 'https://www.ebay.com/itm/123456789', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: maximum 15-digit id', url: 'https://www.ebay.com/itm/123456789012345', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: uppercase route', url: 'https://www.ebay.com/ITM/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: trailing slash', url: 'https://www.ebay.com/itm/123456789012/', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: sold flags do not prove item state', url: 'https://www.ebay.com/itm/123456789012?LH_Sold=1&LH_Complete=1', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: fragment does not alter item identity', url: 'https://www.ebay.com/itm/123456789012#viTabs_0_is', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: bare ebay.com host', url: 'https://ebay.com/itm/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: mobile eBay host', url: 'https://m.ebay.com/itm/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: http route', url: 'http://www.ebay.com/itm/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: default HTTPS port', url: 'https://www.ebay.com:443/itm/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: encoded title and plain id', url: 'https://www.ebay.com/itm/Onkyo%20TX-SR304/123456789012', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: tracking query does not alter identity', url: 'https://www.ebay.com/itm/123456789012?mkcid=1&mkrid=711-53200-19255-0', kind: 'listing-unknown-state', rejectionReason: null },
  { label: 'item: eight-digit id is too short', url: 'https://www.ebay.com/itm/12345678', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: sixteen-digit id is too long', url: 'https://www.ebay.com/itm/1234567890123456', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: alphanumeric id is unsupported', url: 'https://www.ebay.com/itm/ABC123456789', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: query-only id is unsupported', url: 'https://www.ebay.com/itm?item=123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: encoded digits are not a canonical id segment', url: 'https://www.ebay.com/itm/%31%32%33%34%35%36%37%38%39%30%31%32', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: title without id is unsupported', url: 'https://www.ebay.com/itm/Onkyo-TX-SR304', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item: numeric substring is not an id segment', url: 'https://www.ebay.com/itm/Onkyo-123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },

  // Direct item URLs have exactly an id, or a title plus id. Search-like/deep tails are not canonical evidence URLs.
  { label: 'item shape: search tail after id is unsupported', url: 'https://www.ebay.com/itm/123456789012/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item shape: multiple title segments are unsupported', url: 'https://www.ebay.com/itm/audio/receiver/123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item shape: tail after title and id is unsupported', url: 'https://www.ebay.com/itm/receiver/123456789012/details', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item shape: two numeric id segments are unsupported', url: 'https://www.ebay.com/itm/123456789012/210987654321', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'item shape: duplicate path separators are unsupported', url: 'https://www.ebay.com/itm//123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },

  // Consumer hosts are explicit; locale sites, deceptive hosts, and non-web protocols are not ebay.com evidence URLs.
  { label: 'host: unrelated host', url: 'https://example.com/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: ebay.com as a parent label', url: 'https://ebay.com.example.org/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: www.ebay.com with hostile suffix', url: 'https://www.ebay.com.evil.example/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: notebay.com suffix trick', url: 'https://notebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: dashed ebay lookalike', url: 'https://www-ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: ebay in path only', url: 'https://example.org/ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: ebay in query only', url: 'https://example.org/itm/123456789012?host=www.ebay.com', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: userinfo spoof points to hostile host', url: 'https://www.ebay.com@evil.example/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: userinfo with password points to hostile host', url: 'https://www.ebay.com:443@evil.example/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: localhost is not eBay', url: 'https://localhost/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: IPv4 is not eBay', url: 'https://127.0.0.1/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'host: IPv6 is not eBay', url: 'https://[::1]/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'locale: ebay.co.uk is outside ebay.com scope', url: 'https://www.ebay.co.uk/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'locale: ebay.de is outside ebay.com scope', url: 'https://www.ebay.de/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'locale: ebay.ca is outside ebay.com scope', url: 'https://www.ebay.ca/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'locale: ebay.com.au is outside ebay.com scope', url: 'https://www.ebay.com.au/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'locale: ebay.fr is outside ebay.com scope', url: 'https://www.ebay.fr/itm/123456789012', kind: 'rejected', rejectionReason: 'non-ebay-url' },
  { label: 'protocol: ftp is unsupported', url: 'ftp://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: file is unsupported', url: 'file://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: javascript is unsupported', url: 'javascript:https://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: data is unsupported', url: 'data:text/plain,https://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: websocket is unsupported', url: 'wss://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: mailto is unsupported', url: 'mailto:https://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'protocol: blob is unsupported', url: 'blob:https://www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-protocol' },
  { label: 'url: protocol-relative form is invalid without a base', url: '//www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'invalid-url' },
  { label: 'url: missing scheme is invalid', url: 'www.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'invalid-url' },
  { label: 'url: malformed percent host is invalid', url: 'https://%/itm/123456789012', kind: 'rejected', rejectionReason: 'invalid-url' },
  { label: 'url: empty string', url: '', kind: 'rejected', rejectionReason: 'empty-url' },
  { label: 'url: whitespace string', url: '   ', kind: 'rejected', rejectionReason: 'empty-url' },
  { label: 'route: ebay.com homepage is unsupported', url: 'https://www.ebay.com/', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'route: help page is unsupported', url: 'https://www.ebay.com/help/home', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'route: encoded search slash is unsupported', url: 'https://www.ebay.com/sch%2Fi.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'route: encoded search letters are unsupported', url: 'https://www.ebay.com/%73ch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'route: search-like prefix is unsupported', url: 'https://www.ebay.com/scholar?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'subdomain: sign-in host is not a consumer item page', url: 'https://signin.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'subdomain: API host is not a consumer item page', url: 'https://api.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'subdomain: arbitrary host is not a consumer item page', url: 'https://arbitrary.ebay.com/itm/123456789012', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
  { label: 'subdomain: sign-in host is not a sold-search page', url: 'https://signin.ebay.com/sch/i.html?_nkw=receiver&LH_Sold=1&LH_Complete=1', kind: 'rejected', rejectionReason: 'unsupported-ebay-url' },
] as const;

const renderedSoldListing: IndependentEbaySoldEvidence = {
  kind: 'independent-sold-evidence',
  source: 'rendered-sold-listing',
  itemId: '123456789012',
};

const sellerHubSoldRecord: IndependentEbaySoldEvidence = {
  kind: 'independent-sold-evidence',
  source: 'seller-hub-sold-record',
  itemId: '123456789012',
};

const transactionRecord: IndependentEbaySoldEvidence = {
  kind: 'independent-sold-evidence',
  source: 'transaction-record',
  itemId: '123456789012',
};

const manualEstimate: ManualEstimateProvenance = {
  kind: 'manual-estimate',
  amountUsd: 125,
};

const INDEPENDENT_PROVENANCE = [renderedSoldListing, sellerHubSoldRecord, transactionRecord] as const;

function expectedNormalizedUrl(entry: ExplicitUrlCase): string | null {
  if (entry.kind === 'rejected') return null;
  return new URL(entry.url.trim()).href;
}

function provenanceForUrl(provenance: IndependentEbaySoldEvidence, url: string): IndependentEbaySoldEvidence {
  try {
    const itemId = new URL(url).pathname.match(/\/(\d{9,15})\/?$/)?.[1];
    return itemId ? { ...provenance, itemId } : provenance;
  } catch {
    return provenance;
  }
}

test(`classifies ${URL_CASES.length} explicit eBay evidence URL stress cases`, () => {
  assert.ok(URL_CASES.length >= 50, `expected at least 50 explicit URL cases, received ${URL_CASES.length}`);

  const mismatches = URL_CASES.flatMap((entry) => {
    const actual = classifyEbayEvidenceUrl(entry.url);
    const expected = {
      kind: entry.kind,
      normalizedUrl: expectedNormalizedUrl(entry),
      rejectionReason: entry.rejectionReason,
    };
    return actual.kind === expected.kind
      && actual.normalizedUrl === expected.normalizedUrl
      && actual.rejectionReason === expected.rejectionReason
      ? []
      : [{ label: entry.label, url: entry.url, expected, actual }];
  });

  assert.deepEqual(mismatches, []);
});

test('the generated Sold + Completed URL is a research seed under every provenance', () => {
  const generated = buildRetailLinks('  Onkyo   TX-SR304 Receiver  ').ebay;
  const parsed = new URL(generated);
  assert.equal(parsed.searchParams.get('_nkw'), 'Onkyo TX-SR304 Receiver');
  assert.equal(parsed.searchParams.get('LH_Sold'), '1');
  assert.equal(parsed.searchParams.get('LH_Complete'), '1');
  assert.equal(classifyEbayEvidenceUrl(generated).kind, 'sold-search-seed');

  const provenanceAttempts: readonly EbayEvidenceProvenance[] = [
    renderedSoldListing,
    sellerHubSoldRecord,
    transactionRecord,
    manualEstimate,
  ];
  for (const provenance of provenanceAttempts) {
    const assessment = assessEbayEvidenceUrl(generated, provenance);
    assert.equal(assessment.kind, 'not-verified', provenance.kind);
    assert.equal(assessment.verifiedSoldComp, false, provenance.kind);
    assert.equal(isVerifiedEbaySoldComp(assessment), false, provenance.kind);
  }
});

test('no active or search URL can become verified sold evidence', () => {
  const activeAndSearchCases = URL_CASES.filter(({ kind }) => kind === 'active' || kind === 'sold-search-seed');
  assert.ok(activeAndSearchCases.length >= 40, 'stress matrix should contain broad active/search coverage');

  const unexpectedVerifications = activeAndSearchCases.flatMap((entry) => (
    INDEPENDENT_PROVENANCE.flatMap((provenance) => {
      const assessment = assessEbayEvidenceUrl(entry.url, provenance);
      return assessment.verifiedSoldComp
        ? [{ label: entry.label, url: entry.url, provenance: provenance.source, classification: assessment.urlClassification }]
        : [];
    })
  ));

  assert.deepEqual(unexpectedVerifications, []);
});

test('manual estimates never verify any URL, including canonical item URLs', () => {
  const unexpectedVerifications = URL_CASES.flatMap((entry) => {
    const assessment = assessEbayEvidenceUrl(entry.url, manualEstimate);
    return assessment.verifiedSoldComp
      ? [{ label: entry.label, url: entry.url, classification: assessment.urlClassification }]
      : [];
  });

  assert.deepEqual(unexpectedVerifications, []);
});

test('independent provenance verifies only canonical consumer item URLs', () => {
  const mismatches = URL_CASES.flatMap((entry) => (
    INDEPENDENT_PROVENANCE.flatMap((provenance) => {
      const boundProvenance = provenanceForUrl(provenance, entry.url);
      const assessment = assessEbayEvidenceUrl(entry.url, boundProvenance);
      const expectedVerified = entry.kind === 'listing-unknown-state';
      return assessment.verifiedSoldComp === expectedVerified
        && isVerifiedEbaySoldComp(assessment) === expectedVerified
        ? []
        : [{
            label: entry.label,
            url: entry.url,
            provenance: boundProvenance.source,
            expectedVerified,
            actual: assessment,
          }];
    })
  ));

  assert.deepEqual(mismatches, []);
});

test('runtime provenance lookalikes cannot impersonate independent evidence', () => {
  const itemUrl = 'https://www.ebay.com/itm/123456789012';
  const lookalikes = [
    { kind: 'manual-estimate', amountUsd: 125, source: 'rendered-sold-listing', itemId: '123456789012' },
    { kind: 'independent-sold-evidence', source: 'manual-estimate', itemId: '123456789012' },
    { kind: 'independent-sold-evidence', source: 'RENDERED-SOLD-LISTING', itemId: '123456789012' },
    { kind: 'independent-sold-evidence' },
    { source: 'rendered-sold-listing', itemId: '123456789012' },
  ] as unknown as readonly EbayEvidenceProvenance[];

  for (const provenance of lookalikes) {
    const assessment = assessEbayEvidenceUrl(itemUrl, provenance);
    assert.equal(assessment.kind, 'not-verified');
    assert.equal(assessment.verifiedSoldComp, false);
    assert.equal(isVerifiedEbaySoldComp(assessment), false);
  }
});
