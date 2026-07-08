// ==UserScript==
// @name         HiBid Safe Bid Assistant
// @namespace    http://tampermonkey.net/
// @version      0.4.0
// @description  Safely queues HiBid bids and exports active eBay/Facebook Marketplace listings for FlipTracker.
// @updateURL    https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @match        https://hibid.com/lots*
// @match        https://hibid.com/lots/*
// @match        https://hibid.com/catalog/*
// @match        https://hibid.com/account/watchlist*
// @match        https://hibid.com/*
// @match        https://bid.ajwillnerauctions.com/ui/auctions/*
// @match        https://www.ebay.com/sh/lst*
// @match        https://www.ebay.com/mys/*
// @match        https://www.facebook.com/marketplace/you/*
// @match        https://www.facebook.com/marketplace/profile/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'hibid-bid-assistant-panel';
  const SCRIPT_VERSION = '0.4.0';
  const PLAN_KEY = 'hibid-bid-assistant-plan-v1';
  const AUTO_REFRESH_KEY = 'hibid-bid-assistant-auto-refresh-v1';
  const AUTO_CONFIRM_KEY = 'hibid-bid-assistant-auto-confirm-v1';
  const MINIMIZED_KEY = 'hibid-bid-assistant-minimized-v1';
  const OUTBID_WATCHLIST_URL = 'https://hibid.com/account/watchlist?status=OUTBID';
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const DEBUG_PREFIX = '[HiBid Safe Bid Assistant]';

  function debug(message, data) {
    try {
      if (data === undefined) console.debug(DEBUG_PREFIX, message);
      else console.debug(DEBUG_PREFIX, message, data);
    } catch {
      // Console logging is best-effort.
    }
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

    return dedupeListings(listings);
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
    evaluateLot,
    moneyFromText,
    numberFromText,
    parseBidPlan,
    titleMatches,
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
    evaluateLiveLot,
    prepareLiveBid,
    findLotOnPage,
    planTextFromLoadedLots,
    scanPlan,
    lotSummary,
    getStoredAutoConfirm
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

  function isWatchlistOutbidPage() {
    return /\/account\/watchlist/i.test(location.pathname) && /status=OUTBID/i.test(location.search);
  }

  function isLiveCatalogPage(loc = location) {
    return /^\/livecatalog\b/i.test(String(loc.pathname || ''));
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
    const search = String(loc.search || '');

    if (host === 'bid.ajwillnerauctions.com') {
      return /^\/ui\/auctions\//i.test(pathname);
    }

    if (isFlipTrackerListingPage(loc)) return true;

    if (host !== 'hibid.com' && !host.endsWith('.hibid.com')) return false;
    if (/^\/account\/watchlist\b/i.test(pathname)) return /status=OUTBID/i.test(search);
    return /^\/(?:lots?|catalog|livecatalog|lot)\b/i.test(pathname);
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
    const compactLots = lots.map(lot => ({
      lot: lot.lot,
      title: lot.title,
      highBid: lot.highBidAmount ?? null,
      nextBid: lot.nextBidAmount ?? null,
      bidCount: lot.bidCountNumber ?? null,
      timeLeft: lot.timeLeft || '',
      valueHint: lot.estimatedValue ?? null,
      status: lot.status || lot.userBidStatus || ''
    }));
    return [
      'You are evaluating an auction catalog for deal quality, resale/use value, and bidding priority.',
      'Search eBay sold/completed comps for every lead before recommending it. Profit comes before hunches.',
      'Use rough math unless better fee data is known: auction all-in cost = bid x 1.25 for buyer premium/tax estimate; eBay net = sold price x 0.87 before shipping complications.',
      'Return a ranked shortlist of the best opportunities, suspicious/overpriced lots, and any lots that need manual research. Include estimated all-in cost, sold-comp range, estimated eBay net, and expected profit where possible.',
      '',
      'Auction context:',
      JSON.stringify(context, null, 2),
      '',
      `Lots scraped: ${compactLots.length}`,
      '',
      'Lot data JSON:',
      JSON.stringify(compactLots, null, 2)
    ].join('\n');
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

  function getStoredPlanText() {
    try {
      return GM_getValue(PLAN_KEY, defaultPlanText());
    } catch {
      return defaultPlanText();
    }
  }

  function savePlanText(value) {
    try {
      GM_setValue(PLAN_KEY, value);
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
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
      return Boolean(GM_getValue(MINIMIZED_KEY, false));
    } catch {
      return false;
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

  function createPanel() {
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:999999',
      'width:520px',
      'max-height:78vh',
      'overflow:auto',
      'background:#111',
      'color:#fff',
      'border:1px solid #ffffff33',
      'border-radius:10px',
      'box-shadow:0 12px 40px #0008',
      'font:13px system-ui',
      'padding:12px'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <strong>HiBid Safe Bid Assistant v${SCRIPT_VERSION}</strong>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="hibid-bid-minimize" type="button" title="Minimize" style="background:#333;color:#fff;border:1px solid #fff3;border-radius:6px;padding:4px 8px;cursor:pointer">Min</button>
          <button id="hibid-bid-close" type="button" style="background:#333;color:#fff;border:1px solid #fff3;border-radius:6px;padding:4px 8px;cursor:pointer">Close</button>
        </div>
      </div>
      <div id="hibid-bid-body">
        <div id="fliptracker-listing-export-mode" style="display:none;border-bottom:1px solid #fff2;margin-bottom:10px;padding-bottom:10px">
          <strong>FlipTracker Active Listing Export</strong>
          <div class="hiba-meta" style="margin-top:4px">Scrapes visible active eBay/Facebook listing cards and exports an HTML file for FlipTracker ImportInbox.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <button id="fliptracker-listing-scan" type="button" class="hiba-btn">Scan Listings</button>
            <button id="fliptracker-listing-copy" type="button" class="hiba-btn">Copy Export HTML</button>
            <button id="fliptracker-listing-download" type="button" class="hiba-btn">Download Export HTML</button>
          </div>
          <div id="fliptracker-listing-status" class="hiba-meta" style="margin-top:8px">Waiting to scan.</div>
          <div id="fliptracker-listing-results" style="margin-top:8px"></div>
        </div>
        <div id="hibid-bid-controls">
        <textarea id="hibid-bid-plan-json" spellcheck="false" style="width:100%;height:132px;box-sizing:border-box;background:#050505;color:#fff;border:1px solid #fff3;border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;color:#ddd">
          <input id="hibid-bid-outbid-only" type="checkbox">
          Outbid only
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-top:6px;color:#ddd">
          <input id="hibid-bid-auto-refresh" type="checkbox">
          Auto refresh/scan every 30s
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-top:6px;color:#ddd">
          <input id="hibid-bid-auto-confirm" type="checkbox">
          Auto-confirm bid modals
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button id="hibid-bid-load" type="button" class="hiba-btn">Load Lots</button>
          <button id="hibid-bid-scan" type="button" class="hiba-btn">Scan</button>
          <button id="hibid-bid-next" type="button" class="hiba-btn">Prepare Next Eligible</button>
          <button id="hibid-bid-stop" type="button" class="hiba-btn danger">Stop</button>
        </div>
        </div>
        <div id="hibid-live-mode" style="display:none;border-top:1px solid #fff2;margin-top:10px;padding-top:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <strong>Live Mode</strong>
            <div style="display:flex;gap:8px">
              <button id="hibid-live-arm" type="button" class="hiba-btn">Arm</button>
              <button id="hibid-live-snipe" type="button" class="hiba-btn" disabled>Snipe Now</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <button id="hibid-live-copy-json" type="button" class="hiba-btn">Copy Visible Lots JSON</button>
            <button id="hibid-live-copy-llm" type="button" class="hiba-btn">Copy LLM Auction Brief</button>
          </div>
          <div id="hibid-live-state" class="hiba-meta" style="margin-top:8px">Waiting for live lot...</div>
        </div>
        <div id="hibid-bid-status" style="margin:8px 0;color:#ddd">Paste max plan, then Scan.</div>
        <div id="hibid-bid-detected" style="margin:8px 0;color:#9ca3af;font:12px ui-monospace,Consolas,monospace"></div>
        <div id="hibid-bid-results"></div>
      </div>
      <style>
        #${PANEL_ID} .hiba-btn { background:#2563eb;color:#fff;border:1px solid #fff3;border-radius:7px;padding:7px 10px;font-weight:700;cursor:pointer }
        #${PANEL_ID} .hiba-btn.danger { background:#991b1b }
        #${PANEL_ID} .hiba-row { border-top:1px solid #fff2;padding:8px 0;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center }
        #${PANEL_ID} .hiba-meta { color:#bbb;font-size:12px;margin-top:3px }
        #${PANEL_ID} .hiba-status { font-weight:700 }
        #${PANEL_ID} .hiba-status.eligible { color:#86efac }
        #${PANEL_ID} .hiba-status.skip { color:#fca5a5 }
        #${PANEL_ID} .hiba-prepare { background:#16a34a;color:#fff;border:0;border-radius:7px;padding:7px 10px;font-weight:700;cursor:pointer }
        #${PANEL_ID} .hiba-prepare[disabled] { background:#444;color:#999;cursor:not-allowed }
      </style>
    `;

    document.body.appendChild(panel);
    document.getElementById('hibid-bid-plan-json').value = getStoredPlanText();
    document.getElementById('hibid-bid-outbid-only').checked = isWatchlistOutbidPage();
    document.getElementById('hibid-bid-auto-refresh').checked = getStoredAutoRefresh();
    document.getElementById('hibid-bid-auto-confirm').checked = getStoredAutoConfirm();
    const minimized = getStoredMinimized();
    if (minimized) {
      document.getElementById('hibid-bid-body').style.display = 'none';
      panel.style.width = '320px';
      const minimizeButton = document.getElementById('hibid-bid-minimize');
      minimizeButton.textContent = 'Show';
      minimizeButton.setAttribute('title', 'Restore');
    }
    return panel;
  }

  function getScanOptions() {
    return {
      requireOutbid: Boolean(document.getElementById('hibid-bid-outbid-only')?.checked)
    };
  }

  function init() {
    const panel = createPanel();
    const statusEl = panel.querySelector('#hibid-bid-status');
    const detectedEl = panel.querySelector('#hibid-bid-detected');
    const resultsEl = panel.querySelector('#hibid-bid-results');
    const planEl = panel.querySelector('#hibid-bid-plan-json');
    const liveMode = isLiveCatalogPage();
    const listingExportMode = isFlipTrackerListingPage();
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
    const autoRefreshInput = panel.querySelector('#hibid-bid-auto-refresh');
    const state = { stop: false, rows: [], busy: false, refreshTimer: null, refreshSeconds: 30, lotCache: new Map(), planFocused: false, lastPlanInputAt: 0, liveArmed: false, liveRow: null, liveTimer: null, listingRows: [] };

    const status = (message) => {
      statusEl.textContent = message;
      debug('status', message);
    };

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
          <button type="button" class="hiba-prepare" data-index="${index}" ${row.eligible ? '' : 'disabled'}>Prepare Bid</button>
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
      await loadLots(status, () => state.stop, () => {
        uniqueLots(getLotTiles().map(extractLot)).forEach(lot => {
          if (lot.lot) state.lotCache.set(String(lot.lot), lot);
        });
        return state.lotCache.size;
      });
      const mergedPlanText = planTextFromLoadedLots(planEl.value, Array.from(state.lotCache.values()));
      planEl.value = mergedPlanText;
      savePlanText(mergedPlanText);
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
      if (!liveMode) return null;
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
      liveArmButton.textContent = state.liveArmed ? 'Disarm' : 'Arm';
      liveSnipeButton.disabled = state.busy || !state.liveArmed || !row.eligible;
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

    panel.querySelector('#hibid-bid-minimize').addEventListener('click', (event) => {
      const body = panel.querySelector('#hibid-bid-body');
      const minimized = body.style.display !== 'none';
      body.style.display = minimized ? 'none' : '';
      panel.style.width = minimized ? '320px' : '520px';
      event.currentTarget.textContent = minimized ? 'Show' : 'Min';
      event.currentTarget.setAttribute('title', minimized ? 'Restore' : 'Minimize');
      saveMinimized(minimized);
      debug('panel minimize toggled', { minimized });
    });
    panel.querySelector('#hibid-bid-close').addEventListener('click', () => {
      if (state.liveTimer) clearInterval(state.liveTimer);
      panel.remove();
    });
    panel.querySelector('#hibid-bid-stop').addEventListener('click', () => {
      state.stop = true;
      autoRefreshInput.checked = false;
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = null;
      state.liveArmed = false;
      renderLive();
      status('Stop requested.');
    });
    panel.querySelector('#hibid-bid-load').addEventListener('click', async () => {
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
    panel.querySelector('#hibid-bid-scan').addEventListener('click', () => {
      const plan = getPlan(status);
      const rows = scanPlan(plan, { ...getScanOptions(), includeUnplanned: true }, Array.from(state.lotCache.values()));
      render(rows);
      const plannedCount = Object.keys(plan).length;
      const loadedCount = rows.filter(row => row.status === 'loaded from OUTBID - add max').length;
      status(`${rows.filter(row => row.eligible).length} eligible / ${plannedCount} planned. ${loadedCount} loaded without max. ${rows.filter(row => row.status === 'not found').length} not found.`);
    });
    const setAutoRefresh = (enabled) => {
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

    if (listingExportMode) {
      listingExportModeEl.style.display = '';
      if (!/hibid\.com$/i.test(location.hostname) && location.hostname !== 'bid.ajwillnerauctions.com') {
        bidControlsEl.style.display = 'none';
        liveModeEl.style.display = 'none';
        detectedEl.textContent = 'FlipTracker export mode. Scroll/load your active listings, then scan and download the export.';
        status('Ready to export active listings for FlipTracker.');
      }
      window.setTimeout(scanListingsForExport, 500);
    }

    listingExportScanButton.addEventListener('click', () => {
      const rows = scanListingsForExport();
      status(`Scanned ${rows.length} active listing card(s).`);
    });
    listingExportCopyButton.addEventListener('click', async () => {
      if (!state.listingRows.length) scanListingsForExport();
      if (!state.listingRows.length) {
        status('Nothing to copy yet. Scroll/load listings and scan again.');
        return;
      }
      const copied = await writeClipboard(currentListingExportHtml()).catch(() => false);
      status(copied ? `Copied FlipTracker export HTML for ${state.listingRows.length} listing(s).` : 'Clipboard write failed. Use Download Export HTML instead.');
    });
    listingExportDownloadButton.addEventListener('click', () => {
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

    autoRefreshInput.addEventListener('change', (event) => {
      setAutoRefresh(event.target.checked);
    });
    if (liveMode) {
      liveModeEl.style.display = '';
      autoRefreshInput.checked = false;
      autoRefreshInput.disabled = true;
      saveAutoRefresh(false);
      detectedEl.textContent = 'Live Mode scans this page in-place; it will not auto-refresh/reload.';
      state.liveTimer = setInterval(renderLive, 750);
      renderLive();
    } else if (autoRefreshInput.checked) {
      setAutoRefresh(true);
    }
    panel.querySelector('#hibid-bid-auto-confirm').addEventListener('change', (event) => {
      saveAutoConfirm(event.target.checked);
    });
    panel.querySelector('#hibid-bid-next').addEventListener('click', async () => {
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
    liveArmButton.addEventListener('click', () => {
      state.liveArmed = !state.liveArmed;
      state.stop = false;
      renderLive();
      status(state.liveArmed ? 'Live snipe armed. Use Snipe Now when ready.' : 'Live snipe disarmed.');
    });
    liveSnipeButton.addEventListener('click', async () => {
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
      liveCopyJsonButton.disabled = true;
      liveCopyLlmButton.disabled = true;
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
        liveCopyJsonButton.disabled = false;
        liveCopyLlmButton.disabled = false;
      }
    };
    liveCopyJsonButton.addEventListener('click', () => copyLiveLots('json'));
    liveCopyLlmButton.addEventListener('click', () => copyLiveLots('llm'));
    resultsEl.addEventListener('click', async (event) => {
      if (state.busy) return;
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
    const start = () => waitForLotDocument().then(shouldInit => {
      if (shouldInit) init();
    });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  async function waitForLotDocument() {
    if (!shouldInitOnLocation()) return false;
    if (isFlipTrackerListingPage()) return true;

    for (let i = 0; i < 24; i += 1) {
      if (getLotTiles().length || extractTextLots().length) return true;
      await wait(250);
    }

    const hasFrames = Boolean(document.querySelector('iframe'));
    if (hasFrames && window.top === window) return false;
    return shouldInitOnLocation();
  }
})();
