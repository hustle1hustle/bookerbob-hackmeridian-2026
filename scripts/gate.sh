#!/usr/bin/env bash
# Golden-proof gate: the golden Semaphore proof must verify on testnet, a tampered input must not.
set -euo pipefail
cd "$(dirname "$0")/.."
G=circuits/golden/depth10
P=$(node -e "process.stdout.write(JSON.stringify(require('./$G/soroban.json').proof))")
PUB=$(node -e "process.stdout.write(JSON.stringify(require('./$G/public.json')))")
BAD=$(node -e "const p=require('./$G/public.json');p[3]=(BigInt(p[3])+1n).toString();process.stdout.write(JSON.stringify(p))")
for args in "$PUB" "$BAD"; do
  stellar contract invoke --id "${CONTRACT:-proof_of_stay}" --source "${SOURCE:-relayer}" --network testnet --send=yes -- \
    verify --proof "$P" --pub_signals "$args" 2>&1 | grep -E "tx/|^true|^false"
done
