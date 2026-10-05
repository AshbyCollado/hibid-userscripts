import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parsePublicEbaySoldSearch, verifyEbaySoldCompSet } from '../src/intelligence/ebay-sold-results.js';
import { assessCondition, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-09-22T08:13:41.442Z';
const sourceUrl = 'https://www.ebay.com/sch/i.html?_nkw=Bambu+Lab+P1S+AMS+combo&LH_Sold=1&LH_Complete=1';
const fixture = readFileSync(new URL('./fixtures/ebay-sold-s-card-2026-09-22.html', import.meta.url), 'utf8');
const itemId = '890000000001';
const title = 'Onkyo TX-SR304 AV Receiver';

function documentFor(html: string): Document {
  return new JSDOM(html, { url: sourceUrl }).window.document;
}

function card(options: { id?: string; title?: string; subtitles?: string[]; price?: string; caption?: string; extra?: string; shipping?: string; legacy?: boolean } = {}): string {
  const id = options.id ?? itemId;
  const cardTitle = options.title ?? title;
  const price = options.price ?? '<span class="s-card__price">$100.00</span>';
  const caption = options.caption ?? 'Sold Sep 20, 2026';
  if (options.legacy) {
    return `<li class="s-item"><a class="s-item__link" href="https://www.ebay.com/itm/${id}"><span class="s-item__title">${cardTitle}</span></a>
      <span class="s-item__caption--signal">${caption}</span>
      ${price.replaceAll('s-card__price', 's-item__price')}
      <span class="s-item__shipping">${options.shipping ?? 'Free shipping'}</span>
      <span class="SECONDARY_INFO">Pre-Owned</span>${options.extra ?? ''}</li>`;
  }
  return `<li class="s-card" id="item${id}">
    <a class="s-card__link image-treatment" href="https://www.ebay.com/itm/${id}"></a>
    <div class="s-card__caption">${caption}</div>
    <a class="s-card__link" href="https://www.ebay.com/itm/${id}"><div class="s-card__title">${cardTitle}<span class="clipped">Opens in a new window or tab</span></div></a>
    ${(options.subtitles ?? ['Pre-Owned']).map((value) => `<div class="s-card__subtitle"><span class="su-styled-text secondary default">${value}</span></div>`).join('')}
    <div class="s-card__attribute-row">${price}</div>
    <div class="s-card__attribute-row">${options.shipping ?? 'Free delivery'}</div>
    ${options.extra ?? ''}</li>`;
}

function page(cards: string, heading = '3 results'): string {
  return `<h1 id="srp-results-heading">${heading}</h1><div id="srp-river-results"><ul class="srp-results">${cards}</ul></div>`;
}

function parse(html: string) {
  return parsePublicEbaySoldSearch(documentFor(html), sourceUrl, observedAt);
}

function verify(html: string) {
  const attempt = parse(html);
  return verifyEbaySoldCompSet(extractProductIdentity(title), [attempt], {
    plannedQueries: [attempt.query], minimumSampleSize: 1,
  });
}

test('grounded live s-card fixture keeps titles, Sold dates, delivery, and hidden offer uncertainty', () => {
  const doc = documentFor(fixture);
  const before = doc.body.innerHTML;
  const result = parsePublicEbaySoldSearch(doc, sourceUrl, observedAt);
  assert.equal(result.status, 'ok');
  assert.equal(result.failureReason, null);
  assert.equal(result.observedAt, observedAt);
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.map((record) => ({
    id: record.itemId, title: record.title, condition: record.condition, soldAt: record.soldAt,
    price: record.soldPrice?.amount ?? null, shipping: record.shippingPrice?.amount ?? null,
    delivered: record.deliveredPrice?.amount ?? null, totalSales: record.totalSales?.amount ?? null,
    kind: record.priceKind, format: record.format,
  })), [
    { id: '377375216393', title: 'Bambu Lab P1S Combo 3D Printer AMS Multi-Color Printing High Speed Black', condition: 'Pre-Owned', soldAt: 'Sep 20, 2026', price: 479.99, shipping: 0, delivered: 479.99, totalSales: 479.99, kind: 'public-visible', format: 'or Best Offer' },
    { id: '237074439173', title: 'Bambu Lab P1S 3D Printer AMS Combo with Filament', condition: 'Open Box', soldAt: 'Sep 18, 2026', price: null, shipping: 20.28, delivered: null, totalSales: null, kind: 'best-offer-unknown', format: 'Best offer accepted' },
    { id: '407066157028', title: 'Bambu Lab P1S Combo 3D Printer with AMS | Less than 600 Hours', condition: 'Pre-Owned', soldAt: 'Aug 14, 2026', price: null, shipping: 45.34, delivered: null, totalSales: null, kind: 'best-offer-unknown', format: 'Best offer accepted' },
  ]);
  for (const record of result.records) {
    assert.equal(record.itemUrl, `https://www.ebay.com/itm/${record.itemId}`);
    assert.equal(record.provenance.itemId, record.itemId);
    assert.equal(record.provenance.source, 'rendered-sold-listing');
    assert.equal(record.soldPrice?.currency ?? record.shippingPrice?.currency, 'USD');
  }
  assert.equal(doc.body.innerHTML, before, 'parsing must not mutate the supplied DOM');
});

