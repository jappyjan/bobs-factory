#!/usr/bin/env bash
# Real HTTP probes, usable with the native smoke's OS-only PATH.
check_dashboard_access() {
  local base="$1" public_host="$2" output="$3" status field
  status="$(curl -sS -o "$output/state.json" -w '%{http_code}' "$base/api/config")"
  [[ "$status" == 200 ]] || { echo "Expected direct local API 200; got $status"; return 1; }
  grep -q '"onboarding"' "$output/state.json" || return 1
  grep -q '"required":true' "$output/state.json" || return 1
  curl -fsS "$base/api/auth/status" > "$output/local-access.json" || return 1
  for field in '"access":"local"' '"authenticated":true' '"setupRequired":false'; do
    grep -q "$field" "$output/local-access.json" || { echo "Missing local access field: $field"; return 1; }
  done
  status="$(curl -sS -H "Host: $public_host" -o "$output/remote-denied.json" -w '%{http_code}' "$base/api/config")"
  [[ "$status" == 401 ]] || { echo "Expected public Host unauthenticated API 401; got $status"; return 1; }
  grep -q '"code":"FACTORY_AUTH_REQUIRED"' "$output/remote-denied.json" || return 1
  status="$(curl -sS -H 'Origin: https://foreign.example.invalid' -o "$output/foreign-origin.json" -w '%{http_code}' "$base/api/config")"
  [[ "$status" == 403 ]] || { echo "Expected foreign Origin API 403; got $status"; return 1; }
  status="$(curl -sS -H 'Sec-Fetch-Site: cross-site' -o "$output/cross-site.json" -w '%{http_code}' "$base/api/config")"
  [[ "$status" == 403 ]] || { echo "Expected cross-site local API 403; got $status"; return 1; }
  status="$(curl -sS -H 'X-Forwarded-For: 203.0.113.1' -o "$output/forwarded-local.json" -w '%{http_code}' "$base/api/config")"
  [[ "$status" == 403 ]] || { echo "Expected forwarded local authority API 403; got $status"; return 1; }
}
