import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  extractAuctionNinjaCatalogLots,
  extractAuctionNinjaItemDetail,
  mergeAuctionNinjaItemDetail,
} from '../src/auctionninja/dom.js';

const saleUrl = 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/example--17792.html';
const detailUrl = 'https://www.auctionninja.com/clearinghouseestatesales/product/example--2494589.html';

function documentFrom(html: string): Document {
  return new JSDOM(html, { url: saleUrl }).window.document;
}

function slot(index: number, href = `https://www.pictureserver1.auctionninja.com/pictureserver/clearinghouseestatesales/Pictures/photo-${index}.jpg`, image = `https://www.pictureserver1.auctionninja.com/pictureserver/clearinghouseestatesales/Pictures/Thumb_Big/photo-${index}.jpg`) {
  return `<a href="${href}" class="listicle-capterra-gallery-sing"><img id="zoom_${index}" src="${image}" title="Fixture item"></a>`;
}

function card(gallery: string, extra = ''): string {
  return `<div class="search-catalog-item-box"><a href="/clearinghouseestatesales/product/fixture--2494589.html">Fixture item</a><span>Lot # 1 Current Bid: $5.00</span>${gallery}${extra}</div>`;
}

test('extracts every canonical gallery slot beyond fifteen without a provider-total claim', () => {
  const gallery = `<div class="listicle-capterra-gallery">${Array.from({ length: 18 }, (_, index) => slot(index + 1)).join('')}</div>`;
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.length, 18);
  assert.deepEqual(lot.physicalPhotoDescriptors?.map((item) => item.sellerOrdinal), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.deepEqual(lot.photoAudit, { expectedCount: null, observedCount: 18, knownImageCount: 18, reconciled: false, verification: 'unverified', countSource: 'dom-gallery' });
});

test('uses each canonical anchor href as full resolution and the img as thumbnail', () => {
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}</div>`)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.fullResolutionUrl, 'https://www.pictureserver1.auctionninja.com/pictureserver/clearinghouseestatesales/Pictures/photo-1.jpg');
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.thumbnailUrl, 'https://www.pictureserver1.auctionninja.com/pictureserver/clearinghouseestatesales/Pictures/Thumb_Big/photo-1.jpg');
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.source, 'dom-gallery');
});

test('preserves repeated seller gallery entries at different ordinals', () => {
  const duplicate = slot(2, 'https://images.example/same.jpg', 'https://images.example/same-thumb.jpg');
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1, 'https://images.example/same.jpg')}${duplicate}</div>`)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.length, 2);
  assert.deepEqual(lot.physicalPhotoDescriptors?.map((item) => item.sellerOrdinal), [1, 2]);
  assert.deepEqual(lot.physicalPhotoDescriptors?.map((item) => item.fullResolutionUrl), ['https://images.example/same.jpg', 'https://images.example/same.jpg']);
});

test('does not turn slick carousel clones into additional seller slots', () => {
  const clone = slot(99).replace('listicle-capterra-gallery-sing', 'listicle-capterra-gallery-sing slick-cloned');
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${clone}${slot(2)}</div>`)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.length, 2);
  assert.deepEqual(lot.physicalPhotoDescriptors?.map((item) => item.sellerOrdinal), [1, 2]);
});

test('reads lazy and srcset thumbnails without guessing a full-resolution URL', () => {
  const gallery = `<div class="listicle-capterra-gallery"><a href="" class="listicle-capterra-gallery-sing"><img id="zoom_1" data-src="/Pictures/lazy-thumb.jpg" srcset="/Pictures/lazy-small.jpg 320w, /Pictures/lazy-large.jpg 1280w"></a></div>`;
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.fullResolutionUrl, null);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.thumbnailUrl, 'https://www.auctionninja.com/Pictures/lazy-thumb.jpg');
  assert.equal(lot.photoAudit?.verification, 'unverified');
});

test('uses explicit known image URLs as unverified fallback without inventing originals', () => {
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card('', '<img src="/Pictures/card-thumb.jpg"><img src="/logo.png">')), saleUrl)[0]!;
  assert.equal(lot.photoAudit?.observedCount, 0);
  assert.equal(lot.photoAudit?.knownImageCount, 1);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.source, 'known-image-url');
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.fullResolutionUrl, null);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.knownImageUrl, 'https://www.auctionninja.com/Pictures/card-thumb.jpg');
});

test('ignores unrelated imagery outside the canonical gallery for physical descriptors', () => {
  const gallery = `<div class="listicle-capterra-gallery">${slot(1)}</div><img src="/Pictures/unrelated-banner.jpg"><img src="/avatar.jpg">`;
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
  assert.equal(lot.physicalPhotoDescriptors?.length, 1);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.fullResolutionUrl?.endsWith('/photo-1.jpg'), true);
  assert.equal(lot.images.some((url) => url.endsWith('/unrelated-banner.jpg')), true);
});

test('does not change the existing images array while adding descriptors', () => {
  const gallery = `<div class="listicle-capterra-gallery">${slot(1)}${slot(2)}</div><img src="/Pictures/extra-card-image.jpg">`;
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
  assert.ok(lot.images.some((url) => url.endsWith('/extra-card-image.jpg')));
  assert.equal(lot.physicalPhotoDescriptors?.length, 2);
});

test('detail gallery descriptors replace catalog fallback descriptors without duplicating them', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card('', '<img src="/Pictures/card-thumb.jpg">')), saleUrl)[0]!;
  const detailDoc = documentFrom(`<link rel="canonical" href="${detailUrl}"><h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><div id="description">Condition: Used</div><div class="listicle-capterra-gallery">${slot(1)}${slot(2)}</div><span>Lot # 1 High Bid: $5.00</span></div>`);
  const detail = extractAuctionNinjaItemDetail(detailDoc, detailUrl);
  const merged = mergeAuctionNinjaItemDetail(catalog, detail);
  assert.equal(merged.physicalPhotoDescriptors?.length, 2);
  assert.equal(merged.physicalPhotoDescriptors?.every((item) => item.source === 'dom-gallery'), true);
  assert.ok(merged.images.some((url) => url.endsWith('/card-thumb.jpg')));
});