test('live ECOVACS 198583746592 selects refurbished condition after the warranty subtitle', () => {
  const ecovacsTitle = 'ECOVACS DEEBOT N30 PRO Omni Robot Vacuum and Mop 10000Pa Hot Water Mop Wahshing';
  const result = parse(page(card({
    id: '198583746592',
    title: ecovacsTitle,
    subtitles: ['2-Year Warranty, TruEdge Edge Mop, Obstacle Avoidance', 'Certified - Refurbished'],
  })));
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0]?.itemId, '198583746592');
  assert.equal(result.records[0]?.title, ecovacsTitle);
  assert.equal(result.records[0]?.condition, 'Certified - Refurbished');
});

for (const condition of ['Used', 'Pre-Owned', 'For parts or not working', 'Parts only', 'Open box', 'New', 'Brand New', 'Refurbished', 'Certified - Refurbished', 'Seller refurbished']) {
  for (const promotionFirst of [true, false]) {
    test(`${condition} wins over New arrivals with promotion ${promotionFirst ? 'first' : 'last'}`, () => {
      const subtitles = promotionFirst ? ['New arrivals', condition] : [condition, 'New arrivals'];
      assert.equal(parse(page(card({ subtitles }))).records[0]?.condition, condition);
    });
  }
}

for (const promotion of ['New arrivals', 'New technology for easy cleaning', '2-Year Warranty, TruEdge Edge Mop, Obstacle Avoidance']) {
  test(`promotion alone is not condition evidence: ${promotion}`, () => {
    const attempt = parse(page(card({ subtitles: [promotion] })));
    assert.equal(attempt.records[0]?.condition, null);
    const result = verifyEbaySoldCompSet(extractProductIdentity(title), [attempt], {
      plannedQueries: [attempt.query], minimumSampleSize: 1, sourceCondition: assessCondition('Untested'),
    });
    assert.deepEqual(result.rejected[0]?.reasons, ['condition-ambiguous:comp-function-unconfirmed']);
    assert.equal(result.marketValueReady, false);
  });
}

test('an unfamiliar explicitly labeled condition survives promotional subtitles as raw evidence', () => {
  const result = parse(page(card({ subtitles: ['New arrivals', 'Condition: Seller grade B'] })));
  assert.equal(result.records[0]?.condition, 'Condition: Seller grade B');
});

for (const [condition, sourceCondition, reason] of [
  ['Certified - Refurbished', 'Condition: New - Factory Sealed', 'condition-mismatch:used-comp-for-new-lot'],
  ['For parts or not working', 'Fully tested and working', 'condition-mismatch:parts-only-comp'],
  ['New', 'Untested', 'condition-mismatch:working-comp-for-untested-lot'],
] as const) {
  test(`selected ${condition} reaches the existing comp guard`, () => {
    const attempt = parse(page(card({ subtitles: ['2-Year Warranty', condition] })));
    const result = verifyEbaySoldCompSet(extractProductIdentity(title), [attempt], {
      plannedQueries: [attempt.query], minimumSampleSize: 1, sourceCondition: assessCondition(sourceCondition),
    });
    assert.deepEqual(result.rejected[0]?.reasons, [reason]);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.statistics.salePriceMedian, null);
    assert.equal(result.marketValueReady, false);
  });
}

