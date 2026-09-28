#!/bin/sh
# 야간 배치 호출기 — 하루치 플랫폼 지표를 `platform_metrics_daily` 에 적재한다.
#
# 왜 스크립트인가: 시크릿을 `curl` 인자로 넘기면 같은 호스트의 누구나 `ps` 로 읽는다.
# 그래서 Authorization 헤더는 `-K -`(설정을 stdin 으로) 로만 전달한다.
#
# 사용:
#   moawork-platform-metrics.sh              # 어제(KST) 집계
#   moawork-platform-metrics.sh 2026-09-18   # 그 날짜 재집계(백필, 멱등)
set -eu

URL="${MOAWORK_CRON_URL:-http://127.0.0.1:3100/api/cron/platform-metrics}"

day="${1:-}"
if [ -n "$day" ]; then
  case "$day" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) URL="$URL?day=$day" ;;
    *) echo "day must be YYYY-MM-DD" >&2; exit 2 ;;
  esac
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set" >&2
  exit 78            # EX_CONFIG — 설정 누락은 실패로 남긴다
fi

body="$(mktemp)"
trap 'rm -f "$body"' EXIT INT TERM

# 207 은 부분 실패다. 200 만 성공으로 보고 나머지는 상태코드를 그대로 드러낸다.
code="$(
  printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" \
  | curl --silent --show-error --config - \
      --max-time 120 --retry 2 --retry-delay 10 --retry-connrefused \
      --output "$body" --write-out '%{http_code}' \
      "$URL"
)"

echo "platform-metrics ${URL%%\?*} -> $code"
cat "$body"
echo

[ "$code" = "200" ] || exit 1
