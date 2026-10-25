# Shopify store as a core merchant (testnet)

| What | Value |
|---|---|
| merchant id | **5** |
| contract | `CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL` |
| kind / name | `shop` / "REP Store (Shopify)" |
| price | 40.80 test USDC (`408000000`, the 150 AED tee at a fixed demo rate) |
| discount | 1000 bps (10%) |
| admin | `GBDEYOAF4QGIZSIJZWPUDWGZT2IT5Z44MBEU3F2RUVCXVZQBSBLAYVZS` (stellar-cli alias `ucp-shop-admin`; USDC trustline to issuer `GAJNOS…ARHU`) |
| register tx | [`86e53e17…`](https://stellar.expert/explorer/testnet/tx/86e53e1738da0e4ee6ecc39efb8a7ef743988669cd4805b19436fbb49ae1636e) |
| store | jwq0dd-rp.myshopify.com (external service, test mode) |

Real store: no seed reviews. Leaves come only from real test purchases through the bridge, which signs `checkout` as the merchant admin.
