const fs = require('fs');
let content = fs.readFileSync('assets/index.ts-BuCXDImd.js', 'utf8');

// 1. Revert F()
content = content.replace(
  'if(i.maxBidCents===null){x.textContent=`Enter a max bid`;return}let o=ne({...n,bidCents:i.maxBidCents}).trueCostCents;i.budgetCents=o,x.textContent=`All-in cost: ${p(o,r)}`',
  'if(i.budgetCents===null){x.textContent=i.maxBidCents===null?`Enter a max bid`:`Saved max bid ${p(i.maxBidCents,r)}`;return}let o=te(i.budgetCents,n);i.maxBidCents=o,x.textContent=o===null?`Budget is below shipping`:`Stop bidding at ${p(o,r)}`'
);

// 2. Revert V()
content = content.replace(
  'V=()=>{i.maxBidCents=E(b.value),i.maxBidCents===null&&(i.budgetCents=null),F()}',
  'V=()=>{i.budgetCents=E(b.value),i.budgetCents===null&&(i.maxBidCents=null),F()}'
);

// 3. Fix population
// Currently: t.resaleCents!==null&&(S.value=(t.resaleCents/100).toFixed(2)),t.maxBidCents!==null&&(b.value=(t.maxBidCents/100).toFixed(2)),M.value=t.note
// Change to: t.resaleCents!==null&&(S.value=(t.resaleCents/100).toFixed(2)),t.maxBidCents!==null&&(b.value=(ne({premiumPct:i.premiumPct,taxPct:i.taxPctOverride??s(i.stateCode),shipCents:i.shipCents,taxOnPremium:i.taxOnPremium,bidCents:t.maxBidCents}).trueCostCents/100).toFixed(2)),M.value=t.note
// Actually, `n` is computed inside `F()`, so `n` is not available inside the `then` callback!
// Wait, the callback is: `n.lotId&&m({kind:watch:list}).then(e=>{ let t=e.find...; if(t) { ... } })`
// It doesn't have `n` because `n` is `t.parseResult.lot` or similar? No, in `F()`, `n={premiumPct:i.premiumPct,taxPct:e,shipCents:i.shipCents,taxOnPremium:i.taxOnPremium}`.
// I can just recreate it!
content = content.replace(
  't.maxBidCents!==null&&(b.value=(t.maxBidCents/100).toFixed(2)),M.value=t.note',
  't.maxBidCents!==null&&(b.value=(ne({premiumPct:i.premiumPct,taxPct:i.taxPctOverride??s(i.stateCode),shipCents:t.shipCents,taxOnPremium:i.taxOnPremium,bidCents:t.maxBidCents}).trueCostCents/100).toFixed(2)),M.value=t.note'
);

fs.writeFileSync('assets/index.ts-BuCXDImd.js', content, 'utf8');