test('does not let a detail fallback overwrite canonical catalog gallery descriptors', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${slot(2)}</div>`)), saleUrl)[0]!;
  const detailDoc = documentFrom(`<link rel="canonical" href="${detailUrl}"><h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><div id="description">Condition: Used</div><img src="/Pictures/detail-thumb.jpg"><span>Lot # 1 High Bid: $5.00</span></div>`);
  const detail = extractAuctionNinjaItemDetail(detailDoc, detailUrl);
  const merged = mergeAuctionNinjaItemDetail(catalog, detail);
  assert.equal(merged.physicalPhotoDescriptors?.length, 2);
  assert.equal(merged.physicalPhotoDescriptors?.every((item) => item.source === 'dom-gallery'), true);
});

test('canonical gallery audits remain explicitly unverified even with a complete-looking slot list', () => {
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${slot(2)}${slot(3)}</div>`)), saleUrl)[0]!;
  assert.equal(lot.photoAudit?.expectedCount, null);
  assert.equal(lot.photoAudit?.reconciled, false);
  assert.equal(lot.photoAudit?.verification, 'unverified');
  assert.equal(lot.photoAudit?.countSource, 'dom-gallery');
});

test('detail fallback adds newly discovered URLs to fallback descriptors', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card('', '<img src="/Pictures/card-thumb.jpg">')), saleUrl)[0]!;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><img src="/Pictures/detail-thumb.jpg"></div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.deepEqual(merged.physicalPhotoDescriptors?.map((photo) => photo.knownImageUrl), merged.images);
  assert.equal(merged.photoAudit?.knownImageCount, 2);
  assert.equal(merged.photoAudit?.observedCount, 0);
  assert.ok(merged.physicalPhotoDescriptors?.every((photo) => photo.fullResolutionUrl === null));
});

test('shorter detail galleries cannot discard earlier seller slots', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${slot(2)}${slot(3)}</div>`)), saleUrl)[0]!;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><div class="listicle-capterra-gallery">${slot(1)}</div></div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.physicalPhotoDescriptors?.length, 3);
  assert.equal(merged.photoAudit?.observedCount, 3);
  assert.equal(merged.photoAudit?.reconciled, false);
});

test('gallery merging preserves maximum duplicate occurrences and unmatched slots', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${slot(1)}${slot(2)}</div>`)), saleUrl)[0]!;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><div class="listicle-capterra-gallery">${slot(1)}${slot(3)}</div></div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.physicalPhotoDescriptors?.length, 4);
  assert.equal(merged.physicalPhotoDescriptors?.filter((photo) => photo.fullResolutionUrl?.endsWith('/photo-1.jpg')).length, 2);
  assert.ok(merged.physicalPhotoDescriptors?.some((photo) => photo.fullResolutionUrl?.endsWith('/photo-3.jpg')));
  assert.equal(merged.photoAudit?.expectedCount, null);
});

test('Milestone nested slider gallery exposes all originals without navigation mirrors', () => {
  const main = Array.from({ length: 18 }, (_, i) => slot(i + 1)).join('');
  const gallery = `<div class="listicle-capterra-gallery"><div id="aniimated-thumbnials" class="slider-for"><div class="slick-list"><div class="slick-track">${main}<div class="slick-cloned">${slot(99)}</div></div></div></div><div class="slider-nav">${slot(1)}${slot(2)}</div></div>`;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main">${gallery}</div>`);
  const detail = extractAuctionNinjaItemDetail(detailDoc, detailUrl)!;
  assert.equal(detail.physicalPhotoDescriptors?.length, 18);
  assert.ok(detail.physicalPhotoDescriptors?.every((photo) => photo.fullResolutionUrl));
  assert.equal(detail.photoAudit?.observedCount, 18);
});

