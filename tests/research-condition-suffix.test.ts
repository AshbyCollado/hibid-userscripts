import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessLotCondition,
  buildProductResearchQuery,
  buildRetailLinks,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const realHiBidFixtures = [
  {
    auctionId: '322840960',
    title: 'Q Link Wireless Scepter 8 Tablet NWT',
    query: 'q link wireless scepter 8 tablet',
  },
  {
    auctionId: '322840770',
    title: 'Dymo Personal Labelmaker W/Refill NWT',
    query: 'dymo personal labelmaker with refill',
  },
] as const;

test('real HiBid NWT titles do not leak seller condition into research queries', () => {
  for (const fixture of realHiBidFixtures) {
    assert.equal(buildProductResearchQuery(fixture.title), fixture.query, fixture.auctionId);
    assert.equal(extractProductIdentity(fixture.title).query, fixture.query, fixture.auctionId);
  }
});

test('trailing standalone condition suffixes are normalized conservatively', () => {
  const cases = [
    ['Acme Shirt NWT', 'acme shirt'],
    ['Acme Shirt NWOT', 'acme shirt'],
    ['Acme Shirt BNIB', 'acme shirt'],
    ['Acme Shirt New With Tags', 'acme shirt'],
    ['Acme Shirt New Without Tags', 'acme shirt'],
    ['NWT-2000 Labelmaker', 'nwt-2000 labelmaker'],
    ['Acme NWT-xxx Labelmaker', 'acme nwt-xxx labelmaker'],
    ['NWT Brand Labelmaker', 'nwt brand labelmaker'],
    ['Acme NWT Labelmaker', 'acme nwt labelmaker'],
    ['Acme Model 8 NWT123', 'acme model 8 nwt123'],
  ] as const;

  for (const [title, expected] of cases) {
    assert.equal(buildProductResearchQuery(title), expected, title);
  }
});

test('query normalization leaves title condition assessment unchanged', () => {
  for (const fixture of realHiBidFixtures) {
    const record = Object.freeze({ title: fixture.title });
    const identity = extractProductIdentity(record);
    assert.equal(identity.query, fixture.query);
    assert.equal(identity.name, fixture.title);
    assert.equal(record.title, fixture.title);
    assert.deepEqual(assessLotCondition(record), {
      partsOnly: false, partsReasons: [], damaged: false, damageReasons: [],
      cautions: [], positive: false, condition: '', fields: {}, freeText: fixture.title,
    });
  }
});

test('attached condition-like model segments survive at the trailing boundary', () => {
  for (const condition of ['NWT', 'NWOT', 'BNIB', 'New With Tags', 'New Without Tags']) {
    assert.equal(buildProductResearchQuery(`AcmeModelX-${condition}`), `acmemodelx-${condition.toLowerCase()}`);
  }
  assert.equal(buildProductResearchQuery('Acme Model X-NWT'), 'acme model x-nwt');
  assert.equal(buildProductResearchQuery('Acme Model X-NWOT'), 'acme model x-nwot');
  assert.equal(buildProductResearchQuery('Acme Model X-BNIB'), 'acme model x-bnib');
  assert.equal(buildProductResearchQuery('AcmeModelX(NWT)'), 'acmemodelx nwt');
});

test('standalone suffix punctuation, case and stacking preserve product identity', () => {
  for (const condition of ['NWT', 'NWOT', 'BNIB', 'New With Tags', 'New Without Tags']) {
    for (const separator of [' ', ' - ', '- ', ' -', ' | ', '| ', ' |', ' , ', ', ', ' ,', ' ; ', '; ', ' ;']) {
      assert.equal(buildProductResearchQuery(`Acme Model X${separator}${condition}`), 'acme model x');
    }
    assert.equal(buildProductResearchQuery(`Acme Model X (${condition})`), 'acme model x');
  }
  assert.equal(buildProductResearchQuery('Acme Model X (nWt)'), 'acme model x');
  assert.equal(buildProductResearchQuery('Acme Model X nWoT'), 'acme model x');
  assert.equal(buildProductResearchQuery('Acme Model X bNiB'), 'acme model x');
  assert.equal(buildProductResearchQuery('Acme Model X NeW WiThOuT TaGs'), 'acme model x');
  assert.equal(buildProductResearchQuery('Acme Model X NWT (BNIB) - NIB'), 'acme model x');
  assert.equal(buildProductResearchQuery('Acme Model X-NWT (BNIB) - NIB'), 'acme model x-nwt');
  assert.equal(buildProductResearchQuery('Acme Model X-NIB'), 'acme model x');
});

test('record query normalization retains NT-USB+, capacity and stated condition evidence', () => {
  const microphone = Object.freeze({
    title: 'RODE NT-USB+ USB Condenser Microphone (BNIB)', condition: 'New in box',
  });
  const identity = extractProductIdentity(microphone);
  assert.equal(identity.query, 'rode nt-usb+ usb condenser microphone');
  assert.equal(identity.model, 'NT-USB+');
  assert.equal(identity.name, microphone.title);
  const assessment = assessLotCondition(microphone);
  assert.equal(assessment.condition, 'New in box');
  assert.equal(assessment.fields.condition, 'New in box');
  assert.equal(assessment.freeText, microphone.title);
  assert.equal(assessment.positive, true);
  assert.equal(microphone.title, 'RODE NT-USB+ USB Condenser Microphone (BNIB)');

  const tablet = extractProductIdentity({ title: 'Apple iPad A2602 256GB Wi-Fi NWOT' });
  assert.equal(tablet.query, 'apple ipad a2602 256gb wi-fi');
  assert.ok(tablet.capacities.includes('256GB'));
});

test('normalized queries feed the same eBay and Amazon URLs', () => {
  for (const fixture of realHiBidFixtures) {
    const links = buildRetailLinks(buildProductResearchQuery(fixture.title));
    const encoded = encodeURIComponent(fixture.query);
    assert.equal(links.amazon, `https://www.amazon.com/s?k=${encoded}`);
    assert.equal(links.ebay, `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`);
  }
});
