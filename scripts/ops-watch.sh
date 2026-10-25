#!/bin/zsh
# Polls the BookerBob backend and the UCP bridge for new errors and prints ONE line per new error;
# silent otherwise (also prints a line when a target goes unreachable or comes back). Monitor-friendly.
# Token: ~/.rep-secrets/ops.token (= the OPS_TOKEN Fly secret on both apps). Never printed.
#   zsh scripts/ops-watch.sh [interval_seconds]
set -u
TOKEN_FILE=${OPS_TOKEN_FILE:-$HOME/.rep-secrets/ops.token}
[ -r "$TOKEN_FILE" ] || { echo "ops-watch: no token at $TOKEN_FILE"; exit 1; }
INTERVAL=${1:-60}
TARGETS=("backend https://stellarbob2026.xyz" "bridge https://bookerbob-ucp-bridge.fly.dev")

# Reads {errors:[...]} on stdin, prints one line per error to stdout, and the newest timestamp to fd 3.
read -r -d '' PY <<'PYEOF'
import json, sys, datetime, os
name = sys.argv[1]
out3 = os.fdopen(3, "w")
try:
    d = json.load(sys.stdin)
except Exception:
    print("%s ops-watch %s: bad response" % (datetime.datetime.now().strftime("%H:%M:%S"), name))
    out3.write("0"); sys.exit()
if "errors" not in d:
    print("%s ops-watch %s: %s" % (datetime.datetime.now().strftime("%H:%M:%S"), name, d.get("error", "no errors field")))
    out3.write("0"); sys.exit()
newest = 0
for e in d["errors"]:
    t = datetime.datetime.fromtimestamp(e["at"] / 1000.0).strftime("%H:%M:%S")
    extra = " ".join(x for x in [e.get("path") or "", e.get("release") or "", e.get("ua") or ""] if x)
    line = "%s %s %s %s: %s" % (t, name, e.get("source", "?"), e.get("kind", "?"), e.get("message", ""))
    print((line + "  [" + extra + "]") if extra else line)
    newest = max(newest, e["at"])
out3.write(str(newest))
PYEOF

typeset -A SINCE DOWN
for t in $TARGETS; do n=${t%% *}; SINCE[$n]=$(( $(date +%s) * 1000 )); DOWN[$n]=0; done   # only errors from now on
while true; do
  for t in $TARGETS; do
    n=${t%% *}; base=${t##* }
    body=$(curl -s -f -m 15 -H "authorization: Bearer $(cat $TOKEN_FILE)" "$base/api/ops/errors?since=${SINCE[$n]}")
    if [ $? -ne 0 ]; then
      [ ${DOWN[$n]} -eq 0 ] && echo "$(date +%H:%M:%S) ops-watch $n: unreachable or refused"
      DOWN[$n]=1; continue
    fi
    [ ${DOWN[$n]} -eq 1 ] && echo "$(date +%H:%M:%S) ops-watch $n: reachable again"
    DOWN[$n]=0
    tmp=$(mktemp)
    print -r -- "$body" | python3 -c "$PY" "$n" 3>"$tmp"
    newest=$(cat "$tmp"); rm -f "$tmp"
    [ "${newest:-0}" -gt 0 ] 2>/dev/null && SINCE[$n]=$newest
  done
  sleep $INTERVAL
done
