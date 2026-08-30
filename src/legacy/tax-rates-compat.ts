type SettingsState = {
  stateCode: string | null;
  taxPctOverride: number | null;
  taxOnPremium: boolean;
  ebayFeePct: number;
  ebayFeeFixedCents: number;
  catalogChips: boolean;
  licenseKey: string | null;
  nativeWatchSync: boolean;
  taxExempt: boolean;
};

const defaults: SettingsState = {
  stateCode: null, taxPctOverride: null, taxOnPremium: true,
  ebayFeePct: 13.25, ebayFeeFixedCents: 30, catalogChips: true,
  licenseKey: null, nativeWatchSync: false, taxExempt: false
};

const localDefaults = {
  premiums: {}, watchlist: {}, license: { status: 'free', checkedAt: 0 }, remoteSelectors: null
};

const states: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
};

const taxRates: Record<string, number> = {
  AL:9.46,AK:1.82,AZ:8.52,AR:9.46,CA:8.99,CO:7.89,CT:6.35,DE:0,DC:6,FL:6.98,GA:7.49,HI:4.5,ID:6.03,IL:8.96,IN:7,IA:6.94,KS:8.69,KY:6,LA:10.11,ME:5.5,MD:6,MA:6.25,MI:6,MN:8.14,MS:7,MO:8.69,MT:0,NE:6.95,NV:8.23,NH:0,NJ:6.6,NM:7.62,NY:8.53,NC:7,ND:7.04,OH:7.24,OK:8.99,OR:0,PA:6.34,RI:7,SC:7.49,SD:6.11,TN:9.55,TX:8.2,UT:7.19,VT:6.36,VA:5.77,WA:9.4,WV:6.57,WI:5.7,WY:5.44
};

function object(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalize(value: unknown): SettingsState {
  const source = object(value) ? value : {};
  return {
    stateCode: typeof source.stateCode === 'string' ? source.stateCode : defaults.stateCode,
    taxPctOverride: finite(source.taxPctOverride),
    taxOnPremium: typeof source.taxOnPremium === 'boolean' ? source.taxOnPremium : defaults.taxOnPremium,
    ebayFeePct: finite(source.ebayFeePct) ?? defaults.ebayFeePct,
    ebayFeeFixedCents: finite(source.ebayFeeFixedCents) ?? defaults.ebayFeeFixedCents,
    catalogChips: typeof source.catalogChips === 'boolean' ? source.catalogChips : defaults.catalogChips,
    licenseKey: typeof source.licenseKey === 'string' ? source.licenseKey : defaults.licenseKey,
    nativeWatchSync: typeof source.nativeWatchSync === 'boolean' ? source.nativeWatchSync : defaults.nativeWatchSync,
    taxExempt: typeof source.taxExempt === 'boolean' ? source.taxExempt : defaults.taxExempt
  };
}

function syncGet(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => chrome.storage.sync.get(null, (value) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}

function syncSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => chrome.storage.sync.set(value, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

function localGet(): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => chrome.storage.local.get(null, (value) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}

function localSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => chrome.storage.local.set(value, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

async function getSettings(): Promise<SettingsState> { return normalize(await syncGet()); }
async function saveSettings(patch: Partial<SettingsState>): Promise<SettingsState> {
  const next = normalize({ ...await getSettings(), ...patch });
  await syncSet(next as unknown as Record<string, unknown>);
  return next;
}
async function getLocalState(): Promise<any> {
  const value = await localGet();
  return {
    premiums: object(value.premiums) ? value.premiums : {},
    watchlist: object(value.watchlist) ? value.watchlist : {},
    license: object(value.license) ? value.license : { ...localDefaults.license },
    remoteSelectors: value.remoteSelectors ?? null
  };
}
async function setLocalState(value: Record<string, unknown>): Promise<void> { await localSet(value); }
async function getPremium(key: string): Promise<any> { return (await getLocalState()).premiums[key] ?? null; }
async function setPremium(key: string, premium: unknown): Promise<void> {
  const { premiums } = await getLocalState();
  await localSet({ premiums: { ...premiums, [key]: premium } });
}
async function listWatchlist(): Promise<any[]> { return Object.values((await getLocalState()).watchlist); }
async function addWatch(lot: any): Promise<void> {
  const { watchlist } = await getLocalState();
  await localSet({ watchlist: { ...watchlist, [lot.lotId]: lot } });
}
async function removeWatch(lotId: string): Promise<void> {
  const { watchlist } = await getLocalState();
  const next = { ...watchlist };
  delete next[lotId];
  await localSet({ watchlist: next });
}
function taxRate(stateCode: string | null): number { return stateCode && Object.hasOwn(states, stateCode) ? taxRates[stateCode] ?? 0 : 0; }

export {
  getPremium as a,
  removeWatch as c,
  saveSettings as d,
  addWatch as f,
  getLocalState as i,
  setLocalState as l,
  taxRate as n,
  getSettings as o,
  defaults as r,
  listWatchlist as s,
  states as t,
  setPremium as u
};
