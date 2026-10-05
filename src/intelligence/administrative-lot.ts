export function nonMerchandiseNoticeReason(
  title: string,
  description: string,
  physicalPhotoCount: number | null,
): string | null {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (physicalPhotoCount === 0) {
    if (/^welcome to (?:the|our)\b/i.test(normalized)
      && /\bonline only auction\b/i.test(description)
      && /\bterms\s*(?:&|and)\s*conditions\b/i.test(description)) {
      return 'Auction introduction; no merchandise or physical photos';
    }
    if (/^pick\s?up is\b/i.test(normalized) && !description.trim()) {
      return 'Pickup instructions; no merchandise or physical photos';
    }
    if (/^(?:3rd|third) party shipping offered!?$/i.test(normalized) && !description.trim()) {
      return 'Shipping instructions; no merchandise or physical photos';
    }
  }
  if (physicalPhotoCount === 1) {
    if (/^you are bidding in the .+ auction[.!]?$/i.test(normalized)
      && /\bcheckouts?\s+and\s+pickups?\b/i.test(description)
      && /\bregister for upcoming auctions\b/i.test(description)) {
      return 'Auction logistics notice graphic; no merchandise described';
    }
    if (/^en espanol:\s*por favor leer antes de ofertar$/i.test(normalized)
      && /\bparticipar en esta subasta\b/i.test(description)
      && /\bPagos:\s/i.test(description)
      && /\bRecogidas:\s/i.test(description)) {
      return 'Spanish auction terms notice graphic; no merchandise described';
    }
    if (/^(?:SPI Simply Bueno Deals!?|Fullfillment Center at Simply Bueno)$/i.test(normalized)
      && /^Condition: New\(other\)\s/m.test(description)
      && /\bUPC: NOUPC\{/i.test(description)
      && !/\bTitle:\s/i.test(description)) {
      return 'Auction promotion or fulfillment notice graphic; no merchandise described';
    }
    if (/^shipping available!?$/i.test(normalized)
      && /\bUPC:\s*NOUPC\{/i.test(description)
      && /^Title:[ \t]*Shipping Available![ \t]*$/im.test(description)
      && /(?:^|\n)If shipping is requested, shipping and handling costs will be charged when items are packed\.\s*$/i.test(description)) {
      return 'Shipping notice graphic; no merchandise described';
    }
    if (/^no shipping local pickup only$/i.test(normalized) && !description.trim()) {
      return 'Local-pickup notice graphic; no merchandise described';
    }
    if (/^atx pickup deadline$/i.test(normalized)
      && /^condition:\s*new\(other\)/i.test(description)
      && /\bUPC:\s*NOUPC\{/i.test(description)) {
      return 'Auction pickup-deadline graphic; no merchandise described';
    }
    if (/^please read before bidding$/i.test(normalized)
      && /terms and conditions/i.test(description)
      && /\bbuyer(?:[\u2019']s|s[\u2019']?)?\s+premium\b/i.test(description)) {
      return 'Auction bidding-terms graphic; no merchandise described';
    }
    if (/^important information!+ please read!+$/i.test(normalized)
      && /buyers? premium/i.test(description) && /(?:local pickup|shipping)/i.test(description)) {
      return 'Auction terms notice graphic; no merchandise described';
    }
    if (/\bauctions?\b.*\baddress$/i.test(normalized)
      && /\b\d{2,6}\s+\w+(?:\s+\w+){0,3}\s+(?:dr|drive|rd|road|st|street|ave|avenue)\b/i.test(description)) {
      return 'Auction address notice graphic; no merchandise described';
    }
  }
  return null;
}
