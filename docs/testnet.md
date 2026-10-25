# Testnet deployment

Network: Stellar testnet (Protocol 29). Explorer links: stellar.expert.

Live app and BookerBob backend: [https://bookerbob-proof-of-loyalty.fly.dev](https://bookerbob-proof-of-loyalty.fly.dev) (Fly, region cdg). API: `/api/config`, `/api/reviews/:merchant`, `/api/disputes`.

| What | Value |
|---|---|
| `proof_of_stay` contract (current, v2: merchant-quoted amounts, `redeem`, admin-gated `upgrade`) | [`CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY`](https://stellar.expert/explorer/testnet/contract/CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY) |
| Deploy tx | [`28e9b1e0…`](https://stellar.expert/explorer/testnet/tx/28e9b1e0b3475d8d3d87ab0f36172943f22463b0d887cac892d4e959c99efc17) |
| Test USDC SAC (our issuer, stand-in for Circle testnet USDC) | [`CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S`](https://stellar.expert/explorer/testnet/contract/CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S) |

The contract takes the token address in its constructor, so Circle's testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) is a drop-in swap; we use our own issuer so seed guests can be funded without the Circle faucet.

## Golden proof gate

Current contract v2 (Sun 25 Oct, ~13:05 Lisbon), `scripts/gate.sh`:

| Input | Result | Tx |
|---|---|---|
| golden proof, original public signals | `true` | [`0637fea7…`](https://stellar.expert/explorer/testnet/tx/0637fea7161f51651e9d6323e22f936cf807f17cbd36dba159c174065366e6ad) |
| same proof, `hash(scope) + 1` | `false` | [`b97d19f0…`](https://stellar.expert/explorer/testnet/tx/b97d19f03aa2fa3509cddfafc30c468da752342d74e5ca8a12223c1a2d424b97) |

Merchant-generic contract `CBZ7I3VO…5MTL` (Sun 25 Oct, ~12:40 Lisbon):

| Input | Result | Tx |
|---|---|---|
| golden proof, original public signals | `true` | [`0dd755b0…`](https://stellar.expert/explorer/testnet/tx/0dd755b03eeac00f386d3c1ed417c4ce583a645569aa98e1dc4c00d446e2b5f4) |
| same proof, `hash(scope) + 1` | `false` | [`e11f22c4…`](https://stellar.expert/explorer/testnet/tx/e11f22c424bbf6a743bcc68fded6a646dffee1c8756ff8d6830f05d4bab3d58a) |

First passed on the first deployment `CDRKD65U…PYWN` (Sun 25 Oct, ~12:30 Lisbon):

`verify(proof, pub_signals)` with the golden Semaphore v4 proof from `circuits/golden/depth10`:

| Input | Result | Tx |
|---|---|---|
| golden proof, original public signals | `true` | [`2656e81e…`](https://stellar.expert/explorer/testnet/tx/2656e81ec090cb7fdbbd358afac477c0778c1060c8ccc7c2b52d323df8e7eb1b) |
| same proof, `hash(scope) + 1` | `false` | [`8eba70c0…`](https://stellar.expert/explorer/testnet/tx/8eba70c08ab69c8adb31d819f362c19227b8a802ff2b591660b3a0e39660a34f) |

Reproduce: `scripts/deploy.sh`, then `scripts/gate.sh`.

## Deployment history

Earlier deployments stay on testnet; their transactions remain valid evidence of the build.

| Contract | What changed | Notes |
|---|---|---|
| [`CDRKD65U…PYWN`](https://stellar.expert/explorer/testnet/contract/CDRKD65UBKOVLOABILPJTSZYB7JXWZQOLCJGD4FHQ37EXEPGHEFIPYWN) | first deploy: verifier, tree, reviews, discount, attest | golden gate passed here first (~12:30) |
| [`CCSGYUKT…SGTD`](https://stellar.expert/explorer/testnet/contract/CCSGYUKTZ54IE3U5YP3JEZ2AXMP5SE63CBWGX6MKW4ZVKX24MQCCSGTD) | review ids, leaves views | superseded within minutes |
| [`CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL`](https://stellar.expert/explorer/testnet/contract/CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL) | Hotel generalized to Merchant with a kind | first seed (22 reviews), first e2e, first app run |
| [`CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY`](https://stellar.expert/explorer/testnet/contract/CBEGVNZFDZMOBKYVP27D5Q6Y7OHKWC2P3DAKQNC3MGTO5OW5JHAL5EBY) | v2: `book_amount`, `book_with_discount_amount` (merchant-signed amount + order ref), `redeem`, admin-gated `upgrade` | current; later changes upgrade in place and keep this ID |
