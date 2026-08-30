export function listingPage(kind: 'active' | 'ended', start: number, count: number, total: number, nextUrl = ''): string {
  const rows = Array.from({ length: count }, (_, offset) => {
    const sequence = start + offset;
    const itemId = String(110000000000 + sequence);
    return `<tr><td><a href="https://www.ebay.com/itm/${itemId}">Redacted test item ${sequence}</a></td><td>${itemId}</td><td>$${sequence}.00</td><td>1</td><td>${sequence}</td><td>2</td><td>0</td><td>${kind === 'ended' ? 'Aug 20, 2026' : ''}</td><td>${kind === 'ended' ? 'Unsold' : 'Active'}</td><td>Fixed price</td></tr>`;
  }).join('');
  return `<!doctype html><html><body><p>Results: ${start}-${start + count - 1} of ${total} listings</p><table><thead><tr><th>Item</th><th>Item number</th><th>Current price</th><th>Available quantity</th><th>Views</th><th>Watchers</th><th>Bids</th><th>End date</th><th>Status</th><th>Format</th></tr></thead><tbody>${rows}</tbody></table>${nextUrl ? `<a class="pagination__next" aria-label="Next page" href="${nextUrl}">Next</a>` : ''}</body></html>`;
}

export function sellerHubActiveGridPage(total = 2, misleadingFilterCount = 1): string {
  const rows = Array.from({ length: total }, (_, offset) => {
    const sequence = offset + 1;
    const itemId = String(140000000000 + sequence);
    return `<tbody><tr class="grid-row">
      <td class="shui-dt--selector"></td>
      <td class="shui-dt-column__lineActions shui-dt--left"><a href="https://www.ebay.com/sl/list?mode=ReviseItem&amp;itemId=${itemId}">Edit</a></td>
      <td class="shui-dt-column__title shui-dt--left"><a href="/itm/${itemId}"><img alt=""></a><a href="/itm/${itemId}">Redacted live-grid item ${sequence}</a></td>
      <td class="shui-dt-column__listingSKU shui-dt--left">TEST-${sequence}</td>
      <td class="shui-dt-column__price shui-dt--right"><span>$${40 + sequence}.00</span><span> Buy It Now</span></td>
      <td class="shui-dt-column__promotions shui-dt--left">No discounts</td>
      <td class="shui-dt-column__availableQuantity shui-dt--right">${sequence}</td>
      <td class="shui-dt-column__visitCount shui-dt--right">${10 + sequence}</td>
      <td class="shui-dt-column__promoteListing shui-dt--left">Not promoted</td>
      <td class="shui-dt-column__watchCount shui-dt--right">${sequence}</td>
      <td class="shui-dt-column__unansweredQuestionCount shui-dt--right">0</td>
      <td class="shui-dt-column__bidCount shui-dt--right">0</td>
      <td class="shui-dt-column__timeRemaining shui-dt--left">29d 4h</td>
    </tr><tr><td colspan="13"></td></tr><tr><td colspan="13"></td></tr></tbody>`;
  }).join('');
  return `<!doctype html><html><body>
    <span>Promoted Listings active (${misleadingFilterCount})</span>
    <h1>Manage active listings (${total})</h1>
    <script type="application/json">{"appSpeed":{"listingCount":${total}}}</script>
    <table role="grid"><thead><tr class="header-row">
      <th></th><th>Actions</th><th>Item<button>Sort ascending</button></th>
      <th>Custom label (SKU)<button>Sort descending</button></th>
      <th>Current price<button>Sort ascending</button></th><th>Discounts</th>
      <th>Available quantity<button>Sort ascending</button></th>
      <th>Views (30 days)<button>Sort ascending</button><span>This column shows recent views</span></th>
      <th>Promoted Listings</th><th>Watchers<button>Sort ascending</button></th>
      <th>Questions</th><th>Bids</th><th>Time left</th>
    </tr></thead>${rows}</table>
  </body></html>`;
}

export function soldPage(orderId: string, itemId: string, page: number, total: number, nextUrl = ''): string {
  return `<!doctype html><html><body><p>Showing ${page}-${page} of ${total} orders</p><article class="sold-itemcard" data-order-id="${orderId}"><div data-order-line-id="${orderId}-1"><a href="https://www.ebay.com/itm/${itemId}">Redacted sold item ${page}</a> | Quantity: 1 | Item subtotal: $40.00</div><div>Sold on: Aug ${20 + page}, 2026 | Shipping: $5.00 | Sales tax: $2.00 | Order total: $47.00 | Paid</div></article>${nextUrl ? `<a class="pagination__next" href="${nextUrl}">Next page</a>` : ''}</body></html>`;
}

export function transactionPage(id: string, page: number, total: number, nextUrl = ''): string {
  return `<!doctype html><html><body><p>Results: ${page}-${page} of ${total} transactions</p><div class="transaction-row-v2" data-transaction-id="${id}">Transaction date: 2026-08-${20 + page} | Sale | Order ID: 12-34567-8901${page} | Item ID: 12000000000${page} | Gross: $40.00 | eBay fee: $5.00 | Net: $35.00 | Available</div>${nextUrl ? `<a class="pagination__next" href="${nextUrl}">Next page</a>` : ''}</body></html>`;
}
