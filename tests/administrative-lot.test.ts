import assert from 'node:assert/strict';
import test from 'node:test';
import { nonMerchandiseNoticeReason } from '../src/intelligence/administrative-lot.js';

test('photo-free auction notices need affirmative notice evidence', () => {
  assert.match(nonMerchandiseNoticeReason(
    'Welcome to the Equipment Auction',
    'Welcome to the Equipment Online Only Auction. Review the Terms & Conditions before bidding.',
    0,
  ) || '', /Auction introduction/);
  assert.match(nonMerchandiseNoticeReason('PICK UP IS TUESDAY AFTER CLOSE OF SALE', '', 0) || '', /Pickup instructions/);
  assert.match(nonMerchandiseNoticeReason('3RD PARTY SHIPPING OFFERED', '', 0) || '', /Shipping instructions/);
});

test('merchandise descriptions override notice-like titles when photos are absent', () => {
  assert.equal(nonMerchandiseNoticeReason(
    'Welcome to the jungle framed poster',
    'Framed vintage poster, 24 by 36 inches.',
    0,
  ), null);
  assert.equal(nonMerchandiseNoticeReason(
    'Pick up is here sign',
    'Vintage metal sign, 12 by 18 inches.',
    0,
  ), null);
  assert.equal(nonMerchandiseNoticeReason(
    '3rd Party Shipping Offered sign',
    'Painted novelty sign.',
    0,
  ), null);
  assert.equal(nonMerchandiseNoticeReason('Welcome to the Equipment Auction', '', null), null);
});

test('McAllen bidding instructions with one notice graphic are not merchandise', () => {
  const title = 'YOU ARE BIDDING IN THE MCALLEN AUCTION';
  const description = 'Checkouts and Pickups are at the FRONT of the Warehouse. Register for upcoming auctions and receive text notifications.';
  assert.match(nonMerchandiseNoticeReason(title, description, 1) || '', /logistics notice/);
  assert.equal(nonMerchandiseNoticeReason(title, 'Vintage printed auction sign, framed for display.', 1), null);
  assert.equal(nonMerchandiseNoticeReason(title, description, 2), null);
});

test('Spanish auction terms with one notice graphic are not merchandise', () => {
  const title = 'EN ESPANOL: POR FAVOR LEER ANTES DE OFERTAR';
  const description = 'Al participar en esta subasta, usted acepta estos terminos. Pagos: tarjeta. Recogidas: en el almacen.';
  assert.match(nonMerchandiseNoticeReason(title, description, 1) || '', /Spanish auction terms/);
  assert.equal(nonMerchandiseNoticeReason(title, 'Vintage printed Spanish auction sign, framed.', 1), null);
  assert.equal(nonMerchandiseNoticeReason(title, description, 2), null);
});

test('McAllen promotion and fulfillment graphics do not enter product research', () => {
  const placeholder = 'Condition: New(other)\nDamaged?: No\nIn Packaging?: Yes\nUPC: NOUPC{19601911}';
  assert.match(nonMerchandiseNoticeReason('SPI Simply Bueno Deals!', placeholder, 1) || '', /promotion or fulfillment/);
  assert.match(nonMerchandiseNoticeReason('Fullfillment Center at Simply Bueno', placeholder, 1) || '', /promotion or fulfillment/);
  assert.equal(nonMerchandiseNoticeReason('SPI Simply Bueno Deals!', `${placeholder}\nTitle: Vintage printed store flyer`, 1), null);
  assert.equal(nonMerchandiseNoticeReason('Fullfillment Center at Simply Bueno', placeholder, 2), null);
});

test('shipping notices require the actual notice text, not merchandise with shipping terms', () => {
  const notice = 'Condition: New\nUPC: NOUPC{20461735}\nTitle: Shipping Available!\n\nIf shipping is requested, shipping and handling costs will be charged when items are packed.';
  assert.match(nonMerchandiseNoticeReason('Shipping Available!', notice, 1) || '', /Shipping notice/);
  assert.equal(nonMerchandiseNoticeReason('Shipping Available!', 'Vintage porcelain vase. Shipping available at buyer cost.', 1), null);
  assert.equal(nonMerchandiseNoticeReason('Shipping Available!', `${notice}\nVintage porcelain vase.`, 1), null);
});
