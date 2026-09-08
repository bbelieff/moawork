#!/usr/bin/env bash
set -euo pipefail

# Read-only shared-host inventory for Issue #725. This script intentionally
# emits no environment variables, command lines, addresses, credentials, or
# application data. It is safe to pipe over an already-authenticated SSH
# session and does not create files or change services.
export LC_ALL=C

readonly SCHEMA="moawork-vps-readonly-v1"

one_line() {
  tr '\n\r\t' '   ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

field() {
  printf '%s=%s\n' "$1" "$2"
}

command_version() {
  local name="$1"
  shift
  if command -v "$name" >/dev/null 2>&1; then
    field "tool_${name}" "$("$@" 2>/dev/null | head -n 1 | one_line)"
  else
    field "tool_${name}" "absent"
  fi
}

unit_field() {
  local unit="$1"
  local key="$2"
  local value
  value="$(systemctl show "$unit" --property="$key" --value 2>/dev/null || true)"
  field "unit_${unit//[^A-Za-z0-9]/_}_${key}" "${value:-absent}"
}

inventory_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    # Do not execute the PM2 CLI: even its version command can start a daemon.
    field tool_pm2 present_not_executed
  else
    field tool_pm2 absent
  fi
  field pm2_process_inventory not_collected_without_mutating_cli
}

inventory_hermes() {
  local -a managed_containers=()
  local container container_index inspect
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  mapfile -t managed_containers < <(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(hermes|hermes-)' | LC_ALL=C sort || true)
  field hermes_container_count "${#managed_containers[@]}"
  container_index=0
  for container in "${managed_containers[@]}"; do
    container_index=$((container_index + 1))
    # Names are used only as local inspect handles; output has stable sorted indices.
    inspect="$(docker inspect --format '{{.State.Status}} {{.RestartCount}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}' "$container" 2>/dev/null || true)"
    field "hermes_${container_index}_state" "$(printf '%s' "$inspect" | one_line)"
  done
}

main() {
field schema "$SCHEMA"
field observed_at_utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
field kernel "$(uname -srmo | one_line)"
field os_release "$(. /etc/os-release && printf '%s %s' "$ID" "$VERSION_ID" | one_line)"
field cpu_count "$(getconf _NPROCESSORS_ONLN)"
field loadavg "$(cut -d' ' -f1-3 /proc/loadavg | one_line)"
field cgroup_v2 "$(test -f /sys/fs/cgroup/cgroup.controllers && echo yes || echo no)"
field systemd_version "$(systemd --version | head -n 1 | one_line)"

while read -r key value _; do
  case "$key" in
    MemTotal:|MemAvailable:|SwapTotal:|SwapFree:)
      field "mem_${key%:}_kib" "$value"
      ;;
  esac
done </proc/meminfo

read -r disk_total_kib disk_available_kib < <(
  df -Pk / | awk 'NR == 2 { print $2, $4 }'
)
field disk_root_total_kib "$disk_total_kib"
field disk_root_available_kib "$disk_available_kib"

command_version node node --version
command_version npm npm --version
command_version git git --version
command_version caddy caddy version
command_version docker docker --version
command_version systemd-run systemd-run --version
inventory_pm2

for account in moawork moawork-deploy; do
  if getent passwd "$account" >/dev/null; then
    field "account_${account}" present
  else
    field "account_${account}" absent
  fi
done

for path in /srv/moawork /etc/moawork /var/lib/moawork; do
  key="$(printf '%s' "$path" | sed 's#[^A-Za-z0-9]#_#g')"
  if test -e "$path"; then
    field "path${key}" present
  else
    field "path${key}" absent
  fi
done

for unit in caddy.service docker.service salespt-bot.service; do
  for key in ActiveState SubState MainPID NRestarts MemoryCurrent CPUUsageNSec; do
    unit_field "$unit" "$key"
  done
done

if test -f /etc/caddy/Caddyfile; then
  field caddyfile_sha256 "$(sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)"
  field caddyfile_mode "$(stat -c '%a:%U:%G' /etc/caddy/Caddyfile)"
else
  field caddyfile_sha256 absent
  field caddyfile_mode absent
fi

inventory_hermes

if command -v ss >/dev/null 2>&1; then
  for port in 3000 3100 3101 3102; do
    count="$(ss -H -ltn "sport = :$port" 2>/dev/null | wc -l | tr -d ' ')"
    field "tcp_listen_${port}_count" "$count"
  done
fi

probe() {
  local key="$1"
  local url="$2"
  local output
  output="$(curl --silent --show-error --output /dev/null --connect-timeout 3 --max-time 10 --write-out '%{http_code} %{time_total}' "$url" 2>/dev/null || true)"
  field "$key" "${output:-failed}"
}

probe salespt_local_health http://127.0.0.1:3000/api/health
probe salespt_public_health https://salesptlog.online/api/health

for sample in 1 2 3 4 5; do
  available="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
  swap_free="$(awk '/^SwapFree:/ { print $2 }' /proc/meminfo)"
  load1="$(cut -d' ' -f1 /proc/loadavg)"
  field "sample_${sample}" "mem_available_kib:${available},swap_free_kib:${swap_free},load1:${load1}"
  if test "$sample" -lt 5; then sleep 1; fi
done

field result complete
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
