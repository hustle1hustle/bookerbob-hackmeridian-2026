# Testnet deployment

Network: Stellar testnet (Protocol 29). Explorer links: stellar.expert.

| What | Value |
|---|---|
| `proof_of_stay` contract (current, merchant-generic) | [`CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL`](https://stellar.expert/explorer/testnet/contract/CBZ7I3VOQEMK5LKDZLCUJ4VU6KQX5WT747XN4KLGM23EIUCISTDX5MTL) |
| Deploy tx | [`0172e855…`](https://stellar.expert/explorer/testnet/tx/0172e855a39a61503f0e1fe25a74567ebc8dc2d5cd1c0e1eb2425d784435469b) |
| Test USDC SAC (our issuer, stand-in for Circle testnet USDC) | [`CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S`](https://stellar.expert/explorer/testnet/contract/CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S) |

The contract takes the token address in its constructor, so Circle's testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) is a drop-in swap; we use our own issuer so seed guests can be funded without the Circle faucet.

## Golden proof gate

Current contract (Sun 25 Oct, ~13:10 Lisbon), `scripts/gate.sh`:

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
