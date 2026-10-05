// Serialized into the preserved calculator, so this reader must be self-contained.
function readLegacyEconomics(host, expectedLotId) {
  const unknown = { fixedFeeCents: 0, premiumPct: null, complete: false, warnings: ['Auction fees are not verified yet.'] };
  const data = host.dataset;
  if (expectedLotId == null || String(expectedLotId) === '' || data.flippahEconomicsLotId !== String(expectedLotId)) return unknown;
  const raw = data.flippahFixedFeeCents;
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) return unknown;
  const fixedFeeCents = Number(raw);
  if (!Number.isSafeInteger(fixedFeeCents) || fixedFeeCents < 0) return unknown;
  let warnings;
  try { warnings = JSON.parse(data.flippahEconomicsWarnings); } catch { return unknown; }
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === 'string')) return unknown;
  const premiumRaw = data.flippahPremiumPct;
  const premiumPct = typeof premiumRaw === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(premiumRaw)
    ? Number(premiumRaw) : null;
  return { fixedFeeCents, premiumPct: premiumPct !== null && Number.isFinite(premiumPct) && premiumPct <= 50 ? premiumPct : null,
    complete: data.flippahEconomicsComplete === 'true' && warnings.length === 0, warnings };
}

function replaceOnce(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`Unexpected legacy economics marker: ${marker}`);
  return source.replace(marker, () => replacement);
}

// Run only after RemoveShipping and RemoveCatalog. Every mutation asserts its
// exact post-patch marker so a baseline update cannot silently omit fee math.
export function patchLegacyAuctionEconomics(source) {
  if (source.includes('<label for="lotlens-shipping">') || source.includes('var h=`lotlens-catalog-chip`')) {
    throw new Error('Legacy economics requires RemoveShipping and RemoveCatalog first');
  }
  for (const call of ['a=ne({...n,bidCents:i.bidCents});', 'let o=te(i.budgetCents,n);i.maxBidCents=o']) {
    if (source.split(call).length !== 2) throw new Error(`Unexpected legacy economics call: ${call}`);
  }
  const replacements = [
    ['function D(e,t){let n=ue(t.parseResult)', `${readLegacyEconomics.toString()}function D(e,t){let flippahHost=e,flippahDestroyed=false,flippahUserPremium=false;let n=ue(t.parseResult)`],
    ['aria-label="Flippah true cost calculator"', 'aria-label="Flippah bid subtotal calculator"'],
    ['<span>True cost if you win now</span>', '<span>Bid subtotal</span>'],
    ['<p class="lotlens-degraded"', '<p class="lotlens-watch-status lotlens-economics-status" aria-live="polite"></p><p class="lotlens-degraded"'],
    ['for="lotlens-budget">Max bid</label>', 'for="lotlens-budget">Budget</label>'],
    ['aria-label="Max bid"', 'aria-label="Budget"'],
    ['let F=()=>{let e=t.settings.taxExempt', `let flippahLotId=n.lotId,flippahStatus=T(o,\`.lotlens-economics-status\`),flippahBudgetLabel=T(o,\`label[for="lotlens-budget"]\`),flippahBasePremiumPct=i.premiumPct,flippahBasePremiumLabel=d.textContent,flippahBridgePremiumPct=null;let F=()=>{
      if(flippahDestroyed)return;
      let flippahEconomics=readLegacyEconomics(flippahHost,flippahLotId),flippahEstimated=!flippahEconomics.complete;
      if(!flippahUserPremium&&t.premium.source!==\`user\`){
        if(flippahEconomics.premiumPct!==null){
          if(i.premiumPct!==flippahEconomics.premiumPct){i.premiumPct=flippahEconomics.premiumPct;g.value=String(i.premiumPct)}
          d.textContent=\`premium reconciled: \${i.premiumPct}%\`;flippahBridgePremiumPct=i.premiumPct;
        }else if(flippahBridgePremiumPct!==null){
          i.premiumPct=flippahBasePremiumPct;g.value=String(i.premiumPct);d.textContent=flippahBasePremiumLabel;flippahBridgePremiumPct=null;
        }
      }
      let flippahPrefix=flippahEstimated?\`Estimated \`:\`\`,flippahSuffix=flippahEstimated?\` (extra costs excluded)\`:\`\`;
      flippahStatus.textContent=flippahEstimated?[\`Estimated: extra costs are excluded; profit and ROI are not fully costed.\`,...flippahEconomics.warnings].join(\` \`):\`\`;
      flippahStatus.hidden=!flippahEstimated;
      flippahBudgetLabel.textContent=flippahEstimated?\`Estimated budget (extras excluded)\`:\`Budget\`;
      b.setAttribute(\`aria-label\`,flippahBudgetLabel.textContent);
      let e=t.settings.taxExempt`],
    ['x.textContent=`Enter the current bid`', 'x.textContent=flippahPrefix+`max bid: enter the current bid`+flippahSuffix'],
    ['w.textContent=`Enter the current bid`', 'w.textContent=flippahPrefix+`profit / ROI: enter the current bid`+flippahSuffix'],
    ['let n={premiumPct:i.premiumPct,taxPct:e,shipCents:0,taxOnPremium:i.taxOnPremium}', 'let n={premiumPct:i.premiumPct,taxPct:e,shipCents:0,taxOnPremium:i.taxOnPremium,fixedFeeCents:flippahEconomics.fixedFeeCents}'],
    ['w.textContent=`Enter resale value`', 'w.textContent=flippahPrefix+`profit / ROI: enter resale value`+flippahSuffix'],
    ['w.textContent=`${p(e.profitCents,r)} \u00b7 ${n}`', 'w.textContent=flippahPrefix+`profit ${p(e.profitCents,r)} / `+flippahPrefix+n+flippahSuffix'],
    ['x.textContent=i.maxBidCents===null?`Enter a max bid`:`Saved max bid ${p(i.maxBidCents,r)}`', 'x.textContent=flippahPrefix+(i.maxBidCents===null?`max bid: enter budget`:`saved max bid ${p(i.maxBidCents,r)}`)+flippahSuffix'],
    ['x.textContent=o===null?`Budget is below fees and tax`:`Stop bidding at ${p(o,r)}`', 'x.textContent=flippahPrefix+(o===null?`max bid unavailable: budget is below fees and tax`:`max bid ${p(o,r)}`)+flippahSuffix'],
    ['return f.addEventListener(`input`,I)', 'return flippahHost.addEventListener(`flippah:economics`,F),f.addEventListener(`input`,I)'],
    ['i.premiumPct=e,d.textContent=`premium set by you: ${e}%`', 'flippahUserPremium=true,i.premiumPct=e,d.textContent=`premium set by you: ${e}%`'],
    ['then(e=>{let wi=e.find(e=>e.lotId===n.lotId);', 'then(e=>{if(flippahDestroyed)return;let wi=e.find(e=>e.lotId===n.lotId);'],
    ['shipCents:0,taxOnPremium:i.taxOnPremium,bidCents:wi.maxBidCents}', 'shipCents:0,taxOnPremium:i.taxOnPremium,fixedFeeCents:readLegacyEconomics(flippahHost,n.lotId).fixedFeeCents,bidCents:wi.maxBidCents}'],
    ['destroy(){f.removeEventListener(`input`,I)', 'destroy(){flippahDestroyed=true,flippahHost.removeEventListener(`flippah:economics`,F),f.removeEventListener(`input`,I)'],
  ];
  return replacements.reduce((patched, [marker, replacement]) => replaceOnce(patched, marker, replacement), source);
}
