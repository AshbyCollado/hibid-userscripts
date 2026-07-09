import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeElement({ text = '', attrs = {}, disabled = false } = {}) {
  return {
    disabled,
    offsetParent: {},
    textContent: text,
    getClientRects: () => [{ width: 1, height: 1 }],
    getAttribute(name) {
      return attrs[name] || '';
    },
  };
}

function loadCore() {
  const source = fs.readFileSync(new URL('../hibid-lot-catalog-scraper.user.js', import.meta.url), 'utf8');
  const sandbox = {
    console,
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_LOT_CATALOG_SCRAPER_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-lot-catalog-scraper.user.js' });
  return sandbox.HiBidLotCatalogScraperCore;
}

test('standalone scraper initializes on livecatalog and subdomain catalog pages', () => {
  const core = loadCore();

  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/livecatalog/752334/the-luxe-edit')), true);
  assert.equal(core.shouldInitOnLocation(new URL('https://seuyco.hibid.com/catalog/752334/the-luxe-edit')), true);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/watchlist?status=OUTBID')), false);
});

test('standalone scraper finds safe live open-more controls only', () => {
  const core = loadCore();
  const openMore = makeElement({ text: 'Open More' });
  const bidHistory = makeElement({ text: '2 Bids' });
  const bidButton = makeElement({ text: 'Bid 86.00 USD' });
  const watch = makeElement({ text: 'Watch' });

  const root = {
    querySelectorAll() {
      return [bidHistory, bidButton, watch, openMore];
    },
  };

  assert.equal(core.findLiveLoadMoreButton(root), openMore);
});

test('standalone scraper parses visible livecatalog lots with bid fields', () => {
  const core = loadCore();
  const root = {
    body: {
      textContent: `
        Total Lots: 1999 Open Lots: 375
        Lot 1627sf | Chloe L'eau by Chloe Eau De Toilette Spray
        Watch High Bid: 38.00 USD 200.00 USD 1 Bid 10s Bid 43.00 USD
        Lot 1628sf | Hermes Swift Elan Pocket Belt Bag
        Watch High Bid: 881.00 USD 3,950.00 USD 1 Bid 25s Bid 896.00 USD
      `,
    },
  };

  assert.deepEqual(plain(core.extractLivePageLots(root)), [
    {
      id: '1627sf',
      lot: '1627sf',
      title: "Chloe L'eau by Chloe Eau De Toilette Spray",
      highBid: 'High Bid: 38.00 USD',
      highBidAmount: 38,
      estimatedValue: 200,
      bidCount: '1 Bid',
      bidCountNumber: 1,
      timeLeft: '10s',
      nextBid: 'Bid 43.00 USD',
      nextBidAmount: 43,
      userBidStatus: '',
      status: '',
      rawText: "Lot 1627sf | Chloe L'eau by Chloe Eau De Toilette Spray Watch High Bid: 38.00 USD 200.00 USD 1 Bid 10s Bid 43.00 USD",
    },
    {
      id: '1628sf',
      lot: '1628sf',
      title: 'Hermes Swift Elan Pocket Belt Bag',
      highBid: 'High Bid: 881.00 USD',
      highBidAmount: 881,
      estimatedValue: 3950,
      bidCount: '1 Bid',
      bidCountNumber: 1,
      timeLeft: '25s',
      nextBid: 'Bid 896.00 USD',
      nextBidAmount: 896,
      userBidStatus: '',
      status: '',
      rawText: 'Lot 1628sf | Hermes Swift Elan Pocket Belt Bag Watch High Bid: 881.00 USD 3,950.00 USD 1 Bid 25s Bid 896.00 USD',
    },
  ]);
});
