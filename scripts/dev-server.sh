#!/usr/bin/env bash
# Runs the backend locally with testnet demo keys pulled from the local stellar-cli keystore (never printed).
set -euo pipefail
cd "$(dirname "$0")/.."
s() { stellar keys secret "$1"; }
export RELAYER_SECRET=$(s relayer) ARBITER_SECRET=$(s arbiter) USDC_ISSUER_SECRET=$(s usdc-issuer)
export DEMO_MERCHANT_SECRETS="$(s hotel1),$(s hotel2),$(s hotel3),$(s cafe1),$(s shop1)"
export DATA_DIR=${DATA_DIR:-server/.data}
exec node server/src/index.ts
