#!/usr/bin/env bash
set -uo pipefail

# Issue #725 audit-v2 collector. This script is intentionally read-only: it
# does not install packages, write files, inspect process environments, print
# command lines, or read application/customer data. Output is one JSON object.
export LC_ALL=C

readonly SCHEMA="moawork-vps-readonly-v2"
readonly REQUIRED_FIELDS_DIGEST="07784443e2d7432886712753c273a917ac51eedd3e63933d72b60d0b97a4690d"
readonly COLLECTOR="ops/vps/audit-host-readonly.sh"
readonly COLLECTOR_VERSION=2
readonly TIMEOUT_BIN="/usr/bin/timeout"
readonly QUERY_TIMEOUT="12s"
readonly -a REQUIRED_PROBES=(
  caddy.closure caddy.root caddy.validate filesystem.executables filesystem.paths
  identity.auditActor identity.accounts identity.machine listeners.all
  listeners.candidatePorts resources.host resources.samples services.caddy
  services.docker services.hermes services.salespt globalNode
)
readonly -a REQUIRED_PATHS=(
  "caddy.active|/etc/caddy/moawork.d/active.caddy"
  "caddy.include|/etc/caddy/moawork.caddy"
  "caddy.managedDirectory|/etc/caddy/moawork.d"
  "caddy.root|/etc/caddy/Caddyfile"
  "global.nodeLink|/usr/local/bin/node"
  "global.nodeParent|/opt/moawork"
  "global.nodeRoot|/opt/moawork/node-22.23.2"
  "global.nodeTarget|/opt/moawork/node-22.23.2/bin/node"
  "moawork.config|/etc/moawork"
  "moawork.deployHome|/home/moawork-deploy"
  "moawork.provisionLock|/run/lock/moawork-provision.lock"
  "moawork.releaseConfig|/etc/moawork/release.json"
  "moawork.releaseLock|/srv/moawork/release.lock"
  "moawork.releaseState|/srv/moawork/state.json"
  "moawork.root|/srv/moawork"
  "moawork.runtimeEnv|/etc/moawork/runtime.env"
  "moawork.trustedBuilderKey|/etc/moawork/trusted-builder.pem"
  "systemd.blue|/etc/systemd/system/moawork-web-blue.service"
  "systemd.blueEnabled|/etc/systemd/system/multi-user.target.wants/moawork-web-blue.service"
  "systemd.green|/etc/systemd/system/moawork-web-green.service"
  "systemd.greenEnabled|/etc/systemd/system/multi-user.target.wants/moawork-web-green.service"
  "systemd.policy|/etc/polkit-1/rules.d/70-moawork-deploy.rules"
)

declare -A PROBE_STATE=()
declare -A PROBE_REASON=()
declare -A PROBE_VALUE=()

run_bounded() {
  "$TIMEOUT_BIN" --signal=TERM --kill-after=2s "$QUERY_TIMEOUT" "$@"
}

json_quote() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\001'/\\u0001}"
  value="${value//$'\002'/\\u0002}"
  value="${value//$'\003'/\\u0003}"
  value="${value//$'\004'/\\u0004}"
  value="${value//$'\005'/\\u0005}"
  value="${value//$'\006'/\\u0006}"
  value="${value//$'\007'/\\u0007}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  value="${value//$'\013'/\\u000b}"
  value="${value//$'\016'/\\u000e}"
  value="${value//$'\017'/\\u000f}"
  value="${value//$'\020'/\\u0010}"
  value="${value//$'\021'/\\u0011}"
  value="${value//$'\022'/\\u0012}"
  value="${value//$'\023'/\\u0013}"
  value="${value//$'\024'/\\u0014}"
  value="${value//$'\025'/\\u0015}"
  value="${value//$'\026'/\\u0016}"
  value="${value//$'\027'/\\u0017}"
  value="${value//$'\030'/\\u0018}"
  value="${value//$'\031'/\\u0019}"
  value="${value//$'\032'/\\u001a}"
  value="${value//$'\033'/\\u001b}"
  value="${value//$'\034'/\\u001c}"
  value="${value//$'\035'/\\u001d}"
  value="${value//$'\036'/\\u001e}"
  value="${value//$'\037'/\\u001f}"
  printf '"%s"' "$value"
}

json_nullable_string() {
  if [[ -n "${1-}" ]]; then json_quote "$1"; else printf 'null'; fi
}

