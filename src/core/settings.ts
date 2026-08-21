export interface ResearchSettings {
  originLabel: string;
  originZip: string;
  radiusMiles: number;
  customInstructions: string;
}

export interface FlippahSettings extends ResearchSettings {
  stateCode: string | null;
  taxPctOverride: number | null;
  taxOnPremium: boolean;
  ebayFeePct: number;
  ebayFeeFixedCents: number;
  catalogChips: boolean;
  nativeWatchSync: boolean;
  taxExempt: boolean;
  debugMode: boolean;
  includePrivateWatchNotes: boolean;
  amazonAutoLookup: boolean;
  retailTargetPct: number;
  retailWarningPct: number;
}

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  originLabel: 'Edison, NJ',
  originZip: '08817',
  radiusMiles: 100,
  customInstructions: ''
};

export const DEFAULT_SETTINGS: FlippahSettings = {
  ...DEFAULT_RESEARCH_SETTINGS,
  stateCode: null,
  taxPctOverride: null,
  taxOnPremium: true,
  ebayFeePct: 13.25,
  ebayFeeFixedCents: 30,
  catalogChips: true,
  nativeWatchSync: false,
  taxExempt: false,
  debugMode: false,
  includePrivateWatchNotes: false,
  amazonAutoLookup: true,
  retailTargetPct: 50,
  retailWarningPct: 25
};

export const US_STATE_TAX_RATES: Readonly<Record<string, number>> = {
  AL:9.46, AK:1.82, AZ:8.52, AR:9.46, CA:8.99, CO:7.89, CT:6.35, DE:0, DC:6,
  FL:6.98, GA:7.49, HI:4.5, ID:6.03, IL:8.96, IN:7, IA:6.94, KS:8.69, KY:6,
  LA:10.11, ME:5.5, MD:6, MA:6.25, MI:6, MN:8.14, MS:7, MO:8.69, MT:0,
  NE:6.95, NV:8.23, NH:0, NJ:6.6, NM:7.62, NY:8.53, NC:7, ND:7.04,
  OH:7.24, OK:8.99, OR:0, PA:6.34, RI:7, SC:7.49, SD:6.11, TN:9.55,
  TX:8.2, UT:7.19, VT:6.36, VA:5.77, WA:9.4, WV:6.57, WI:5.7, WY:5.44
};

export function effectiveTaxPct(settings: Pick<FlippahSettings, 'stateCode' | 'taxPctOverride' | 'taxExempt'>): number {
  if (settings.taxExempt) return 0;
  if (settings.taxPctOverride !== null && Number.isFinite(settings.taxPctOverride)) return settings.taxPctOverride;
  return settings.stateCode ? US_STATE_TAX_RATES[settings.stateCode] ?? 0 : 0;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function normalizeSettings(value: unknown): FlippahSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    stateCode: typeof source.stateCode === 'string' && source.stateCode ? source.stateCode : null,
    taxPctOverride: finite(source.taxPctOverride),
    taxOnPremium: typeof source.taxOnPremium === 'boolean' ? source.taxOnPremium : true,
    ebayFeePct: finite(source.ebayFeePct) ?? DEFAULT_SETTINGS.ebayFeePct,
    ebayFeeFixedCents: finite(source.ebayFeeFixedCents) ?? DEFAULT_SETTINGS.ebayFeeFixedCents,
    catalogChips: typeof source.catalogChips === 'boolean' ? source.catalogChips : true,
    nativeWatchSync: typeof source.nativeWatchSync === 'boolean' ? source.nativeWatchSync : false,
    taxExempt: typeof source.taxExempt === 'boolean' ? source.taxExempt : false,
    debugMode: typeof source.debugMode === 'boolean' ? source.debugMode : false,
    includePrivateWatchNotes: typeof source.includePrivateWatchNotes === 'boolean' ? source.includePrivateWatchNotes : false,
    amazonAutoLookup: typeof source.amazonAutoLookup === 'boolean' ? source.amazonAutoLookup : true,
    retailTargetPct: Math.max(1, Math.min(95, finite(source.retailTargetPct) ?? DEFAULT_SETTINGS.retailTargetPct)),
    retailWarningPct: Math.max(1, Math.min(95, finite(source.retailWarningPct) ?? DEFAULT_SETTINGS.retailWarningPct)),
    originLabel: typeof source.originLabel === 'string' && source.originLabel.trim() ? source.originLabel.trim() : DEFAULT_SETTINGS.originLabel,
    originZip: typeof source.originZip === 'string' && source.originZip.trim() ? source.originZip.trim() : DEFAULT_SETTINGS.originZip,
    radiusMiles: Math.max(1, Math.min(500, finite(source.radiusMiles) ?? DEFAULT_SETTINGS.radiusMiles)),
    customInstructions: typeof source.customInstructions === 'string' ? source.customInstructions.trim() : ''
  };
}
