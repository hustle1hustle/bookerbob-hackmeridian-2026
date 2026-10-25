# Verification log

Every claim the build relies on, checked against primary sources on 2026-10-25. Local test results refer to `contracts/proof_of_stay` tests.

## HackMeridian 2026 rules: verified on public pages (2026-10-25)

Sources: H https://www.hackmeridian.com/ , B /build , F /faq , T /terms.html , S /schedule
GATED (login): official rules https://app.hackmeridian.com/portal/rules and submit form /portal/submit. Not read yet.

- Paths: Genesis = Idea -> MVP, "new idea or early prototype" allowed (F). Scale = prototype -> product, judged on milestones set at pre-event intake.
- Tracks: Stellar Unlocked and Stellar Composed are Genesis-only. The public page says "either or both tracks" (B), BUT the portal form is single-select (No thematic track / Stellar Unlocked / Stellar Composed; screenshot 2026-10-25). Selected: Genesis + Stellar Unlocked. Composed elements go in the submission text; ask organizers whether Track Alignment credits them. Track Alignment = "fit with Stellar Unlocked and/or Stellar Composed".
  - Unlocked names "ZK, natively: Use the Poseidon and BN254 host functions to build verifiers, private voting, membership proofs". (No "X-Ray" wording.)
  - Composed = "combines two or more ecosystem tools or projects": OpenZeppelin policies, USDC over x402/MPP, wallets without seed phrases or gas, Confidential Tokens, etc.
- Rubric 1-5 each: Track Alignment 20, User Value & Problem 20, Technical Execution 15, Innovation 15, Hackathon Progress 10, Market & Ecosystem 10, Product Design & UX 10. Priority Adoption -> Discovery -> Continuation (undefined). Genesis judged on problem clarity, MVP quality, Stellar integration, continued development potential.
- Judging: async review of demo video, pitch deck, GitHub repo, submission answers. Checklist: "Does your core feature work, and can judges test it?", "Can you clearly demonstrate what you built or improved during the event?". README with specs "does most of the work for judges".
- Deadline Mon 26 Oct 12:00, no late submissions. Judging 13:00-14:45, finalists picked 15:30. Finalist pitch Wed 28 Oct 13:50, Convento do Beato.
- Repos must be public (SDF dev meeting 2026-10-08). Repo-created-after-start rule: NOT FOUND publicly. Code of conduct bans "misrepresent your work" (T s.05). Original work or properly licensed (T s.06). AI tools explicitly allowed.
- Teams up to 5. Discord https://discord.gg/DxzSCZYxZG . meridian@growwithguava.com . Organizer Grow with Guava LLC.
- Not found publicly: mandatory live URL, contract IDs, testnet tx proof, video length limit, form fields. Keep the brief's list until the gated rules are read.
## Stellar / Soroban ZK: verified (2026-10-25)

- Networks: testnet and mainnet on Protocol 29. P25 (CAP-74 BN254, CAP-75 Poseidon) mainnet 2026-01-22; P26 (CAP-80: g1_msm, g1_is_on_curve, fr_*) mainnet 2026-05-06. https://developers.stellar.org/docs/networks/software-versions
- soroban-sdk: min 25.0.0 for bn254 + poseidon, 26.0.0 for msm/fr. Latest 29.0.1; soroban-examples pin 28. stellar-cli 28.1.0 (`brew install stellar-cli` is fastest). SDK 28 wasm builds need `stellar contract build`.
- API: env.crypto().bn254(): g1_add, g1_mul(&G1, &Fr), pairing_check(Vec<G1>, Vec<G2>) -> bool (panics on empty/mismatched). Types: G1 = BytesN<64>, G2 = BytesN<128>, Fr wraps U256 and is REDUCED mod r silently (contract must reject signals >= r before converting).
- Encoding (CAP-74): uncompressed big-endian. G2 = X.c1 || X.c0 || Y.c1 || Y.c0. snarkjs pairs are [c0, c1] -> swap. G2 gets on-curve + subgroup checks; G1 none.
- Poseidon: host = permutation only (CryptoHazmat::poseidon_permutation, feature hazmat-crypto). Use SDF crate soroban-poseidon 28.0.0: poseidon_hash::<3, Bn254Fr>(&env, &vec![a,b]); circomlib vectors in its tests. Locally verified: LeanIMT root of the golden fixture reproduced exactly. https://github.com/stellar/rs-soroban-poseidon
- Verifier: soroban-examples groth16_verifier/contracts/bn254_verifier works unchanged with snarkjs Semaphore v4.13.0 proofs (locally tested; README says only gnark-tested, unaudited). Cost: 29.6M CPU (~7.4% of 400M tx limit), 1.47 MB mem. Testnet datapoint: 1-input circom proof 0.0023 XLM fee. Generator: mysteryon88/soroban-verifier-gen.
- Limits (testnet = mainnet): CPU 400M/tx, mem 41.9 MB, tx 132 KB, wasm 128 KB, footprint 400, 200 write entries/tx, entry 64 KB, key 250 B.
- Tree cost: 16 Poseidon hashes ~17-23M CPU native (measure in wasm). Depth 10 insert = 10 hashes.
- Storage: nullifiers as PERSISTENT entries (temporary entries expire and reopen double spend). Testnet min persistent TTL ~7 days: extend TTL on instance, roots, tree nodes before judging (26-28 Oct and after).
- USDC testnet: issuer GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, SAC CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA. Faucet https://faucet.circle.com (needs trustline). Own asset: `stellar contract asset deploy --asset CODE:G... --network testnet`.
- Tooling for agents: stellar-dev-skill (skills/zk-proofs), stellar-docs MCP, Raven MCP.
## Semaphore v4: verified against source (semaphore main dbab555, packages 4.14.5)