test('canonical result lists exclude recently viewed cards in either layout', () => {
  const html = `${page(card())}<aside aria-label="Recently viewed">${card({ id: '890000000002' })}${card({ id: '890000000003', legacy: true })}<ul class="srp-results">${card({ id: '890000000004', legacy: true })}</ul></aside>`;
  assert.deepEqual(parse(html).records.map((record) => record.itemId), [itemId]);
});

test('legacy canonical markup remains supported without the newer river wrapper', () => {
  const result = parse(`<ul class="srp-results">${card({ legacy: true, shipping: '+$12.00 shipping' })}</ul>`);
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0]?.soldPrice?.amount, 100);
  assert.equal(result.records[0]?.shippingPrice?.amount, 12);
  assert.equal(result.records[0]?.deliveredPrice?.amount, 112);
});

test('title link supplies identity when an earlier image link is empty or unrelated', () => {
  const html = card().replace(`class="s-card__link image-treatment" href="https://www.ebay.com/itm/${itemId}"`, 'class="s-card__link image-treatment" href="https://www.ebay.com/itm/890000000099"');
  assert.deepEqual(parse(page(html)).records.map((record) => record.itemId), [itemId]);
});

for (const caption of ['', 'Ended Sep 20, 2026', 'Not Sold Sep 20, 2026']) {
  test(`caption ${JSON.stringify(caption)} cannot gain Sold provenance from other card text`, () => {
    const result = parse(page(card({ caption, extra: '<div class="s-card__attribute-row">Sold Sep 20, 2026</div>' })));
    assert.equal(result.status, 'parse-error');
    assert.deepEqual(result.records, []);
  });
}

for (const shipping of ['Free delivery', 'Free shipping', '+$20.28 delivery', '+$45.34 shipping']) {
  test(`${shipping} is parsed from an s-card attribute row`, () => {
    const record = parse(page(card({ shipping }))).records[0];
    const amount = shipping.startsWith('Free') ? 0 : shipping.includes('20.28') ? 20.28 : 45.34;
    assert.deepEqual(record?.shippingPrice, { amount, currency: 'USD' });
    assert.equal(record?.deliveredPrice?.amount, Number((100 + amount).toFixed(2)));
  });
}

for (const legacy of [false, true]) {
  for (const range of ['$80.00 to $100.00', '$80.00 - 100.00']) {
    test(`${legacy ? 'legacy' : 's-card'} range ${range} cannot become a numeric sold price`, () => {
      const html = page(card({ legacy, price: `<span class="s-card__price">${range}</span>` }));
      const record = parse(html).records[0];
      assert.ok(record);
      assert.equal(record.soldPrice, null);
      assert.equal(record.deliveredPrice, null);
      assert.equal(record.totalSales, null);
      assert.equal(verify(html).marketValueReady, false);
    });
  }
}

for (const price of [
  '<span class="s-card__price strikethrough">$200.00</span><span class="s-card__price">$100.00</span>',
  '<span class="s-card__price"><s>$200.00</s> $100.00</span>',
  '<span class="s-card__price"><span class="strikethrough">$200.00</span> $100.00</span>',
]) {
  test(`current price survives marked original price: ${price}`, () => {
    const result = parse(page(card({ price })));
    assert.equal(result.records[0]?.soldPrice?.amount, 100);
    assert.equal(result.records[0]?.deliveredPrice?.amount, 100);
  });
}

for (const price of [
  '<span class="s-card__price strikethrough">$200.00</span>',
  '<span class="s-card__price">$200.00 $100.00</span>',
]) {
  test(`ambiguous or wholly struck price stays unknown: ${price}`, () => {
    const record = parse(page(card({ price }))).records[0];
    assert.ok(record);
    assert.equal(record.soldPrice, null);
  });
}

