# Open-source inspiration

Flippah remains an open-source, read-only HiBid research extension. The project
reviewed more than twenty public HiBid tools before the `v0.4.0` quality pass.
The implementation keeps Flippah's API-first coverage model and original HiBid
layout rather than running those projects alongside the extension.

## Adapted in v0.4.0

- [Hover Zoom+](https://github.com/extesy/hoverzoom) inspired the Sandhills
  thumbnail-to-full-size URL conversion. Flippah implements its own accessible,
  extension-scoped preview and includes the upstream MIT license in
  `vendor/hoverzoom/LICENSE`.
- [encore-browser](https://github.com/Perpalicious/encore-browser) inspired
  field-level fidelity reporting. Flippah independently measures identity,
  title, URL, description, image, category, price, and status/time coverage in
  every verified export.
- [ebaySTR](https://github.com/astro-nat/ebaySTR) inspired the outcome feedback
  loop. Flippah independently stores optional actual all-in cost, sold price,
  selling costs, channel, realized profit, and prediction error locally.

## Already represented

- [hibid-enhancer-suite](https://github.com/dgomesbr/hibid-enhancer-suite):
  condition parsing, Amazon matching, batching, caching, and deal indicators.
- [Auction-Tracker](https://github.com/CarsonKopec/Auction-Tracker): stable lot
  IDs, `timeLeftSeconds`, adaptive watch refresh, and closing notifications.
- [auction-scout](https://github.com/astro-nat/auction-scout): conservative
  identity evidence, mixed-lot review, and model/quantity conflict rejection.
- [CarBuyerAssistant](https://github.com/mbohaychuk/CarBuyerAssistant): strict
  source boundaries, retryable transports, and challenge detection.

## Intentionally excluded

Flippah does not adopt automatic bidding, checkout/account mutations, broad
recursive JSON guessing, synthetic fallback auction data, or average-price
claims that lack exact sold evidence. Public source is attributed, but unsafe
behavior is not carried into the product.
