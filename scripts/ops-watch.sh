#!/bin/zsh
# Polls the BookerBob backend and the UCP bridge for new errors every 60 s and prints them.
# Token: ~/.rep-secrets/ops.token (same value as the OPS_TOKEN Fly secret on both apps). Never printed.
#   zsh scripts/ops-watch.sh [interval_seconds]
set -u
TOKEN_FILE=${OPS_TOKEN_FILE:-$HOME/.rep-secrets/ops.token}
[ -r "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE"; exit 1; }
INTERVAL=${1:-60}
typeset -A SINCE
TARGETS=(
  "backend https://stellarbob2026.xyz"
  "bridge  https://bookerbob-ucp-bridge.fly.dev"
)
for t in $TARGETS; do SINCE[${t%% *}]=$(( $(date +%s) * 1000 - 3600000 )); done   # first pass: last hour
while true; do
  for t in $TARGETS; do
    name=${t%% *}; base=${t##* }
    out=$(curl -s -m 15 -H "authorization: Bearer $(cat $TOKEN_FILE)" "$base/api/ops/errors?since=${SINCE[$name]}") || { echo "$(date +%T) $name unreachable"; continue; }
    next=$(print -r -- "$out" | python3 -c '
import json, sys, datetime
name = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    print("0"); print(f"{name}: bad response", file=sys.stderr); sys.exit()
if "errors" not in d:
    print("0"); print(f"{name}: {d.get(\"error\", d)}", file=sys.stderr); sys.exit()
for e in d["errors"]:
    t = datetime.datetime.fromtimestamp(e["at"] / 1000).strftime("%H:%M:%S")
    where = e.get("path") or ""
    print(f"{t} {name:7} {e[\"source\"]:6} {e[\"kind\"]}: {e[\"message\"]} {where} [{e.get(\"release\",\"\")}{(\" \" + e[\"ua\"]) if e.get(\"ua\") else \"\"}]", file=sys.stderr)
print(max([e["at"] for e in d["errors"]], default=0))
' "$name")
    [ "${next:-0}" != "0" ] && SINCE[$name]=$next
  done
  sleep $INTERVAL
done
