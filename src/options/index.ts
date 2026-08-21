import { getSyncStorage, setSyncStorage } from '../core/browser.js';
import { normalizeSettings } from '../core/settings.js';

const app = document.querySelector<HTMLElement>('#app')!;
const states = ['', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function replaceMarkup(target: Element, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  target.replaceChildren(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)));
}

async function init(): Promise<void> {
  const settings = normalizeSettings(await getSyncStorage());
  const markup = `<header class="header"><div class="brand">Flippah by ALOS</div><div class="subtitle">True cost, research, watchlist, and HiBid export settings.</div></header><form id="settings-form"><section class="section"><h2>Purchase costs</h2><div class="grid"><label>Tax state<select name="stateCode">${states.map((state) => `<option value="${state}" ${settings.stateCode === state ? 'selected' : ''}>${state || 'No state selected'}</option>`).join('')}</select></label><label>Tax override (%)<input name="taxPctOverride" type="number" min="0" max="20" step="0.01" value="${settings.taxPctOverride ?? ''}"></label><label>eBay fee (%)<input name="ebayFeePct" type="number" min="0" max="40" step="0.01" value="${settings.ebayFeePct}"></label><label>eBay fixed fee (cents)<input name="ebayFeeFixedCents" type="number" min="0" max="1000" step="1" value="${settings.ebayFeeFixedCents}"></label></div><p><label class="check"><input name="taxOnPremium" type="checkbox" ${settings.taxOnPremium ? 'checked' : ''}>Apply tax to buyer premium</label></p><p><label class="check"><input name="taxExempt" type="checkbox" ${settings.taxExempt ? 'checked' : ''}>Tax-exempt purchases</label></p></section><section class="section"><h2>HiBid behavior</h2><p><label class="check"><input name="catalogChips" type="checkbox" ${settings.catalogChips ? 'checked' : ''}>Show true-cost chips on catalog tiles</label></p><p><label class="check"><input name="nativeWatchSync" type="checkbox" ${settings.nativeWatchSync ? 'checked' : ''}>Mirror native HiBid watch actions into Flippah</label></p><p><label class="check"><input name="includePrivateWatchNotes" type="checkbox" ${settings.includePrivateWatchNotes ? 'checked' : ''}>Include private watch notes in exports</label></p></section><section class="section"><h2>Research defaults</h2><div class="grid"><label>Origin label<input name="originLabel" value="${escapeHtml(settings.originLabel)}"></label><label>Origin ZIP<input name="originZip" inputmode="numeric" value="${escapeHtml(settings.originZip)}"></label><label>Radius (miles)<input name="radiusMiles" type="number" min="1" max="500" value="${settings.radiusMiles}"></label></div><label style="margin-top:14px">Additional LLM instructions<textarea name="customInstructions">${escapeHtml(settings.customInstructions)}</textarea></label></section><section class="section"><h2>Diagnostics</h2><label class="check"><input name="debugMode" type="checkbox" ${settings.debugMode ? 'checked' : ''}>Enable verbose Flippah diagnostics</label></section><div class="actions"><button type="submit">Save settings</button><span id="status" role="status"></span></div></form>`;
  replaceMarkup(app, markup);
  document.querySelector<HTMLFormElement>('#settings-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const checkbox = (name: string) => Boolean(document.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked);
    const number = (name: string) => { const value = String(form.get(name) || '').trim(); return value ? Number(value) : null; };
    const next = normalizeSettings({
      stateCode: String(form.get('stateCode') || '') || null,
      taxPctOverride: number('taxPctOverride'), taxOnPremium: checkbox('taxOnPremium'), taxExempt: checkbox('taxExempt'),
      ebayFeePct: number('ebayFeePct'), ebayFeeFixedCents: number('ebayFeeFixedCents'),
      catalogChips: checkbox('catalogChips'), nativeWatchSync: checkbox('nativeWatchSync'),
      includePrivateWatchNotes: checkbox('includePrivateWatchNotes'), debugMode: checkbox('debugMode'),
      originLabel: String(form.get('originLabel') || ''), originZip: String(form.get('originZip') || ''),
      radiusMiles: number('radiusMiles'), customInstructions: String(form.get('customInstructions') || '')
    });
    await setSyncStorage(next as unknown as Record<string, unknown>);
    const status = document.querySelector<HTMLElement>('#status')!;
    status.textContent = 'Saved'; window.setTimeout(() => { status.textContent = ''; }, 1800);
  });
}

void init();
