#!/usr/bin/env bash
# On-chain REP check for the "REP verified traveler" group. For the contract admin; nothing here runs on its own.
#   scripts/rep-onchain.sh upgrade      build, upload the wasm, upgrade() the live contract (admin = deployer)
#   scripts/rep-onchain.sh set-issuer   pin REP's key (live JWKS, kid rep-attest-1) for the group via set_rep_issuer
# Env: CONTRACT (default config/testnet.json), DEPLOYER_KEY (default deployer), REP_GROUP_ID (default 1),
#      REP_MAX_AGE seconds (default 604800 = 7 days; revocation cannot be read on-chain, this bounds it).
set -euo pipefail
cd "$(dirname "$0")/.."
NET=${STELLAR_NETWORK:-testnet}
SRC=${DEPLOYER_KEY:-deployer}
CONTRACT=${CONTRACT:-$(node -p 'require("./config/testnet.json").contractId')}
GROUP=${REP_GROUP_ID:-1}
hex() { printf %s "$1" | od -An -tx1 | tr -d ' \n'; }

case "${1:-}" in
  upgrade)
    stellar contract build --manifest-path contracts/proof_of_stay/Cargo.toml >/dev/null
    HASH=$(stellar contract upload --wasm contracts/proof_of_stay/target/wasm32v1-none/release/proof_of_stay.wasm --source "$SRC" --network "$NET")
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" -- upgrade --new_wasm_hash "$HASH"
    echo "upgraded $CONTRACT to $HASH"
    ;;
  set-issuer)
    # REP_ISSUER_KEY (SEC-1 hex) overrides the live JWKS, for a throwaway test deployment only
    KEY=${REP_ISSUER_KEY:-$(curl -fsS https://rep-attest.fly.dev/.well-known/jwks.json | node -e '
      const k = JSON.parse(require("fs").readFileSync(0)).keys.find((k) => k.kid === "rep-attest-1" && k.crv === "P-256")
      if (!k) process.exit(1)
      process.stdout.write("04" + Buffer.from(k.x, "base64url").toString("hex") + Buffer.from(k.y, "base64url").toString("hex"))')}
    ISSUER=$(cat <<JSON
{"key":"$KEY","iss":"$(hex https://rep-attest.fly.dev)","aud":"$(hex bookerbob)","max_age":${REP_MAX_AGE:-604800},"hosts":["$(hex airbnb.com)","$(hex booking.com)"]}
JSON
)
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" -- set_rep_issuer --group "$GROUP" --issuer "$ISSUER"
    stellar contract invoke --id "$CONTRACT" --source "$SRC" --network "$NET" --send=no -- get_rep_issuer --group "$GROUP"
    ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