for (const legacy of [false, true]) {
  for (const unknownFirst of [false, true]) {
    for (const uncertainty of ['offer', 'range'] as const) {
      test(`${legacy ? 'legacy' : 's-card'} duplicate ${uncertainty} uncertainty wins with unknown ${unknownFirst ? 'first' : 'last'}`, () => {
        const known = card({ legacy });
        const unknown = card({ legacy, ...(uncertainty === 'offer'
          ? { extra: '<div class="s-card__attribute-row">Best offer accepted</div>' }
          : { price: '<span class="s-card__price">$80 to $100</span>' }) });
        const html = page(unknownFirst ? unknown + known : known + unknown);
        const attempt = parse(html);
        assert.equal(attempt.status, 'ok');
        assert.equal(attempt.records.length, 1);
        assert.equal(attempt.records[0]?.itemId, itemId);
        assert.equal(attempt.records[0]?.soldPrice, null);
        assert.equal(attempt.records[0]?.totalSales, null);
        assert.equal(attempt.records[0]?.deliveredPrice, null);
        assert.equal(attempt.records[0]?.priceKind, uncertainty === 'offer' ? 'best-offer-unknown' : 'public-visible');
        const result = verify(html);
        assert.equal(result.accepted.length, 0);
        assert.equal(result.statistics.salePriceMedian, null);
        assert.equal(result.marketValueReady, false);
      });
    }
  }
}

test('mixed old and new duplicate cards cannot restore a hidden offer price', () => {
  const result = parse(page(card({ legacy: true }) + card({ extra: '<div class="s-card__attribute-row">Best offer accepted</div>' })));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.priceKind, 'best-offer-unknown');
  assert.equal(result.records[0]?.soldPrice, null);
});

test('separate observations cannot restore a hidden price during verification', () => {
  const known = parse(page(card()));
  const unknown = parse(page(card({ extra: '<div class="s-card__attribute-row">Best offer accepted</div>' })));
  assert.equal(known.status, 'ok');
  assert.equal(unknown.status, 'ok');
  const result = verifyEbaySoldCompSet(extractProductIdentity(title), [known, unknown], { plannedQueries: [known.query], minimumSampleSize: 1 });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.marketValueReady, false);
  assert.deepEqual(result.rejected[0]?.reasons, ['duplicate-record-conflict']);
});

test('zero exact results heading excludes fallback Sold cards', () => {
  const result = parse(page(card(), '0 results for exact query; Results matching fewer words'));
  assert.equal(result.status, 'no-results');
  assert.equal(result.records.length, 0);
});

for (const html of [
  '<main>Results could not be loaded</main>',
  page('<li class="unrecognized-result">Sold Sep 20, 2026 $100</li>'),
  page(card({ caption: '' })),
]) {
  test(`unparseable results are errors rather than zero evidence: ${html.slice(0, 80)}`, () => {
    const result = parse(html);
    assert.equal(result.status, 'parse-error');
    assert.equal(result.failureReason, 'sold-search-contained-no-parseable-records');
  });
}

test('explicit no-exact-match heading with an empty canonical list is no-results', () => {
  assert.equal(parse(page('', 'No exact matches found')).status, 'no-results');
});

test('explicit zero results with an empty canonical list remains no-results', () => {
  assert.equal(parse(page('', '0 results')).status, 'no-results');
});

test('new cards retain source-context and challenge protections', () => {
  const doc = documentFor(page(card()));
  assert.equal(parsePublicEbaySoldSearch(doc, sourceUrl.replace('LH_Sold=1', 'LH_Sold=0'), observedAt).status, 'not-sold-context');
  assert.equal(parsePublicEbaySoldSearch(doc, sourceUrl.replace('www.ebay.com', 'example.com'), observedAt).status, 'not-sold-context');
  assert.equal(parse(`<h1>Pardon our interruption</h1>${page(card())}`).status, 'challenge');
});
