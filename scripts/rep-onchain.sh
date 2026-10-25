#!/usr/bin/env bash
# On-chain REP tier credentials for the "REP verified traveler" group. For the contract admin; nothing runs on its own.
#   scripts/rep-onchain.sh upgrade    build, upload the wasm, upgrade() the live contract (admin = deployer)
#   scripts/rep-onchain.sh set-tier   pin the tier issuer key (kid 1) and the group policy via set_tier_issuer / set_tier_policy
# Env: CONTRACT (default config/testnet.json), DEPLOYER_KEY (default deployer), REP_GROUP_ID (default 1),
#      TIER_KEY (SEC-1 hex; default: the live issuer's /.well-known/rep-tier-configuration), TIER_KID (default 1),
#      TIER_GROUP (default rep-verified-traveler), TIER_MIN (default 1).
set -euo pipefail
cd "$(dirname "$0")/.."
NET=${STELLAR_NETWORK:-testnet}
SRC=${DEPLOYER_KEY:-deployer}
CONTRACT=${CONTRACT:-$(node -p 'require("./config/testnet.json").contractId')}
GROUP=${REP_GROUP_ID:-1}
KID=${TIER_KID:-1}

case "${1:-}" in
  upgrade)
    stellar contract build --manifest-path contracts/proof_of_stay/Cargo.toml >/dev/null
    HASH=$(stellar contract upload --wasm contracts/proof_of_stay/target/wasm32v1-none/release/proof_of_stay.wasm --source "$SRC" --network "$NET")
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" -- upgrade --new_wasm_hash "$HASH"
    echo "upgraded $CONTRACT to $HASH"
    ;;
  set-tier)
    KEY=${TIER_KEY:-$(curl -fsS https://rep-attest-tier.fly.dev/.well-known/rep-tier-configuration | node -e '
      const c = JSON.parse(require("fs").readFileSync(0))
      if (String(c.kid_byte) !== process.argv[1]) process.exit(1)
      const k = c.pubkey_sec1_hex
      if (!/^04[0-9a-f]{128}$/.test(k ?? "")) process.exit(1)
      process.stdout.write(k)' "$KID")}
    GHASH=$(printf %s "${TIER_GROUP:-rep-verified-traveler}" | shasum -a 256 | cut -d' ' -f1)
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" -- set_tier_policy --group "$GROUP" --policy "{\"group_hash\":\"$GHASH\",\"min_tier\":${TIER_MIN:-1}}"
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" -- set_tier_issuer --group "$GROUP" --kid "$KID" --pubkey "\"$KEY\""
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" --send=no -- get_tier_policy --group "$GROUP"
    ;;
  *) sed -n 2,7p "$0"; exit 2 ;;
esac
