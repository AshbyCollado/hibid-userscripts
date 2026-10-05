// The legacy bundle's money module is intentionally tiny; this wrapper keeps its
// validation and rounding behavior while adding the separately sourced fee.
// @ts-expect-error The reference build has no TypeScript declarations by design.
import { a as originalParse, i as originalInverse, n as originalForward, r as originalFormat, t as originalProfit } from '../../reference-build/flippah-v0.1.0/assets/money-ip6lU9wJ.js';

type FeeInput = { premiumPct: number; taxPct: number; shipCents: number; taxOnPremium: boolean; fixedFeeCents?: number };
type CostInput = FeeInput & { bidCents: number };
type CostResult = { bidCents: number; premiumCents: number; taxableCents: number; taxCents: number; shipCents: number; trueCostCents: number };
type ProfitInput = { resaleCents: number; trueCostCents: number; ebayFeePct: number; ebayFeeFixedCents: number };
type ProfitResult = { resaleCents: number; ebayFeesCents: number; profitCents: number; roi: number | null };

function nonnegativeCents(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

export const a = originalParse as (value: string) => number | null;
export function i(budgetCents: number, input: FeeInput): number | null {
  nonnegativeCents(budgetCents, 'budgetCents');
  const fee = nonnegativeCents(input.fixedFeeCents === undefined ? 0 : input.fixedFeeCents, 'fixedFeeCents');
  // Preserve validation of rates and shipping even when the budget is below the fee.
  originalForward({ ...input, bidCents: 0 });
  if (fee > budgetCents) return null;
  return originalInverse(budgetCents - fee, input) as number | null;
}
export function n(input: CostInput): CostResult {
  const fee = nonnegativeCents(input.fixedFeeCents === undefined ? 0 : input.fixedFeeCents, 'fixedFeeCents');
  const result = originalForward(input) as CostResult;
  const trueCostCents = nonnegativeCents(result.trueCostCents + fee, 'trueCostCents');
  return { ...result, trueCostCents };
}
export const r = originalFormat as (cents: number, currency: string) => string;
export const t = originalProfit as (input: ProfitInput) => ProfitResult;