CRIT: the circuit does not bound merkleProofLength. depth > MAX_DEPTH yields root = 0 with a valid proof for any secret (binary-merkle-root.circom header). The contract must accept only roots in its own root history and never root 0.

1. publicSignals = [merkleRoot, nullifier, hash(message), hash(scope)], nPublic 4. merkleTreeDepth is NOT a circuit input; it selects the verification key (one VK per depth: alpha/beta/gamma shared, delta2 and IC[5] per depth). Source: packages/circuits/src/semaphore.circom, circuits.json pubs, packages/proof/src/verify-proof.ts, contracts/Semaphore.sol.
2. hash(m) = keccak256(toBeHex(m, 32)) >> 8 (packages/proof/src/hash.ts; Solidity: keccak256(abi.encodePacked(uint256)) >> 8). Strings go through encodeBytes32String unless they parse as numbers. Contract computes scope itself from (kind, hotel, season) as a uint256, then this hash.
3. nullifier = Poseidon2(hashedScope, secret). commitment = Poseidon2(BabyPbk(secret)). new Identity(privateKey) is deterministic: feed a 32-byte KDF output, e.g. HKDF(master, "stay"|hotel|counter).
4. LeanIMT, Poseidon2 = circomlib Poseidon t=3 BN254 (poseidon-lite poseidon2 == PoseidonT3). No zero hashes: a lone left child is promoted unchanged. Depth = ceil(log2(size)). Leaves nonzero, < field, unique. Proofs omit sibling-less levels; JS pads siblings with 0 to merkleTreeDepth.
5. Artifacts: https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-{depth}.{wasm,zkey,json}, depths 1..32. depth 10: wasm 1.8 MB, zkey 2.4 MB. depth 16: zkey 3.4 MB. Ceremony: Semaphore V4, 400+ participants, 2024-07-13.
6. snarkjs pi_b = [[x.c0,x.c1],[y.c0,y.c1]]; Solidity packs G2 as c1,c0 (EIP-197). Soroban: match its native BN254 G2 order (check SDK docs), check every public signal < r. Browser proving ~270 ms at depth 10 (M2 Pro).
7. identity.signMessage(msg) -> {R8, S}, EdDSA-Poseidon BabyJubJub; Identity.verifySignature(msg, sig, pubkey). Signing key's Poseidon hash = commitment, so the signature links to the leaf (fine for arbiter-only disclosure).
8. MIT (Ethereum Foundation). circomlib and snarkjs are GPL-3.0: do not vendor-modify circomlib; bundling snarkjs in the app is the usual practice, note it in PRIOR_WORK.

## Confirmed locally in this repo (2026-10-25)

- Golden Semaphore v4 proof (depth 10, artifacts 4.13.0) passes `snarkjs groth16 verify` and the Soroban BN254 verifier; each tampered public signal and a wrong signal count fail (`circuits/golden/depth10`, test `golden_proof_verifies`, `tampered_public_input_fails`).
- Public signal order `[merkleRoot, nullifier, hash(message), hash(scope)]` confirmed from snarkjs output.
- LeanIMT root over `soroban-poseidon` equals `@semaphore-protocol/group` root; the incremental insert equals full recompute for sizes 1 to 13.
- Verifier cost in the host budget (native test env): 29.1M CPU instructions, 205 KB memory. To be re-measured in wasm via simulateTransaction for `docs/bench.md`.
- soroban-sdk G2 layout (`src/crypto/bn254.rs`, v28.0.0): `be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)`, flag bits unset, infinity = 128 zero bytes. `Bn254Fr` from `U256` is reduced mod r, so the contract rejects nullifiers >= r.
- `soroban-poseidon` README: "Sponge construction matches circom's implementation. Parameters: BN254 matches circomlib". https://github.com/stellar/rs-soroban-poseidon