test('blank image sources and seller-rating stars never become lot photos', () => {
  const extra = '<img src="" alt="AN"><img src="   "><img class="starimgcls" src="/images/star_100.png"><img src="/images/star_50.png"><img src="/Pictures/Star-Wars-toy.jpg">';
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card('', extra)), saleUrl)[0]!;
  assert.deepEqual(lot.images, ['https://www.auctionninja.com/Pictures/Star-Wars-toy.jpg']);
  assert.equal(lot.photoAudit?.knownImageCount, 1);
});

test('a provider box placeholder cannot displace the actual lot photo', () => {
  const extra = '<div class="gift-img"><img src="/clearinghouseestatesales/sales/details/images/box-img.png" alt="AN"></div>'
    + '<div class="hot-items-img"><img src="/Pictures/Thumbs/IMG_2736_copy_21_40908264_1789503855886.jpg" alt="Vintage Cocktail Glasses By Rosenthal"></div>';
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card('', extra)), saleUrl)[0]!;
  assert.equal(lot.image, 'https://www.auctionninja.com/Pictures/Thumbs/IMG_2736_copy_21_40908264_1789503855886.jpg');
  assert.deepEqual(lot.images, [lot.image]);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.knownImageUrl, lot.image);
});

test('Milestone blankwhite placeholder is not a seller photo', () => {
  const placeholder = '/milestone-estate-services-llc/sales/details/imagemy.php?src=blankwhite.jpg&w=348&h=257';
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card('', `<img src="${placeholder}">`)), saleUrl)[0]!;
  assert.deepEqual(lot.images, []);
  assert.deepEqual(lot.physicalPhotoDescriptors, []);
  assert.equal(lot.photoAudit?.knownImageCount, 0);
});

test('catalog excludes the root provider removed-image graphic but keeps seller media and product names', () => {
  const html = '<div class="search-catalog-item-box"><a href="/clearinghouseestatesales/product/fixture--2494589.html">Ninjaremoved piano</a>'
    + '<span>Lot # 1 Current Bid: $5.00</span>'
    + '<img src="/ninjaremoved.png"><img src="/Pictures/ninjaremoved-piano.jpg" alt="Ninjaremoved piano"></div>';
  const lot = extractAuctionNinjaCatalogLots(documentFrom(html), saleUrl)[0]!;
  assert.equal(lot.title, 'Ninjaremoved piano');
  assert.deepEqual(lot.images, ['https://www.auctionninja.com/Pictures/ninjaremoved-piano.jpg']);
  assert.equal(lot.physicalPhotoDescriptors?.[0]?.knownImageUrl, 'https://www.auctionninja.com/Pictures/ninjaremoved-piano.jpg');
});

test('detail keeps a provider removed-image slot unresolved while accepting a lazy seller photo', () => {
  const gallery = '<div class="listicle-capterra-gallery"><a href="/ninjaremoved.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/ninjaremoved.png" data-src="/Pictures/ninjaremoved-piano.jpg"></a></div>';
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Ninjaremoved piano</h1><div class="item-detail-main">${gallery}</div>`);
  const detail = extractAuctionNinjaItemDetail(detailDoc, detailUrl)!;
  assert.deepEqual(detail.images, ['https://www.auctionninja.com/Pictures/ninjaremoved-piano.jpg']);
  assert.deepEqual(detail.physicalPhotoDescriptors?.[0], {
    sellerOrdinal: 1, fullResolutionUrl: null,
    knownImageUrl: 'https://www.auctionninja.com/Pictures/ninjaremoved-piano.jpg',
    thumbnailUrl: 'https://www.auctionninja.com/Pictures/ninjaremoved-piano.jpg', source: 'dom-gallery',
  });
});

test('merge preserves unresolved provider slots conservatively without claiming alignment', () => {
  const placeholder = '<div class="listicle-capterra-gallery"><a href="/ninjaremoved.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/ninjaremoved.png"></a></div>';
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(placeholder)), saleUrl)[0]!;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main">${placeholder}</div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.physicalPhotoDescriptors?.length, 2);
  assert.ok(merged.physicalPhotoDescriptors?.every((photo) => photo.knownImageUrl === ''));
  assert.equal(merged.photoAudit?.knownImageCount, 0);
  assert.equal(merged.photoAudit?.verification, 'unverified');
});

test('merge keeps unknown slots when catalog and detail galleries are disjoint', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${slot(1)}${slot(2)}</div>`)), saleUrl)[0]!;
  const gallery = '<div class="listicle-capterra-gallery"><a href="/ninjaremoved.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/ninjaremoved.png"></a>'
    + `${slot(3, 'https://images.example/detail-c.jpg')}`
    + '</div>';
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main">${gallery}</div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.physicalPhotoDescriptors?.length, 4);
  assert.ok(merged.physicalPhotoDescriptors?.some((photo) => photo.knownImageUrl === ''));
  assert.equal(merged.photoAudit?.knownImageCount, 3);
});

