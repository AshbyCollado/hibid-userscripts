export function patchLegacyLotPanelRecovery(source, helperPath) {
  const mount = 'let l=document.createElement(`div`);l.id=L,K(l),B=D(l,{parseResult:i,premium:s,settings:o,isPro:c});';
  const matches = source.split(mount).length - 1;
  if (matches !== 1) throw new Error(`Expected exactly one legacy calculator mount, found ${matches}`);
  const importLine = `import { installLotPanelRecovery } from ${JSON.stringify(helperPath)};`;
  const bridge = `${mount}const flippahUpdateBid=B?.updateBid;installLotPanelRecovery({host:l,signal:n,routeHref:location.href,getBidNode:()=>e(document,t.currentBid),parseBid:()=>{let parsed=r(document,location.href);return parsed.status===\`ok\`?parsed.lot.currentBidCents:null},updateBid:bidCents=>flippahUpdateBid?.(bidCents),insertHost:K});`;
  return `${importLine}\n${source.replace(mount, bridge)}`;
}
