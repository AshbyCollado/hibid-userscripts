// ==UserScript==
// @name         FlipperAddon by ALOS
// @namespace    http://tampermonkey.net/
// @version      0.6.5
// @description  Modular resale helper for HiBid catalog/live scraping, LLM exports, safe bid prep, and FlipTracker marketplace exports.
// @updateURL    https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @match        https://hibid.com/lots*
// @match        https://hibid.com/lots/*
// @match        https://hibid.com/catalog/*
// @match        https://hibid.com/livecatalog/*
// @match        https://hibid.com/account/watchlist*
// @match        https://hibid.com/*
// @match        https://*.hibid.com/*
// @match        https://bid.ajwillnerauctions.com/ui/auctions/*
// @match        https://www.ebay.com/sh/lst*
// @match        https://www.ebay.com/mys/*
// @match        https://www.facebook.com/marketplace/you/*
// @match        https://www.facebook.com/marketplace/profile/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'hibid-bid-assistant-panel';
  const APP_NAME = 'FlipperAddon by ALOS';
  const APP_SHORT_NAME = 'FlipperAddon';
  const SCRIPT_VERSION = '0.6.5';
  const LEGACY_PLAN_KEY = 'hibid-bid-assistant-plan-v1';
  const LEGACY_PLAN_MIGRATED_KEY = 'flipperaddon-legacy-plan-migrated-v1';
  const PLAN_KEY_PREFIX = 'flipperaddon-max-plan-v2';
  const AUTO_REFRESH_KEY = 'flipperaddon-auto-refresh-v1';
  const AUTO_CONFIRM_KEY = 'flipperaddon-auto-confirm-v1';
  const MINIMIZED_KEY = 'flipperaddon-minimized-v1';
  const DEBUG_ENABLED_KEY = 'flipperaddon-debug-enabled-v1';
  const DEBUG_LOG_KEY = 'flipperaddon-debug-log-v1';
  const DEBUG_LOG_LIMIT = 200;
  const OUTBID_WATCHLIST_URL = 'https://hibid.com/account/watchlist?status=OUTBID';
  const LEGACY_SCRAPER_IDS = [
    'hibid-lot-catalog-scraper-copy-button',
    'hibid-lot-catalog-scraper-json',
    'hibid-scraper-copy-button',
    'hibid-scraper-json'
  ];
  const MENU_COMMANDS = [
    'Remount FlipperAddon',
    'Toggle FlipperAddon Debug Mode',
    'Copy FlipperAddon Debug Log',
    'Clear FlipperAddon Debug Log',
    'Copy HiBid Lots Now'
  ];
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const DEBUG_PREFIX = '[FlipperAddon]';
  const AUCTION_RESALE_COORDINATOR_PROMPT = `You are an auction resale analysis coordinator.

Goal:
Find profitable resale deals from a full auction export without missing hidden value. Do not skim only obvious items. Every lot must be parsed, classified, and included in the final spreadsheet.

Context:
I am buying to resell for profit. I do not want $10-$20 time-wasters unless they are tiny, easy, or bundled into a larger profitable pickup. I may be driving about an hour and I am in a sedan, so bulky items need much higher profit and must be marked with sedan risk.
Sold/completed comps first, profit second, hunches last.

Core rule:
Coverage first, confirmation second. Every lot gets classified. Nothing silently disappears.

Statuses:
- Confirmed Lead: exact or close sold comps support meaningful profit after all fees.
- Research Lead: possible value, but proof is incomplete, active-only, model uncertain, or condition-sensitive.
- Local Flip Lead: better for Facebook/Craigslist/local marketplace than eBay.
- Bundle/Parts Lead: value comes from quantity, parts, accessories, or splitting.
- Garbage: unlikely worth time.

Do not mark something garbage just because the title is generic.
Look for hidden value in vague titles, bundles, quantities, pro gear, tools, electronics, restaurant equipment, industrial, medical, camera/audio, baby gear, and local bulky flips.

Profit math:
Assume auction buyer premium is 15%.
Assume sales tax applies to hammer price plus buyer premium unless stated otherwise.
Use sales tax rate: [INSERT TAX RATE].
Rough quick math: auction all-in = bid x 1.25 for buyer premium/tax estimate; eBay net = sold price x 0.87 before shipping complications.
Assume eBay resale has seller fees and promoted listing friction:
- eBay final value fee default: 13.25%
- Promoted listing ad rate default: 2%
- Total default eBay selling friction: 15.25%

Assume buyer pays shipping, so shipping is not deducted from profit unless the item is oversized, fragile, hard to pack, likely to need packing materials, or commonly causes shipping damage/returns.

For local flips:
- Do not apply eBay fees.
- Use lower local resale estimate.
- Apply extra caution for pickup, storage, meetup time, and sedan fit.

Calculations:
auction_all_in_cost = hammer_price * 1.15 * (1 + sales_tax_rate)

ebay_net = estimated_resale * (1 - 0.1525)

estimated_net_profit = ebay_net - auction_all_in_cost

recommended_max_bid = ((estimated_resale * (1 - 0.1525)) - target_profit) / (1.15 * (1 + sales_tax_rate))

For local flips:
local_net_profit = estimated_local_resale - auction_all_in_cost
recommended_max_bid = (estimated_local_resale - target_profit) / (1.15 * (1 + sales_tax_rate))

Default target profit:
- Small easy ship item: minimum $30 profit
- Medium item: minimum $50 profit
- Heavy/fragile/restaurant equipment: minimum $100-$150 profit
- One-hour pickup trip: total expected profit should be $150+ minimum, preferably $250+
- Sedan-risk bulky item: only include if profit is large enough to justify logistics

Comping rules:
- Use eBay sold/completed listings first.
- Exact sold comps are strongest.
- Close sold comps are acceptable but mark speculative.
- Active listings alone cannot make a Confirmed Lead.
- If proof is only an eBay search/shop/category page, mark Research Lead unless there is very strong market context.
- For local-only bulky items, use local market intuition only if potential profit justifies pickup.
- Every lead needs proof URL or must be explicitly marked local/speculative.

Proof levels:
- exact_ebay_sold
- close_ebay_sold
- sold_search_page
- active_only
- retail_reference
- local_speculative
- no_proof

Only exact_ebay_sold or close_ebay_sold can be Confirmed Lead.

Spreadsheet output:
Create an Excel workbook with these tabs:
- Best Bids
- Research Leads
- Local Flip Leads
- Bundle/Parts Leads
- All Lots
- Garbage
- Audit

Required columns:
row_id
lot
title
current_bid
next_bid
quantity
category
status
estimated_resale
estimated_local_resale
buyer_premium_rate
sales_tax_rate
auction_all_in_cost
ebay_fee_rate
promo_fee_rate
ebay_net
target_profit
estimated_net_profit
breakeven_bid
recommended_max_bid
proof_type
proof_urls
reason
risk_notes
sedan_fit
shipping_assumption
assigned_agent
audit_flag

Classification instructions:
1. Parse every lot into normalized rows.
2. Assign stable row_id and lot number.
3. Identify quantity and {each} lots. Treat {each} lots carefully because bid may be per unit.
4. Estimate resale conservatively.
5. Calculate max bid backwards from target profit.
6. If current bid is already above recommended max bid, mark audit_flag: current_bid_over_max.
7. If item is bulky, fragile, restaurant equipment, refrigerated, gas-powered, or needs truck/rigging, mark sedan_fit as No or Maybe.
8. If sell-through is uncertain, mark Research Lead, not Confirmed Lead.
9. Garbage rows must have a reason, not a blank dismissal.

Garbage reason must be one or more of:
- low ASP
- no sold comps
- active-only weak proof
- current bid too high
- bulky/sedan risk
- refrigeration risk
- gas/electrical install risk
- hygiene risk
- missing-parts risk
- generic saturated item
- slow local sale
- admin/info lot

Audit requirements:
- 100% of lots must appear in All Lots.
- Missing row count must be zero.
- Duplicate row IDs must be zero.
- Every non-garbage row must have proof URL or be marked local_speculative.
- Every Confirmed Lead must have exact or close sold-comp proof.
- Recheck any Garbage row with brand/model/quantity/value signals.
- Recheck every {each} lot for per-unit bid math.
- Recheck all current bids over recommended max bid.

Final summary:
After creating the spreadsheet, summarize:
- total lots parsed
- total confirmed leads
- total research leads
- total local flip leads
- total bundle/parts leads
- total garbage
- missing row count
- top 10 best bids
- max bid for each
- what needs inspection
- whether pickup is worth the drive

Tone:
Be skeptical, but do not be lazy. The mission is to avoid missing profitable deals while not fooling me with fake profit before fees.`;

  function safeClone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value, (_key, item) => {
        if (typeof item === 'function') return '[function]';
        if (item && typeof item === 'object') {
          const ctor = item.constructor?.name || '';
          if (/^(HTML|SVG|Window|Document|Node)/.test(ctor)) return `[${ctor}]`;
        }
        return item;
      }));
    } catch {
      return String(value);
    }
  }

  function getDebugLog() {
    try {
      const stored = GM_getValue(DEBUG_LOG_KEY, []);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  function setDebugLog(entries) {
    try {
      GM_setValue(DEBUG_LOG_KEY, entries.slice(-DEBUG_LOG_LIMIT));
    } catch {
      // Tampermonkey storage may be unavailable in tests or blocked pages.
    }
  }

  function clearDebugLog() {
    setDebugLog([]);
  }

  function formatDebugLog(entries = getDebugLog()) {
    return entries.map(entry => {
      const suffix = entry.data === undefined ? '' : ` ${JSON.stringify(entry.data)}`;
      return `${entry.at} ${entry.version} ${entry.url} ${entry.message}${suffix}`;
    }).join('\n');
  }

  function getStoredDebugEnabled() {
    try {
      return Boolean(GM_getValue(DEBUG_ENABLED_KEY, false));
    } catch {
      return false;
    }
  }

  function saveDebugEnabled(value) {
    try {
      GM_setValue(DEBUG_ENABLED_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function debug(message, data) {
    if (!getStoredDebugEnabled()) return;
    const entry = {
      at: new Date().toISOString(),
      version: SCRIPT_VERSION,
      url: typeof location !== 'undefined' ? location.href : '',
      message,
      data: safeClone(data)
    };
    try {
      if (data === undefined) console.debug(DEBUG_PREFIX, message);
      else console.debug(DEBUG_PREFIX, message, data);
    } catch {
      // Console logging is best-effort.
    }
    const log = getDebugLog();
    log.push(entry);
    setDebugLog(log);
  }

  async function copyDebugLog() {
    const payload = formatDebugLog();
    if (!payload) return false;
    return writeClipboard(payload).catch(() => false);
  }

  function routeDebug(loc = (typeof location !== 'undefined' ? location : null)) {
    if (!loc) return {};
    return {
      href: loc.href,
      route: resolveHiBidPage(loc),
      readyState: typeof document !== 'undefined' ? document.readyState : ''
    };
  }

  function removeLegacyScraperArtifacts(reason = 'cleanup') {
    if (typeof document === 'undefined') return 0;
    let removed = 0;
    LEGACY_SCRAPER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.remove();
      removed += 1;
    });
    if (removed) debug('removed legacy scraper artifacts', { reason, removed, ids: LEGACY_SCRAPER_IDS });
    return removed;
  }

  function textOf(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function moneyFromText(value) {
    const match = (value || '').match(/([\d,]+(?:\.\d{2})?)\s*USD/i);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function numberFromText(value) {
    const match = (value || '').match(/([\d,]+)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function parseBidPlan(raw) {
    const parsed = JSON.parse(raw || '{}');
    const out = {};

    Object.entries(parsed).forEach(([lot, value]) => {
      if (typeof value === 'number') {
        out[String(lot)] = { max: value, title: '' };
        return;
      }

      if (value && typeof value === 'object') {
        const max = Number(value.max);
        out[String(lot)] = {
          max: Number.isFinite(max) && max > 0 ? max : null,
          title: String(value.title || '').trim()
        };
      }
    });

    return out;
  }

  function titleMatches(title, expected) {
    if (!expected) return true;
    return String(title || '').toLowerCase().includes(String(expected).toLowerCase());
  }

  function extractUserBidStatus(value) {
    if (/outbid|losing|not winning/i.test(value || '')) return 'Outbid';
    if (/winning|high bidder|you'?re winning|you are winning/i.test(value || '')) return 'Winning';
    if (/you'?ve bid|you have bid|your bid/i.test(value || '')) return 'Bid Placed';
    return '';
  }

  function isVisible(el) {
    if (!el) return false;
    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const style = win?.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return Boolean(el.offsetParent || el.getClientRects?.().length);
  }

  function controlLabel(el) {
    return [
      textOf(el),
      el?.getAttribute?.('aria-label') || '',
      el?.getAttribute?.('title') || '',
      el?.getAttribute?.('class') || '',
      el?.getAttribute?.('id') || el?.id || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function controlHref(el) {
    return el?.getAttribute?.('href') || el?.href || '';
  }

  function absoluteUrl(href, base = (typeof location !== 'undefined' ? location.href : 'https://hibid.com/')) {
    if (!href) return '';
    try {
      return new URL(href, base).href;
    } catch {
      if (/^https?:\/\//i.test(String(href))) return String(href);
      const origin = String(base || '').match(/^(https?:\/\/[^/]+)/i)?.[1] || 'https://hibid.com';
      if (String(href).startsWith('/')) return `${origin}${href}`;
      return String(href);
    }
  }

  function getRootText(root = document) {
    return textOf(root.body || root.documentElement || root);
  }

  function getExpectedLotTotal(root = document) {
    const text = getRootText(root);
    const totalMatch = text.match(/\bTotal Lots:\s*([\d,]+)/i);
    if (totalMatch) return Number(totalMatch[1].replace(/,/g, ''));

    const openMatch = text.match(/\bOpen Lots:\s*([\d,]+)/i);
    if (openMatch) return Number(openMatch[1].replace(/,/g, ''));

    const showingMatch = text.match(/\bShowing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)\s+lots\b/i);
    if (showingMatch) return Number(showingMatch[1].replace(/,/g, ''));

    const ofMatch = text.match(/\b(?:of|total)\s+([\d,]+)\s+lots\b/i);
    if (ofMatch) return Number(ofMatch[1].replace(/,/g, ''));
    return null;
  }

  function findCatalogNextPageButton(root = document) {
    const textNodeType = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
    const walker = root.createTreeWalker?.(root.body || root.documentElement, textNodeType);
    while (walker) {
      const node = walker.nextNode();
      if (!node) break;
      if (!/^next\s*>?$/i.test((node.textContent || '').trim())) continue;
      const control = node.parentElement?.closest?.('a[href], button, [role="button"]');
      if (control && !control.disabled && !control.getAttribute?.('aria-disabled') && isVisible(control)) {
        debug('catalog next-page text-node control', { label: controlLabel(control), href: controlHref(control) });
        return control;
      }
    }

    const candidates = Array.from(root.querySelectorAll?.('a[href], button, [role="button"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const href = controlHref(button);
        let score = 0;
        if (/\bbid\b|history|watch|unwatch|notes?|close|confirm|share|print|search/i.test(label)) score = -100;
        else if (/^next\s*>?$/i.test(textOf(button))) score = 120;
        else if (/\bnext\b/i.test(label) && /(?:apage|page)=\d+/i.test(href)) score = 110;
        else if (/\bnext\b/i.test(label) && /page|pagination|pager/i.test(button.closest?.('[class]')?.getAttribute?.('class') || '')) score = 100;
        else if (/(?:apage|page)=\d+/i.test(href) && /\bnext\b/i.test(label)) score = 80;
        return { button, score, label, href };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('catalog next-page candidates', candidates.map(item => ({ score: item.score, label: item.label, href: item.href })).slice(0, 10));
    return candidates[0]?.button || null;
  }

  function findBidButton(tile) {
    const candidates = Array.from(tile.querySelectorAll('.lot-bid-button, button.lot-bid-button, .lot-bid-button button, .lot-bid-button[role="button"], button, [role="button"]'))
      .filter(button => !button.disabled && !button.getAttribute('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const amount = moneyFromText(label);
        const className = button.getAttribute?.('class') || '';
        let score = 0;

        if (/bid\s+history|history|\b\d+\s+bids?\b|\bbids?\b/i.test(label) && !amount) {
          score = -100;
        } else if (/\blot-bid-button\b/i.test(className)) {
          score = 100;
        } else if (/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = 80;
        } else if (/\bplace\s+bid\b|\bnext\s+bid\b/i.test(label) && amount) {
          score = 70;
        } else if (/\bbid\b/i.test(label) && amount) {
          score = 60;
        } else if (amount && /\bUSD\b/i.test(label)) {
          score = 30;
        }

        return { button, label, amount, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findBidButton candidates', candidates.map(item => ({
      label: item.label,
      amount: item.amount,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function findLiveBidButton(root = document) {
    const candidates = Array.from(root.querySelectorAll?.('.live-bid-button, .lot-bid-button, button, [role="button"], input[type="button"], input[type="submit"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const amount = moneyFromText(label);
        const className = button.getAttribute?.('class') || '';
        let score = 0;

        if (/bid\s+history|history|\b\d+\s+bids?\b|\bbids?\b|watch|unwatch|notes?|close|catalog|view\s+catalog/i.test(label) && !/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = -100;
        } else if (/\blive-bid-button\b/i.test(className)) {
          score = 120;
        } else if (/\blot-bid-button\b/i.test(className)) {
          score = 100;
        } else if (/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = 90;
        } else if (/\bplace\s+bid\b|\bsubmit\s+bid\b|\bnext\s+bid\b/i.test(label) && amount) {
          score = 75;
        } else if (/\bbid\b/i.test(label) && amount) {
          score = 60;
        }

        return { button, label, amount, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findLiveBidButton candidates', candidates.map(item => ({
      label: item.label,
      amount: item.amount,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function findLiveLoadMoreButton(root = document) {
    const candidates = Array.from(root.querySelectorAll?.('button, [role="button"], a[href], input[type="button"], input[type="submit"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        let score = 0;

        if (/\bbid\b|history|watch|unwatch|notes?|close|confirm|snipe|catalog|search/i.test(label)) {
          score = -100;
        } else if (/\bopen\s+more\b/i.test(label)) {
          score = 100;
        } else if (/\b(?:load|show|view)\s+more\b/i.test(label)) {
          score = 90;
        } else if (/\bmore\s+lots?\b/i.test(label)) {
          score = 80;
        }

        return { button, label, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findLiveLoadMoreButton candidates', candidates.map(item => ({
      label: item.label,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function getLotTiles(root = document) {
    const roots = getLotSearchRoots(root);
    const candidates = roots.flatMap(searchRoot => Array.from(searchRoot.querySelectorAll([
        'app-lot-tile[id^="lot-"]',
        '.bid-status-border',
        '.lot-tile',
        '[class*="lot-tile"]',
        '.lot-number-lead',
        'a[href*="/lot/"]',
        '[class*="lot-number"]'
      ].join(','))));

    const fromText = roots.flatMap(searchRoot => Array.from(searchRoot.querySelectorAll('a, span, div, h2'))
      .filter(el => /^Lot\s+\d+[A-Za-z-]*/i.test(textOf(el))));

    const tiles = candidates.concat(fromText)
      .map(candidate => findLotTileFromSeed(candidate))
      .filter(Boolean)
      .filter(tile => Boolean(tile.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) || /^Lot\s+\d+/i.test(textOf(tile)));

    return Array.from(new Set(tiles));
  }

  function getLotSearchRoots(root = document) {
    const roots = [root];
    const seen = new Set(roots);

    for (let i = 0; i < roots.length; i += 1) {
      const current = roots[i];
      Array.from(current.querySelectorAll?.('*') || []).forEach(el => {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          roots.push(el.shadowRoot);
        }
      });
    }

    if (root === document) {
      Array.from(document.querySelectorAll('iframe')).forEach(frame => {
        try {
          const frameDoc = frame.contentDocument;
          if (frameDoc && !seen.has(frameDoc)) {
            seen.add(frameDoc);
            roots.push(frameDoc);
          }
        } catch {
          // Cross-origin frames cannot be inspected.
        }
      });
    }

    return roots;
  }

  function findLotTileFromSeed(seed) {
    if (!seed) return null;
    if (seed.matches?.('app-lot-tile[id^="lot-"], .bid-status-border, .lot-tile, [class*="lot-tile"]')) {
      if (seed.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) return seed;
    }

    let el = seed;
    for (let depth = 0; el && depth < 10; depth += 1, el = el.parentElement) {
      const hasLotIdentity = Boolean(el.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) || /^Lot\s+\d+/i.test(textOf(el));
      const hasBidSurface = Boolean(el.querySelector?.('.lot-bid-button, .TileDisplayMinBid, .lot-high-bid, .lot-tile-bid-status, .bid-status, [class*="high-bid"], [class*="bid-status"]'));
      if (hasLotIdentity && hasBidSurface) return el;
    }

    return null;
  }

  function extractLot(tile) {
    const titleLink = tile.querySelector('a.lot-number-lead[href], a.lot-preview-link[href]');
    const titleEl = tile.querySelector('.lot-title, h2');
    const lotLabel = textOf(tile.querySelector('.lot-number-lead .text-primary, .lot-number-lead span'));
    const lotNumber = lotLabel.match(/\d+[A-Za-z-]*/)?.[0] || '';
    const highBidText = textOf(tile.querySelector('.lot-high-bid, .lot-bid-container'));
    const bidCountText = textOf(tile.querySelector('.lot-bid-history'));
    const timeLeftText = textOf(tile.querySelector('.lot-time-left, .lot-time-label, .lot-time-left-container'));
    const nextBidText = textOf(tile.querySelector('.TileDisplayMinBid'));
    const bidButton = findBidButton(tile);
    const nextBidFromLabel = moneyFromText(nextBidText);
    const nextBidFromButton = moneyFromText(textOf(bidButton));
    const nextBidAmount = Math.max(nextBidFromLabel || 0, nextBidFromButton || 0) || null;
    const bidStatusRoot = tile.querySelector('.lot-tile-bid-status .bid-status');
    const statusClass = [
      tile.querySelector('[class*="bid-status-border"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="live-catalog-high-bid-status"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="lot-status-"]')?.getAttribute('class') || '',
      bidStatusRoot?.getAttribute('class') || '',
      tile.querySelector('.bid-status.winning, .bid-status.outbid, .bid-status.losing')?.getAttribute('class') || ''
    ].join(' ');
    const statusText = textOf(tile.querySelector('.bid-status.winning, .bid-status.outbid, .bid-status.losing, .lot-tile-bid-status'));
    const allStatus = `${statusText} ${statusClass} ${textOf(tile)}`;
    const userBidStatus = extractUserBidStatus(allStatus);
    const href = titleLink?.getAttribute('href') || '';

    return {
      tile,
      bidButton,
      id: (tile.id || '').replace(/^lot-/, ''),
      lot: lotNumber,
      title: textOf(titleEl) || titleLink?.getAttribute('aria-label') || '',
      url: href ? new URL(href, location.origin).href : '',
      highBid: highBidText,
      highBidAmount: moneyFromText(highBidText),
      bidCount: bidCountText,
      bidCountNumber: numberFromText(bidCountText),
      timeLeft: timeLeftText,
      nextBid: nextBidText,
      nextBidAmount,
      userBidStatus,
      isWinning: userBidStatus === 'Winning',
      isOutbid: userBidStatus === 'Outbid',
      statusClass: statusClass.trim()
    };
  }

  function uniqueLots(lots) {
    const unique = new Map();
    lots.forEach(lot => {
      if (lot?.lot && !unique.has(String(lot.lot))) unique.set(String(lot.lot), lot);
    });
    return Array.from(unique.values());
  }

  function evaluateLot(lot, planEntry, options = {}) {
    if (!planEntry) return { status: 'not planned', eligible: false };
    if (!titleMatches(lot.title, planEntry.title)) return { status: 'title mismatch', eligible: false };
    if (!Number.isFinite(planEntry.max) || planEntry.max <= 0) return { status: 'add max', eligible: false };
    if (options.requireOutbid && !lot.isOutbid) return { status: 'not outbid', eligible: false };
    if (lot.isWinning) return { status: 'already winning', eligible: false };
    if (!Number.isFinite(lot.nextBidAmount)) return { status: 'no bid button', eligible: false };
    if (lot.nextBidAmount > planEntry.max) return { status: 'over max', eligible: false };
    return { status: 'eligible', eligible: true };
  }

  function evaluateLiveLot(liveState, planEntry) {
    if (!planEntry) return { status: 'not planned', eligible: false };
    if (!Number.isFinite(planEntry.max) || planEntry.max <= 0) return { status: 'add max', eligible: false };
    if (!liveState?.lot) return { status: 'no live lot', eligible: false };
    if (!titleMatches(liveState.title, planEntry.title)) return { status: 'title mismatch', eligible: false };
    if (!liveState.bidButton || !isVisible(liveState.bidButton)) return { status: 'no live bid button', eligible: false };
    if (!Number.isFinite(liveState.nextBidAmount)) return { status: 'no live ask', eligible: false };
    if (liveState.nextBidAmount > planEntry.max) return { status: 'over max', eligible: false };
    return { status: 'eligible', eligible: true };
  }

  function decodeHtml(value) {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  function stripHtml(value) {
    return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function firstMatch(value, patterns) {
    for (const pattern of patterns) {
      const match = String(value || '').match(pattern);
      if (match?.[1]) return decodeHtml(match[1]).trim();
    }
    return '';
  }

  function parseDollarAmount(value) {
    const match = String(value || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function parsePlainInteger(value) {
    const match = String(value || '').match(/\b([\d,]+)\b/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function cleanListingTitle(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^Mark as sold\s+/i, '')
      .trim();
  }

  function cleanEbaySellerHubTitle(value) {
    let title = cleanListingTitle(value);
    const prefixes = [
      /^eBay\s*\|\s*/i,
      /^(?:\d+\s+)?Link\.\s*/i,
      /^Bids:\s*\d+\.\s*/i,
      /^Show Bid History\.\s*/i,
      /^Listing\.\s*/i,
    ];
    let changed = true;
    while (changed) {
      changed = false;
      prefixes.forEach(pattern => {
        const next = title.replace(pattern, '').trim();
        if (next !== title) {
          title = next;
          changed = true;
        }
      });
    }
    return title;
  }

  function normalizeListingUrl(value) {
    const url = decodeHtml(value || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) {
      if (/\/marketplace\//i.test(url)) return `https://www.facebook.com${url}`;
      return `https://www.ebay.com${url}`;
    }
    return url;
  }

  function dedupeListings(listings) {
    const seen = new Set();
    const result = [];
    listings.forEach(listing => {
      const key = [
        listing.source || '',
        listing.itemId || '',
        listing.url || '',
        String(listing.title || '').toLowerCase(),
        listing.price ?? ''
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      result.push(listing);
    });
    return result;
  }

  function amountFromState(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = moneyFromText(value) ?? Number(value.replace?.(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object') {
      return amountFromState(value.amount ?? value.value ?? value.current ?? value.bid);
    }
    return null;
  }

  function formatUsd(amount) {
    return Number.isFinite(amount) ? `${amount.toFixed(2)} USD` : '';
  }

  function refId(value) {
    if (typeof value === 'string') return value;
    return value?.__ref || '';
  }

  function deref(state, value) {
    const key = refId(value);
    return key && state?.[key] ? state[key] : value;
  }

  function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
  }

  function apolloLotConnections(state) {
    return Object.entries(state?.ROOT_QUERY || {}).map(([key, value]) => {
      const paged = value?.pagedResults || value?.lots?.pagedResults || value?.search?.pagedResults || value;
      const results = paged?.results || value?.results || [];
      const refs = [];
      const seen = new Set();

      function addRef(value) {
        const key = refId(value);
        if (!/^Lot:/i.test(key) || seen.has(key)) return;
        seen.add(key);
        refs.push(key);
      }

      if (Array.isArray(results)) results.forEach(addRef);
      if (!refs.length) return null;
      return {
        key,
        refs,
        totalCount: Number(firstDefined(paged?.totalCount, paged?.filteredCount, paged?.total, value?.totalCount)),
        pageLength: Number(firstDefined(paged?.pageLength, paged?.pageSize, paged?.take, refs.length)),
        pageNumber: Number(firstDefined(paged?.pageNumber, paged?.page, 1))
      };
    }).filter(Boolean);
  }

  function chooseApolloLotConnection(state, options = {}) {
    const connections = apolloLotConnections(state);
    if (!connections.length) return null;
    const expectedTotal = Number(options.expectedTotal);
    const scored = connections.map(connection => {
      let score = 0;
      if (Number.isFinite(expectedTotal) && connection.totalCount === expectedTotal) score += 1000;
      if (/lotSearch/i.test(connection.key)) score += 250;
      if (!/featured|hot|recommend|similar|related/i.test(connection.key)) score += 100;
      if (Number.isFinite(connection.totalCount)) score += Math.min(connection.totalCount, 500) / 10;
      score += Math.min(connection.refs.length, 100);
      return { connection, score };
    }).sort((a, b) => b.score - a.score);
    debug('apollo lot connections', scored.map(item => ({
      key: item.connection.key,
      refs: item.connection.refs.length,
      totalCount: item.connection.totalCount,
      pageLength: item.connection.pageLength,
      pageNumber: item.connection.pageNumber,
      score: item.score
    })).slice(0, 10));
    return scored[0].connection;
  }

  function collectLotRefsFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    if (chosen) return chosen.refs;

    const refs = [];
    const seen = new Set();

    function addRef(value) {
      const key = refId(value);
      if (!/^Lot:/i.test(key) || seen.has(key)) return;
      seen.add(key);
      refs.push(key);
    }

    if (!refs.length) {
      Object.keys(state || {}).filter(key => /^Lot:/i.test(key)).forEach(addRef);
    }

    return refs;
  }

  function expectedTotalFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    return Number.isFinite(chosen?.totalCount) ? chosen.totalCount : null;
  }

  function pageLengthFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    return Number.isFinite(chosen?.pageLength) ? chosen.pageLength : null;
  }

  function normalizeLotUrl(lot, context = {}) {
    const href = lot.url || lot.lotUrl || lot.itemUrl || lot.href || '';
    if (href) return absoluteUrl(href, context.url || location.href);
    const id = firstDefined(lot.id, lot.eventItemId, lot.eventitemId, lot.itemId);
    const lotNumber = firstDefined(lot.lotNumber, lot.lotNumberExtension, lot.number, id);
    if (!id && !lotNumber) return '';
    const slug = encodeURIComponent(String(lotNumber || id).replace(/\s+/g, '-'));
    return absoluteUrl(`/lot/${encodeURIComponent(String(id || lotNumber))}/${slug}`, context.url || 'https://hibid.com/');
  }

  function normalizeApolloLot(state, lotRef, context = {}) {
    const lot = deref(state, lotRef);
    if (!lot || typeof lot !== 'object') return null;
    const lotState = lot.lotState || lot.state || {};
    const auction = deref(state, lot.auction || lot.auctionInfo || lot.event) || {};
    const id = String(firstDefined(lot.id, lot.eventItemId, lot.eventitemId, lot.itemId, refId(lotRef).replace(/^Lot:/i, '')) || '');
    const lotNumber = String(firstDefined(lot.lotNumber, lot.lotNumberExtension, lot.number, lot.lot, id) || '');
    const title = stripHtml(firstDefined(lot.lead, lot.title, lot.name, lot.descriptionShort) || '');
    if (!lotNumber && !title) return null;

    const highBidAmount = amountFromState(firstDefined(lotState.highBid, lot.highBid, lotState.currentBid, lotState.currentPrice, lot.currentBid));
    const nextBidAmount = amountFromState(firstDefined(lotState.minBid, lotState.nextBid, lot.minBid, lot.nextBid));
    const bidCountNumber = Number(firstDefined(lotState.bidCount, lot.bidCount, lotState.bids, lot.bids));
    const statusText = String(firstDefined(lotState.status, lot.status, lotState.priceRealizedMessage, '') || '');
    const userBidStatus = extractUserBidStatus(`${statusText} ${lotState.userBidStatus || ''}`);
    const picture = deref(state, lot.featuredPicture || lot.picture || lot.primaryPicture) || {};
    const description = stripHtml(firstDefined(lot.description, lot.fullDescription, lot.notes, lot.longDescription) || '');

    return {
      id,
      lot: lotNumber,
      title,
      url: normalizeLotUrl({ ...lot, id, lotNumber }, context),
      image: firstDefined(picture.thumbnailLocation, picture.fullSizeLocation, picture.url, picture.src, lot.imageUrl, lot.thumbnailUrl) || '',
      highBid: Number.isFinite(highBidAmount) ? `High Bid: ${formatUsd(highBidAmount)}` : '',
      highBidAmount,
      currentPrice: highBidAmount,
      currentBid: highBidAmount,
      nextBid: Number.isFinite(nextBidAmount) ? `Bid ${formatUsd(nextBidAmount)}` : '',
      nextBidAmount,
      bidCount: Number.isFinite(bidCountNumber) ? `${bidCountNumber} ${bidCountNumber === 1 ? 'Bid' : 'Bids'}` : '',
      bidCountNumber: Number.isFinite(bidCountNumber) ? bidCountNumber : null,
      timeLeft: String(firstDefined(lotState.timeLeft, lot.timeLeft, lotState.closingTimeText, '') || ''),
      status: statusText,
      userBidStatus,
      isWinning: userBidStatus === 'Winning',
      isOutbid: userBidStatus === 'Outbid',
      watched: Boolean(firstDefined(lotState.isWatching, lot.isWatching, lot.watchListed, false)),
      pictureCount: Number(firstDefined(lot.pictureCount, lotState.pictureCount, 0)) || 0,
      description,
      auctionTitle: String(firstDefined(auction.title, auction.name, lot.auctionTitle, '') || ''),
      buyerPremium: String(firstDefined(auction.buyerPremium, auction.buyersPremium, lot.buyerPremium, '') || '')
    };
  }

  function extractHibidApolloLots(apolloState, context = {}) {
    const state = apolloState?.['apollo.state'] || apolloState?.apollo?.state || apolloState || {};
    const refs = collectLotRefsFromApolloState(state, { expectedTotal: context.expectedTotal });
    const unique = new Map();
    refs.forEach(ref => {
      const lot = normalizeApolloLot(state, ref, context);
      const key = lot?.id || lot?.lot || lot?.url;
      if (key && lot?.title) unique.set(String(key), lot);
    });
    return {
      source: 'hibid-state',
      items: Array.from(unique.values()),
      expectedTotal: Number.isFinite(Number(context.expectedTotal)) ? Number(context.expectedTotal) : expectedTotalFromApolloState(state, { expectedTotal: context.expectedTotal }),
      pageLength: pageLengthFromApolloState(state, { expectedTotal: context.expectedTotal })
    };
  }

  function parseHibidStateText(text) {
    if (!text) return null;
    try {
      const parsed = JSON.parse(String(text));
      return parsed?.['apollo.state'] || parsed?.apollo?.state || parsed;
    } catch (err) {
      debug('hibid-state parse failed', { error: err.message });
      return null;
    }
  }

  function extractHibidStateFromDocument(root = document) {
    const script = root.querySelector?.('script#hibid-state[type="application/json"], script#hibid-state');
    return parseHibidStateText(script?.textContent || '');
  }

  function mergeCatalogLots(target, lots) {
    lots.forEach(lot => {
      const key = lot?.id || lot?.url || lot?.lot;
      if (key && lot?.title) target.set(String(key), lot);
    });
    return target;
  }

  function catalogPageUrl(pageNumber, baseHref = (typeof location !== 'undefined' ? location.href : '')) {
    const url = new URL(baseHref || 'https://hibid.com/');
    url.searchParams.set('apage', String(pageNumber));
    return url.href;
  }

  async function fetchHibidApolloStatePage(pageNumber, baseHref = location.href) {
    if (typeof fetch !== 'function' || typeof DOMParser === 'undefined') return null;
    const href = catalogPageUrl(pageNumber, baseHref);
    debug('hibid-state fetch page start', { pageNumber, href });
    const response = await fetch(href, {
      credentials: 'same-origin',
      cache: 'no-cache'
    });
    if (!response.ok) {
      debug('hibid-state fetch page failed', { pageNumber, href, status: response.status });
      return null;
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const state = extractHibidStateFromDocument(doc);
    debug('hibid-state fetch page parsed', { pageNumber, href, hasState: Boolean(state) });
    return state;
  }

  async function scrapeHibidStatePages(onProgress = () => {}, shouldStop = () => false, root = document) {
    const firstState = extractHibidStateFromDocument(root);
    if (!firstState) {
      debug('hibid-state unavailable on current document');
      return null;
    }

    const lotsByKey = new Map();
    const visibleTotal = getExpectedLotTotal(root);
    const first = extractHibidApolloLots(firstState, { url: location.href, expectedTotal: visibleTotal });
    mergeCatalogLots(lotsByKey, first.items);
    const expectedTotal = first.expectedTotal || visibleTotal || first.items.length;
    const pageLength = first.pageLength || first.items.length || 100;
    const totalPages = expectedTotal && pageLength ? Math.max(1, Math.ceil(expectedTotal / pageLength)) : 1;
    let pagesRead = first.items.length ? 1 : 0;
    let failedPage = null;
    let stopReason = '';
    debug('hibid-state first page extracted', {
      count: lotsByKey.size,
      expectedTotal,
      pageLength,
      totalPages
    });
    onProgress(`Reading HiBid page data... ${lotsByKey.size}${expectedTotal ? `/${expectedTotal}` : ''}`);

    for (let page = 2; page <= totalPages; page += 1) {
      if (shouldStop()) {
        stopReason = 'user-stop';
        break;
      }
      const state = await fetchHibidApolloStatePage(page).catch(err => {
        debug('hibid-state page fetch threw', { page, error: err.message });
        failedPage = page;
        return null;
      });
      if (!state) {
        failedPage ||= page;
        stopReason = 'missing-page-state';
        break;
      }
      const pageLots = extractHibidApolloLots(state, { url: catalogPageUrl(page), expectedTotal });
      if (!pageLots.items.length) {
        failedPage = page;
        stopReason = 'empty-page-state';
        debug('hibid-state page had no lots', { page, expectedTotal });
        break;
      }
      mergeCatalogLots(lotsByKey, pageLots.items);
      pagesRead += 1;
      debug('hibid-state page merged', {
        page,
        pageLots: pageLots.items.length,
        count: lotsByKey.size,
        expectedTotal
      });
      onProgress(`Reading HiBid page data... ${lotsByKey.size}${expectedTotal ? `/${expectedTotal}` : ''}`);
      if (expectedTotal && lotsByKey.size >= expectedTotal) break;
    }

    const items = Array.from(lotsByKey.values());
    if (!items.length) return null;
    const stopped = !!shouldStop() || stopReason === 'user-stop';
    const incomplete = Boolean(expectedTotal && items.length < expectedTotal && !stopped);
    return {
      source: 'hibid-state',
      items,
      lots: items,
      expectedTotal,
      stopped,
      incomplete,
      pageLength,
      pagesAttempted: totalPages,
      pagesRead,
      failedPage,
      stopReason: stopReason || (incomplete ? 'below-expected-total' : 'complete')
    };
  }

  function isCatalogScrapeComplete(result) {
    if (!result?.items?.length) return false;
    if (result.stopped) return true;
    if (result.incomplete) return false;
    if (!Number.isFinite(result.expectedTotal) || result.expectedTotal <= 0) return true;
    return result.items.length >= result.expectedTotal;
  }

  function parseEbaySellerHubTableListingsHtml(html) {
    const text = String(html || '');
    const rowChunks = Array.from(text.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map(match => match[0])
      .concat(Array.from(text.matchAll(/<div\b[^>]+role=["']row["'][\s\S]*?(?=<div\b[^>]+role=["']row["']|$)/gi)).map(match => match[0]));
    const listings = [];

    rowChunks.forEach(chunk => {
      if (!/(?:\/itm\/\d+|itemId=\d+|itemid=\d+)/i.test(chunk)) return;
      const anchors = Array.from(chunk.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(match => {
        const attrs = match[1] || '';
        const href = decodeHtml(firstMatch(attrs, [/href="([^"]+)"/i, /data-href="([^"]+)"/i]));
        const text = cleanListingTitle(stripHtml(match[2] || '').replace(/\bopens in new window\b.*$/i, ''));
        return { href, text };
      });
      const itemHref = anchors.find(anchor => /\/itm\/\d+/i.test(anchor.href))?.href || '';
      const idHref = anchors.find(anchor => /(?:\/itm\/\d+|itemId=\d+|itemid=\d+)/i.test(anchor.href))?.href || '';
      const itemId = firstMatch(`${itemHref} ${idHref} ${chunk}`, [
        /\/itm\/(\d+)/i,
        /itemId=(\d+)/i,
        /itemid=(\d+)/i
      ]);
      const titleAnchor = anchors
        .filter(anchor => anchor.text && !/^(edit|actions?|sell similar|sell it faster|promote|preview|view|download|upload)$/i.test(anchor.text))
        .sort((a, b) => b.text.length - a.text.length)[0];
      const title = cleanEbaySellerHubTitle(titleAnchor?.text || stripHtml(firstMatch(chunk, [/aria-label="([^"]+)"/i])));
      const url = normalizeListingUrl(itemHref || (itemId ? `/itm/${itemId}` : idHref));
      const price = parseDollarAmount(chunk);
      if (!title || !price) return;
      const rowText = stripHtml(chunk);

      listings.push({
        source: 'eBay',
        itemId,
        title,
        price,
        url,
        status: /inactive|ended|sold/i.test(rowText) ? 'Inactive' : 'Active',
        listedDateText: firstMatch(rowText, [/\b(Listed\s+(?:today|yesterday|on\s+[^|]+?))(?:\s{2,}|$)/i]),
        shippingText: firstMatch(rowText, [/(\+\s*Shipping|Free shipping|Buyer pays shipping)/i]),
        views: parsePlainInteger(firstMatch(rowText, [/\b([\d,]+)\s+Views?\b/i, /\b([\d,]+)\s+View\b/i])),
        watchers: parsePlainInteger(firstMatch(rowText, [/\b([\d,]+)\s+Watchers?\b/i])),
        clicks: null,
      });
    });

    return dedupeListings(listings);
  }

  function parseEbayActiveListingsHtml(html) {
    const text = String(html || '');
    const chunks = text.split(/(?=<div[^>]+(?:qa-id="active-item-|\bid="active-item-|class="[^"]*active-item))/i);
    const listings = [];

    chunks.forEach(chunk => {
      if (!/ebay\.com\/itm\/\d+|active-item-\d+|item__price/i.test(chunk)) return;
      const url = normalizeListingUrl(firstMatch(chunk, [
        /href="(https:\/\/www\.ebay\.com\/itm\/\d+[^"]*)"/i,
        /href="(\/itm\/\d+[^"]*)"/i
      ]));
      const itemId = firstMatch(chunk, [
        /active-item-(\d+)/i,
        /Item ID:\s*(\d+)/i,
        /\/itm\/(\d+)/i
      ]);
      const title = stripHtml(firstMatch(chunk, [
        /<h3[^>]*class="[^"]*item-title[^"]*"[\s\S]*?<a[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
        /<a[^>]+href="(?:https:\/\/www\.ebay\.com)?\/itm\/\d+[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
        /<img[^>]+alt="([^"]+)"/i
      ]));
      const priceHtml = firstMatch(chunk, [/<div[^>]+class="[^"]*item__price[^"]*"[^>]*>([\s\S]*?)<\/div>/i]);
      const price = parseDollarAmount(stripHtml(priceHtml) || chunk);
      if (!title || !price) return;
      const activityText = stripHtml(chunk);
      const views = parsePlainInteger(firstMatch(activityText, [/\b([\d,]+)\s+Views?\b/i, /\b([\d,]+)\s+View\b/i]));
      const watchers = parsePlainInteger(firstMatch(activityText, [/\b([\d,]+)\s+Watchers?\b/i]));

      listings.push({
        source: 'eBay',
        itemId,
        title,
        price,
        url,
        status: 'Active',
        listedDateText: stripHtml(firstMatch(chunk, [/<div[^>]+class="[^"]*item__listing-status[^"]*"[^>]*>([\s\S]*?)<\/div>/i])),
        shippingText: stripHtml(firstMatch(chunk, [/<div[^>]+class="[^"]*item__shipping-price[^"]*"[^>]*>([\s\S]*?)<\/div>/i])),
        views,
        watchers,
        clicks: null,
      });
    });

    return dedupeListings(listings.concat(parseEbaySellerHubTableListingsHtml(text)));
  }

  function parseFacebookMarketplaceListingsHtml(html) {
    const text = String(html || '');
    const listings = [];
    const markSoldPattern = /aria-label="Mark as sold\s+([^"]+)"/gi;
    let match;

    while ((match = markSoldPattern.exec(text))) {
      const title = cleanListingTitle(decodeHtml(match[1]));
      const titleIndex = title ? text.lastIndexOf(title, match.index) : -1;
      const start = titleIndex >= 0 ? titleIndex : Math.max(0, match.index - 3200);
      const windowHtml = text.slice(start, match.index);
      const priceMatches = Array.from(windowHtml.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g));
      const price = priceMatches.length ? Number(priceMatches[priceMatches.length - 1][1].replace(/,/g, '')) : null;
      const url = normalizeListingUrl(firstMatch(windowHtml, [
        /href="(https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?[^"]*)"/i,
        /href="(\/marketplace\/item\/\d+\/?[^"]*)"/i
      ]));
      const fullText = stripHtml(windowHtml);
      const clicks = parsePlainInteger(firstMatch(fullText, [/\b([\d,]+)\s+clicks?\s+on\s+listing\b/i]));
      const listedDateText = firstMatch(fullText, [/\b(Active\s+·\s+Listed\s+on\s+[^·]+?)(?:\s+Listed|\s+\d+\s+clicks|$)/i]) || 'Active';

      if (!title || !price) continue;
      listings.push({
        source: 'Facebook Marketplace',
        itemId: firstMatch(url, [/\/marketplace\/item\/(\d+)/i]),
        title,
        price,
        url,
        status: /sold|inactive/i.test(listedDateText) ? 'Inactive' : 'Active',
        listedDateText,
        shippingText: '',
        views: null,
        watchers: null,
        clicks,
      });
    }

    if (!listings.length) {
      const cardPattern = /<div[^>]+aria-label="([^"]+)"[^>]+role="button"[\s\S]*?(?=<div[^>]+aria-label=|$)/gi;
      let card;
      while ((card = cardPattern.exec(text))) {
        const title = cleanListingTitle(decodeHtml(card[1]));
        if (!title || /^Mark as sold\b/i.test(title)) continue;
        const chunk = card[0];
        const price = parseDollarAmount(chunk);
        if (!price) continue;
        const fullText = stripHtml(chunk);
        listings.push({
          source: 'Facebook Marketplace',
          itemId: firstMatch(chunk, [/\/marketplace\/item\/(\d+)/i]),
          title,
          price,
          url: normalizeListingUrl(firstMatch(chunk, [
            /href="(https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?[^"]*)"/i,
            /href="(\/marketplace\/item\/\d+\/?[^"]*)"/i
          ])),
          status: /sold|inactive/i.test(fullText) ? 'Inactive' : 'Active',
          listedDateText: firstMatch(fullText, [/\b(Active\s+·\s+Listed\s+on\s+[^·]+?)(?:\s+Listed|\s+\d+\s+clicks|$)/i]) || 'Active',
          shippingText: '',
          views: null,
          watchers: null,
          clicks: parsePlainInteger(firstMatch(fullText, [/\b([\d,]+)\s+clicks?\s+on\s+listing\b/i])),
        });
      }
    }

    return dedupeListings(listings);
  }

  function parseFlipTrackerActiveListingsHtml(html, context = {}) {
    const sourceUrl = String(context.url || '');
    const text = String(html || '');
    if (/ebay\.com/i.test(sourceUrl) || /active-item-\d+|item__price|ebay\.com\/itm\/\d+/i.test(text)) {
      return parseEbayActiveListingsHtml(text);
    }
    if (/facebook\.com/i.test(sourceUrl) || /Mark as sold|clicks on listing|marketplace\/item\//i.test(text)) {
      return parseFacebookMarketplaceListingsHtml(text);
    }
    return dedupeListings(parseEbayActiveListingsHtml(text).concat(parseFacebookMarketplaceListingsHtml(text)));
  }

  function buildFlipTrackerListingsExportHtml(listings, meta = {}) {
    const rows = Array.isArray(listings) ? listings : [];
    const generatedAt = meta.generatedAt || new Date().toISOString();
    const pageUrl = meta.pageUrl || (typeof location !== 'undefined' ? location.href : '');
    const source = rows[0]?.source || 'Unknown';
    const cards = rows.map((listing, index) => {
      if (listing.source === 'eBay') {
        const itemId = listing.itemId || firstMatch(listing.url, [/\/itm\/(\d+)/i]) || String(index + 1);
        return `
          <div qa-id="active-item-${escapeHtml(itemId)}" class="active-item" data-fliptracker-source="ebay">
            <h3 class="item-title"><a href="${escapeHtml(listing.url || '')}"><span>${escapeHtmlText(listing.title || '')}</span></a></h3>
            <div class="item__itemid"><span>Item ID: ${escapeHtml(itemId)}</span></div>
            <div class="item__price"><span>$${Number(listing.price || 0).toFixed(2)}</span><span> Buy It Now</span></div>
            <div class="item__shipping-price">${escapeHtml(listing.shippingText || '')}</div>
            <div class="item__listing-status">${escapeHtml(listing.listedDateText || listing.status || 'Active')}</div>
            <div class="me-item-activity__column"><span>${Number.isFinite(listing.views) ? listing.views : ''}</span><span>View</span></div>
            <div class="me-item-activity__column"><span>${Number.isFinite(listing.watchers) ? listing.watchers : ''}</span><span>Watchers</span></div>
          </div>`;
      }
      return `
        <div aria-label="${escapeHtml(listing.title || '')}" role="button" data-fliptracker-source="facebook">
          <span>${escapeHtmlText(listing.title || '')}</span><span>$${Number(listing.price || 0).toFixed(2)}</span>
          <span>${escapeHtmlText(listing.listedDateText || listing.status || 'Active')}</span>
          <span>Listed on Marketplace · ${Number.isFinite(listing.clicks) ? listing.clicks : 0} clicks on listing</span>
          ${listing.url ? `<a href="${escapeHtml(listing.url)}">Open</a>` : ''}
        </div>
        <div aria-label="Mark as sold ${escapeHtml(listing.title || '')}" role="button">Mark as sold</div>`;
    }).join('\n');

    return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>FlipTracker Active Listing Export</title></head>
<body data-fliptracker-export="active-listings">
<h1>FlipTracker Active Listing Export</h1>
<script type="application/json" id="fliptracker-export-metadata">${JSON.stringify({ generatedAt, pageUrl, source, count: rows.length }).replace(/</g, '\\u003c')}</script>
${cards}
</body>
</html>`;
  }

  const Core = {
    APP_NAME,
    APP_SHORT_NAME,
    evaluateLot,
    moneyFromText,
    numberFromText,
    parseBidPlan,
    titleMatches,
    DEBUG_PREFIX,
    MENU_COMMANDS,
    resolveHiBidPage,
    resolveAssistantMode,
    getExpectedLotTotal,
    findCatalogNextPageButton,
    extractHibidApolloLots,
    extractHibidStateFromDocument,
    isCatalogScrapeComplete,
    scrapeCatalogLots,
    findDialog,
    findBidButton,
    findLiveBidButton,
    findLiveLoadMoreButton,
    findConfirmButton,
    findConfirmSurface,
    getLoadTarget,
    isLiveCatalogPage,
    isFlipTrackerListingPage,
    shouldInitOnLocation,
    getLotTiles,
    extractLot,
    extractTextLots,
    extractLiveAuctionState,
    extractLivePageLots,
    expandLivePageLots,
    buildLlmAuctionBrief,
    parseEbayActiveListingsHtml,
    parseFacebookMarketplaceListingsHtml,
    parseFlipTrackerActiveListingsHtml,
    buildFlipTrackerListingsExportHtml,
    buildPanelHtml,
    evaluateLiveLot,
    prepareLiveBid,
    findLotOnPage,
    planTextFromLoadedLots,
    addLotToPlanText,
    getPlanStorageKey,
    getStoredPlanText,
    shouldRebuildPanelForMode,
    shouldTeardownPanelForRebuild,
    scanPlan,
    lotSummary,
    getStoredAutoConfirm,
    getStoredMinimized,
    getStoredDebugEnabled
  };
  globalThis.HiBidBidAssistantCore = Core;

  async function enableSinglePage(status) {
    const headerText = textOf(document.querySelector('.lot-list-header'));
    if (/Total Lots:\s*\d/i.test(headerText)) return;

    const button = document.querySelector('.single-page-button');
    if (!button) return;

    status('Turning on Single Page...');
    button.click();
    for (let i = 0; i < 50; i += 1) {
      await wait(200);
      if (/Total Lots:\s*\d/i.test(textOf(document.querySelector('.lot-list-header')))) break;
    }
  }

  async function loadLots(status, shouldStop, collectLots = () => {}) {
    await enableSinglePage(status);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await wait(500);
    let lastUniqueCount = collectLots() || 0;
    let lastScrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);

    let stuck = 0;

    for (let i = 0; i < 500; i += 1) {
      if (shouldStop()) break;
      const uniqueCount = collectLots() || 0;
      status(`Loading lots... ${uniqueCount} unique`);
      const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const atBottom = scrollY >= Math.max(0, maxScrollY - 2);
      if (uniqueCount === lastUniqueCount && scrollY === lastScrollY) stuck += 1;
      else stuck = 0;
      lastUniqueCount = uniqueCount;
      lastScrollY = scrollY;
      if (stuck >= 8 || (atBottom && stuck >= 2)) break;

      window.scrollBy({ top: Math.max(700, Math.floor(window.innerHeight * 0.9)), left: 0, behavior: 'instant' });
      await wait(180);
    }
  }

  async function scrapeCatalogLots(status = () => {}, shouldStop = () => false) {
    debug('catalog scrape start', routeDebug());

    const stateResult = await scrapeHibidStatePages(status, shouldStop).catch(err => {
      debug('catalog hibid-state scrape failed', { error: err.message });
      return null;
    });
    if (stateResult?.items?.length) {
      debug('catalog scrape finished from hibid-state', {
        count: stateResult.items.length,
        expectedTotal: stateResult.expectedTotal,
        stopped: stateResult.stopped,
        incomplete: stateResult.incomplete,
        stopReason: stateResult.stopReason
      });
      if (isCatalogScrapeComplete(stateResult)) return stateResult;
      status(`HiBid page data incomplete (${stateResult.items.length}/${stateResult.expectedTotal || '?'}); trying visible-page fallback...`);
      debug('catalog hibid-state incomplete; falling back to DOM', {
        count: stateResult.items.length,
        expectedTotal: stateResult.expectedTotal,
        failedPage: stateResult.failedPage,
        stopReason: stateResult.stopReason
      });
    }

    const itemsMap = new Map();
    const collect = () => {
      uniqueLots(getLotTiles().map(extractLot)).forEach(lot => {
        const key = lot.id || lot.url || lot.lot;
        if (key && lot.title) itemsMap.set(String(key), lot);
      });
      mergeCatalogLots(itemsMap, extractTextLots());
      return itemsMap.size;
    };

    await loadLots(status, shouldStop, collect);
    collect();
    const items = Array.from(itemsMap.values());
    const expectedTotal = getExpectedLotTotal();
    debug('catalog scrape finished from dom fallback', {
      count: items.length,
      expectedTotal,
      stopped: shouldStop()
    });
    return {
      source: 'dom-fallback',
      items,
      lots: items,
      expectedTotal,
      stopped: !!shouldStop()
    };
  }

  function isHiBidHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'hibid.com' || host.endsWith('.hibid.com');
  }

  function pathSegments(loc = location) {
    return String(loc.pathname || '')
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
  }

  function resolveHiBidPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const search = String(loc.search || '');
    const parts = pathSegments(loc);

    if (!isHiBidHost(host)) {
      return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };
    }

    if (parts[0] === 'account' && parts[1] === 'watchlist') {
      return /status=OUTBID/i.test(search)
        ? { supported: true, kind: 'watchlist-outbid', host, reason: 'outbid watchlist route' }
        : { supported: false, kind: 'watchlist', host, reason: 'watchlist is not OUTBID' };
    }

    if (parts[0] === 'livecatalog') {
      return { supported: true, kind: 'live', host, auctionId: parts[1] || '', reason: 'livecatalog route' };
    }

    if (parts[0] === 'catalog') {
      return { supported: true, kind: 'catalog', host, auctionId: parts[1] || '', reason: 'catalog route' };
    }

    if (parts[0] === 'lots' || parts[0] === 'lot') {
      return {
        supported: true,
        kind: parts[0] === 'lot' ? 'lot' : 'catalog',
        host,
        auctionId: parts[1] || '',
        reason: `${parts[0]} route`
      };
    }

    if (parts[1] === 'lots' || parts[1] === 'lot') {
      return {
        supported: true,
        kind: parts[1] === 'lot' ? 'lot' : 'catalog',
        host,
        statePrefix: parts[0] || '',
        auctionId: parts[2] || '',
        reason: `state-prefixed ${parts[1]} route`
      };
    }

    return { supported: false, kind: 'unsupported', host, reason: 'unsupported HiBid path' };
  }

  function isWatchlistOutbidPage(loc = location) {
    return resolveHiBidPage(loc).kind === 'watchlist-outbid';
  }

  function isLiveCatalogPage(loc = location) {
    return resolveHiBidPage(loc).kind === 'live';
  }

  function isFlipTrackerListingPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');
    if (host === 'www.ebay.com') {
      return /^\/sh\/lst\b/i.test(pathname) || /^\/mys\//i.test(pathname);
    }
    if (host === 'www.facebook.com' || host === 'facebook.com') {
      return /^\/marketplace\/(?:you|profile)\b/i.test(pathname);
    }
    return false;
  }

  function shouldInitOnLocation(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');

    if (host === 'bid.ajwillnerauctions.com') {
      return /^\/ui\/auctions\//i.test(pathname);
    }

    if (isFlipTrackerListingPage(loc)) return true;

    if (isHiBidHost(host)) return resolveHiBidPage(loc).supported;
    return false;
  }

  function resolveAssistantMode(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    if (host === 'bid.ajwillnerauctions.com' && /^\/ui\/auctions\//i.test(loc.pathname || '')) {
      return {
        supported: true,
        mode: 'catalog',
        source: 'ajwillner',
        reason: 'AJ Willner auction route',
        route: { supported: true, kind: 'catalog', host, auctionId: getAjWillnerAuctionId(loc), reason: 'AJ Willner auction route' }
      };
    }

    if (isFlipTrackerListingPage(loc)) {
      return { supported: true, mode: 'fliptracker', source: 'marketplace', reason: 'active listing export route', route: null };
    }

    if (isHiBidHost(host)) {
      const route = resolveHiBidPage(loc);
      if (!route.supported) return { supported: false, mode: 'unsupported', source: 'hibid', reason: route.reason, route };
      if (route.kind === 'live') return { supported: true, mode: 'live', source: 'hibid', reason: route.reason, route };
      return { supported: true, mode: 'catalog', source: 'hibid', reason: route.reason, route };
    }

    return { supported: false, mode: 'unsupported', source: 'unknown', reason: 'unsupported host', route: null };
  }

  function getLoadTarget(options = {}, loc = location) {
    const onOutbidWatchlist = /\/account\/watchlist/i.test(loc.pathname || '') && /status=OUTBID/i.test(loc.search || '');
    if (options.requireOutbid && !onOutbidWatchlist) return OUTBID_WATCHLIST_URL;
    return null;
  }

  function scanPlan(plan, options = {}, cachedLots = []) {
    const lots = uniqueLots(getLotTiles().map(extractLot));
    if (!lots.length) lots.push(...extractTextLots());
    const byLot = new Map(cachedLots.concat(lots).filter(lot => lot?.lot).map(lot => [String(lot.lot), lot]));
    const rows = [];
    const plannedLots = new Set(Object.keys(plan).map(String));

    Object.entries(plan).forEach(([lotNumber, entry]) => {
      const lot = byLot.get(String(lotNumber));
      if (!lot) {
        rows.push({ lot: lotNumber, title: entry.title || '', max: entry.max, status: 'not found', eligible: false });
        return;
      }

      const decision = evaluateLot(lot, entry, options);
      rows.push({ ...lot, max: entry.max, expectedTitle: entry.title, ...decision });
    });

    if (options.includeUnplanned) {
      byLot.forEach((lot, lotNumber) => {
        if (plannedLots.has(String(lotNumber))) return;
        rows.push({ ...lot, max: '', status: 'loaded from OUTBID - add max', eligible: false });
      });
    }

    rows.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return Number(a.lot || 0) - Number(b.lot || 0);
    });
    return rows;
  }

  async function findLotOnPage(lotNumber, status, shouldStop = () => false) {
    const wanted = String(lotNumber);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await wait(350);

    let lastScrollY = -1;
    let stuck = 0;
    for (let i = 0; i < 350; i += 1) {
      if (shouldStop()) return null;
      const lot = uniqueLots(getLotTiles().map(extractLot)).find(item => String(item.lot) === wanted);
      if (lot?.tile) return lot;

      const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (scrollY >= Math.max(0, maxScrollY - 2) && scrollY === lastScrollY) stuck += 1;
      else stuck = 0;
      if (stuck >= 3) break;
      lastScrollY = scrollY;
      status(`Searching visible list for Lot ${wanted}...`);
      window.scrollBy({ top: Math.max(650, Math.floor(window.innerHeight * 0.85)), left: 0, behavior: 'instant' });
      await wait(180);
    }

    return null;
  }

  function extractTextLots(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    const chunks = text.split(/(?=Lot\s+\d+[A-Za-z-]*\s*\|)/i);

    return chunks.map(chunk => {
      const firstLine = chunk.match(/Lot\s+(\d+[A-Za-z-]*)\s*\|\s*([^\n\r]+?)(?=\s{2,}|High Bid:|Current Bid:|$)/i);
      if (!firstLine) return null;

      const highBid = chunk.match(/(?:High Bid|Current Bid):\s*([\d,.]+\s*USD)/i)?.[1] || '';
      const nextBid = chunk.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
      const bidCount = chunk.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
      const status = extractUserBidStatus(chunk);

      return {
        tile: null,
        bidButton: null,
        id: '',
        lot: firstLine[1],
        title: firstLine[2].trim(),
        url: '',
        highBid: highBid ? `High Bid: ${highBid}` : '',
        highBidAmount: moneyFromText(highBid),
        bidCount,
        bidCountNumber: numberFromText(bidCount),
        timeLeft: '',
        nextBid,
        nextBidAmount: moneyFromText(nextBid),
        userBidStatus: status,
        isWinning: status === 'Winning',
        isOutbid: status === 'Outbid',
        statusClass: 'text-fallback'
      };
    }).filter(Boolean);
  }

  function cleanLiveTitle(value) {
    return String(value || '')
      .replace(/\s*(?:Current Bid|High Bid|Asking Bid|Next Bid|Min(?:imum)? Bid|Bid\s+[\d,.]+\s*USD|Bidding Closed|Opening Bid|Price Realized).*$/i, '')
      .replace(/\s+\d+\s+Bids?\s*$/i, '')
      .trim();
  }

  function extractLiveAuctionState(root = document) {
    const source = root.body || root.documentElement || root;
    const text = textOf(source);
    const lotMatch = text.match(/\bLot\s+(\d+[A-Za-z-]*)\s*(?:\||-|:)?\s*([\s\S]*?)(?=\s+(?:Current Bid|High Bid|Asking Bid|Next Bid|Min(?:imum)? Bid|Bid\s+[\d,.]+\s*USD|Bidding Closed|Opening Bid|Price Realized)|$)/i);
    const currentBid = text.match(/(?:Current Bid|High Bid|Price Realized):?\s*([\d,.]+\s*USD)/i)?.[1] || '';
    const bidCount = text.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
    const explicitNext = text.match(/(?:Next Bid|Asking Bid|Min(?:imum)? Bid):?\s*([\d,.]+\s*USD)/i)?.[1] || '';
    const bidButton = findLiveBidButton(root);
    const buttonLabelText = controlLabel(bidButton);
    const buttonNext = buttonLabelText.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
    const nextBid = explicitNext || buttonNext;
    const state = {
      root,
      lot: lotMatch?.[1] || '',
      title: cleanLiveTitle(lotMatch?.[2] || ''),
      highBid: currentBid ? `High Bid: ${currentBid}` : '',
      currentBid: currentBid ? `Current Bid: ${currentBid}` : '',
      currentBidAmount: moneyFromText(currentBid),
      nextBid: nextBid ? `Bid ${nextBid}` : '',
      nextBidAmount: moneyFromText(nextBid),
      bidCount,
      bidCountNumber: numberFromText(bidCount),
      bidButton,
      isLive: true
    };

    debug('live state extracted', {
      lot: state.lot,
      title: state.title,
      currentBidAmount: state.currentBidAmount,
      nextBidAmount: state.nextBidAmount,
      bidCount: state.bidCount,
      hasBidButton: Boolean(state.bidButton),
      bidButtonLabel: buttonLabelText
    });

    return state;
  }

  function extractLivePageLots(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    const chunks = text.split(/(?=Lot\s+\d+[A-Za-z-]*\s*\|)/i);
    return chunks.map(chunk => {
      const firstLine = chunk.match(/Lot\s+(\d+[A-Za-z-]*)\s*\|\s*([\s\S]*?)(?=\s+(?:Watch|Unwatch|High Bid:|Current Bid:|Price Realized:|Bidding Closed|Bid\s+[\d,.]+\s*USD)|$)/i);
      if (!firstLine) return null;
      const highBid = chunk.match(/(?:High Bid|Current Bid|Price Realized):\s*([\d,.]+\s*USD)/i)?.[1] || '';
      const nextBid = chunk.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
      const bidCount = chunk.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
      const timeLeft = chunk.match(/\b\d+\s*(?:d|h|m|s)\b/i)?.[0] || '';
      const valueHint = chunk.match(/(?:High Bid|Current Bid):\s*[\d,.]+\s*USD\s+([\d,.]+\s*USD)/i)?.[1] || '';
      const userBidStatus = extractUserBidStatus(chunk);
      const lot = firstLine[1];
      return {
        id: lot,
        lot,
        title: firstLine[2].replace(/\s+/g, ' ').trim(),
        highBid: highBid ? `High Bid: ${highBid}` : '',
        highBidAmount: moneyFromText(highBid),
        estimatedValue: moneyFromText(valueHint),
        bidCount,
        bidCountNumber: numberFromText(bidCount),
        timeLeft,
        nextBid: nextBid ? `Bid ${nextBid}` : '',
        nextBidAmount: moneyFromText(nextBid),
        userBidStatus,
        status: /bidding closed/i.test(chunk) ? 'Bidding Closed' : (/incoming bid/i.test(chunk) ? 'Incoming Bid' : ''),
        rawText: chunk.replace(/\s+/g, ' ').trim().slice(0, 1200)
      };
    }).filter(Boolean);
  }

  function liveAuctionContext(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    return {
      title: text.match(/\bThe Luxe Edit\b/i)?.[0] || document.title || '',
      url: location.href,
      totalLots: numberFromText(text.match(/Total Lots:\s*([\d,]+)/i)?.[1] || ''),
      openLots: numberFromText(text.match(/Open Lots:\s*([\d,]+)/i)?.[1] || '')
    };
  }

  function catalogAuctionContext(root = document) {
    return {
      title: (typeof document !== 'undefined' ? document.title : '') || textOf(root.querySelector?.('h1')) || '',
      url: typeof location !== 'undefined' ? location.href : '',
      route: typeof location !== 'undefined' ? resolveHiBidPage(location) : null,
      totalLots: getExpectedLotTotal(root),
      openLots: null
    };
  }

  function mergeLiveLots(target, lots) {
    lots.forEach(lot => {
      if (!lot?.lot) return;
      target.set(String(lot.lot), lot);
    });
  }

  function scrollLiveLots(root = document) {
    const doc = root?.nodeType === 9 ? root : document;
    const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
    const scroller = root?.documentElement || doc?.documentElement;
    const body = root?.body || doc?.body;
    if (win?.scrollBy) {
      win.scrollBy({ top: Math.max(700, Math.floor((win.innerHeight || 900) * 0.85)), left: 0, behavior: 'instant' });
      return true;
    }
    if (scroller) {
      scroller.scrollTop = (scroller.scrollTop || 0) + 700;
      return true;
    }
    if (body) {
      body.scrollTop = (body.scrollTop || 0) + 700;
      return true;
    }
    return false;
  }

  async function expandLivePageLots(onProgress = () => {}, shouldStop = () => false, root = document, options = {}) {
    const maxSteps = options.maxSteps ?? 80;
    const waitMs = options.waitMs ?? 350;
    const lotsById = new Map();
    const context = liveAuctionContext(root);
    const expectedOpenLots = context.openLots || 0;
    let lastCount = -1;
    let stuckSteps = 0;
    let loadMoreClicks = 0;
    let scrolls = 0;

    for (let step = 0; step < maxSteps; step += 1) {
      mergeLiveLots(lotsById, extractLivePageLots(root));
      const countText = expectedOpenLots ? `${lotsById.size}/${expectedOpenLots}` : String(lotsById.size);
      onProgress(`Loading live lots... ${countText}`);
      debug('live expansion step', { step, lots: lotsById.size, expectedOpenLots, loadMoreClicks, scrolls });

      if (shouldStop()) {
        debug('live expansion stopped by user', { lots: lotsById.size });
        break;
      }
      if (expectedOpenLots && lotsById.size >= expectedOpenLots) break;

      const loadMoreButton = findLiveLoadMoreButton(root);
      if (loadMoreButton) {
        const label = controlLabel(loadMoreButton);
        loadMoreButton.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        loadMoreButton.click();
        loadMoreClicks += 1;
        debug('live load-more clicked', { label, loadMoreClicks });
        await wait(waitMs);
        continue;
      }

      const didScroll = scrollLiveLots(root);
      if (didScroll) scrolls += 1;
      await wait(waitMs);
      mergeLiveLots(lotsById, extractLivePageLots(root));

      if (lotsById.size === lastCount) {
        stuckSteps += 1;
      } else {
        stuckSteps = 0;
        lastCount = lotsById.size;
      }

      if (stuckSteps >= 4) {
        debug('live expansion stopped after no new lots', { lots: lotsById.size, expectedOpenLots, loadMoreClicks, scrolls });
        break;
      }
    }

    mergeLiveLots(lotsById, extractLivePageLots(root));
    const lots = Array.from(lotsById.values()).sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    return { lots, expectedOpenLots, loadMoreClicks, scrolls };
  }

  function buildLlmAuctionBrief(lots, context = liveAuctionContext()) {
    const fullLots = lots.map(lot => ({
      id: lot.id ?? '',
      lot: lot.lot,
      title: lot.title,
      url: lot.url || '',
      image: lot.image || '',
      description: lot.description || '',
      highBid: lot.highBid || '',
      highBidAmount: lot.highBidAmount ?? null,
      currentPrice: lot.currentPrice ?? null,
      currentBid: lot.currentBid ?? null,
      nextBid: lot.nextBid || '',
      nextBidAmount: lot.nextBidAmount ?? null,
      bidCount: lot.bidCount || '',
      bidCountNumber: lot.bidCountNumber ?? null,
      timeLeft: lot.timeLeft || '',
      valueHint: lot.estimatedValue ?? null,
      status: lot.status || lot.userBidStatus || '',
      userBidStatus: lot.userBidStatus || '',
      isWinning: Boolean(lot.isWinning),
      isOutbid: Boolean(lot.isOutbid),
      watched: Boolean(lot.watched),
      pictureCount: lot.pictureCount ?? null,
      auctionTitle: lot.auctionTitle || '',
      buyerPremium: lot.buyerPremium || '',
      rawText: lot.rawText || ''
    }));
    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      'Parsed auction context:',
      JSON.stringify(context, null, 2),
      '',
      `Lots scraped: ${fullLots.length}`,
      '',
      'Full lot data JSON:',
      JSON.stringify(fullLots, null, 2)
    ].join('\n');
  }

  function installAssistantCatalogScraperButton(status = () => {}) {
    const buttonId = 'hibid-scraper-copy-button';
    const fallbackId = 'hibid-scraper-json';
    const state = { running: false, stopRequested: false };

    function setButton(text, color = '#111') {
      const button = document.getElementById(buttonId);
      if (!button) return;
      button.textContent = text;
      button.style.backgroundColor = color;
    }

    function showFallback(payload) {
      let box = document.getElementById(fallbackId);
      if (!box) {
        box = document.createElement('textarea');
        box.id = fallbackId;
        box.style.cssText =
          'position:fixed;left:16px;bottom:64px;z-index:2147483647;width:520px;height:300px;background:#111;color:#fff;border:1px solid #fff5;border-radius:12px;padding:10px;font:12px monospace;box-shadow:0 8px 30px #0008';
        document.body.appendChild(box);
      }
      box.value = payload;
      box.focus();
      box.select();
    }

    function collectCatalogLots(itemsMap) {
      getLotTiles().forEach(tile => {
        const lot = extractLot(tile);
        const key = lot.url || lot.id || lot.lot;
        if (key && lot.title) itemsMap.set(String(key), lot);
      });
      return itemsMap.size;
    }

    async function copyAllLots() {
      if (state.running) {
        state.stopRequested = true;
        setButton('Stopping...', '#9c1b1b');
        status('Catalog scraper stop requested.');
        return;
      }

      state.running = true;
      state.stopRequested = false;
      setButton('Starting...', '#d32f2f');

      try {
        let lots = [];
        let stopped = false;
        let expectedTotal = 0;

        if (isLiveCatalogPage()) {
          const expanded = await expandLivePageLots(message => {
            setButton(message, '#d32f2f');
            status(message);
          }, () => state.stopRequested);
          lots = expanded.lots || [];
          stopped = expanded.stopped;
          expectedTotal = expanded.expectedOpenLots;
        } else {
          const itemsMap = new Map();
          await loadLots(message => {
            setButton(message, '#d32f2f');
            status(message);
          }, () => state.stopRequested, () => collectCatalogLots(itemsMap));
          collectCatalogLots(itemsMap);
          lots = Array.from(itemsMap.values());
          stopped = state.stopRequested;
          expectedTotal = numberFromText(textOf(document.querySelector('.lot-list-header')).match(/Total Lots:\s*([\d,]+)/i)?.[1] || '');
        }

        if (!lots.length) {
          setButton('Failed. Try again.', '#111');
          status('Catalog scraper found no lots.');
          return;
        }

        const payload = JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        if (!copied) showFallback(payload);
        const countText = expectedTotal ? `${lots.length}/${expectedTotal}` : String(lots.length);
        setButton(stopped
          ? (copied ? `Stopped. Copied ${countText}.` : `Stopped at ${countText}. Select text box.`)
          : (copied ? `Success! Copied ${countText}.` : `Scraped ${countText}. Select text box.`), '#2e7d32');
        status(copied ? `Catalog scraper copied ${countText} lot(s).` : `Catalog scraper scraped ${countText}; select fallback text box.`);
      } finally {
        state.running = false;
        state.stopRequested = false;
        setTimeout(() => setButton('Copy All HiBid Lots', '#111'), 5000);
      }
    }

    function ensureButton() {
      if (!shouldInitOnLocation() || isFlipTrackerListingPage() || !document.body) return;
      if (document.getElementById(buttonId)) return;
      const button = document.createElement('button');
      button.id = buttonId;
      button.type = 'button';
      button.textContent = 'Copy All HiBid Lots';
      button.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:999px;border:1px solid #fff3;background:#111;color:white;font:600 13px system-ui;box-shadow:0 8px 30px #0008;cursor:pointer;transition:background-color 0.3s;';
      button.addEventListener('click', copyAllLots);
      document.body.appendChild(button);
    }

    ensureButton();
    setTimeout(ensureButton, 1000);
    setTimeout(ensureButton, 3000);
    setInterval(ensureButton, 5000);
  }

  async function writeClipboard(payload) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(payload, 'text');
      return true;
    }
    if (globalThis.GM?.setClipboard) {
      await globalThis.GM.setClipboard(payload, 'text');
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
      return true;
    }
    return false;
  }

  function safeTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function downloadTextFile(filename, contents, type = 'text/html;charset=utf-8') {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  }

  function scanCurrentFlipTrackerListings() {
    return parseFlipTrackerActiveListingsHtml(document.documentElement?.outerHTML || '', {
      url: location.href
    });
  }

  function lotSummary(rows) {
    return rows
      .map(row => row.lot)
      .filter(Boolean)
      .slice(0, 12)
      .join(', ');
  }

  function findDialog() {
    return document.querySelector('ngb-modal-window, .modal.show, .modal-dialog, [role="dialog"], [aria-modal="true"], app-bid-confirmation, app-confirm-bid');
  }

  function buttonLabel(btn) {
    return [
      textOf(btn),
      btn?.getAttribute?.('aria-label') || '',
      btn?.getAttribute?.('title') || '',
      btn?.getAttribute?.('id') || btn?.id || '',
      btn?.getAttribute?.('name') || btn?.name || '',
      btn?.getAttribute?.('value') || btn?.value || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function findConfirmButton(dialog) {
    const candidates = Array.from(dialog.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn'))
      .filter(btn => !btn.disabled && !btn.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(btn => {
        const text = buttonLabel(btn).toLowerCase();
        let score = 0;
        if (/cancel|close|reject|no\b|deny|dismiss|hide/i.test(text)) {
          score = -100;
        } else if (/bid-confirm-confirm-bid|click\s+to\s+confirm\s+bid|confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(text)) {
          score = 12;
        } else if (/confirm/i.test(text)) {
          score = 8;
        } else if (/place\s+bid|place\s+max\s+bid/i.test(text)) {
          score = 7;
        } else if (/submit/i.test(text)) {
          score = 6;
        } else if (/yes/i.test(text)) {
          score = 5;
        } else if (/ok/i.test(text)) {
          score = 4;
        } else if (/bid/i.test(text)) {
          score = 3;
        }
        return { btn, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.btn || null;
  }

  function isBidConfirmText(value) {
    return /confirm\s+(?:your\s+)?(?:max\s+)?bid|bid\s+confirmation|click\s+to\s+confirm\s+bid|maximum\s+(?:amount|bid)|new\s+max\s+bid|submit\s+(?:your\s+)?bid/i.test(value || '');
  }

  function isStrongConfirmButton(btn) {
    return /bid-confirm-confirm-bid|click\s+to\s+confirm\s+bid|confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(buttonLabel(btn));
  }

  function isBidHistorySurface(surface) {
    return /bid\s+history|bid\s+history\s+for|\b\d+\s+bids?\b/i.test(textOf(surface));
  }

  function findConfirmSurface(root = document) {
    const modalRoots = Array.from(root.querySelectorAll?.('ngb-modal-window, .modal.show, .modal-dialog, [role="dialog"], [aria-modal="true"], app-bid-confirmation, app-confirm-bid, #modal-body, .modal-body') || []);
    const blockingHistoryDialog = modalRoots.find(surface => isVisible(surface) && isBidHistorySurface(surface));
    if (blockingHistoryDialog) {
      debug('confirm-surface blocked by bid history dialog', {
        text: textOf(blockingHistoryDialog).slice(0, 220)
      });
      return null;
    }

    const roots = modalRoots.slice();
    const pageRoot = root.body || root.documentElement;
    if (pageRoot) roots.push(pageRoot);

    const uniqueRoots = Array.from(new Set(roots));
    debug('confirm-surface scan', { candidateRoots: uniqueRoots.length });

    for (const surface of uniqueRoots) {
      const visible = isVisible(surface);
      if (!visible) {
        debug('confirm-surface skipped invisible root', {
          tag: surface?.tagName || '',
          id: surface?.id || '',
          className: String(surface?.className || '').slice(0, 120),
          text: textOf(surface).slice(0, 160)
        });
        continue;
      }
      const button = findConfirmButton(surface);
      const surfaceText = textOf(surface);
      const textMatch = isBidConfirmText(surfaceText);
      const strongButton = Boolean(button && isStrongConfirmButton(button));
      const isPageRoot = surface === pageRoot;
      debug('confirm-surface inspected visible root', {
        tag: surface?.tagName || '',
        id: surface?.id || '',
        className: String(surface?.className || '').slice(0, 120),
        isPageRoot,
        textMatch,
        hasButton: Boolean(button),
        strongButton,
        buttonLabel: button ? buttonLabel(button) : '',
        text: surfaceText.slice(0, 220)
      });
      if (!button) continue;
      if (isBidHistorySurface(surface)) continue;
      if (isPageRoot && !strongButton && !/confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(surfaceText)) continue;
      if (textMatch || strongButton) {
        debug('confirm-surface matched', {
          buttonLabel: buttonLabel(button),
          surfaceText: surfaceText.slice(0, 220)
        });
        return { surface, button };
      }
    }

    debug('confirm-surface no match');
    return null;
  }

  async function prepareBid(row, status, rerender, shouldStop = () => false) {
    const plan = getPlan(status);
    const options = getScanOptions();
    debug('prepare-bid start', { row, options, plannedLots: Object.keys(plan) });
    if (findDialog()) {
      status('A HiBid dialog is already open. Review or close it before preparing another bid.');
      debug('prepare-bid blocked: existing dialog');
      return;
    }

    const freshRows = scanPlan(plan, options);
    let fresh = freshRows.find(item => String(item.lot) === String(row.lot));

    if ((!fresh || !fresh.tile) && plan[String(row.lot)]) {
      const found = await findLotOnPage(row.lot, status, shouldStop);
      if (found) {
        const decision = evaluateLot(found, plan[String(row.lot)], options);
        fresh = { ...found, max: plan[String(row.lot)].max, expectedTitle: plan[String(row.lot)].title, ...decision };
      }
    }

    if (!fresh || !fresh.tile) {
      status(`Lot ${row.lot} not found.`);
      debug('prepare-bid blocked: lot not found', { lot: row.lot });
      return;
    }
    if (!fresh.eligible) {
      status(`Lot ${row.lot} skipped: ${fresh.status}.`);
      debug('prepare-bid blocked: ineligible', { lot: row.lot, status: fresh.status, fresh });
      rerender(freshRows);
      return;
    }
    if (!fresh.bidButton || !isVisible(fresh.bidButton)) {
      status(`Lot ${row.lot} has no active bid button.`);
      debug('prepare-bid blocked: missing/hidden bid button', { lot: row.lot, hasButton: Boolean(fresh.bidButton), fresh });
      rerender(freshRows);
      return;
    }

    debug('prepare-bid clicking bid button', {
      lot: row.lot,
      nextBid: fresh.nextBid,
      nextBidAmount: fresh.nextBidAmount,
      buttonText: textOf(fresh.bidButton),
      autoConfirmChecked: Boolean(document.getElementById('hibid-bid-auto-confirm')?.checked)
    });
    fresh.tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await wait(450);

    fresh.bidButton.click();

    const autoConfirm = Boolean(document.getElementById('hibid-bid-auto-confirm')?.checked);
    if (autoConfirm) {
      status(`Prepared Lot ${row.lot} at ${fresh.nextBid}. Waiting for confirmation dialog...`);
    } else {
      status(`Prepared Lot ${row.lot} at ${fresh.nextBid}. Confirm manually if HiBid asks.`);
    }

    let dialogOpened = false;
    for (let i = 0; i < 60; i += 1) {
      await wait(150);
      const confirmSurface = findConfirmSurface();
      const dialog = confirmSurface?.surface || findDialog();
      debug('prepare-bid confirm wait tick', {
        lot: row.lot,
        tick: i + 1,
        hasConfirmSurface: Boolean(confirmSurface),
        hasDialog: Boolean(dialog),
        autoConfirm
      });
      if (autoConfirm && dialog && !confirmSurface) {
        debug('prepare-bid saw non-confirm dialog; continuing to wait', {
          lot: row.lot,
          tick: i + 1,
          dialogText: textOf(dialog).slice(0, 300)
        });
        continue;
      }
      if (dialog || confirmSurface) {
        dialogOpened = true;
        if (dialog?.style) {
          dialog.style.outline = '4px solid #f5c542';
          dialog.style.boxShadow = '0 0 0 9999px rgba(0,0,0,.22)';
        }
        
        if (autoConfirm) {
          status(`Lot ${row.lot}: Clicked place bid, auto-confirming...`);
          const confirmBtn = confirmSurface?.button || null;
          if (confirmBtn) {
            debug('prepare-bid clicking confirm button', {
              lot: row.lot,
              buttonLabel: buttonLabel(confirmBtn),
              buttonText: textOf(confirmBtn)
            });
            confirmBtn.click();
            status(`Lot ${row.lot}: Auto-confirm clicked. Waiting for dialog to close...`);
            
            // Wait for dialog to close
            let closed = false;
            for (let j = 0; j < 60; j += 1) {
              await wait(150);
              const stillOpen = findConfirmSurface() || findDialog();
              debug('prepare-bid close wait tick', {
                lot: row.lot,
                tick: j + 1,
                stillOpen: Boolean(stillOpen)
              });
              if (!stillOpen) {
                closed = true;
                break;
              }
            }
            if (closed) {
              status(`Lot ${row.lot} bid placed and confirmed at ${fresh.nextBid}!`);
            } else {
              status(`Lot ${row.lot}: Clicked confirm, but confirmation modal did not close. Please check.`);
            }
          } else {
            status(`Lot ${row.lot}: Confirmation surface opened, but no confirm button matched. Please confirm manually.`);
            debug('prepare-bid blocked: confirm surface without matched button', {
              lot: row.lot,
              dialogText: textOf(dialog).slice(0, 500)
            });
          }
        } else {
          status(`Lot ${row.lot}: HiBid confirmation is open. Review and click the site confirmation yourself.`);
        }
        break;
      }
    }

    if (!dialogOpened) {
      if (autoConfirm) {
        status(`Lot ${row.lot}: Bid button clicked, but no HiBid confirmation surface appeared.`);
        debug('prepare-bid failed: no confirmation surface appeared', { lot: row.lot });
      } else {
        status(`Lot ${row.lot}: Bid button clicked. No confirmation modal appeared.`);
        debug('prepare-bid clicked without confirmation surface', { lot: row.lot });
      }
    }
  }

  async function prepareLiveBid(row, status, shouldStop = () => false, root = document) {
    if (shouldStop()) {
      status('Live snipe stopped before bidding.');
      debug('live snipe stopped before fresh check', { lot: row?.lot });
      return;
    }

    const fresh = extractLiveAuctionState(root);
    const planEntry = {
      max: row?.max,
      title: row?.expectedTitle || row?.title || ''
    };
    if (String(fresh.lot || '') !== String(row?.lot || '')) {
      status(`Live snipe blocked: current live lot is ${fresh.lot || 'unknown'}, not Lot ${row?.lot}.`);
      debug('live snipe blocked: lot changed', { requestedLot: row?.lot, freshLot: fresh.lot, fresh });
      return;
    }

    const decision = evaluateLiveLot(fresh, planEntry);
    debug('live snipe fresh decision', { lot: fresh.lot, decision, max: planEntry.max, nextBidAmount: fresh.nextBidAmount });
    if (!decision.eligible) {
      status(`Live Lot ${row?.lot} skipped: ${decision.status}.`);
      return;
    }

    fresh.bidButton.click();
    const autoConfirm = Boolean(document.getElementById('hibid-bid-auto-confirm')?.checked);
    if (!autoConfirm) {
      status(`Live Lot ${fresh.lot}: bid button clicked at ${fresh.nextBid || fresh.nextBidAmount}. Confirm manually if HiBid asks.`);
      debug('live snipe clicked bid button; manual confirm mode', { lot: fresh.lot, nextBid: fresh.nextBid });
      return;
    }

    status(`Live Lot ${fresh.lot}: bid button clicked, waiting for confirmation...`);
    for (let i = 0; i < 60; i += 1) {
      await wait(150);
      const confirmSurface = findConfirmSurface(root === document ? document : globalThis.document || document);
      debug('live snipe confirm wait tick', { lot: fresh.lot, tick: i + 1, hasConfirmSurface: Boolean(confirmSurface) });
      if (!confirmSurface?.button) continue;
      confirmSurface.button.click();
      status(`Live Lot ${fresh.lot}: auto-confirm clicked at ${fresh.nextBid || fresh.nextBidAmount}.`);
      debug('live snipe auto-confirm clicked', { lot: fresh.lot, buttonLabel: buttonLabel(confirmSurface.button) });
      return;
    }

    status(`Live Lot ${fresh.lot}: no confirmation button found after bid click. Check HiBid manually.`);
    debug('live snipe confirm not found', { lot: fresh.lot });
  }

  function defaultPlanText() {
    return JSON.stringify({}, null, 2);
  }

  function storageSafeSegment(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';
  }

  function getAjWillnerAuctionId(loc = location) {
    const match = String(loc.pathname || '').match(/\/ui\/auctions\/([^/?#]+)/i);
    return match?.[1] || '';
  }

  function getPlanStorageKey(loc = location) {
    const host = storageSafeSegment(loc.hostname || 'page');
    if (host === 'bid.ajwillnerauctions.com') {
      const auctionId = getAjWillnerAuctionId(loc);
      return `${PLAN_KEY_PREFIX}:${host}:${auctionId ? `auction:${storageSafeSegment(auctionId)}` : 'catalog'}`;
    }

    if (isFlipTrackerListingPage(loc)) return `${PLAN_KEY_PREFIX}:${host}:fliptracker`;

    const route = resolveHiBidPage(loc);
    if (route.auctionId) return `${PLAN_KEY_PREFIX}:${host}:auction:${storageSafeSegment(route.auctionId)}`;
    if (route.kind === 'watchlist-outbid') return `${PLAN_KEY_PREFIX}:${host}:watchlist-outbid`;
    return `${PLAN_KEY_PREFIX}:${host}:${storageSafeSegment(route.kind || 'page')}`;
  }

  function getStoredPlanText(loc = (typeof location !== 'undefined' ? location : null)) {
    try {
      const key = loc ? getPlanStorageKey(loc) : `${PLAN_KEY_PREFIX}:global`;
      const stored = GM_getValue(key, null);
      if (typeof stored === 'string') return stored;

      const migrated = Boolean(GM_getValue(LEGACY_PLAN_MIGRATED_KEY, false));
      const legacy = migrated ? null : GM_getValue(LEGACY_PLAN_KEY, null);
      if (typeof legacy === 'string') {
        GM_setValue(key, legacy);
        GM_setValue(LEGACY_PLAN_MIGRATED_KEY, true);
        return legacy;
      }
      return defaultPlanText();
    } catch {
      return defaultPlanText();
    }
  }

  function savePlanText(value, loc = (typeof location !== 'undefined' ? location : null)) {
    try {
      const key = loc ? getPlanStorageKey(loc) : `${PLAN_KEY_PREFIX}:global`;
      GM_setValue(key, value);
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function addLotToPlanText(raw, lot) {
    let existingPlan;
    try {
      existingPlan = JSON.parse(raw || '{}');
    } catch {
      existingPlan = {};
    }
    if (!existingPlan || Array.isArray(existingPlan) || typeof existingPlan !== 'object') existingPlan = {};
    if (!lot?.lot) return JSON.stringify(existingPlan, null, 2);

    const lotKey = String(lot.lot);
    const existing = existingPlan[lotKey];
    const existingMax = typeof existing === 'number' ? existing : existing?.max;
    const max = Number(existingMax);
    existingPlan[lotKey] = {
      max: Number.isFinite(max) && max > 0 ? max : null,
      title: lot.title || existing?.title || ''
    };

    const sorted = {};
    Object.keys(existingPlan).sort((a, b) => String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    })).forEach(key => {
      sorted[key] = existingPlan[key];
    });
    return JSON.stringify(sorted, null, 2);
  }

  function planTextFromLoadedLots(raw, lots) {
    let existingPlan;
    try {
      existingPlan = JSON.parse(raw || '{}');
    } catch {
      existingPlan = {};
    }

    if (!existingPlan || Array.isArray(existingPlan) || typeof existingPlan !== 'object') existingPlan = {};

    const nextPlan = {};
    lots.forEach(lot => {
      if (!lot?.lot) return;
      const lotKey = String(lot.lot);
      const existing = existingPlan[lotKey];
      const existingMax = typeof existing === 'number' ? existing : existing?.max;
      const max = Number(existingMax);
      nextPlan[lotKey] = {
        max: Number.isFinite(max) && max > 0 ? max : null,
        title: lot.title || ''
      };
    });

    const sorted = {};
    Object.keys(nextPlan).sort((a, b) => Number(a) - Number(b)).forEach(key => {
      sorted[key] = nextPlan[key];
    });
    return JSON.stringify(sorted, null, 2);
  }

  function getStoredAutoRefresh() {
    try {
      return Boolean(GM_getValue(AUTO_REFRESH_KEY, false));
    } catch {
      return false;
    }
  }

  function saveAutoRefresh(value) {
    try {
      GM_setValue(AUTO_REFRESH_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function getStoredAutoConfirm() {
    try {
      return Boolean(GM_getValue(AUTO_CONFIRM_KEY, false));
    } catch {
      return false;
    }
  }

  function saveAutoConfirm(value) {
    try {
      GM_setValue(AUTO_CONFIRM_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function getStoredMinimized() {
    try {
      return Boolean(GM_getValue(MINIMIZED_KEY, true));
    } catch {
      return true;
    }
  }

  function saveMinimized(value) {
    try {
      GM_setValue(MINIMIZED_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function getPlan(status) {
    const raw = document.getElementById('hibid-bid-plan-json')?.value || '{}';
    try {
      const plan = parseBidPlan(raw);
      savePlanText(raw);
      return plan;
    } catch (err) {
      status(`Bad JSON: ${err.message}`);
      return {};
    }
  }

  function hibaIcon(name) {
    const icons = {
      chevron: '<path d="m6 9 6 6 6-6"></path>',
      close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>',
      list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
      radio: '<circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path>',
      scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path>',
      shield: '<path d="M20 13c0 5-3.5 7.5-7.7 8.8a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.6a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"></path>',
      stop: '<rect width="14" height="14" x="5" y="5" rx="2"></rect>',
      zap: '<path d="M4 14a1 1 0 0 1-.8-1.6l9-10A1 1 0 0 1 14 3v7h6a1 1 0 0 1 .8 1.6l-9 10A1 1 0 0 1 10 21v-7z"></path>'
    };
    return `<svg class="hiba-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.shield}</svg>`;
  }

  function helpAttrs(text) {
    if (!text) return '';
    const safe = escapeHtml(text);
    return ` title="${safe}" aria-label="${safe}" data-help="${safe}"`;
  }

  function actionButton(id, icon, label, tone = 'primary', extra = '', help = '') {
    return `<button id="${id}" type="button" class="hiba-btn ${tone}"${helpAttrs(help || label)} ${extra}>${hibaIcon(icon)}<span>${label}</span></button>`;
  }

  function renderModeTabs(mode) {
    const meta = {
      catalog: { label: 'Catalog', icon: 'list', help: 'Catalog mode loads visible or outbid HiBid lots, edits max plans, copies JSON, and builds the resale LLM brief.' },
      live: { label: 'Live', icon: 'radio', help: 'Live mode watches the current HiBid live lot and lets you manually fire a bid if the ask is within your saved max.' },
      fliptracker: { label: 'FlipTracker', icon: 'file', help: 'FlipTracker mode exports visible eBay or Facebook selling listings for import/review.' },
      unsupported: { label: 'Unsupported', icon: 'shield', help: 'This page is not supported by FlipperAddon.' }
    };
    const active = meta[mode] || meta.catalog;
    return `
      <div class="hiba-tabs" role="tablist" aria-label="Active FlipperAddon module">
        <button type="button" class="hiba-tab active" data-mode-tab="${escapeHtml(mode)}"${helpAttrs(active.help)} disabled>${hibaIcon(active.icon)}<span>${active.label}</span></button>
      </div>
    `;
  }

  function renderMaxPlanEditor() {
    return `
      <details id="hibid-max-plan-details" class="hiba-details">
        <summary data-help="Open this to edit the lot-number to maximum-bid plan. Null means saved, but not allowed to bid yet.">Max plan</summary>
        <div class="hiba-meta">Format: {"1627sf":{"max":40,"title":"optional title words"}}. Leave max null to save a lot for later without making it eligible.</div>
        <textarea id="hibid-bid-plan-json" spellcheck="false" class="hiba-plan" placeholder='{
  "1627sf": {
    "max": 40,
    "title": "Chloe"
  }
}'></textarea>
      </details>
    `;
  }

  function renderDebugActions(debugEnabled) {
    if (!debugEnabled) return '';
    return `
      <div class="hiba-actions hiba-debug-actions">
        ${actionButton('hibid-debug-copy', 'copy', 'Copy Debug', 'secondary', '', 'Copy the in-memory FlipperAddon debug log for troubleshooting.')}
        ${actionButton('hibid-debug-clear', 'stop', 'Clear Debug', 'danger', '', 'Clear saved FlipperAddon debug log entries.')}
      </div>
    `;
  }

  function renderCatalogSection(debugEnabled) {
    return `
      <section id="hibid-bid-controls" class="hiba-section" data-module="catalog">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">HiBid catalog</div>
            <strong>Catalog / Watchlist Scanner</strong>
          </div>
          <span class="hiba-chip neutral">max plan</span>
        </div>
        <div class="hiba-meta">Load lots, set a max per lot, then prepare only rows that are still under your max. This module is for catalog, category, lot, and OUTBID watchlist pages.</div>
        ${renderMaxPlanEditor()}
        <div class="hiba-toggle-grid">
          <label class="hiba-switch"${helpAttrs('Only show and prepare lots where the page says you are outbid.')}><input id="hibid-bid-outbid-only" type="checkbox"><span>Outbid only</span></label>
          <label class="hiba-switch"${helpAttrs('Refresh the outbid/watchlist scan every 30 seconds, pausing while you type.')}><input id="hibid-bid-auto-refresh" type="checkbox"><span>Auto refresh 30s</span></label>
          <label class="hiba-switch"${helpAttrs('When checked, FlipperAddon clicks only strongly matched HiBid confirm bid buttons after you prepare/fire a bid.')}><input id="hibid-bid-auto-confirm" type="checkbox"><span>Auto-confirm modals</span></label>
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-bid-load', 'download', 'Load Lots', 'primary', '', 'Scrape the current catalog or OUTBID watchlist and merge lots into the max plan with blank max values.')}
          ${actionButton('hibid-bid-scan', 'scan', 'Scan', 'primary', '', 'Evaluate current visible or loaded lots against your max plan.')}
          ${actionButton('hibid-bid-next', 'zap', 'Prepare Next', 'success', '', 'Click the next eligible bid button after a fresh scan.')}
          ${actionButton('hibid-bid-stop', 'stop', 'Stop', 'danger', '', 'Stop scraping, auto refresh, or pending bid preparation.')}
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-catalog-copy-json', 'copy', 'Copy Lots JSON', 'secondary', '', 'Copy scraped HiBid lots as JSON for manual use.')}
          ${actionButton('hibid-catalog-copy-llm', 'file', 'Copy LLM Brief', 'primary', '', 'Copy the full resale-analysis prompt plus scraped lot JSON for a desktop LLM.')}
        </div>
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderLiveSection(debugEnabled) {
    return `
      <section id="hibid-live-mode" class="hiba-section" data-module="live">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">HiBid live</div>
            <strong>Live Snipe Assistant</strong>
          </div>
          <span class="hiba-chip neutral">manual fire</span>
        </div>
        <div class="hiba-meta">Live mode does not reload the page. It watches the current live lot, compares the ask to your max plan, and enables Snipe Now only when eligible.</div>
        ${renderMaxPlanEditor()}
        <div class="hiba-toggle-grid">
          <label class="hiba-switch"${helpAttrs('When checked, FlipperAddon clicks only strongly matched HiBid confirm bid buttons after Snipe Now opens a confirm surface.')}><input id="hibid-bid-auto-confirm" type="checkbox"><span>Auto-confirm modals</span></label>
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-live-arm', 'shield', 'Arm', 'secondary', '', 'Arm or disarm manual live sniping for the current eligible live lot.')}
          ${actionButton('hibid-live-snipe', 'zap', 'Snipe Now', 'success', 'disabled', 'Fresh-check the current live lot and click its bid control if the ask is still under max.')}
          ${actionButton('hibid-bid-stop', 'stop', 'Stop', 'danger', '', 'Disarm live mode and stop pending activity.')}
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-live-copy-json', 'copy', 'Copy Lots JSON', 'secondary', '', 'Expand visible live lots and copy their JSON.')}
          ${actionButton('hibid-live-copy-llm', 'file', 'Copy LLM Brief', 'primary', '', 'Expand visible live lots and copy the resale-analysis prompt plus lot JSON.')}
        </div>
        ${renderDebugActions(debugEnabled)}
        <div id="hibid-live-state" class="hiba-live-card hiba-meta">Waiting for live lot...</div>
      </section>
    `;
  }

  function renderFlipTrackerSection(debugEnabled) {
    return `
      <section id="fliptracker-listing-export-mode" class="hiba-section" data-module="fliptracker">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">Marketplace listings</div>
            <strong>FlipTracker Active Listing Export</strong>
          </div>
          <span class="hiba-chip neutral">HTML</span>
        </div>
        <div class="hiba-meta">Scrapes visible active eBay/Facebook selling cards and exports an HTML file for FlipTracker ImportInbox. Scroll or load more listings first if needed.</div>
        <div class="hiba-actions">
          ${actionButton('fliptracker-listing-scan', 'scan', 'Scan Listings', 'primary', '', 'Read the currently visible eBay or Facebook active selling listings.')}
          ${actionButton('fliptracker-listing-copy', 'copy', 'Copy HTML', 'secondary', '', 'Copy the FlipTracker import HTML to the clipboard.')}
          ${actionButton('fliptracker-listing-download', 'download', 'Download', 'success', '', 'Download the FlipTracker import HTML file.')}
        </div>
        ${renderDebugActions(debugEnabled)}
        <div id="fliptracker-listing-status" class="hiba-meta">Waiting to scan.</div>
        <div id="fliptracker-listing-results" class="hiba-results"></div>
      </section>
    `;
  }

  function renderActiveSection(mode, debugEnabled) {
    if (mode === 'live') return renderLiveSection(debugEnabled);
    if (mode === 'fliptracker') return renderFlipTrackerSection(debugEnabled);
    return renderCatalogSection(debugEnabled);
  }

  function shouldRebuildPanelForMode(existingMode, nextMode, allowed = true, panelExists = false) {
    if (!existingMode) return Boolean(panelExists);
    if (!allowed || nextMode === 'unsupported') return true;
    return existingMode !== nextMode;
  }

  function shouldTeardownPanelForRebuild(reason = '') {
    return /^(mode-change|unsupported|debug-toggle)\b/i.test(String(reason || ''));
  }

  function buildPanelHtml(options = {}) {
    const mode = options.mode || (typeof location !== 'undefined' ? resolveAssistantMode(location).mode : 'catalog') || 'catalog';
    const debugEnabled = options.debugEnabled ?? getStoredDebugEnabled();
    const modeLabel = mode === 'fliptracker' ? 'FlipTracker' : (mode === 'live' ? 'Live' : 'Catalog');
    return `
      <div class="hiba-drawer" role="dialog" aria-label="${APP_NAME}" data-flipperaddon-mode="${escapeHtml(mode)}">
        <div class="hiba-shellbar">
          <button id="hibid-bid-minimize" type="button" class="hiba-launcher" title="Show assistant" aria-label="Show assistant">
            <span class="hiba-orb"></span>
            <span class="hiba-launcher-copy">
              <span class="hiba-title">${APP_NAME}</span>
              <span class="hiba-subtitle">Ready</span>
            </span>
            <span class="hiba-mode-pill" id="hiba-current-mode-pill">${modeLabel}</span>
            ${hibaIcon('chevron')}
          </button>
          <button id="hibid-bid-close" type="button" class="hiba-icon-btn" title="Close assistant" aria-label="Close assistant">${hibaIcon('close')}</button>
        </div>
        <div id="hibid-bid-body" class="hiba-body">
          <div class="hiba-head">
            <div>
              <div class="hiba-kicker">by ALOS</div>
              <strong>${APP_SHORT_NAME} v${SCRIPT_VERSION}</strong>
              <div class="hiba-meta">A modular resale cockpit for the people: HiBid catalog/live tools plus eBay/Facebook FlipTracker export.</div>
            </div>
            <span class="hiba-chip neutral" id="hiba-session-chip">idle</span>
          </div>
          ${renderModeTabs(mode)}
          ${renderActiveSection(mode, debugEnabled)}
          <div id="hibid-bid-status" class="hiba-statusline">Open the active module, then scan or export.</div>
          <div id="hibid-bid-detected" class="hiba-detected"></div>
          <div id="hibid-bid-results" class="hiba-results"></div>
        </div>
      </div>
      <style>
        #${PANEL_ID} { position:fixed; right:16px; bottom:16px; z-index:999999; width:min(420px, calc(100vw - 24px)); max-height:calc(100vh - 32px); color:#f8fafc; font:13px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing:0; color-scheme:dark; }
        #${PANEL_ID}, #${PANEL_ID} * { box-sizing:border-box; }
        #${PANEL_ID}.hiba-minimized { width:min(340px, calc(100vw - 24px)); }
        #${PANEL_ID} .hiba-drawer { overflow:hidden; border:1px solid rgba(148,163,184,.26); border-radius:14px; background:linear-gradient(180deg,#10141d 0%,#080b11 100%); box-shadow:0 24px 70px rgba(0,0,0,.42), 0 2px 12px rgba(15,23,42,.45); }
        #${PANEL_ID} .hiba-shellbar { display:flex; align-items:stretch; gap:8px; padding:8px; border-bottom:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.88); }
        #${PANEL_ID}.hiba-minimized .hiba-shellbar { border-bottom:0; }
        #${PANEL_ID} .hiba-launcher { flex:1; min-width:0; display:flex; align-items:center; gap:9px; color:#f8fafc; background:transparent; border:0; border-radius:10px; padding:6px 8px; cursor:pointer; text-align:left; }
        #${PANEL_ID} .hiba-launcher:hover { background:rgba(148,163,184,.12); }
        #${PANEL_ID} .hiba-launcher-copy { min-width:0; display:flex; flex-direction:column; gap:1px; }
        #${PANEL_ID} .hiba-title { font-weight:800; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        #${PANEL_ID} .hiba-subtitle, #${PANEL_ID} .hiba-kicker { color:#94a3b8; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
        #${PANEL_ID} .hiba-orb { width:9px; height:9px; border-radius:999px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.14); flex:0 0 auto; }
        #${PANEL_ID} .hiba-mode-pill, #${PANEL_ID} .hiba-chip { display:inline-flex; align-items:center; min-height:22px; border:1px solid rgba(148,163,184,.24); border-radius:999px; padding:2px 8px; color:#cbd5e1; background:rgba(15,23,42,.78); font-size:11px; font-weight:800; white-space:nowrap; }
        #${PANEL_ID} .hiba-chip.eligible, #${PANEL_ID} .hiba-chip.success { color:#bbf7d0; background:rgba(22,101,52,.32); border-color:rgba(74,222,128,.34); }
        #${PANEL_ID} .hiba-chip.skip, #${PANEL_ID} .hiba-chip.danger { color:#fecaca; background:rgba(127,29,29,.34); border-color:rgba(248,113,113,.34); }
        #${PANEL_ID} .hiba-body { max-height:calc(100vh - 92px); overflow:auto; padding:12px; }
        #${PANEL_ID} .hiba-head, #${PANEL_ID} .hiba-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        #${PANEL_ID} .hiba-head { margin-bottom:10px; }
        #${PANEL_ID} .hiba-head strong, #${PANEL_ID} .hiba-section-head strong { font-size:14px; }
        #${PANEL_ID} .hiba-tabs { display:grid; grid-template-columns:1fr; gap:6px; margin:10px 0; padding:3px; border:1px solid rgba(148,163,184,.18); border-radius:11px; background:rgba(2,6,23,.62); }
        #${PANEL_ID} .hiba-tab { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; color:#94a3b8; background:transparent; border:0; border-radius:8px; padding:7px 5px; font-weight:800; cursor:pointer; }
        #${PANEL_ID} .hiba-tab.active { color:#fff; background:#1d4ed8; box-shadow:0 8px 22px rgba(37,99,235,.24); cursor:default; }
        #${PANEL_ID} .hiba-section { border:1px solid rgba(148,163,184,.16); border-radius:12px; padding:10px; margin-top:9px; background:rgba(15,23,42,.52); }
        #${PANEL_ID} .hiba-section[style*="display:none"] { margin:0; padding:0; border:0; }
        #${PANEL_ID} .hiba-details { margin-top:9px; border:1px solid rgba(148,163,184,.16); border-radius:10px; background:rgba(2,6,23,.38); padding:8px 9px; }
        #${PANEL_ID} .hiba-details summary { cursor:pointer; font-weight:900; color:#e0f2fe; }
        #${PANEL_ID} .hiba-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-top:9px; }
        #${PANEL_ID} .hiba-actions.compact { margin-top:0; justify-content:flex-end; }
        #${PANEL_ID} .hiba-btn, #${PANEL_ID} .hiba-prepare, #${PANEL_ID} .hiba-icon-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid rgba(147,197,253,.28); border-radius:9px; padding:7px 9px; color:#eff6ff; background:#1d4ed8; font-weight:800; cursor:pointer; min-height:34px; }
        #${PANEL_ID} .hiba-btn.secondary { background:#1f2937; border-color:rgba(148,163,184,.25); color:#e5e7eb; }
        #${PANEL_ID} .hiba-btn.success, #${PANEL_ID} .hiba-prepare { background:#15803d; border-color:rgba(74,222,128,.28); }
        #${PANEL_ID} .hiba-btn.danger { background:#991b1b; border-color:rgba(248,113,113,.28); }
        #${PANEL_ID} .hiba-btn[disabled], #${PANEL_ID} .hiba-prepare[disabled] { background:#27272a; color:#71717a; border-color:rgba(113,113,122,.28); cursor:not-allowed; }
        #${PANEL_ID} .hiba-icon-btn { flex:0 0 auto; width:34px; padding:0; background:rgba(30,41,59,.88); border-color:rgba(148,163,184,.24); }
        #${PANEL_ID} .hiba-icon { width:15px; height:15px; flex:0 0 auto; }
        #${PANEL_ID} .hiba-plan { width:100%; height:128px; margin-top:9px; resize:vertical; color:#f8fafc; background:#020617; border:1px solid rgba(148,163,184,.26); border-radius:10px; padding:9px; font:12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
        #${PANEL_ID} .hiba-toggle-grid { display:grid; grid-template-columns:1fr; gap:6px; margin-top:8px; }
        #${PANEL_ID} .hiba-switch { display:flex; align-items:center; justify-content:space-between; gap:8px; color:#cbd5e1; background:rgba(2,6,23,.45); border:1px solid rgba(148,163,184,.15); border-radius:9px; padding:7px 9px; font-weight:700; }
        #${PANEL_ID} .hiba-switch input { width:16px; height:16px; accent-color:#2563eb; }
        #${PANEL_ID} .hiba-statusline { margin-top:10px; border:1px solid rgba(59,130,246,.24); border-radius:10px; padding:8px 9px; color:#dbeafe; background:rgba(30,64,175,.18); font-weight:700; }
        #${PANEL_ID} .hiba-detected, #${PANEL_ID} .hiba-meta { color:#94a3b8; font-size:12px; margin-top:6px; }
        #${PANEL_ID} .hiba-detected { font-family:ui-monospace, SFMono-Regular, Consolas, monospace; }
        #${PANEL_ID} .hiba-row { border:1px solid rgba(148,163,184,.16); border-radius:11px; padding:9px; margin-top:8px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; background:rgba(2,6,23,.42); }
        #${PANEL_ID} .hiba-row strong { color:#f8fafc; }
        #${PANEL_ID} .hiba-row-actions { display:grid; grid-template-columns:76px 86px 104px; gap:6px; align-items:center; }
        #${PANEL_ID} .hiba-max-inline { width:100%; min-height:34px; color:#f8fafc; background:#020617; border:1px solid rgba(148,163,184,.28); border-radius:9px; padding:6px 7px; font:12px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
        #${PANEL_ID} .hiba-add-plan { min-height:34px; border:1px solid rgba(147,197,253,.28); border-radius:9px; color:#eff6ff; background:#1f2937; font-weight:800; cursor:pointer; }
        #${PANEL_ID} .hiba-status { display:inline-flex; align-items:center; width:max-content; margin-top:5px; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:900; }
        #${PANEL_ID} .hiba-status.eligible { color:#bbf7d0; background:rgba(22,101,52,.38); }
        #${PANEL_ID} .hiba-status.skip { color:#fecaca; background:rgba(127,29,29,.34); }
        #${PANEL_ID} .hiba-live-card { border-radius:10px; padding:9px; background:rgba(2,6,23,.5); border:1px solid rgba(148,163,184,.16); }
        @media (max-width:520px) { #${PANEL_ID} { right:8px; bottom:8px; width:calc(100vw - 16px); } #${PANEL_ID} .hiba-row { grid-template-columns:1fr; } #${PANEL_ID} .hiba-row-actions { grid-template-columns:1fr; } }
      </style>
    `;
  }

  function setPanelMinimized(panel, minimized) {
    const body = panel.querySelector('#hibid-bid-body');
    const button = panel.querySelector('#hibid-bid-minimize');
    const subtitle = panel.querySelector('.hiba-subtitle');
    if (body) body.style.display = minimized ? 'none' : '';
    panel.classList.toggle('hiba-minimized', Boolean(minimized));
    if (button) {
      button.setAttribute('title', minimized ? 'Show assistant' : 'Minimize assistant');
      button.setAttribute('aria-label', minimized ? 'Show assistant' : 'Minimize assistant');
      const chevron = button.querySelector('.hiba-icon');
      if (chevron) chevron.style.transform = minimized ? 'rotate(180deg)' : '';
    }
    if (subtitle && !subtitle.dataset.statusText) subtitle.textContent = minimized ? 'Click to open' : 'Open drawer';
  }

  function setActiveModeTab(panel, mode) {
    panel.querySelectorAll('[data-mode-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.modeTab === mode);
    });
    const pill = panel.querySelector('#hiba-current-mode-pill');
    if (pill) {
      pill.textContent = mode === 'fliptracker' ? 'FlipTracker' : (mode === 'live' ? 'Live' : 'Catalog');
    }
  }

  function createPanel(mode = resolveAssistantMode().mode, debugEnabled = getStoredDebugEnabled()) {
    removeLegacyScraperArtifacts('createPanel');
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.dataset.flipperaddonMode = mode;
    panel.innerHTML = buildPanelHtml({ mode, debugEnabled });

    document.body.appendChild(panel);
    const planInput = panel.querySelector('#hibid-bid-plan-json');
    if (planInput) planInput.value = getStoredPlanText();
    const outbidInput = panel.querySelector('#hibid-bid-outbid-only');
    if (outbidInput) outbidInput.checked = isWatchlistOutbidPage();
    const autoRefreshInput = panel.querySelector('#hibid-bid-auto-refresh');
    if (autoRefreshInput) autoRefreshInput.checked = getStoredAutoRefresh();
    const autoConfirmInput = panel.querySelector('#hibid-bid-auto-confirm');
    if (autoConfirmInput) autoConfirmInput.checked = getStoredAutoConfirm();
    setPanelMinimized(panel, true);
    return panel;
  }

  function getScanOptions() {
    return {
      requireOutbid: Boolean(document.getElementById('hibid-bid-outbid-only')?.checked)
    };
  }

  function init() {
    const assistantMode = resolveAssistantMode();
    const activeMode = assistantMode.mode === 'unsupported' ? 'catalog' : assistantMode.mode;
    const panel = createPanel(activeMode, getStoredDebugEnabled());
    const statusEl = panel.querySelector('#hibid-bid-status');
    const detectedEl = panel.querySelector('#hibid-bid-detected');
    const resultsEl = panel.querySelector('#hibid-bid-results');
    const planEl = panel.querySelector('#hibid-bid-plan-json');
    const liveMode = activeMode === 'live';
    const listingExportMode = activeMode === 'fliptracker';
    const catalogMode = activeMode === 'catalog';
    const bidControlsEl = panel.querySelector('#hibid-bid-controls');
    const listingExportModeEl = panel.querySelector('#fliptracker-listing-export-mode');
    const listingExportStatusEl = panel.querySelector('#fliptracker-listing-status');
    const listingExportResultsEl = panel.querySelector('#fliptracker-listing-results');
    const listingExportScanButton = panel.querySelector('#fliptracker-listing-scan');
    const listingExportCopyButton = panel.querySelector('#fliptracker-listing-copy');
    const listingExportDownloadButton = panel.querySelector('#fliptracker-listing-download');
    const liveModeEl = panel.querySelector('#hibid-live-mode');
    const liveStateEl = panel.querySelector('#hibid-live-state');
    const liveArmButton = panel.querySelector('#hibid-live-arm');
    const liveSnipeButton = panel.querySelector('#hibid-live-snipe');
    const liveCopyJsonButton = panel.querySelector('#hibid-live-copy-json');
    const liveCopyLlmButton = panel.querySelector('#hibid-live-copy-llm');
    const catalogCopyJsonButton = panel.querySelector('#hibid-catalog-copy-json');
    const catalogCopyLlmButton = panel.querySelector('#hibid-catalog-copy-llm');
    const debugCopyButton = panel.querySelector('#hibid-debug-copy');
    const debugClearButton = panel.querySelector('#hibid-debug-clear');
    const autoRefreshInput = panel.querySelector('#hibid-bid-auto-refresh');
    const state = { stop: false, rows: [], busy: false, refreshTimer: null, refreshSeconds: 30, lotCache: new Map(), planFocused: false, lastPlanInputAt: 0, liveArmed: false, liveRow: null, liveTimer: null, listingRows: [] };
    setActiveModeTab(panel, activeMode);

    const status = (message) => {
      statusEl.textContent = message;
      const chip = panel.querySelector('#hiba-session-chip');
      const subtitle = panel.querySelector('.hiba-subtitle');
      const lower = String(message || '').toLowerCase();
      const tone = lower.includes('stop') || lower.includes('bad json') || lower.includes('failed') || lower.includes('not found')
        ? 'danger'
        : (lower.includes('eligible') || lower.includes('copied') || lower.includes('download') || lower.includes('finished') ? 'success' : 'neutral');
      if (chip) {
        chip.className = `hiba-chip ${tone}`;
        chip.textContent = lower.includes('stop') ? 'paused' : (state.busy ? 'busy' : tone === 'success' ? 'ready' : 'idle');
      }
      if (subtitle) {
        subtitle.dataset.statusText = 'true';
        subtitle.textContent = String(message || 'Ready').replace(/\s+/g, ' ').slice(0, 42);
      }
      debug('status', message);
    };
    debug('unified drawer mounted', routeDebug());

    const render = (rows) => {
      state.rows = rows;
      const cardLots = uniqueLots(getLotTiles().map(extractLot));
      const textLots = cardLots.length ? [] : extractTextLots();
      const allLots = cardLots.length ? cardLots : textLots;
      detectedEl.textContent = `Detected ${cardLots.length} unique live lot(s), ${textLots.length} text lot(s), ${state.lotCache.size} cached lot(s). Visible lots: ${lotSummary(allLots) || '-'}`;
      resultsEl.innerHTML = rows.map((row, index) => `
        <div class="hiba-row">
          <div>
            <div><strong>Lot ${row.lot}</strong> | ${escapeHtml(row.title || '(missing)')}</div>
            <div class="hiba-meta">Current: ${row.highBid || '-'} | Next: ${row.nextBid || '-'} | Max: $${row.max ?? '-'} | Your: ${row.userBidStatus || '-'} | ${row.bidCount || ''} | ${row.timeLeft || ''}</div>
            <div class="hiba-status ${row.eligible ? 'eligible' : 'skip'}">${row.status}</div>
          </div>
          <div class="hiba-row-actions">
            <input class="hiba-max-inline" data-lot="${escapeHtml(row.lot)}" type="number" min="0" step="0.01" value="${row.max ?? ''}" placeholder="max" title="Your maximum hammer bid for this lot.">
            <button type="button" class="hiba-add-plan" data-lot="${escapeHtml(row.lot)}" title="Add or update this lot in the max plan.">${row.max ? 'Save Max' : 'Add Plan'}</button>
            <button type="button" class="hiba-prepare" data-index="${index}" ${row.eligible ? '' : 'disabled'}>Prepare Bid</button>
          </div>
        </div>
      `).join('');
    };

    const renderListingExport = (rows) => {
      state.listingRows = rows;
      listingExportStatusEl.textContent = rows.length
        ? `Found ${rows.length} active listing card(s). Download the export, then scan/import it in FlipTracker.`
        : 'No active listing cards found. Scroll/load more listings, then scan again.';
      listingExportResultsEl.innerHTML = rows.slice(0, 8).map(row => `
        <div class="hiba-row" style="grid-template-columns:1fr">
          <div>
            <div><strong>${escapeHtml(row.source || 'Listing')}</strong> | ${escapeHtml(row.title || '(missing title)')}</div>
            <div class="hiba-meta">$${Number(row.price || 0).toFixed(2)} | ${escapeHtml(row.status || '')} | Views: ${row.views ?? '-'} | Watchers: ${row.watchers ?? '-'} | Clicks: ${row.clicks ?? '-'}</div>
            <div class="hiba-meta">${escapeHtml(row.url || '')}</div>
          </div>
        </div>
      `).join('') + (rows.length > 8 ? `<div class="hiba-meta">Showing 8 of ${rows.length} listing(s).</div>` : '');
    };

    const currentListingExportHtml = () => buildFlipTrackerListingsExportHtml(state.listingRows, {
      pageUrl: location.href,
      generatedAt: new Date().toISOString()
    });

    const scanListingsForExport = () => {
      const rows = scanCurrentFlipTrackerListings();
      renderListingExport(rows);
      return rows;
    };

    const loadCurrentOutbidLots = async () => {
      state.lotCache.clear();
      const result = await scrapeCatalogLots(status, () => state.stop);
      uniqueLots(result.items || result.lots || []).forEach(lot => {
        if (lot.lot) state.lotCache.set(String(lot.lot), lot);
      });
      const mergedPlanText = planTextFromLoadedLots(planEl.value, Array.from(state.lotCache.values()));
      planEl.value = mergedPlanText;
      savePlanText(mergedPlanText);
      debug('load lots merged into plan', {
        count: state.lotCache.size,
        source: result.source,
        expectedTotal: result.expectedTotal
      });
    };

    const isEditingPlan = () => state.planFocused || Date.now() - state.lastPlanInputAt < 5000;
    const getLivePlan = () => {
      try {
        return parseBidPlan(planEl.value);
      } catch (err) {
        status(`Bad JSON: ${err.message}`);
        return {};
      }
    };

    const renderLive = () => {
      if (!liveMode || !liveStateEl) return null;
      const liveState = extractLiveAuctionState();
      const plan = getLivePlan();
      const planEntry = liveState.lot ? plan[String(liveState.lot)] : null;
      const decision = evaluateLiveLot(liveState, planEntry);
      const row = {
        ...liveState,
        ...decision,
        max: planEntry?.max ?? null,
        expectedTitle: planEntry?.title || ''
      };
      state.liveRow = row;

      const armedText = state.liveArmed ? 'armed' : 'not armed';
      const askText = row.nextBid || (Number.isFinite(row.nextBidAmount) ? `${row.nextBidAmount} USD` : '-');
      const currentText = row.currentBid || row.highBid || '-';
      liveStateEl.innerHTML = `
        <div><strong>Lot ${escapeHtml(row.lot || '-')}</strong> | ${escapeHtml(row.title || '(waiting)')}</div>
        <div>Current: ${escapeHtml(currentText)} | Ask: ${escapeHtml(askText)} | Max: $${row.max ?? '-'} | ${escapeHtml(row.bidCount || '')}</div>
        <div class="hiba-status ${row.eligible ? 'eligible' : 'skip'}">${escapeHtml(row.status)} (${armedText})</div>
      `;
      const liveArmLabel = liveArmButton?.querySelector('span');
      if (liveArmLabel) liveArmLabel.textContent = state.liveArmed ? 'Disarm' : 'Arm';
      if (liveSnipeButton) liveSnipeButton.disabled = state.busy || !state.liveArmed || !row.eligible;
      debug('live render', {
        lot: row.lot,
        title: row.title,
        status: row.status,
        eligible: row.eligible,
        armed: state.liveArmed,
        max: row.max,
        nextBidAmount: row.nextBidAmount
      });
      return row;
    };

    if (planEl) {
      planEl.addEventListener('focus', () => {
        state.planFocused = true;
        debug('plan editing focus');
      });
      planEl.addEventListener('blur', () => {
        state.planFocused = false;
        state.lastPlanInputAt = Date.now();
        savePlanText(planEl.value);
        debug('plan editing blur');
      });
      planEl.addEventListener('input', () => {
        state.lastPlanInputAt = Date.now();
        savePlanText(planEl.value);
        debug('plan editing input: saved plan text');
      });
    }

    panel.querySelectorAll('[data-mode-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.modeTab;
        const target = mode === 'live' ? liveModeEl : (mode === 'fliptracker' ? listingExportModeEl : bidControlsEl);
        setActiveModeTab(panel, mode);
        if (target && target.style.display !== 'none') target.scrollIntoView({ block: 'nearest' });
      });
    });

    panel.querySelector('#hibid-bid-minimize').addEventListener('click', () => {
      const body = panel.querySelector('#hibid-bid-body');
      const minimized = body.style.display !== 'none';
      setPanelMinimized(panel, minimized);
      saveMinimized(minimized);
      debug('panel minimize toggled', { minimized });
    });
    panel.querySelector('#hibid-bid-close').addEventListener('click', () => {
      cleanupTimers();
      document.dispatchEvent(new CustomEvent('hibid-bid-assistant-close'));
      panel.remove();
    });
    panel.querySelector('#hibid-bid-stop')?.addEventListener('click', () => {
      state.stop = true;
      if (autoRefreshInput) autoRefreshInput.checked = false;
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = null;
      state.liveArmed = false;
      renderLive();
      status('Stop requested.');
    });
    panel.querySelector('#hibid-bid-load')?.addEventListener('click', async () => {
      state.stop = false;
      const target = getLoadTarget(getScanOptions());
      if (target) {
        status('Opening OUTBID watchlist...');
        location.href = target;
        return;
      }
      await loadCurrentOutbidLots();
      const rows = scanPlan(getPlan(status), { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
      render(rows);
      status(`Load finished. Replaced plan with ${state.lotCache.size} loaded OUTBID lot(s).`);
    });
    panel.querySelector('#hibid-bid-scan')?.addEventListener('click', () => {
      const plan = getPlan(status);
      const rows = scanPlan(plan, { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
      render(rows);
      const plannedCount = Object.keys(plan).length;
      const loadedCount = rows.filter(row => row.status === 'loaded from OUTBID - add max').length;
      status(`${rows.filter(row => row.eligible).length} eligible / ${plannedCount} planned. ${loadedCount} loaded without max. ${rows.filter(row => row.status === 'not found').length} not found.`);
    });
    const setAutoRefresh = (enabled) => {
      if (!autoRefreshInput) return;
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = null;
      if (liveMode && enabled) {
        autoRefreshInput.checked = false;
        saveAutoRefresh(false);
        status('Auto refresh/reload is disabled on live auction pages. Live Mode scans in-place.');
        debug('auto-refresh blocked on live page');
        return;
      }
      saveAutoRefresh(enabled);
      if (!enabled) {
        status('Auto refresh off.');
        return;
      }

      state.stop = false;
      state.refreshSeconds = 30;
      status('Auto refresh on. It loads/scans now, then refreshes every 30s.');
      if (isWatchlistOutbidPage()) {
        loadCurrentOutbidLots().then(() => {
          const rows = scanPlan(getPlan(status), { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
          render(rows);
        });
      } else {
        const rows = scanPlan(getPlan(status), { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
        render(rows);
      }
      state.refreshTimer = setInterval(() => {
        if (isEditingPlan()) {
          state.refreshSeconds = 30;
          status('Auto refresh paused while editing max plan.');
          debug('auto-refresh paused: editing plan');
          return;
        }
        if (state.busy || findDialog()) {
          status('Auto refresh paused while a bid dialog/action is open.');
          debug('auto-refresh paused: busy/dialog', { busy: state.busy, hasDialog: Boolean(findDialog()) });
          return;
        }
        state.refreshSeconds -= 1;
        if (state.refreshSeconds > 0) {
          status(`Auto refresh in ${state.refreshSeconds}s.`);
          return;
        }
        savePlanText(planEl.value);
        debug('auto-refresh saved plan before reload');
        status('Refreshing watchlist...');
        location.reload();
      }, 1000);
    };

    const cleanupTimers = () => {
      if (state.liveTimer) clearInterval(state.liveTimer);
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.liveTimer = null;
      state.refreshTimer = null;
    };
    document.addEventListener('flipperaddon-panel-teardown', cleanupTimers, { once: true });

    if (listingExportMode) {
      detectedEl.textContent = 'FlipTracker export mode. Scroll/load your active listings, then scan and download the export.';
      status('Ready to export active listings for FlipTracker.');
      window.setTimeout(scanListingsForExport, 500);
    }

    listingExportScanButton?.addEventListener('click', () => {
      const rows = scanListingsForExport();
      status(`Scanned ${rows.length} active listing card(s).`);
    });
    listingExportCopyButton?.addEventListener('click', async () => {
      if (!state.listingRows.length) scanListingsForExport();
      if (!state.listingRows.length) {
        status('Nothing to copy yet. Scroll/load listings and scan again.');
        return;
      }
      const copied = await writeClipboard(currentListingExportHtml()).catch(() => false);
      status(copied ? `Copied FlipTracker export HTML for ${state.listingRows.length} listing(s).` : 'Clipboard write failed. Use Download Export HTML instead.');
    });
    listingExportDownloadButton?.addEventListener('click', () => {
      if (!state.listingRows.length) scanListingsForExport();
      if (!state.listingRows.length) {
        status('Nothing to download yet. Scroll/load listings and scan again.');
        return;
      }
      const source = state.listingRows[0]?.source === 'eBay' ? 'ebay' : 'facebook';
      const filename = `FlipTracker-listings-${source}-${safeTimestamp()}.html`;
      downloadTextFile(filename, currentListingExportHtml());
      status(`Downloaded ${filename}. Put it in ImportInbox, then use FlipTracker import.`);
    });

    const copyCatalogLots = async (mode) => {
      if (state.busy) return;
      state.busy = true;
      if (catalogCopyJsonButton) catalogCopyJsonButton.disabled = true;
      if (catalogCopyLlmButton) catalogCopyLlmButton.disabled = true;
      state.stop = false;
      try {
        status(mode === 'llm' ? 'Scraping catalog for LLM brief...' : 'Scraping catalog for JSON...');
        const result = await scrapeCatalogLots(status, () => state.stop);
        const lots = result.items || result.lots || [];
        if (!lots.length) {
          status('No catalog lots found. Copy debug log and check route/data source.');
          return;
        }
        const payload = mode === 'llm'
          ? buildLlmAuctionBrief(lots, catalogAuctionContext())
          : JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        const countText = result.expectedTotal ? `${lots.length}/${result.expectedTotal}` : String(lots.length);
        detectedEl.textContent = `Catalog scrape source: ${result.source || 'unknown'} | Lots: ${countText}`;
        status(copied
          ? (mode === 'llm' ? `Copied LLM brief for ${countText} lot(s).` : `Copied JSON for ${countText} lot(s).`)
          : `Scraped ${countText} lot(s), but clipboard failed. Copy debug log.`);
        debug('catalog lots copied', {
          mode,
          count: lots.length,
          expectedTotal: result.expectedTotal,
          source: result.source,
          copied,
          stopped: result.stopped
        });
      } finally {
        state.busy = false;
        if (catalogCopyJsonButton) catalogCopyJsonButton.disabled = false;
        if (catalogCopyLlmButton) catalogCopyLlmButton.disabled = false;
      }
    };

    catalogCopyJsonButton?.addEventListener('click', () => copyCatalogLots('json'));
    catalogCopyLlmButton?.addEventListener('click', () => copyCatalogLots('llm'));
    debugCopyButton?.addEventListener('click', async () => {
      const copied = await copyDebugLog();
      status(copied ? `Copied ${getDebugLog().length} debug log entries.` : 'Debug log empty or clipboard failed.');
    });
    debugClearButton?.addEventListener('click', () => {
      clearDebugLog();
      status('Debug log cleared.');
      debug('debug log cleared from drawer');
    });

    autoRefreshInput?.addEventListener('change', (event) => {
      setAutoRefresh(event.target.checked);
    });
    if (liveMode) {
      saveAutoRefresh(false);
      detectedEl.textContent = 'Live Mode scans this page in-place; it will not auto-refresh/reload.';
      state.liveTimer = setInterval(renderLive, 750);
      renderLive();
    } else if (autoRefreshInput?.checked) {
      setAutoRefresh(true);
    }
    panel.querySelector('#hibid-bid-auto-confirm')?.addEventListener('change', (event) => {
      saveAutoConfirm(event.target.checked);
    });
    panel.querySelector('#hibid-bid-next')?.addEventListener('click', async () => {
      if (state.busy) return;
      const eligible = state.rows.find(row => row.eligible);
      if (!eligible) {
        status('No eligible row. Scan first.');
        return;
      }
      state.busy = true;
      try {
        await prepareBid(eligible, status, render, () => state.stop);
      } finally {
        state.busy = false;
      }
    });
    liveArmButton?.addEventListener('click', () => {
      state.liveArmed = !state.liveArmed;
      state.stop = false;
      renderLive();
      status(state.liveArmed ? 'Live snipe armed. Use Snipe Now when ready.' : 'Live snipe disarmed.');
    });
    liveSnipeButton?.addEventListener('click', async () => {
      if (state.busy) return;
      const row = renderLive();
      if (!row?.eligible || !state.liveArmed) {
        status(`Live snipe blocked: ${row?.status || 'not ready'}.`);
        return;
      }
      state.busy = true;
      try {
        await prepareLiveBid(row, status, () => state.stop);
      } finally {
        state.busy = false;
        renderLive();
      }
    });
    const copyLiveLots = async (mode) => {
      if (state.busy) return;
      state.busy = true;
      if (liveCopyJsonButton) liveCopyJsonButton.disabled = true;
      if (liveCopyLlmButton) liveCopyLlmButton.disabled = true;
      try {
        status('Loading all open live lots before copy...');
        const expanded = await expandLivePageLots(status, () => state.stop);
        const lots = expanded.lots;
        if (!lots.length) {
          status('No live lots found to copy yet.');
          return;
        }
        const context = liveAuctionContext();
        const payload = mode === 'llm' ? buildLlmAuctionBrief(lots, context) : JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        const countText = expanded.expectedOpenLots ? `${lots.length}/${expanded.expectedOpenLots}` : String(lots.length);
        if (copied) {
          status(mode === 'llm'
            ? `Copied LLM brief for ${countText} live lot(s). Open More clicks: ${expanded.loadMoreClicks}.`
            : `Copied JSON for ${countText} live lot(s). Open More clicks: ${expanded.loadMoreClicks}.`);
        } else {
          status('Clipboard write failed. Check browser permissions.');
        }
        debug('live lots copied', {
          mode,
          lots: lots.length,
          expectedOpenLots: expanded.expectedOpenLots,
          loadMoreClicks: expanded.loadMoreClicks,
          scrolls: expanded.scrolls,
          copied
        });
      } finally {
        state.busy = false;
        if (liveCopyJsonButton) liveCopyJsonButton.disabled = false;
        if (liveCopyLlmButton) liveCopyLlmButton.disabled = false;
      }
    };
    liveCopyJsonButton?.addEventListener('click', () => copyLiveLots('json'));
    liveCopyLlmButton?.addEventListener('click', () => copyLiveLots('llm'));
    resultsEl.addEventListener('click', async (event) => {
      if (state.busy) return;
      const addButton = event.target.closest('.hiba-add-plan');
      if (addButton && planEl) {
        const lotKey = String(addButton.dataset.lot || '');
        const row = state.rows.find(item => String(item.lot) === lotKey);
        if (!row) return;
        const input = Array.from(resultsEl.querySelectorAll('.hiba-max-inline')).find(item => String(item.dataset.lot || '') === lotKey);
        let nextText = addLotToPlanText(planEl.value, row);
        try {
          const parsed = JSON.parse(nextText);
          const rawMax = String(input?.value || '').trim();
          const numericMax = rawMax ? Number(rawMax) : NaN;
          if (Number.isFinite(numericMax) && numericMax > 0) parsed[lotKey].max = numericMax;
          nextText = JSON.stringify(parsed, null, 2);
        } catch {
          // addLotToPlanText already returns valid JSON, so this is only defensive.
        }
        planEl.value = nextText;
        savePlanText(nextText);
        const rows = scanPlan(getPlan(status), { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
        render(rows);
        status(`Saved Lot ${lotKey} to max plan${input?.value ? ` at $${input.value}` : ' with no max yet'}.`);
        return;
      }
      const button = event.target.closest('.hiba-prepare');
      if (!button) return;
      const row = state.rows[Number(button.dataset.index)];
      if (row) {
        state.busy = true;
        try {
          await prepareBid(row, status, render, () => state.stop);
        } finally {
          state.busy = false;
        }
      }
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeHtmlText(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  if (!globalThis.__HIBID_BID_ASSISTANT_TEST__) {
    globalThis.__HIBID_UNIFIED_ASSISTANT_ACTIVE__ = true;
    debug('boot', routeDebug());

    let panelClosed = false;
    let lastMountedHref = location.href;

    const teardownPanel = (reason = 'remount') => {
      const existing = document.getElementById(PANEL_ID);
      if (!existing) return false;
      if (shouldTeardownPanelForRebuild(reason)) {
        document.dispatchEvent(new CustomEvent('flipperaddon-panel-teardown', { detail: { reason } }));
      }
      existing.remove();
      debug('panel removed for remount', { reason });
      return true;
    };

    const ensureMounted = (reason = 'unspecified') => {
      const modeInfo = resolveAssistantMode();
      const allowed = shouldInitOnLocation();
      debug('ensureMounted', { reason, allowed, mode: modeInfo.mode, ...routeDebug() });
      if (!document.body) return false;
      const existingPanel = document.getElementById(PANEL_ID);
      const existingMode = existingPanel?.dataset?.flipperaddonMode || existingPanel?.querySelector?.('.hiba-drawer')?.dataset?.flipperaddonMode || '';
      if (!allowed) {
        teardownPanel(`unsupported:${reason}`);
        return false;
      }
      if (shouldRebuildPanelForMode(existingMode, modeInfo.mode, allowed, Boolean(existingPanel))) {
        teardownPanel(`mode-change:${existingMode || 'none'}:${modeInfo.mode}:${reason}`);
      }
      if (location.href !== lastMountedHref) {
        panelClosed = false;
        lastMountedHref = location.href;
        debug('panel close state reset after URL change', { reason, href: lastMountedHref });
      }
      if (/^menu\b/i.test(reason)) panelClosed = false;
      if (panelClosed) {
        removeLegacyScraperArtifacts(reason);
        debug('ensureMounted skipped: panel closed for current page', { reason });
        return false;
      }
      removeLegacyScraperArtifacts(reason);
      if (document.getElementById(PANEL_ID)) return true;
      init();
      return true;
    };

    const mountWhenReady = (reason) => {
      if (document.body) ensureMounted(reason);
      else document.addEventListener('DOMContentLoaded', () => ensureMounted(`${reason}:domcontentloaded`), { once: true });
    };

    const registerMenuCommands = () => {
      if (typeof GM_registerMenuCommand !== 'function') {
        debug('menu commands unavailable');
        return;
      }
      GM_registerMenuCommand(MENU_COMMANDS[0], () => ensureMounted('menu remount'));
      GM_registerMenuCommand(MENU_COMMANDS[1], async () => {
        const enabled = !getStoredDebugEnabled();
        saveDebugEnabled(enabled);
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          teardownPanel('debug-toggle');
          init();
        } else {
          ensureMounted('menu toggle debug');
        }
        try {
          console.info(DEBUG_PREFIX, `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
        } catch {
          // Console logging is best-effort.
        }
      });
      GM_registerMenuCommand(MENU_COMMANDS[2], async () => {
        ensureMounted('menu copy debug');
        const copied = await copyDebugLog();
        debug('menu copy debug result', { copied, entries: getDebugLog().length });
      });
      GM_registerMenuCommand(MENU_COMMANDS[3], () => {
        clearDebugLog();
        debug('debug log cleared from menu');
      });
      GM_registerMenuCommand(MENU_COMMANDS[4], () => {
        ensureMounted('menu copy lots');
        document.getElementById('hibid-catalog-copy-json')?.click();
      });
      debug('menu commands registered', MENU_COMMANDS);
    };

    mountWhenReady('boot');
    registerMenuCommands();
    document.addEventListener('hibid-bid-assistant-close', () => {
      panelClosed = true;
      debug('panel closed for current page');
    });
    setTimeout(() => ensureMounted('timeout 1s'), 1000);
    setTimeout(() => ensureMounted('timeout 3s'), 3000);
    if ('onurlchange' in window) {
      window.addEventListener('urlchange', () => ensureMounted('urlchange'));
    }
    window.addEventListener('popstate', () => ensureMounted('popstate'));
    window.addEventListener('hashchange', () => ensureMounted('hashchange'));
    new MutationObserver(() => ensureMounted('mutation')).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
