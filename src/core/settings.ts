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
  includePrivateWatchNotes: false
};

function finite(value: unknown): number | null {
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
    originLabel: typeof source.originLabel === 'string' && source.originLabel.trim() ? source.originLabel.trim() : DEFAULT_SETTINGS.originLabel,
    originZip: typeof source.originZip === 'string' && source.originZip.trim() ? source.originZip.trim() : DEFAULT_SETTINGS.originZip,
    radiusMiles: Math.max(1, Math.min(500, finite(source.radiusMiles) ?? DEFAULT_SETTINGS.radiusMiles)),
    customInstructions: typeof source.customInstructions === 'string' ? source.customInstructions.trim() : ''
  };
}
