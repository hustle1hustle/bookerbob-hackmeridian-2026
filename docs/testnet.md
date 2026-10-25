# Testnet deployment

Network: Stellar testnet (Protocol 29). Explorer links: stellar.expert.

| What | Value |
|---|---|
| `proof_of_stay` contract | [`CDRKD65UBKOVLOABILPJTSZYB7JXWZQOLCJGD4FHQ37EXEPGHEFIPYWN`](https://stellar.expert/explorer/testnet/contract/CDRKD65UBKOVLOABILPJTSZYB7JXWZQOLCJGD4FHQ37EXEPGHEFIPYWN) |
| Deploy tx | [`a23c7e4b…`](https://stellar.expert/explorer/testnet/tx/a23c7e4b80f57a8f51324c126eac101fee57361be0c7d2d5b504532eeb1a985c) |
| Test USDC SAC (our issuer, stand-in for Circle testnet USDC) | [`CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S`](https://stellar.expert/explorer/testnet/contract/CBP2AG64D4IVGM5D4IEF353OUGNHCSL4QT36TZIA7QE2ITP22UWAEL5S) |

The contract takes the token address in its constructor, so Circle's testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) is a drop-in swap; we use our own issuer so seed guests can be funded without the Circle faucet.

## Golden proof gate (Sun 25 Oct, 12:35 Lisbon)

`verify(proof, pub_signals)` with the golden Semaphore v4 proof from `circuits/golden/depth10`:

| Input | Result | Tx |
|---|---|---|
| golden proof, original public signals | `true` | [`2656e81e…`](https://stellar.expert/explorer/testnet/tx/2656e81ec090cb7fdbbd358afac477c0778c1060c8ccc7c2b52d323df8e7eb1b) |
| same proof, `hash(scope) + 1` | `false` | [`8eba70c0…`](https://stellar.expert/explorer/testnet/tx/8eba70c08ab69c8adb31d819f362c19227b8a802ff2b591660b3a0e39660a34f) |

Reproduce: `scripts/deploy.sh`, then `stellar contract invoke --id proof_of_stay --network testnet --source <key> --send=yes -- verify --proof "$(jq -c .proof circuits/golden/depth10/soroban.json)" --pub_signals "$(jq -c . circuits/golden/depth10/public.json)"`.
