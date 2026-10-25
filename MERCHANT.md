# Shopify store as a core merchant (testnet)

| What | Value |
|---|---|
| merchant id | **5** (on v2; also 5 on the retired v1 `CBZ7I3VO…5MTL`) |
| contract | `CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY` (frozen v2, read from the core's `config/testnet.json`, not hardcoded in code) |
| kind / name | `shop` / "REP Store (Shopify)" |
| price | 40.80 test USDC (`408000000`, the 150 AED tee at a fixed demo rate) |
| discount | 1000 bps (10%) |
| admin | `GBDEYOAF4QGIZSIJZWPUDWGZT2IT5Z44MBEU3F2RUVCXVZQBSBLAYVZS` (stellar-cli alias `ucp-shop-admin`; USDC trustline to issuer `GAJNOS…ARHU`) |
| register tx | v2 [`4447cc1a…`](https://stellar.expert/explorer/testnet/tx/4447cc1a1cbb1753be44021e9deb1f3f44a422350eb2a0c6dd9d688a1c210466); v1 [`86e53e17…`](https://stellar.expert/explorer/testnet/tx/86e53e1738da0e4ee6ecc39efb8a7ef743988669cd4805b19436fbb49ae1636e) |
| store | jwq0dd-rp.myshopify.com (external service, test mode) |

Real store: no seed reviews. Leaves come only from real test purchases through the bridge, which signs `checkout` as the merchant admin.

## Demo payer accounts
v2 batch 2 (asked for 100 USDC each): `GDTLGAYZ…V3VN`, `GDICQ3AA…6YTN`, `GAIJ2Z3H…CWYK`, `GCZ2AC4M…7AV2`.

v1 batch (testnet, one per purchase, 100 test USDC each from the core issuer)
`GBJQ7PFI3K4HQRLPAMYLM7AL5SEDT33G3PTBXZ7C3AUIF4Y32WZFHSDR`, `GBUKQ4DTGDLJCEXPRWDASMY5LJOKB5EA4SA3IFIVHOPA56KEA3EHLHDQ`, `GCRCWQM2HJYRGF7UJJKOYBK375O3NWZEGIS7CG7WLAFVQ2KXSQUM5CWC`, `GAJT2VLOCBIDLIJMHIJJVL47M4GM76JJFF3GA7QM5HNODP2WK7II23HY`. Secrets only in the gitignored `agent/.payers.json`.
