#!/usr/bin/env bash
# Exact Git archive prepared by the controller; no remote fetch, host setup or DNS.
set -euo pipefail
PATH=/usr/bin:/bin
ROOT=/srv/moawork-direct
NODE=/usr/bin/node
UNIT=moawork-direct.service
PORT=3100
OBSERVER_SOURCE_RELATIVE=ops/vps/request-stream-observer.cjs
OBSERVER_RUNTIME_NAME=request-stream-observer.cjs
OBSERVER_REQUIRE_PATH=$ROOT/current/runtime/app/$OBSERVER_RUNTIME_NAME

die() { printf '%s\n' "$*" >&2; exit 1; }
trusted() {
  local entry="$1" mode
  [[ "$entry" == /* && "$(realpath -e "$entry")" == "$entry" ]] || return 1
  while [[ "$entry" != / ]]; do
    [[ ! -L "$entry" && "$(stat -c %u "$entry")" == 0 ]] || return 1
    mode="$(stat -c %a "$entry")"
    (( (8#$mode & 8#022) == 0 )) || return 1
    entry="$(dirname "$entry")"
  done
}
release_link() {
  local link="$1" value
  if [[ ! -e "$link" && ! -L "$link" ]]; then return; fi
  [[ -L "$link" ]] || return 1
  value="$(readlink "$link")"
  [[ "$value" =~ ^$ROOT/releases/[a-f0-9]{40}$ && -d "$value" && ! -L "$value" ]] || return 1
  printf '%s' "$value"
}
set_current() {
  local target="$1" temporary="$ROOT/.current-next"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$ROOT/current" || { rm -- "$temporary"; return 1; }
}
stop_build() {
  local unit="$1" group
  group="$(systemctl show "$unit" -p ControlGroup --value)" || return 1
  systemctl stop "$unit" >/dev/null 2>&1 || true
  if [[ -n "$group" ]]; then
    [[ "$group" == "/system.slice/$unit" ]] || return 1
    if [[ -e "/sys/fs/cgroup$group/cgroup.events" ]]; then
      grep -qx 'populated 0' "/sys/fs/cgroup$group/cgroup.events" || return 1
    fi
  else
    [[ "$(systemctl show "$unit" -p MainPID --value)" == 0 ]] || return 1
  fi
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
}
port_free() {
  local listeners
  listeners="$(ss -H -lnt "sport = :$PORT")" || return 1
  [[ -z "$listeners" ]]
}
install_observer() {
  local source="$1" target="$2"
  [[ -f "$source" && ! -L "$source" ]] || return 1
  [[ ! -e "$target" && ! -L "$target" ]] || return 1
  install -m 0440 -- "$source" "$target"
}
write_release_env() {
  local target="$1" sha="$2" artifact="$3"
  [[ ! -e "$target" && ! -L "$target" ]] || return 1
  printf 'NODE_ENV=production\nHOSTNAME=127.0.0.1\nPORT=%s\nMOAWORK_BUILD_SHA=%s\nMOAWORK_RELEASE_SHA=%s\nMOAWORK_ARTIFACT_SHA256=%s\nNODE_OPTIONS=--require=%s\n' \
    "$PORT" "$sha" "$sha" "$artifact" "$OBSERVER_REQUIRE_PATH" >"$target"
  chmod 0600 "$target"
}
check_ready() {
  local sha="$1" artifact="$2"
  curl --fail --silent --show-error --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/api/health/ready" |
    "$NODE" -e '
      let data="";process.stdin.on("data", b=>{data+=b;if(data.length>16384)process.exit(1)});
      process.stdin.on("end",()=>{try{
        const h=JSON.parse(data),[sha,artifact]=process.argv.slice(1);
        if(h.service!=="moawork-web"||h.status!=="ready"||h.runtime!=="self-hosted"
          ||h.buildSha!==sha||h.releaseSha!==sha||h.artifactSha256!==artifact
          ||["revision","configuration","artifact","serverActions"].some(k=>h[k]!=="verified")
          ||!["configured","disabled"].includes(h.analytics))process.exit(1);
      }catch{process.exit(1)}});' "$sha" "$artifact"
}
check_release() {
  local release="$1" sha artifact asset relative expected actual attempt
  sha="${release##*/}"; artifact="$(cat "$release/runtime.sha256")"
  [[ "$sha" =~ ^[a-f0-9]{40}$ && "$artifact" =~ ^[a-f0-9]{64}$ ]] || return 1
  for ((attempt=0; attempt<30; attempt++)); do
    if check_ready "$sha" "$artifact" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ((attempt<30)) || return 1
  [[ "$(curl -sS --noproxy '*' --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login")" == 200 ]] || return 1
  asset="$(find "$release/runtime/app/.next/static" -type f -name '*.js' -print -quit)"
  [[ -n "$asset" ]] || return 1
  relative="${asset#"$release/runtime/app/.next/static/"}"
  [[ "$relative" =~ ^[a-zA-Z0-9_./-]+$ ]] || return 1
  expected="$(sha256sum "$asset")"; expected="${expected%% *}"
  actual="$(curl -fsS --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT/_next/static/$relative" | sha256sum)" || return 1
  [[ "${actual%% *}" == "$expected" ]]
}
rollback() {
  local previous="$1"
  if [[ -n "$previous" ]]; then
    set_current "$previous" && systemctl restart "$UNIT" && check_release "$previous"
  else
    systemctl stop "$UNIT" && rm -- "$ROOT/current"
  fi
}
activate() {
  local candidate="$1" previous="$2"
  set_current "$candidate" || return 1
  if systemctl restart "$UNIT" && check_release "$candidate"; then
    if [[ -n "$previous" ]]; then
      [[ ! -e "$ROOT/.previous-next" && ! -L "$ROOT/.previous-next" ]] || return 1
      ln -s "$previous" "$ROOT/.previous-next"
      mv -Tf "$ROOT/.previous-next" "$ROOT/previous"
    fi
    return 0
  fi
  rollback "$previous" || { printf '%s\n' 'ROLLBACK_FAILED' >&2; return 2; }
  printf '%s\n' 'DEPLOY_FAILED_ROLLED_BACK' >&2
  return 1
}
main() {
  [[ $# == 2 && "$1" =~ ^[a-f0-9]{40}$ && "$2" =~ ^[a-f0-9]{64}$ ]] || die 'usage: deploy-source.sh <exact-source-sha> <git-archive-sha256>'
  [[ "$EUID" == 0 ]] || die 'controller must be root; build is always non-root'
  local sha="$1" archive_hash="$2" archive="$ROOT/incoming/$1.tar" release="$ROOT/releases/$1" previous build_unit
  trusted "$ROOT" && trusted "$ROOT/releases" && trusted "$archive" && trusted "$NODE" || die 'unsafe prepared paths'
  trusted /etc/moawork/build.env && trusted /etc/moawork/runtime.env || die 'missing root-owned env files'
  [[ "$(stat -c %a /etc/moawork/build.env)" == 600 && "$(stat -c %a /etc/moawork/runtime.env)" == 600 ]] || die 'env files must be 0600'
  [[ "$("$NODE" --version)" == v22.22.2 ]] || die 'existing Node version differs; do not upgrade globally'
  [[ "$(id -u moawork-build)" != 0 && "$(id -u moawork)" != 0 && "$(id -u moawork-build)" != "$(id -u moawork)" ]] || die 'separate non-root build/runtime accounts required'
  # Build gets only the public configuration and stable Server Actions build key.
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    case "${line%%=*}" in NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_POSTHOG_KEY|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) ;;
      *) die 'build.env contains an unapproved field' ;; esac
  done </etc/moawork/build.env
  exec 9>"$ROOT/deploy.lock"; flock -n 9 || die 'another MoaWork deploy owns the lock'
  [[ ! -e "$release" && ! -L "$release" ]] || die 'release already exists; preserve it'
  trusted /etc/systemd/system/moawork-direct.service || die 'missing root-owned service'
  [[ "$(systemctl show "$UNIT" -p FragmentPath --value)" == /etc/systemd/system/moawork-direct.service &&
     "$(systemctl show "$UNIT" -p User --value)" == moawork &&
     "$(systemctl show "$UNIT" -p WorkingDirectory --value)" == "$ROOT/current/runtime/app" ]] || die 'service does not match dedicated paths'
  previous="$(release_link "$ROOT/current")" || die 'unexpected current link'
  release_link "$ROOT/previous" >/dev/null || die 'unexpected previous link'
  if [[ -n "$previous" ]]; then check_release "$previous" || die 'existing MoaWork release is not healthy'
  else port_free || die 'candidate port is occupied or query failed'; fi
  [[ "$(sha256sum "$archive" | cut -d ' ' -f1)" == "$archive_hash" ]] || die 'archive digest mismatch'
  [[ "$(git get-tar-commit-id <"$archive")" == "$sha" ]] || die 'archive does not identify exact source commit'
  install -d -m 0755 "$release"
  install -d -o moawork-build -g moawork-build -m 0700 "$release/source"
  build_unit="moawork-build-$sha.service"
  [[ "$(systemctl show "$build_unit" -p LoadState --value)" == not-found ]] || die 'build unit already exists'
  trap 'stop_build "$build_unit" || true' EXIT
  if ! systemd-run --quiet --wait --unit="$build_unit" --service-type=exec \
    --property=User=moawork-build --property=Group=moawork-build \
    --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
    --property=PrivateTmp=yes --property=PrivateDevices=yes --property=ProtectHome=yes \
    --property=ProtectSystem=strict --property=ProtectProc=invisible --property=ProcSubset=pid \
    --property=RestrictNamespaces=yes --property=KillMode=control-group --property=SendSIGKILL=yes \
    --property=CPUQuota=50% --property=MemoryMax=1536M --property=MemorySwapMax=0 \
    --property=TasksMax=128 --property=RuntimeMaxSec=30min --property=TimeoutStopSec=10s \
    --property="ReadWritePaths=$release/source" --property=EnvironmentFile=/etc/moawork/build.env \
    --setenv=PATH=/usr/bin:/bin --setenv=HOME=/tmp --setenv=NODE_OPTIONS=--max-old-space-size=1024 \
    --setenv="MOAWORK_BUILD_SHA=$sha" --setenv="NEXT_PUBLIC_APP_VERSION=$sha" \
    /bin/bash -euc 'tar --extract --file="$1" --directory="$2" --no-same-owner; cd "$2"; npm ci --no-audit --no-fund; npm run build --workspace app' -- "$archive" "$release/source"; then
    stop_build "$build_unit" || die 'build descendant cleanup failed'
    die 'build failed; current release unchanged'
  fi
  stop_build "$build_unit" || die 'build descendant cleanup failed'
  trap - EXIT
  [[ -d "$release/source/app/.next/standalone" && ! -L "$release/source/app/.next/standalone" ]] || die 'standalone missing'
  [[ "$(realpath -e "$release/source/app/.next/standalone")" == "$release/source/"* ]] || die 'standalone escapes source'
  cp -a "$release/source/app/.next/standalone" "$release/runtime"
  [[ -d "$release/runtime/app" && ! -L "$release/runtime/app" ]] || die 'invalid app directory'
  [[ -d "$release/runtime/app/.next" && ! -L "$release/runtime/app/.next" ]] || die 'invalid standalone layout'
  [[ ! -e "$release/runtime/app/.next/static" && ! -L "$release/runtime/app/.next/static" && ! -e "$release/runtime/app/public" && ! -L "$release/runtime/app/public" ]] || die 'unexpected bundled public/static target'
  cp -a "$release/source/app/.next/static" "$release/runtime/app/.next/static"
  cp -a "$release/source/app/public" "$release/runtime/app/public"
  install_observer "$release/source/$OBSERVER_SOURCE_RELATIVE" "$release/runtime/app/$OBSERVER_RUNTIME_NAME" || die 'invalid request stream observer'
  # Reject special files and escaping links before privileged ownership changes.
  [[ -z "$(find "$release/runtime" ! -type f ! -type d ! -type l -print -quit)" ]] || die 'unsafe runtime entry'
  while IFS= read -r -d '' link; do
    [[ "$(realpath -e "$link")" == "$release/runtime/"* ]] || die 'runtime link escapes release'
  done < <(find "$release/runtime" -type l -print0)
  [[ ! -e "$release/runtime/app/.next/cache" && ! -L "$release/runtime/app/.next/cache" ]] || die 'unexpected runtime cache'
  ln -s /var/cache/moawork-direct "$release/runtime/app/.next/cache"
  chown -hR root:moawork "$release/runtime"
  chmod -R u=rwX,g=rX,o= "$release/runtime"
  tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf "$release/runtime.tar" -C "$release/runtime" .
  sha256sum "$release/runtime.tar" | cut -d ' ' -f1 >"$release/runtime.sha256"
  write_release_env "$release/release.env" "$sha" "$(cat "$release/runtime.sha256")" || die 'release env already exists'
  trap 'if [[ "$(readlink "$ROOT/current" 2>/dev/null)" == "$release" ]]; then rollback "$previous" || printf "%s\\n" ROLLBACK_FAILED >&2; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  activate "$release" "$previous" || die 'candidate failed; inspect rollback result'
  trap - EXIT INT TERM
  printf 'DEPLOYED source=%s artifact=%s private=loopback\n' "$sha" "$(cat "$release/runtime.sha256")"
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
