import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmazonDocumentCandidates } from '../src/intelligence/amazon-document-parser.js';
import { detectMixedLot, detectProductKind, extractLotQuantityFromTitle, extractProductIdentity, matchAmazonCandidates } from '../src/intelligence/us-deal-intelligence.js';

interface AmazonWatchlistRegression {
  product: string;
  sourceTitle: string;
  falsePositiveTitle: string;
  exactSourceTitle: string;
  exactCandidateTitle: string;
}

const regressions: AmazonWatchlistRegression[] = [
  {
    product: 'Ninja BN801 blender',
    sourceTitle: 'Ninja Professional Blender BN801',
    falsePositiveTitle: 'Replacement 24oz Blender Cup For Ninja BN401 SS401 BN751 BN801 BL450 BL456 BL480 Foodi SS401 SS101 TWISTi SS151 SS351 Cups, 24oz Blender',
    exactSourceTitle: 'Ninja Professional Blender BN801',
    exactCandidateTitle: 'Ninja BN801 Professional Plus Kitchen System with Auto-iQ Countertop Blender',
  },
  {
    product: 'Canon printer and scanner',
    sourceTitle: 'Canon printer scanner and stand',
    falsePositiveTitle: 'Canon SD-24 Printer Stand for imagePROGRAF TM-240, TC-21, and TC-20',
    exactSourceTitle: 'Canon imageCLASS MF656Cdw Wireless Color Laser Printer Scanner with Stand',
    exactCandidateTitle: 'Canon imageCLASS MF656Cdw Wireless Color Laser Printer Scanner with Stand',
  },
  {
    product: 'Mahlkonig EK43 grinder',
    sourceTitle: 'Mahlk\u00f6nig EK43 Coffee Grinder',
    falsePositiveTitle: 'Espresso Coffee Grinder Single Dose Hopper with Silicone Bellow Air Blower Blaster for Mazzer Super Jolly, Mahlkonig EK43',
    exactSourceTitle: 'Mahlk\u00f6nig EK43 Coffee Grinder',
    exactCandidateTitle: 'Mahlkonig EK43 Commercial Coffee Grinder',
  },
  {
    product: 'Lenovo P3 Ultra workstation',
    sourceTitle: 'Lenovo P3 Ultra Workstation',
    falsePositiveTitle: 'Lenovo ThinkStation P3 Tiny Workstation Desktop, Intel i5-14500 vPro',
    exactSourceTitle: 'Lenovo P3 Ultra Workstation',
    exactCandidateTitle: 'Lenovo ThinkStation P3 Ultra Workstation',
  },
  {
    product: 'Lenovo ThinkPad X1 Carbon Gen 11',
    sourceTitle: 'Lenovo ThinkPad X1 Carbon Gen 11 Laptop',
    falsePositiveTitle: 'Lenovo ThinkPad X1 Carbon 7th Gen Windows 11 Pro Laptop Computer',
    exactSourceTitle: 'Lenovo ThinkPad X1 Carbon Gen 11 Laptop',
    exactCandidateTitle: 'Lenovo ThinkPad X1 Carbon Gen 11 Laptop',
  },
  {
    product: 'single Samsung 990 PRO 4TB SSD',
    sourceTitle: 'New Samsung 990 Pro 4TB PCIe 4.0 NVMe M.2 SSD',
    falsePositiveTitle: 'Samsung MZ-V9P4T0B/AM 990 PRO PCIe 4.0 NVMe M.2 SSD 4TB 2 Pack',
    exactSourceTitle: 'New Samsung 990 Pro 4TB PCIe 4.0 NVMe M.2 SSD',
    exactCandidateTitle: 'Samsung 990 PRO 4TB PCIe 4.0 NVMe M.2 Internal SSD',
  },
  {
    product: 'specifically identified book',
    sourceTitle: 'Books',
    falsePositiveTitle: 'The Great Gatsby by F. Scott Fitzgerald, Paperback',
    exactSourceTitle: 'Introduction to Algorithms, 3rd Edition, ISBN 978-0-262-03384-8',
    exactCandidateTitle: 'Introduction to Algorithms, Third Edition, ISBN 9780262033848',
  },
  {
    product: 'Epson printer versus matching-model ink',
    sourceTitle: 'LIKE NEW EPSON WORKFORCE WF-7840',
    falsePositiveTitle: 'Epson 812 Genuine Ink Standard Capacity 3 Color Combo Pack T812520 | Works With WorkForce Pro WF-7310 WF-7820 WF-7840 EC-C7000 Printers',
    exactSourceTitle: 'LIKE NEW EPSON WORKFORCE WF-7840',
    exactCandidateTitle: 'Epson Workforce Pro WF-7840 Wireless All-in-One Wide-Format Inkjet Printer',
  },
  {
    product: 'Alienware laptop versus matching-model charger',
    sourceTitle: 'Dell Alienware m17 R3 Laptop',
    falsePositiveTitle: 'Dell Laptop Charger 330W AC Power Adapter for Alienware m17 R3, LA330PM190',
    exactSourceTitle: 'Dell Alienware m17 R3 Laptop',
    exactCandidateTitle: 'Dell Alienware m17 R3 Gaming Laptop',
  },
];