test('merge does not replace an unresolved catalog slot when detail has unrelated known photos', () => {
  const unresolved = '<a href="/ninjaremoved.png" class="listicle-capterra-gallery-sing"><img src="/ninjaremoved.png"></a>';
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card(`<div class="listicle-capterra-gallery">${unresolved}${slot(2)}${slot(3)}</div>`)), saleUrl)[0]!;
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main"><div class="listicle-capterra-gallery">${slot(1, 'https://images.example/detail-a.jpg')}${slot(2, 'https://images.example/detail-d.jpg')}</div></div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.physicalPhotoDescriptors?.length, 5);
  assert.equal(merged.physicalPhotoDescriptors?.[0]?.knownImageUrl, '');
  assert.equal(merged.photoAudit?.knownImageCount, 4);
});

test('gallery descriptors prefer a lazy seller photo over a provider placeholder', () => {
  const gallery = '<div class="listicle-capterra-gallery"><a href="/sales/details/images/box-img.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/sales/details/images/box-img.png" data-src="/Pictures/actual.jpg"></a></div>';
  const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
  assert.equal(lot.image, 'https://www.auctionninja.com/Pictures/actual.jpg');
  assert.deepEqual(lot.images, [lot.image]);
  assert.deepEqual(lot.physicalPhotoDescriptors?.[0], {
    sellerOrdinal: 1, fullResolutionUrl: null, knownImageUrl: lot.image,
    thumbnailUrl: lot.image, source: 'dom-gallery',
  });
});

test('detail gallery retains an unloaded seller slot without presenting its placeholder as a photo', () => {
  const gallery = '<div class="listicle-capterra-gallery"><a href="/sales/details/images/box-img.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/sales/details/images/box-img.png"></a></div>';
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main">${gallery}</div>`);
  const detail = extractAuctionNinjaItemDetail(detailDoc, detailUrl)!;
  assert.equal(detail.physicalPhotoDescriptors?.[0]?.sellerOrdinal, 1);
  assert.equal(detail.physicalPhotoDescriptors?.[0]?.fullResolutionUrl, null);
  assert.equal(detail.physicalPhotoDescriptors?.[0]?.knownImageUrl, '');
  assert.equal(detail.physicalPhotoDescriptors?.[0]?.thumbnailUrl, null);
  assert.equal(detail.photoAudit?.observedCount, 1);
  assert.equal(detail.photoAudit?.knownImageCount, 0);
});

test('detail merge does not count an unresolved seller slot as a known image', () => {
  const catalog = extractAuctionNinjaCatalogLots(documentFrom(card('')), saleUrl)[0]!;
  const gallery = '<div class="listicle-capterra-gallery"><a href="/sales/details/images/box-img.png" class="listicle-capterra-gallery-sing">'
    + '<img src="/sales/details/images/box-img.png"></a></div>';
  const detailDoc = documentFrom(`<h1 class="item-detail-box-title">Fixture item</h1><div class="item-detail-main">${gallery}</div>`);
  const merged = mergeAuctionNinjaItemDetail(catalog, extractAuctionNinjaItemDetail(detailDoc, detailUrl));
  assert.equal(merged.photoAudit?.observedCount, 1);
  assert.equal(merged.photoAudit?.knownImageCount, 0);
  assert.equal(merged.physicalPhotoDescriptors?.[0]?.knownImageUrl, '');
});

test('whitespace gallery src cannot hide a real lazy thumbnail or become the page URL', () => {
  for (const source of ['data-src="/Pictures/actual.jpg"', 'srcset="/Pictures/actual.jpg 1280w"']) {
    const gallery = `<div class="listicle-capterra-gallery"><a href=" " class="listicle-capterra-gallery-sing"><img src="   " ${source}></a></div>`;
    const lot = extractAuctionNinjaCatalogLots(documentFrom(card(gallery)), saleUrl)[0]!;
    assert.equal(lot.physicalPhotoDescriptors?.[0]?.knownImageUrl, 'https://www.auctionninja.com/Pictures/actual.jpg');
    assert.equal(lot.physicalPhotoDescriptors?.[0]?.thumbnailUrl, 'https://www.auctionninja.com/Pictures/actual.jpg');
    assert.equal(lot.physicalPhotoDescriptors?.[0]?.fullResolutionUrl, null);
  }
});
