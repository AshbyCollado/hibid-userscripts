import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { hibidFullSizeImageUrl, installHibidImagePreview } from '../src/content/image-preview.js';

test('HiBid full-size image URL removes only the appended thumbnail dimensions', () => {
  const thumbnail = 'https://media.sandhills.com/img.axd?id=7012043483&wid=&w=0&h=0&sz=Max&checksum=abc&h=200&w=200';
  const full = hibidFullSizeImageUrl(thumbnail);
  assert.match(full, /w=0&h=0/);
  assert.doesNotMatch(full, /h=200&w=200/);
  assert.equal(hibidFullSizeImageUrl('javascript:alert(1)'), '');
});

test('image preview mounts for canonical lot images and can be disabled without changing page layout', () => {
  const dom = new JSDOM(`<body><app-lot-tile id="lot-1"><img id="photo" src="https://media.sandhills.com/img.axd?id=1&amp;w=0&amp;h=0&amp;h=200&amp;w=200"></app-lot-tile></body>`, {
    url: 'https://hibid.com/catalog/99/example', pretendToBeVisual: true,
  });
  const previous = (globalThis as any).HTMLImageElement;
  (globalThis as any).HTMLImageElement = dom.window.HTMLImageElement;
  try {
    const controller = installHibidImagePreview(dom.window.document, dom.window as unknown as Window, true);
    const image = dom.window.document.querySelector<HTMLImageElement>('#photo')!;
    image.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 80 }));
    const preview = dom.window.document.querySelector<HTMLElement>('#flippah-fullsize-image-preview')!;
    assert.equal(preview.dataset.visible, 'true');
    assert.doesNotMatch(preview.querySelector('img')!.src, /h=200&w=200/);
    assert.equal(image.parentElement?.tagName, 'APP-LOT-TILE');
    controller.setEnabled(false);
    assert.equal(preview.dataset.visible, 'false');
    controller.destroy();
    assert.equal(dom.window.document.querySelector('#flippah-fullsize-image-preview'), null);
  } finally {
    (globalThis as any).HTMLImageElement = previous;
    dom.window.close();
  }
});