function parsedAmazonCandidate(asin: string, title: string) {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="${asin}" data-component-type="s-search-result">
      <a href="/dp/${asin}"><h2><span>${title}</span></h2></a>
      <span class="a-price"><span class="a-offscreen">$199.99</span></span>
    </div>
  `);

  assert.equal(candidates.length, 1, `Amazon parser should return the card for ${asin}`);
  assert.equal(candidates[0]?.title, title);
  return candidates[0]!;
}

test('a generic same-brand VCR remains available only as an equivalent reference', () => {
  const candidate = parsedAmazonCandidate('B0ADV90001', 'JVC HR-VP673U 4-Head Hi-Fi VHS VCR Video Cassette Recorder');
  const match = matchAmazonCandidates([candidate], extractProductIdentity('VINTAGE JVC VCR'));
  assert.equal(match?.candidate.asin, 'B0ADV90001');
  assert.equal(match?.referenceKind, 'equivalent');
});

test('an identified JVC VCR model remains an exact reference', () => {
  const candidate = parsedAmazonCandidate('B0ADV90002', 'JVC HR-VP673U 4-Head Hi-Fi VHS VCR Video Cassette Recorder');
  const match = matchAmazonCandidates([candidate], extractProductIdentity('Vintage JVC HR-VP673U 4-Head Hi-Fi VHS VCR'));
  assert.equal(match?.candidate.asin, 'B0ADV90002');
  assert.equal(match?.referenceKind, 'exact');
});

test('condition prefixes cannot become a fake brand', () => {
  const identity = extractProductIdentity('LIKE NEW EPSON WORKFORCE WF-7840');
  assert.equal(identity.brand.toLowerCase(), 'epson');
  const candidate = parsedAmazonCandidate('B0ADV90003', 'Epson Workforce Pro WF-7840 Wireless All-in-One Wide-Format Inkjet Printer');
  assert.equal(matchAmazonCandidates([candidate], identity)?.candidate.asin, 'B0ADV90003');
});

test('HP trailing-e printer variants may use a clearly labeled base-model equivalent', () => {
  const identity = extractProductIdentity('HP ENVY 6155E');
  const candidate = parsedAmazonCandidate('B0ADV90004', 'HP Envy 6155 Wireless All-in-One Color Inkjet Printer');
  const match = matchAmazonCandidates([candidate], identity);
  assert.equal(match?.candidate.asin, 'B0ADV90004');
  assert.equal(match?.referenceKind, 'equivalent');
});

test('all-in-one printer wording cannot classify an inkjet as a desktop', () => {
  assert.equal(detectProductKind('HP Envy 6155 Wireless All-in-One Color Inkjet Printer'), 'printer');
  assert.equal(detectProductKind('HP ENVY 6155E'), 'printer');
  assert.equal(detectProductKind('EPSON WORKFORCE WF-7840'), 'printer');
  assert.equal(detectProductKind('Lenovo 24 inch All-in-One Desktop Computer'), 'desktop');
});

test('P3 workstation form remains mandatory across Ultra, Tiny, and Tower', () => {
  const identity = extractProductIdentity('Lenovo P3 Ultra Workstation');
  const tower = parsedAmazonCandidate('B0ADV90006', 'Lenovo ThinkStation P3 Tower Workstation Intel Ultra 9 285 vPro');
  assert.equal(matchAmazonCandidates([tower], identity), null);
});

test('included printer ink does not turn the printer into a consumable', () => {
  const identity = extractProductIdentity('HP ENVY 6155E');
  const printer = parsedAmazonCandidate('B0ADV90007', 'HP Envy 6155 Wireless All-in-One Color Inkjet Printer, Print, Scan, Copy, Duplex Printing Best-for-Home, 3 Month Trial of Instant Ink Included, AI-Capable');
  const ink = parsedAmazonCandidate('B0ADV90008', 'HP 68 Black and Tri-Color Instant Ink Cartridges for Envy 6155e Printer');
  assert.equal(matchAmazonCandidates([printer], identity)?.candidate.asin, 'B0ADV90007');
  assert.equal(matchAmazonCandidates([ink], identity), null);
});

test('broad plural book inventories require component review while named single titles do not', () => {
  assert.equal(detectMixedLot('Books').mixed, true);
  assert.equal(detectMixedLot('Preston and Child books').mixed, true);
  assert.equal(detectMixedLot('Books in reference to world history').mixed, true);
  assert.equal(detectMixedLot('Books of Blood by Clive Barker').mixed, false);
  assert.equal(detectMixedLot('Book shelf no books').mixed, false);
  assert.equal(detectMixedLot('Wooden bookshelf').mixed, false);
});

test('mixed signal and mixed reality are product terms, not group-lot markers', () => {
  assert.equal(detectMixedLot('Tektronix MS064B 4GHz 50 GS/s Mixed Signal Oscilloscope').mixed, false);
  assert.equal(detectMixedLot('Meta Quest 3 Mixed Reality Headset').mixed, false);
});

test('unbranded material-led products do not invent a material brand', () => {
  const identity = extractProductIdentity('Wood Cutting Board 12 x 8 inch');
  assert.equal(identity.brand, '');
  const candidate = parsedAmazonCandidate('B0ADV90005', 'Acacia Wood Cutting Board 12 x 8 inch with Handle');
  assert.equal(matchAmazonCandidates([candidate], identity)?.candidate.asin, 'B0ADV90005');
});

test('abbreviated assorted lots and count-of quantities require review', () => {
  assert.equal(detectMixedLot("Ass't of Wooden Cutting Boards Count of 4").mixed, true);
  assert.equal(extractLotQuantityFromTitle("Ass't of Wooden Cutting Boards Count of 4"), 4);
});

test('two branded products joined in one title require component review', () => {
  assert.equal(detectMixedLot('Sony SLV-D380P DVD VHS Recorder & Bose Cinemate').mixed, true);
  assert.equal(detectMixedLot('Sony PlayStation 5 Console with DualSense Controller').mixed, false);
});

for (const [index, regression] of regressions.entries()) {
  test(`Amazon watchlist rejects ${regression.product} false positive`, () => {
    const asin = `B0ADV${String(index + 1).padStart(5, '0')}`;
    const candidate = parsedAmazonCandidate(asin, regression.falsePositiveTitle);
    const match = matchAmazonCandidates([candidate], extractProductIdentity(regression.sourceTitle));

    assert.equal(
      match,
      null,
      `"${regression.sourceTitle}" must reject "${regression.falsePositiveTitle}"`,
    );
  });

  test(`Amazon watchlist accepts exact ${regression.product}`, () => {
    const asin = `B0ADV${String(index + 9).padStart(5, '0')}`;
    const candidate = parsedAmazonCandidate(asin, regression.exactCandidateTitle);
    const match = matchAmazonCandidates([candidate], extractProductIdentity(regression.exactSourceTitle));

    assert.equal(
      match?.candidate.asin,
      asin,
      `"${regression.exactSourceTitle}" should accept "${regression.exactCandidateTitle}"`,
    );
  });
}
