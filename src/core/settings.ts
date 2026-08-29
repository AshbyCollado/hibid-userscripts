export interface ResearchSettings {
  originLabel: string;
  originZip: string;
  radiusMiles: number;
  targetProfitUsd: number;
  minimumRoiPct: number;
  defaultBuyerPremiumPct: number | null;
  soldCompTarget: number;
  auctionPaymentMethod: 'unspecified' | 'card' | 'cash' | 'check';
  outboundShippingUsd: number;
  packingReserveUsd: number;
  promotedListingPct: number;
  returnReservePct: number;
  bulkyItemProfitUsd: number | null;
  resaleChannels: string;
  transportDescription: string;
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
  fullSizeImageHover: boolean;
}

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  originLabel: '',
  originZip: '',
  radiusMiles: 100,
  targetProfitUsd: 50,
  minimumRoiPct: 30,
  defaultBuyerPremiumPct: null,
  soldCompTarget: 5,
  auctionPaymentMethod: 'unspecified',
  outboundShippingUsd: 0,
  packingReserveUsd: 0,
  promotedListingPct: 0,
  returnReservePct: 0,
  bulkyItemProfitUsd: null,
  resaleChannels: 'eBay',
  transportDescription: '',
  customInstructions: ''
};

export const DEFAULT_SETTINGS: FlippahSettings = {
  ...DEFAULT_RESEARCH_SETTINGS,
  stateCode: null,
  taxPctOverride: null,
  taxOnPremium: true,
  ebayFeePct: 13.25,
  ebayFeeFixedCents: 30,
  catalogChips: false,
  nativeWatchSync: false,
  taxExempt: false,
  debugMode: false,
  includePrivateWatchNotes: false,
  amazonAutoLookup: true,
  retailTargetPct: 50,
  retailWarningPct: 25,
  fullSizeImageHover: true
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
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSettings(value: unknown): FlippahSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const stateCode = typeof source.stateCode === 'string' ? source.stateCode.trim().toUpperCase() : '';
  const taxPctOverride = finite(source.taxPctOverride);
  const defaultBuyerPremiumPct = finite(source.defaultBuyerPremiumPct);
  const bulkyItemProfitUsd = finite(source.bulkyItemProfitUsd);
  const paymentMethod = typeof source.auctionPaymentMethod === 'string' ? source.auctionPaymentMethod.trim().toLowerCase() : '';
  return {
    stateCode: stateCode && Object.hasOwn(US_STATE_TAX_RATES, stateCode) ? stateCode : null,
    taxPctOverride: taxPctOverride === null ? null : clamp(taxPctOverride, 0, 20),
    taxOnPremium: typeof source.taxOnPremium === 'boolean' ? source.taxOnPremium : true,
    ebayFeePct: clamp(finite(source.ebayFeePct) ?? DEFAULT_SETTINGS.ebayFeePct, 0, 40),
    ebayFeeFixedCents: Math.round(clamp(finite(source.ebayFeeFixedCents) ?? DEFAULT_SETTINGS.ebayFeeFixedCents, 0, 1000)),
    catalogChips: false,
    nativeWatchSync: typeof source.nativeWatchSync === 'boolean' ? source.nativeWatchSync : false,
    taxExempt: typeof source.taxExempt === 'boolean' ? source.taxExempt : false,
    debugMode: typeof source.debugMode === 'boolean' ? source.debugMode : false,
    includePrivateWatchNotes: typeof source.includePrivateWatchNotes === 'boolean' ? source.includePrivateWatchNotes : false,
    amazonAutoLookup: typeof source.amazonAutoLookup === 'boolean' ? source.amazonAutoLookup : true,
    retailTargetPct: clamp(finite(source.retailTargetPct) ?? DEFAULT_SETTINGS.retailTargetPct, 1, 95),
    retailWarningPct: clamp(finite(source.retailWarningPct) ?? DEFAULT_SETTINGS.retailWarningPct, 1, 95),
    fullSizeImageHover: typeof source.fullSizeImageHover === 'boolean' ? source.fullSizeImageHover : true,
    originLabel: typeof source.originLabel === 'string' ? source.originLabel.trim().slice(0, 120) : DEFAULT_SETTINGS.originLabel,
    originZip: typeof source.originZip === 'string' ? source.originZip.trim().slice(0, 20) : DEFAULT_SETTINGS.originZip,
    radiusMiles: Math.round(clamp(finite(source.radiusMiles) ?? DEFAULT_SETTINGS.radiusMiles, 1, 500)),
    targetProfitUsd: clamp(finite(source.targetProfitUsd) ?? DEFAULT_SETTINGS.targetProfitUsd, 0, 100_000),
    minimumRoiPct: clamp(finite(source.minimumRoiPct) ?? DEFAULT_SETTINGS.minimumRoiPct, 0, 1_000),
    defaultBuyerPremiumPct: defaultBuyerPremiumPct === null ? null : clamp(defaultBuyerPremiumPct, 0, 50),
    soldCompTarget: Math.round(clamp(finite(source.soldCompTarget) ?? DEFAULT_SETTINGS.soldCompTarget, 1, 10)),
    auctionPaymentMethod: paymentMethod === 'card' || paymentMethod === 'cash' || paymentMethod === 'check' ? paymentMethod : 'unspecified',
    outboundShippingUsd: clamp(finite(source.outboundShippingUsd) ?? DEFAULT_SETTINGS.outboundShippingUsd, 0, 10_000),
    packingReserveUsd: clamp(finite(source.packingReserveUsd) ?? DEFAULT_SETTINGS.packingReserveUsd, 0, 10_000),
    promotedListingPct: clamp(finite(source.promotedListingPct) ?? DEFAULT_SETTINGS.promotedListingPct, 0, 40),
    returnReservePct: clamp(finite(source.returnReservePct) ?? DEFAULT_SETTINGS.returnReservePct, 0, 100),
    bulkyItemProfitUsd: bulkyItemProfitUsd === null ? null : clamp(bulkyItemProfitUsd, 0, 100_000),
    resaleChannels: typeof source.resaleChannels === 'string' && source.resaleChannels.trim()
      ? source.resaleChannels.trim().slice(0, 240)
      : DEFAULT_SETTINGS.resaleChannels,
    transportDescription: typeof source.transportDescription === 'string' ? source.transportDescription.trim().slice(0, 600) : '',
    customInstructions: typeof source.customInstructions === 'string' ? source.customInstructions.trim().slice(0, 4000) : ''
  };
}
