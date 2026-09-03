# HiBid route contract

| Kind | Routes | Source |
| --- | --- | --- |
| `catalog` | `/catalog/:auctionId`, state-prefixed catalog routes | HiBid GraphQL pages |
| `livecatalog` | `/livecatalog/:auctionId` | HiBid GraphQL pages |
| `search` | `/lots`, `/lots/...`, state-prefixed `/lots/...` | Search API IDs, GraphQL hydration |
| `lot` | `/lot/:eventItemId/...` | Canonical DOM plus exact `GetLotDetails(lotId, countAsView:false)` GraphQL hydration |
| `watchlist` | `/account/watchlist` | Canonical personalized DOM |
| `currentbids-winning` | `/account/currentbids?status=WINNING` | Canonical personalized DOM |
| `currentbids-outbid` | `/account/currentbids?status=OUTBID` | Canonical personalized DOM |
| `pastbids` | `/account/pastbidsm` | Selected auction group DOM plus detail enrichment |
| `pastwatchlist` | `/account/pastwatchlist` | Selected auction group DOM plus detail enrichment |

The fingerprint contains the canonical host/path, route kind, auction/category
IDs, and sorted search parameters other than presentation-only page controls.

Mutation routes, checkout, payment, registration, and unsupported account pages
do not expose export actions.