json_number_or_null() {
  if [[ "${1-}" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi
}

sha256_text() {
  sha256sum | awk '{print $1}'
}

sha256_file() {
  run_bounded sha256sum -- "$1" 2>/dev/null | awk '{print $1}'
}

probe() {
  local name="$1" state="$2" reason="$3" value="$4"
  PROBE_STATE["$name"]="$state"
  PROBE_REASON["$name"]="$reason"
  PROBE_VALUE["$name"]="$value"
}

metadata_json() {
  local path="$1" logical_key="$2"
  local stat_value type uid gid mode nlink resolved current first ancestor_json="[" ancestors_safe=true
  if stat_value="$(run_bounded stat -c '%F|%u|%g|%a|%h' -- "$path" 2>/dev/null)"; then
    IFS='|' read -r type uid gid mode nlink <<<"$stat_value"
    resolved="$(run_bounded realpath -- "$path" 2>/dev/null || true)"
  else
    if [[ -e "$path" ]]; then return 2; fi
    type="absent"; uid="null"; gid="null"; mode="null"; nlink="null"; resolved=""
  fi

  current="/"
  first=true
  if ! ancestor_stat="$(run_bounded stat -c '%F|%u|%g|%a' -- / 2>/dev/null)"; then return 2; fi
  IFS='|' read -r ancestor_type ancestor_uid ancestor_gid ancestor_mode <<<"$ancestor_stat"
  ancestor_real="$(run_bounded realpath -- / 2>/dev/null || true)"
  if [[ "$ancestor_type" == "symbolic link" || "$ancestor_uid" != 0 ]] \
    || (( (8#${ancestor_mode: -3} & 0002) != 0 )) \
    || { (( (8#${ancestor_mode: -3} & 0020) != 0 )) && [[ "$ancestor_gid" != 0 ]]; }; then ancestors_safe=false; fi
  ancestor_json+="{\"gid\":$ancestor_gid,\"mode\":$(json_quote "$ancestor_mode"),\"path\":\"/\",\"realpath\":$(json_quote "$ancestor_real"),\"type\":$(json_quote "$ancestor_type"),\"uid\":$ancestor_uid}"
  first=false
  IFS='/' read -r -a path_parts <<<"${path#/}"
  local part ancestor_stat ancestor_type ancestor_uid ancestor_gid ancestor_mode ancestor_real
  for part in "${path_parts[@]}"; do
    [[ -z "$part" ]] && continue
    current="${current%/}/$part"
    if [[ "$current" == "$path" ]]; then
      if [[ "$type" == absent && ! -x "$(dirname -- "$current")" ]]; then return 2; fi
      break
    fi
    if ! ancestor_stat="$(run_bounded stat -c '%F|%u|%g|%a' -- "$current" 2>/dev/null)"; then
      if [[ -e "$current" || ! -x "$(dirname -- "$current")" ]]; then return 2; fi
      break
    fi
    IFS='|' read -r ancestor_type ancestor_uid ancestor_gid ancestor_mode <<<"$ancestor_stat"
    ancestor_real="$(run_bounded realpath -- "$current" 2>/dev/null || true)"
    if [[ "$ancestor_type" == "symbolic link" || "$ancestor_uid" != 0 ]] \
      || (( (8#${ancestor_mode: -3} & 0002) != 0 )) \
      || { (( (8#${ancestor_mode: -3} & 0020) != 0 )) && [[ "$ancestor_gid" != 0 ]]; }; then ancestors_safe=false; fi
    $first || ancestor_json+=","
    first=false
    ancestor_json+="{\"gid\":$ancestor_gid,\"mode\":$(json_quote "$ancestor_mode"),\"path\":$(json_quote "$current"),\"realpath\":$(json_quote "$ancestor_real"),\"type\":$(json_quote "$ancestor_type"),\"uid\":$ancestor_uid}"
  done
  ancestor_json+="]"
  printf '{"ancestors":%s,"ancestorsSafe":%s,"gid":%s,"logicalKey":%s,"mode":%s,"nlink":%s,"path":%s,"realpath":%s,"type":%s,"uid":%s}' \
    "$ancestor_json" "$ancestors_safe" "$gid" "$(json_quote "$logical_key")" "$(if [[ "$mode" == null ]]; then printf null; else json_quote "$mode"; fi)" "$nlink" \
    "$(json_quote "$path")" "$(json_nullable_string "$resolved")" "$(json_quote "$type")" "$uid"
}

collect_actor() {
  local euid egid groups groups_raw
  euid="$(run_bounded id -u 2>/dev/null || true)"; egid="$(run_bounded id -g 2>/dev/null || true)"
  if ! groups_raw="$(run_bounded id -G 2>/dev/null)"; then groups_raw=""; fi
  groups="$(printf '%s' "$groups_raw" | tr ' ' '\n' | awk 'NF' | sort -n | paste -sd, - || true)"
  if [[ ! "$euid" =~ ^[0-9]+$ || ! "$egid" =~ ^[0-9]+$ || -z "$groups" ]]; then
    probe identity.auditActor error IDENTITY_QUERY_FAILED null
    return
  fi
  local groups_json="[${groups}]"
  if [[ "$euid" != 0 ]]; then
    probe identity.auditActor unknown AUDIT_REQUIRES_ROOT "{\"egid\":$egid,\"euid\":$euid,\"supplementaryGids\":$groups_json}"
  else
    probe identity.auditActor ok "" "{\"egid\":$egid,\"euid\":$euid,\"supplementaryGids\":$groups_json}"
  fi
}

collect_accounts() {
  local account passwd row status uid gid home shell shadow locked groups groups_raw entries="[" first=true query_failed=false
  for account in moawork moawork-deploy; do
    if row="$(run_bounded getent passwd "$account" 2>/dev/null)"; then
      if [[ -z "$row" ]]; then query_failed=true; fi
    else
      status=$?
      if [[ "$status" == 2 ]]; then row=""; else query_failed=true; row=""; fi
    fi
    if [[ -n "$row" ]]; then
      IFS=':' read -r _ passwd uid gid _ home shell <<<"$row"
      shadow="$(run_bounded getent shadow "$account" 2>/dev/null || true)"
      if [[ -z "$shadow" ]]; then query_failed=true; locked=null
      else
        passwd="${shadow#*:}"; passwd="${passwd%%:*}"
        if [[ -z "$passwd" ]]; then query_failed=true; locked=null
        elif [[ "$passwd" == '!'* || "$passwd" == '*'* ]]; then locked=true; else locked=false; fi
      fi
      if groups_raw="$(run_bounded id -G "$account" 2>/dev/null)" && [[ "$groups_raw" =~ ^[0-9]+([[:space:]]+[0-9]+)*[[:space:]]*$ ]]; then
        groups="$(printf '%s' "$groups_raw" | tr ' ' '\n' | awk -v primary="$gid" 'NF && $1 != primary' | sort -nu | paste -sd, -)"
      else
        query_failed=true
        groups=""
      fi
      $first || entries+=","; first=false
      entries+="{\"gid\":$gid,\"home\":$(json_quote "$home"),\"name\":$(json_quote "$account"),\"passwordLocked\":$locked,\"present\":true,\"shell\":$(json_quote "$shell"),\"supplementaryGids\":[${groups}],\"uid\":$uid}"
    else
      $first || entries+=","; first=false
      entries+="{\"gid\":null,\"home\":null,\"name\":$(json_quote "$account"),\"passwordLocked\":null,\"present\":false,\"shell\":null,\"supplementaryGids\":[],\"uid\":null}"
    fi
  done
  entries+="]"
  if $query_failed; then probe identity.accounts error ACCOUNT_METADATA_UNREADABLE "$entries"; else probe identity.accounts ok "" "$entries"; fi
}

collect_machine() {
  local host_identity_digest="" kernel_arch kernel_release kernel_system kernel_version node_arch="unknown"
  kernel_arch="$(run_bounded uname -m 2>/dev/null || true)"; kernel_release="$(run_bounded uname -r 2>/dev/null || true)"
  kernel_system="$(run_bounded uname -s 2>/dev/null || true)"; kernel_version="$(run_bounded uname -v 2>/dev/null || true)"
  if command -v node >/dev/null 2>&1; then node_arch="$(run_bounded node -p 'process.arch' 2>/dev/null || true)"; fi
  if [[ -r /etc/machine-id ]]; then
    host_identity_digest="$(sha256_file /etc/machine-id)"
  elif compgen -G '/etc/ssh/ssh_host_*_key.pub' >/dev/null; then
    host_identity_digest="$(for key in /etc/ssh/ssh_host_*_key.pub; do sha256_file "$key"; done | sort | sha256_text)"
  fi
  if [[ -z "$host_identity_digest" || -z "$kernel_arch" || -z "$kernel_release" || -z "$kernel_system" || -z "$kernel_version" ]]; then
    probe identity.machine error MACHINE_QUERY_FAILED null
  else
    probe identity.machine ok "" "{\"hostIdentityDigest\":$(json_quote "$host_identity_digest"),\"kernelArch\":$(json_quote "$kernel_arch"),\"kernelRelease\":$(json_quote "$kernel_release"),\"kernelSystem\":$(json_quote "$kernel_system"),\"kernelVersion\":$(json_quote "$kernel_version"),\"nodeArch\":$(json_quote "$node_arch")}"
  fi
}

collect_paths() {
  local definition logical path value entries="[" first=true failed=false
  for definition in "${REQUIRED_PATHS[@]}"; do
    logical="${definition%%|*}"; path="${definition#*|}"
    if value="$(metadata_json "$path" "$logical")"; then :; else failed=true; value="null"; fi
    $first || entries+=","; first=false; entries+="$value"
  done
  entries+="]"
  if $failed; then probe filesystem.paths error PATH_METADATA_UNREADABLE null; else probe filesystem.paths ok "" "$entries"; fi
}

executable_json() {
  local name="$1" path stat_value type uid gid mode nlink resolved digest
  path="$(command -v "$name" 2>/dev/null || true)"
  [[ -n "$path" ]] || return 1
  stat_value="$(run_bounded stat -c '%F|%u|%g|%a|%h' -- "$path" 2>/dev/null)" || return 2
  IFS='|' read -r type uid gid mode nlink <<<"$stat_value"
  resolved="$(run_bounded realpath -- "$path" 2>/dev/null)" || return 2
  digest="$(sha256_file "$resolved")"; [[ -n "$digest" ]] || return 2
  printf '{"digest":%s,"gid":%s,"mode":%s,"name":%s,"nlink":%s,"path":%s,"realpath":%s,"type":%s,"uid":%s}' \
    "$(json_quote "$digest")" "$gid" "$(json_quote "$mode")" "$(json_quote "$name")" "$nlink" "$(json_quote "$path")" "$(json_quote "$resolved")" "$(json_quote "$type")" "$uid"
}

collect_executables() {
  local name value entries="[" first=true failed=false
  for name in systemctl caddy docker; do
    if value="$(executable_json "$name")"; then :; else failed=true; value="{\"digest\":null,\"gid\":null,\"mode\":null,\"name\":$(json_quote "$name"),\"nlink\":null,\"path\":null,\"realpath\":null,\"type\":\"absent\",\"uid\":null}"; fi
    $first || entries+=","; first=false; entries+="$value"
  done
  entries+="]"
  if $failed; then probe filesystem.executables unknown EXECUTABLE_METADATA_INCOMPLETE "$entries"; else probe filesystem.executables ok "" "$entries"; fi
}

collect_global_node() {
  local path resolved stat_value type uid gid mode nlink digest version arch platform
  path="$(command -v node 2>/dev/null || true)"
  if [[ -z "$path" ]]; then probe globalNode unknown GLOBAL_NODE_ABSENT null; return; fi
  if ! resolved="$(run_bounded realpath -- "$path" 2>/dev/null)" || ! stat_value="$(run_bounded stat -c '%F|%u|%g|%a|%h' -- "$path" 2>/dev/null)"; then
    probe globalNode error GLOBAL_NODE_METADATA_UNREADABLE null; return
  fi
  IFS='|' read -r type uid gid mode nlink <<<"$stat_value"
  digest="$(sha256_file "$resolved")"; version="$(run_bounded node --version 2>/dev/null || true)"
  arch="$(run_bounded node -p 'process.arch' 2>/dev/null || true)"; platform="$(run_bounded node -p 'process.platform' 2>/dev/null || true)"
  if [[ -z "$digest" || -z "$version" || -z "$arch" || -z "$platform" ]]; then probe globalNode error GLOBAL_NODE_QUERY_FAILED null; return; fi
  probe globalNode ok "" "{\"arch\":$(json_quote "$arch"),\"digest\":$(json_quote "$digest"),\"gid\":$gid,\"mode\":$(json_quote "$mode"),\"nlink\":$nlink,\"path\":$(json_quote "$path"),\"platform\":$(json_quote "$platform"),\"realpath\":$(json_quote "$resolved"),\"type\":$(json_quote "$type"),\"uid\":$uid,\"version\":$(json_quote "$version")}"
}

collect_listeners() {
  local raw count digest entries="[" first=true port family loopback rechecked port_raw
  if ! command -v ss >/dev/null 2>&1; then
    probe listeners.all unknown LISTENER_TOOL_ABSENT null
    probe listeners.candidatePorts unknown LISTENER_TOOL_ABSENT null
    return
  fi
  if ! raw="$(run_bounded ss -H -lntup 2>/dev/null)"; then
    probe listeners.all error LISTENER_QUERY_FAILED null
    probe listeners.candidatePorts error LISTENER_QUERY_FAILED null
    return
  fi
  count="$(printf '%s\n' "$raw" | awk 'NF {count++} END {print count+0}')"
  digest="$(printf '%s' "$raw" | sha256_text)"
  probe listeners.all ok "" "{\"digest\":$(json_quote "$digest"),\"listenCount\":$count,\"query\":\"tcp-and-udp-all-address-families\"}"
  for port in 3000 3100 3101 3102; do
    for family in ipv4 ipv6; do
      if [[ "$family" == ipv4 ]]; then
        if ! port_raw="$(run_bounded ss -H -4 -ltnp "sport = :$port" 2>/dev/null)"; then probe listeners.candidatePorts error LISTENER_RECHECK_FAILED null; return; fi
        count="$(printf '%s\n' "$port_raw" | awk 'NF {count++} END {print count+0}')"
        loopback="$(printf '%s\n' "$port_raw" | awk 'NF && $4 !~ /^(127\.|localhost:)/ {bad=1} END {print bad ? "false" : "true"}')"
      else
        if ! port_raw="$(run_bounded ss -H -6 -ltnp "sport = :$port" 2>/dev/null)"; then probe listeners.candidatePorts error LISTENER_RECHECK_FAILED null; return; fi
        count="$(printf '%s\n' "$port_raw" | awk 'NF {count++} END {print count+0}')"
        loopback="$(printf '%s\n' "$port_raw" | awk 'NF && $4 !~ /^\[::1\]:/ {bad=1} END {print bad ? "false" : "true"}')"
      fi
      rechecked="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      $first || entries+=","; first=false
      entries+="{\"addressFamily\":$(json_quote "$family"),\"listenCount\":$count,\"loopbackOnly\":$loopback,\"port\":$port,\"recheckedAtUtc\":$(json_quote "$rechecked")}"
    done
  done
  entries+="]"
  probe listeners.candidatePorts ok "" "$entries"
}

collect_caddy() {
  collect_caddy_from_root /etc/caddy/Caddyfile "$(command -v caddy 2>/dev/null || true)"
}

collect_caddy_from_root() {
  local root="$1" caddy_path="$2" meta digest root_value closure_entries="[" first=true closure_failed=false
  local -a queue=() seen=()
  local file resolved stat_value type uid gid mode nlink line token base match import_lines import_status entry_digest path_digest realpath_digest adapted_output adapted_status adapted_digest="" closure_digest
  local config_root_dir managed_include managed_directory managed_empty_glob managed_active managed_comment managed_import managed_import_occurrences unmanaged_digest ends_with_newline file_size managed_block_size managed_block_digest suffix_digest glob_output glob_status glob_stat glob_realpath glob_children glob_realpath_status find_status
  if [[ ! -e "$root" ]]; then
    probe caddy.root absent ABSENT null
    probe caddy.closure absent ABSENT "{\"adaptedDigest\":null,\"complete\":true,\"digest\":null,\"entries\":[],\"entryCount\":0}"
    probe caddy.validate absent ABSENT null
    return
  fi
  if ! stat_value="$(run_bounded stat -c '%F|%u|%g|%a|%h' -- "$root" 2>/dev/null)" || ! resolved="$(run_bounded realpath -- "$root" 2>/dev/null)"; then
    probe caddy.root error CADDY_ROOT_UNREADABLE null; probe caddy.closure error CADDY_CLOSURE_UNREADABLE null; probe caddy.validate error CADDY_VALIDATE_UNAVAILABLE null; return
  fi
  IFS='|' read -r type uid gid mode nlink <<<"$stat_value"; digest="$(sha256_file "$resolved")"
  config_root_dir="$(dirname -- "$resolved")"
  managed_include="$config_root_dir/moawork.caddy"
  managed_directory="$config_root_dir/moawork.d"
  managed_empty_glob="$managed_directory/*.caddy"
  managed_active="$managed_directory/active.caddy"
  managed_comment="# Managed MoaWork import. Existing unrelated site blocks remain outside this file."
  managed_import="import $managed_include"
  managed_import_occurrences="$(grep -Fxc -- "$managed_import" "$resolved" 2>/dev/null || true)"
  file_size="$(run_bounded stat -c '%s' -- "$resolved")"
  if [[ "$file_size" -gt 0 && "$(run_bounded tail -c 1 -- "$resolved" | od -An -tx1 | tr -d '[:space:]')" == "0a" ]]; then ends_with_newline=true; else ends_with_newline=false; fi
  managed_block_size="$(printf '\n%s\n%s\n' "$managed_comment" "$managed_import" | wc -c | tr -d '[:space:]')"
  managed_block_digest="$(printf '\n%s\n%s\n' "$managed_comment" "$managed_import" | sha256_text)"
  if [[ "$managed_import_occurrences" == 1 && "$file_size" -ge "$managed_block_size" ]]; then
    suffix_digest="$(run_bounded tail -c "$managed_block_size" -- "$resolved" | sha256_text)"
  else suffix_digest=""; fi
  if [[ "$suffix_digest" == "$managed_block_digest" ]]; then
    unmanaged_digest="$(run_bounded head -c "$((file_size - managed_block_size))" -- "$resolved" | sha256_text)"
  else
    unmanaged_digest="$digest"
  fi
  root_value="{\"configPath\":$(json_quote "$root"),\"digest\":$(json_quote "$digest"),\"endsWithNewline\":$ends_with_newline,\"gid\":$gid,\"managedImportOccurrences\":$managed_import_occurrences,\"mode\":$(json_quote "$mode"),\"nlink\":$nlink,\"realpath\":$(json_quote "$resolved"),\"type\":$(json_quote "$type"),\"uid\":$uid,\"unmanagedDigest\":$(json_quote "$unmanaged_digest")}"
  probe caddy.root ok "" "$root_value"
  queue+=("$resolved")
  while ((${#queue[@]})); do
    file="${queue[0]}"; queue=("${queue[@]:1}")
    if printf '%s\n' "${seen[@]-}" | grep -Fxq -- "$file"; then continue; fi
    seen+=("$file")
    if ! stat_value="$(run_bounded stat -c '%F|%u|%g|%a|%h' -- "$file" 2>/dev/null)" || ! resolved="$(run_bounded realpath -- "$file" 2>/dev/null)"; then closure_failed=true; continue; fi
    IFS='|' read -r type uid gid mode nlink <<<"$stat_value"; entry_digest="$(sha256_file "$resolved")"
    [[ -n "$entry_digest" ]] || { closure_failed=true; continue; }
    path_digest="$(printf '%s' "$file" | sha256_text)"; realpath_digest="$(printf '%s' "$resolved" | sha256_text)"
    $first || closure_entries+=","; first=false
    closure_entries+="{\"digest\":$(json_quote "$entry_digest"),\"gid\":$gid,\"mode\":$(json_quote "$mode"),\"nlink\":$nlink,\"pathDigest\":$(json_quote "$path_digest"),\"realpathDigest\":$(json_quote "$realpath_digest"),\"type\":$(json_quote "$type"),\"uid\":$uid}"
    base="$(dirname -- "$resolved")"
    import_lines="$(grep -E '^[[:space:]]*import[[:space:]]+' -- "$resolved" 2>/dev/null)"; import_status=$?
    if [[ "$import_status" != 0 && "$import_status" != 1 ]]; then closure_failed=true; continue; fi
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      token="${line#*import }"; token="${token%%[[:space:]]*}"; token="${token%\"}"; token="${token#\"}"; token="${token%\'}"; token="${token#\'}"
      [[ -z "$token" || "$token" == *'{'* || "$token" == *'}'* || "$token" == http* ]] && { closure_failed=true; continue; }
      [[ "$token" == /* ]] || token="$base/$token"
      if [[ "$token" == *'*'* || "$token" == *'?'* || "$token" == *'['* ]]; then
        glob_output="$(compgen -G "$token" 2>/dev/null)"; glob_status=$?
        if [[ "$glob_status" == 0 && -n "$glob_output" ]]; then
          while IFS= read -r match; do [[ -n "$match" ]] && queue+=("$match"); done < <(printf '%s\n' "$glob_output" | sort)
        elif [[ "$glob_status" == 1 && "$resolved" == "$managed_include" && "$token" == "$managed_empty_glob" && ! -e "$managed_active" ]]; then
          glob_stat="$(run_bounded stat -c '%F' -- "$managed_directory" 2>/dev/null)"; glob_status=$?
          glob_realpath="$(run_bounded realpath -- "$managed_directory" 2>/dev/null)"; glob_realpath_status=$?
          glob_children="$(run_bounded find "$managed_directory" -mindepth 1 -maxdepth 1 -name '*.caddy' -print -quit 2>/dev/null)"; find_status=$?
          if [[ "$glob_status" == 0
            && "$glob_realpath_status" == 0
            && "$find_status" == 0
            && -r "$managed_directory"
            && -x "$managed_directory"
            && "$glob_stat" == "directory"
            && "$glob_realpath" == "$managed_directory"
            && -z "$glob_children" ]]; then
            : # Reviewed first-install state: managed include exists, but no active route is published yet.
          else
            closure_failed=true
          fi
        else
          closure_failed=true
        fi
      elif [[ -f "$token" ]]; then queue+=("$token")
      elif [[ "$(basename -- "$token")" =~ ^[A-Za-z0-9_-]+$ ]]; then :
      else closure_failed=true; fi
    done <<<"$import_lines"
  done
  closure_entries+="]"
  closure_digest="$(printf '%s' "$closure_entries" | sha256_text)"
  if [[ -n "$caddy_path" ]]; then
    adapted_output="$(run_bounded "$caddy_path" adapt --config "$root" --adapter caddyfile 2>/dev/null)"; adapted_status=$?
    if [[ "$adapted_status" == 0 && -n "$adapted_output" ]]; then adapted_digest="$(printf '%s' "$adapted_output" | sha256_text)"; else closure_failed=true; fi
  else
    closure_failed=true
  fi
  if $closure_failed; then probe caddy.closure error CADDY_IMPORT_CLOSURE_INCOMPLETE "{\"adaptedDigest\":$(json_nullable_string "$adapted_digest"),\"complete\":false,\"digest\":$(json_quote "$closure_digest"),\"entries\":$closure_entries,\"entryCount\":${#seen[@]}}"
  else probe caddy.closure ok "" "{\"adaptedDigest\":$(json_quote "$adapted_digest"),\"complete\":true,\"digest\":$(json_quote "$closure_digest"),\"entries\":$closure_entries,\"entryCount\":${#seen[@]}}"; fi
  if [[ -z "$caddy_path" ]]; then probe caddy.validate unknown CADDY_EXECUTABLE_ABSENT null
  elif [[ "$adapted_status" == 0 && -n "$adapted_digest" ]]; then
    # Read-only collection deliberately stops at adapter parsing. `caddy validate`
    # provisions configured modules and therefore belongs only to the explicitly
    # confirmed apply/postflight phase, never to this host-observation collector.
    probe caddy.validate ok "" "{\"adapter\":\"caddyfile\",\"configPath\":$(json_quote "$root"),\"mode\":\"read-only-adapt\",\"validated\":false,\"validationDigest\":$(json_quote "$adapted_digest")}"
  else
    probe caddy.validate error CADDY_ADAPT_FAILED null
  fi
}

systemd_service_json() {
  local unit="$1" health="$2" values key value fragment digest dropin_path dropin_file_digest dropin_lines="" dropin_digest identity required
  local -a keys=(LoadState ActiveState SubState MainPID NRestarts MemoryCurrent CPUUsageNSec MemoryMax TasksCurrent TasksMax CPUQuotaPerSecUSec Restart User Group FragmentPath DropInPaths)
  values="$(run_bounded systemctl show "$unit" $(printf -- '--property=%s ' "${keys[@]}") 2>/dev/null)" || return 1
  declare -A field=()
  while IFS='=' read -r key value; do field["$key"]="$value"; done <<<"$values"
  for required in "${keys[@]}"; do [[ "${field[$required]+present}" == present ]] || return 1; done
  [[ -n "${field[LoadState]}" ]] || return 1
  for required in NRestarts MemoryCurrent CPUUsageNSec TasksCurrent; do
    [[ "${field[$required]}" =~ ^[0-9]+$ ]] || return 1
  done
  for required in MemoryMax TasksMax CPUQuotaPerSecUSec; do
    [[ "${field[$required]}" == infinity || "${field[$required]}" =~ ^[0-9]+$ ]] || return 1
  done
  [[ -n "${field[ActiveState]}" && -n "${field[SubState]}" && -n "${field[Restart]}" ]] || return 1
  fragment="${field[FragmentPath]-}"; digest=""; [[ -z "$fragment" ]] || digest="$(sha256_file "$fragment")"
  if [[ "${field[LoadState]}" == loaded && ( -z "$fragment" || -z "$digest" ) ]]; then return 1; fi
  for dropin_path in ${field[DropInPaths]}; do
    dropin_file_digest="$(sha256_file "$dropin_path")"; [[ -n "$dropin_file_digest" ]] || return 1
    dropin_lines+="${dropin_path}"$'\037'"${dropin_file_digest}"$'\n'
  done
  dropin_digest="$(printf '%s' "$dropin_lines" | sha256_text)"
  identity="$(printf '%s\037%s\037%s\037%s\037%s\037%s' "$unit" "${field[User]-}" "${field[Group]-}" "$fragment" "$digest" "$dropin_digest" | sha256_text)"
  printf '{"activeState":%s,"cpuQuotaPerSecUSec":%s,"cpuUsageNSec":%s,"dropInDigest":%s,"fragmentDigest":%s,"group":%s,"health":%s,"identityDigest":%s,"loadState":%s,"memoryCurrent":%s,"memoryMax":%s,"restartCount":%s,"restartPolicy":%s,"subState":%s,"tasksCurrent":%s,"tasksMax":%s,"unit":%s,"user":%s}' \
    "$(json_quote "${field[ActiveState]-unknown}")" "$(json_nullable_string "${field[CPUQuotaPerSecUSec]-}")" "$(json_nullable_string "${field[CPUUsageNSec]-}")" "$(json_quote "$dropin_digest")" "$(json_nullable_string "$digest")" "$(json_nullable_string "${field[Group]-}")" "$health" "$(json_quote "$identity")" "$(json_quote "${field[LoadState]}")" "$(json_nullable_string "${field[MemoryCurrent]-}")" "$(json_nullable_string "${field[MemoryMax]-}")" "$(json_number_or_null "${field[NRestarts]-}")" "$(json_nullable_string "${field[Restart]-}")" "$(json_quote "${field[SubState]-unknown}")" "$(json_number_or_null "${field[TasksCurrent]-}")" "$(json_nullable_string "${field[TasksMax]-}")" "$(json_quote "$unit")" "$(json_nullable_string "${field[User]-}")"
}

http_health_json() {
  local url="$1" scope="$2" result status code seconds endpoint_digest
  result="$(curl --silent --show-error --output /dev/null --connect-timeout 3 --max-time 10 --write-out '%{http_code}|%{time_total}' "$url" 2>/dev/null)"; status=$?
  code="${result%%|*}"; seconds="${result#*|}"
  endpoint_digest="$(printf '%s' "$url" | sha256_text)"
  [[ "$status" == 0 && "$code" =~ ^[0-9]{3}$ ]] || { printf '{"httpStatus":null,"identityDigest":%s,"latencyMs":null,"scope":%s}' "$(json_quote "$endpoint_digest")" "$(json_quote "$scope")"; return; }
  printf '{"httpStatus":%s,"identityDigest":%s,"latencyMs":%s,"scope":%s}' "$code" "$(json_quote "$endpoint_digest")" "$(awk -v s="$seconds" 'BEGIN {printf "%d", s*1000}')" "$(json_quote "$scope")"
}

collect_services() {
  local value health local_health public_health health_state
  health='{"checks":[],"state":"not-applicable"}'
  if value="$(systemd_service_json caddy.service "$health")"; then
    if [[ "$value" == *'"loadState":"not-found"'* ]]; then probe services.caddy absent SERVICE_NOT_FOUND "$value"; else probe services.caddy ok "" "$value"; fi
  else probe services.caddy error SYSTEMD_QUERY_FAILED null; fi
  if value="$(systemd_service_json docker.service "$health")"; then
    if [[ "$value" == *'"loadState":"not-found"'* ]]; then probe services.docker absent SERVICE_NOT_FOUND "$value"; else probe services.docker ok "" "$value"; fi
  else probe services.docker error SYSTEMD_QUERY_FAILED null; fi
  local_health="$(http_health_json http://127.0.0.1:3000/api/health local)"
  public_health="$(http_health_json https://salesptlog.online/api/health public)"
  if [[ "$local_health" == *'"httpStatus":2'* && "$public_health" == *'"httpStatus":2'* ]]; then health_state=healthy
  elif [[ "$local_health" == *'"httpStatus":null'* || "$public_health" == *'"httpStatus":null'* ]]; then health_state=unknown
  else health_state=unhealthy; fi
  health="{\"checks\":[$local_health,$public_health],\"state\":$(json_quote "$health_state")}"
  if value="$(systemd_service_json salespt-bot.service "$health")"; then
    if [[ "$value" == *'"loadState":"not-found"'* ]]; then probe services.salespt absent SERVICE_NOT_FOUND "$value"
    elif [[ "$health_state" == unknown ]]; then probe services.salespt unknown SERVICE_HEALTH_UNAVAILABLE "$value"
    else probe services.salespt ok "" "$value"; fi
  else probe services.salespt error SYSTEMD_QUERY_FAILED null; fi
  collect_hermes
}

collect_hermes() {
  local -a containers=()
  local handle container_id name names_output index=0 raw inspect_id inspect_image entries="[" first=true failed=false identity state health restarts memory nano pids
  if ! command -v docker >/dev/null 2>&1; then probe services.hermes unknown DOCKER_EXECUTABLE_ABSENT null; return; fi
  if ! names_output="$(run_bounded docker ps -a --format '{{.ID}}|{{.Names}}' 2>/dev/null)"; then probe services.hermes error HERMES_QUERY_FAILED null; return; fi
  if [[ -n "$names_output" ]]; then
    mapfile -t containers < <(printf '%s\n' "$names_output" | awk -F'|' '$2 ~ /^(hermes|hermes-)/' | sort -t'|' -k2,2)
  fi
  for handle in "${containers[@]}"; do
    [[ -n "$handle" ]] || continue; container_id="${handle%%|*}"; name="${handle#*|}"; index=$((index + 1))
    if ! raw="$(run_bounded docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{with index .State "Health"}}{{.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}' "$name" 2>/dev/null)"; then failed=true; continue; fi
    if [[ -z "$raw" ]]; then failed=true; continue; fi
    IFS='|' read -r inspect_id inspect_image state health restarts memory nano pids <<<"$raw"
    if [[ -z "$inspect_id" || -z "$inspect_image" || "$inspect_id" != "$container_id"* ]]; then failed=true; continue; fi
    identity="$(printf '%s\037%s\037%s' "$inspect_id" "$inspect_image" "$name" | sha256_text)"
    $first || entries+=","; first=false
    entries+="{\"health\":$(json_quote "$health"),\"identityDigest\":$(json_quote "$identity"),\"index\":$index,\"memoryBytes\":$(json_number_or_null "$memory"),\"nanoCpus\":$(json_number_or_null "$nano"),\"pidsLimit\":$(json_number_or_null "$pids"),\"restartCount\":$(json_number_or_null "$restarts"),\"state\":$(json_quote "$state")}"
  done
  entries+="]"
  value="{\"containerCount\":$index,\"containers\":$entries}"
  if $failed; then probe services.hermes error HERMES_INSPECT_FAILED "$value"
  elif [[ "$index" == 0 ]]; then probe services.hermes absent HERMES_NOT_FOUND "$value"
  else probe services.hermes ok "" "$value"; fi
}

collect_host_resources() {
  local cpu disk_total disk_available mem_total mem_available swap_total swap_free load1 load5 load15
  cpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  read -r disk_total disk_available < <(df -Pk / 2>/dev/null | awk 'NR==2 {print $2, $4}')
  mem_total="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"; mem_available="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  swap_total="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"; swap_free="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
  read -r load1 load5 load15 _ </proc/loadavg
  if [[ -z "$cpu" || -z "$disk_total" || -z "$mem_total" || -z "$load1" ]]; then probe resources.host error RESOURCE_QUERY_FAILED null; return; fi
  probe resources.host ok "" "{\"cpuCount\":$cpu,\"diskRootAvailableKiB\":$disk_available,\"diskRootTotalKiB\":$disk_total,\"load1\":$(json_quote "$load1"),\"load15\":$(json_quote "$load15"),\"load5\":$(json_quote "$load5"),\"memAvailableKiB\":$mem_available,\"memTotalKiB\":$mem_total,\"swapFreeKiB\":$swap_free,\"swapTotalKiB\":$swap_total}"
}

collect_samples() {
  collect_samples_bounded 5
}

collect_samples_bounded() {
  local sample_count="$1" entries="[" first=true failed=false sample timestamp mem swap load unit values memory cpu tasks services_json service_first sample_key sample_value
  for ((sample = 1; sample <= sample_count; sample++)); do
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; mem="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"; swap="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"; load="$(cut -d' ' -f1 /proc/loadavg)"
    services_json="["; service_first=true
    for unit in caddy.service docker.service salespt-bot.service; do
      if ! values="$(run_bounded systemctl show "$unit" --property=MemoryCurrent --property=CPUUsageNSec --property=TasksCurrent 2>/dev/null)"; then values=""; failed=true; fi
      declare -A sample_field=()
      while IFS='=' read -r sample_key sample_value; do
        [[ -n "$sample_key" ]] && sample_field["$sample_key"]="$sample_value"
      done <<<"$values"
      memory="${sample_field[MemoryCurrent]-}"; cpu="${sample_field[CPUUsageNSec]-}"; tasks="${sample_field[TasksCurrent]-}"
      if [[ ! "$memory" =~ ^[0-9]+$ || ! "$cpu" =~ ^[0-9]+$ || ! "$tasks" =~ ^[0-9]+$ ]]; then failed=true; fi
      $service_first || services_json+=","; service_first=false
      services_json+="{\"cpuUsageNSec\":$(json_nullable_string "$cpu"),\"memoryCurrentBytes\":$(json_nullable_string "$memory"),\"tasksCurrent\":$(json_number_or_null "$tasks"),\"unit\":$(json_quote "$unit")}";
    done
    services_json+="]"
    $first || entries+=","; first=false
    entries+="{\"host\":{\"load1\":$(json_quote "$load"),\"memAvailableKiB\":$mem,\"swapFreeKiB\":$swap},\"sampledAtUtc\":$(json_quote "$timestamp"),\"services\":$services_json}"
    [[ "$sample" == "$sample_count" ]] || sleep 1
  done
  entries+="]"
  if $failed; then probe resources.samples error SERVICE_RESOURCE_QUERY_FAILED "$entries"; else probe resources.samples ok "" "$entries"; fi
}

emit_report() {
  local observed complete=true reasons="[" reasons_first=true probes_json="{" probes_first=true name state reason value digest_lines=$'provenance.evidenceSource\037host-observation\n' evidence_digest
  local -a sorted_names=()
  observed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mapfile -t sorted_names < <(printf '%s\n' "${REQUIRED_PROBES[@]}" | sort)
  for name in "${sorted_names[@]}"; do
    state="${PROBE_STATE[$name]-error}"; reason="${PROBE_REASON[$name]-PROBE_NOT_COLLECTED}"; value="${PROBE_VALUE[$name]-null}"
    if [[ "$state" != ok ]]; then
      complete=false; $reasons_first || reasons+=","; reasons_first=false
      reasons+="{\"code\":$(json_quote "$reason"),\"probe\":$(json_quote "$name")}"
    fi
    $probes_first || probes_json+=","; probes_first=false
    probes_json+="$(json_quote "$name"):{\"reasonCode\":$(if [[ -n "$reason" ]]; then json_quote "$reason"; else printf null; fi),\"state\":$(json_quote "$state"),\"value\":$value}"
  done
  for name in "${sorted_names[@]}"; do
    state="${PROBE_STATE[$name]-error}"; reason="${PROBE_REASON[$name]-PROBE_NOT_COLLECTED}"; value="${PROBE_VALUE[$name]-null}"
    digest_lines+="${name}"$'\037'"${state}"$'\037'"${value}"$'\037'"${reason}"$'\n'
  done
  reasons+="]"; probes_json+="}"; evidence_digest="$(printf '%s' "$digest_lines" | sha256_text)"
  printf '{"complete":%s,"incompleteReasons":%s,"observedAtUtc":%s,"probes":%s,"provenance":{"collector":%s,"collectorVersion":2,"evidenceSource":"host-observation","evidenceDigest":%s,"requiredFieldsDigest":%s,"rootRequired":true,"transport":"stdout-json"},"schema":%s}\n' \
    "$complete" "$reasons" "$(json_quote "$observed")" "$probes_json" "$(json_quote "$COLLECTOR")" "$(json_quote "$evidence_digest")" "$(json_quote "$REQUIRED_FIELDS_DIGEST")" "$(json_quote "$SCHEMA")"
}

main() {
  collect_actor
  collect_accounts
  collect_machine
  collect_paths
  collect_executables
  collect_global_node
  collect_listeners
  collect_caddy
  collect_services
  collect_host_resources
  collect_samples
  emit_report
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
