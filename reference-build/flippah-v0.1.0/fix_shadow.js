const fs = require('fs');
let content = fs.readFileSync('assets/index.ts-BuCXDImd.js', 'utf8');

// Find the .then callback
content = content.replace(
  'n.lotId&&m({kind:`watch:list`}).then(e=>{let t=e.find(e=>e.lotId===n.lotId);t&&(P=t,i.watching=!0,i.shipCents=t.shipCents,i.resaleCents=t.resaleCents,i.maxBidCents=t.maxBidCents,i.note=t.note,v&&(v.value=(t.shipCents/100).toFixed(2)),t.resaleCents!==null&&(S.value=(t.resaleCents/100).toFixed(2)),t.maxBidCents!==null&&(b.value=(ne({premiumPct:i.premiumPct,taxPct:t.settings.taxExempt?0:(i.taxPctOverride??s(i.stateCode)),shipCents:t.shipCents,taxOnPremium:i.taxOnPremium,bidCents:t.maxBidCents}).trueCostCents/100).toFixed(2)),M.value=t.note,F(),W())})',
  'n.lotId&&m({kind:`watch:list`}).then(e=>{let wi=e.find(e=>e.lotId===n.lotId);wi&&(P=wi,i.watching=!0,i.shipCents=wi.shipCents,i.resaleCents=wi.resaleCents,i.maxBidCents=wi.maxBidCents,i.note=wi.note,v&&(v.value=(wi.shipCents/100).toFixed(2)),wi.resaleCents!==null&&(S.value=(wi.resaleCents/100).toFixed(2)),wi.maxBidCents!==null&&(b.value=(ne({premiumPct:i.premiumPct,taxPct:t.settings.taxExempt?0:(i.taxPctOverride??s(i.stateCode)),shipCents:wi.shipCents,taxOnPremium:i.taxOnPremium,bidCents:wi.maxBidCents}).trueCostCents/100).toFixed(2)),M.value=wi.note,F(),W())})'
);

fs.writeFileSync('assets/index.ts-BuCXDImd.js', content, 'utf8');
