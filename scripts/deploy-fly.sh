#!/bin/zsh
# Deploys the UCP bridge to Fly (org personal, Dan's). Prints no secrets.
set -euo pipefail
cd "${0:A:h}/.."
export FLY_API_TOKEN="$(cat ~/.rep-secrets/fly.token)"; unset FLY_ACCESS_TOKEN
APP=bookerbob-ucp-bridge
fly apps list --org personal | grep -q "^ *$APP " || fly apps create $APP --org personal
tmp=$(mktemp); trap 'rm -f $tmp' EXIT
grep -E '^(SHOPIFY_[A-Z_]+|UCP_SHOP_ADMIN_SECRET|UCP_MERCHANT_ID|USDC_SAC_ID|USDC_ISSUER)=' .env > $tmp
echo "UCP_PUBLIC_URL=https://$APP.fly.dev" >> $tmp
fly secrets import --app $APP --stage < $tmp > /dev/null
echo "secrets staged: $(fly secrets list --app $APP | awk 'NR>1{print $1}' | tr '\n' ' ')"
fly deploy --app $APP --remote-only --ha=false
curl -s https://$APP.fly.dev/health; echo
curl -s "https://$APP.fly.dev/search?q=tee" | head -c 200; echo
