#!/usr/bin/env bash
# Deploys the test USDC SAC (if USDC_SAC_ID is unset) and the proof_of_stay contract to testnet.
# Keys are stellar-cli aliases (see .env.example); secrets stay in the local stellar keystore.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=${STELLAR_NETWORK:-testnet}
SRC=${DEPLOYER_KEY:-deployer}
ARBITER=$(stellar keys address "${ARBITER_KEY:-arbiter}")

if [ -z "${USDC_SAC_ID:-}" ]; then
  ISSUER=$(stellar keys address usdc-issuer)
  USDC_SAC_ID=$(stellar contract asset deploy --asset "USDC:$ISSUER" --source usdc-issuer --network "$NET" 2>/dev/null \
    || stellar contract id asset --asset "USDC:$ISSUER" --network "$NET")
fi
echo "USDC_SAC_ID=$USDC_SAC_ID"

stellar contract build --manifest-path contracts/proof_of_stay/Cargo.toml >/dev/null
WASM=contracts/proof_of_stay/target/wasm32v1-none/release/proof_of_stay.wasm
VK=$(node -e 'const j=require("./circuits/golden/depth10/soroban.json");process.stdout.write(JSON.stringify(j.vk))')

ID=$(stellar contract deploy --wasm "$WASM" --source "$SRC" --network "$NET" --alias proof_of_stay -- \
  --arbiter "$ARBITER" --usdc "$USDC_SAC_ID" --vk "$VK")
echo "PROOF_OF_STAY_CONTRACT_ID=$ID"
