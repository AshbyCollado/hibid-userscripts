const PREVIEW_ID = 'flippah-fullsize-image-preview';
const STYLE_ID = 'flippah-fullsize-image-preview-style';

export interface HibidImagePreviewController {
  destroy(): void;
  setEnabled(enabled: boolean): void;
}

export function hibidFullSizeImageUrl(value: string, base = 'https://hibid.com/'): string {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:') return '';
    if (/\/img\.axd$/i.test(url.pathname) && /(?:^|&)h=\d+&w=\d+(?:&|$)/i.test(url.search.slice(1))) {
      url.search = url.search.replace(/&h=\d+&w=\d+(?=&|$)/gi, '');
    }
    return url.href;
  } catch {
    return '';
  }
}

function lotImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof HTMLImageElement)) return null;
  if (target.closest(`#${PREVIEW_ID}, [data-flippah-owned="true"]`)) return null;
  return target.closest([
    'app-lot-tile[id^="lot-"]',
    '.bid-status-border[id^="lot-"]',
    '[data-event-item-id]',
    'app-lot-images',
    'app-image-gallery',
    '.lot-images',
    '[class*="lot-image"]',
    '[class*="gallery"]',
    '.carousel',
  ].join(',')) ? target : null;
}

export function installHibidImagePreview(
  root: Document = document,
  view: Window = window,
  initiallyEnabled = true,
): HibidImagePreviewController {
  let enabled = initiallyEnabled;
  let activeSource: HTMLImageElement | null = null;

  const style = root.createElement('style');
  style.id = STYLE_ID;
  style.dataset.flippahOwned = 'true';
  style.textContent = `
    #${PREVIEW_ID}{position:fixed;z-index:2147483646;display:none;pointer-events:none;max-width:min(520px,calc(100vw - 32px));max-height:min(70vh,620px);padding:7px;border:1px solid rgba(15,23,42,.28);border-radius:8px;background:#fff;box-shadow:0 16px 44px rgba(15,23,42,.34)}
    #${PREVIEW_ID}[data-visible="true"]{display:block}
    #${PREVIEW_ID} img{display:block;width:auto;height:auto;max-width:min(504px,calc(100vw - 48px));max-height:calc(min(70vh,620px) - 14px);object-fit:contain;background:#f8fafc}
  `;
  const preview = root.createElement('div');
  preview.id = PREVIEW_ID;
  preview.dataset.flippahOwned = 'true';
  preview.setAttribute('aria-hidden', 'true');
  const previewImage = root.createElement('img');
  previewImage.alt = '';
  preview.append(previewImage);
  (root.head || root.documentElement).append(style);
  (root.body || root.documentElement).append(preview);

  const hide = () => {
    activeSource = null;
    preview.dataset.visible = 'false';
    previewImage.removeAttribute('src');
  };
  const place = (x: number, y: number) => {
    const gap = 18;
    const width = Math.min(520, Math.max(240, view.innerWidth - 32));
    const height = Math.min(620, Math.max(240, view.innerHeight * 0.7));
    let left = x + gap;
    let top = y + gap;
    if (left + width > view.innerWidth - 8) left = Math.max(8, x - width - gap);
    if (top + height > view.innerHeight - 8) top = Math.max(8, view.innerHeight - height - 8);
    preview.style.left = `${Math.round(left)}px`;
    preview.style.top = `${Math.round(top)}px`;
  };
  const show = (source: HTMLImageElement, x: number, y: number) => {
    if (!enabled) return;
    const current = source.currentSrc || source.src || source.getAttribute('data-src') || source.getAttribute('data-lazy-src') || '';
    const fullSize = hibidFullSizeImageUrl(current, root.location?.href || 'https://hibid.com/');
    if (!fullSize) return;
    activeSource = source;
    source.dataset.flippahFullsize = fullSize;
    previewImage.src = fullSize;
    preview.dataset.visible = 'true';
    place(x, y);
  };
  const mouseOver = (event: MouseEvent) => {
    const source = lotImage(event.target);
    if (source) show(source, event.clientX, event.clientY);
  };
  const mouseMove = (event: MouseEvent) => {
    if (activeSource) place(event.clientX, event.clientY);
  };
  const mouseOut = (event: MouseEvent) => {
    if (activeSource && event.target === activeSource && event.relatedTarget !== activeSource) hide();
  };
  const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
  const scroll = () => hide();
  previewImage.addEventListener('error', hide);
  root.addEventListener('mouseover', mouseOver, true);
  root.addEventListener('mousemove', mouseMove, true);
  root.addEventListener('mouseout', mouseOut, true);
  root.addEventListener('keydown', keyDown, true);
  view.addEventListener('scroll', scroll, true);

  return {
    destroy() {
      hide();
      root.removeEventListener('mouseover', mouseOver, true);
      root.removeEventListener('mousemove', mouseMove, true);
      root.removeEventListener('mouseout', mouseOut, true);
      root.removeEventListener('keydown', keyDown, true);
      view.removeEventListener('scroll', scroll, true);
      preview.remove();
      style.remove();
    },
    setEnabled(next) {
      enabled = next;
      if (!enabled) hide();
    },
  };
}
