#!/usr/bin/env bash
# smoke.sh — T10 게이트키퍼 런타임 스모크 (로그인 → 온보딩 → 홈 클릭스루)
#
# 왜 필요한가: check.sh(lint/typecheck/test) 초록은 "화면이 실제로 뜨는지, 가드가 도는지,
# 담당범위·조직 격리가 먹는지"를 증명하지 못한다. 머지마다 이 스크립트로 재확인한다.
# (기획2 판정 2026-07-21: "완료 판정은 main 스모크 초록일 때만")
#
# 사용법:
#   bash scripts/smoke.sh                 # 서버를 직접 띄우고 검사 후 종료
#   BASE=http://localhost:3000 bash scripts/smoke.sh --no-server   # 이미 뜬 서버에 대해 검사
#
# 종료코드: 0=전항목 통과, 1=실패 있음. 실패 항목은 [FAIL] 로 출력된다.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ⚠️ 전용 포트를 쓴다. 기본 3000 은 다른 트랙 워크트리 서버가 점유하고 있을 수 있고,
# 그 서버를 검사하면 "다른 브랜치 코드가 통과했는데 내 브랜치가 통과한 걸로" 오판한다(false pass).
# 실제로 2026-07-21 검증 중 발생 — 반드시 포트 선점 여부를 먼저 확인한다.
PORT="${PORT:-3010}"
BASE="${BASE:-http://localhost:$PORT}"
START_SERVER=1
[ "${1:-}" = "--no-server" ] && START_SERVER=0

# seed 계정(로컬 dev-session). 앱이 dev-session 을 쓰지 않게 되면 이 부분을 교체한다.
OWNER="usr00000-0000-0000-0000-0000000000a1"
ADMIN="usr00000-0000-0000-0000-0000000000a2"
MEMBER="usr00000-0000-0000-0000-0000000000a3"
PIPE="pip00000-0000-0000-0000-000000000001"

PASS=0; FAIL=0; SKIP=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
skip() { echo "  [SKIP] $1"; SKIP=$((SKIP+1)); }

TMP="$(mktemp -d)"
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

code()  { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
redir() { curl -s -o /dev/null -m 15 -w '%{redirect_url}' "$@"; }
body()  { curl -s -m 15 "$@"; }

# ---------------------------------------------------------------- 서버 기동
if [ "$START_SERVER" = "1" ]; then
  # 브랜치를 갈아끼운 워크트리에는 이전 브랜치의 .next 생성물(라우트 타입 등)이 남아
  # typecheck/빌드를 엉뚱하게 깨뜨린다(false fail). 검사 전 항상 비운다.
  rm -rf app/.next app/tsconfig.tsbuildinfo 2>/dev/null
  echo "▶ dev 서버 기동 (PORT=$PORT)"
  # 선점 검사: 이미 응답이 있으면 남의 서버다. 검사하면 오판이므로 즉시 중단.
  if [ "$(code "$BASE/")" != "000" ]; then
    echo "  [ABORT] $BASE 를 이미 다른 프로세스가 점유 중 — 남의 서버를 검사하면 false pass 가 된다."
    echo "          PORT=<빈 포트> bash scripts/smoke.sh 로 다시 실행하라."
    exit 1
  fi
  PORT="$PORT" npm run dev > "$TMP/server.log" 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 40); do
    [ "$(code "$BASE/")" != "000" ] && break
    sleep 1
  done
  if [ "$(code "$BASE/")" = "000" ]; then
    echo "  [FAIL] 서버가 뜨지 않음 — 로그:"; tail -20 "$TMP/server.log"; exit 1
  fi
  # ★ 기동 확증: 응답이 온다고 '내 서버'인 것은 아니다. 바인딩 실패(EADDRINUSE)면
  #   남의 서버가 응답한 것이므로 검사 전체가 무효다. 로그로 반드시 확인한다.
  if grep -qi 'EADDRINUSE' "$TMP/server.log"; then
    echo "  [ABORT] 포트 바인딩 실패(EADDRINUSE) — 응답한 것은 내 서버가 아니다. 검사 무효."
    grep -i 'EADDRINUSE' "$TMP/server.log" | head -2
    exit 1
  fi
  grep -qiE '(Ready in|✓ Ready)' "$TMP/server.log" \
    && echo "  서버 준비됨(기동 확증): $BASE" \
    || { echo "  [ABORT] 기동 로그에 Ready 없음 — 내 서버인지 확증 불가."; tail -10 "$TMP/server.log"; exit 1; }
fi

# 인증 계층 자체가 아직 없는 브랜치(T03 미머지)에서는 가드 부재가 결함이 아니라 '미구현'이다.
AUTH_PRESENT=0
[ "$(code "$BASE/login")" = "200" ] && AUTH_PRESENT=1

echo "▶ [1] 미인증 가드 (보호 라우트 → /login)"
if [ "$AUTH_PRESENT" = "0" ]; then
  skip "인증 계층 미존재(/login 404) — T03 미머지. 가드 검사 보류"
else
for u in / /onboarding /settings/members "/dash/$PIPE"; do
  c=$(code "$BASE$u"); r=$(redir "$BASE$u")
  if [ "$c" = "307" ] || [ "$c" = "302" ]; then
    case "$r" in *"/login"*) ok "$u → $c → /login" ;;
      "") ok "$u → $c (상대 Location — 수동확인 권장)" ;;
      *) bad "$u → $c 이지만 리다이렉트가 /login 아님: $r" ;; esac
  elif [ "$c" = "404" ]; then skip "$u 없음(404) — 해당 기능 미머지"
  else bad "★가드 없음★ $u 가 미인증인데 status=$c"; fi
done
fi

echo "▶ [2] 로그인 화면"
c=$(code "$BASE/login")
if [ "$c" = "200" ]; then
  n=$(body "$BASE/login" | grep -o 'name="uid"' | wc -l)
  [ "$n" -gt 0 ] && ok "/login 200, 계정 $n개" || skip "/login 200 이나 dev 계정 목록 없음(OAuth 전환 가능성 — 수동 확인)"
elif [ "$c" = "404" ]; then skip "/login 없음(404) — T03 미머지"
else bad "/login status=$c"; fi

echo "▶ [3] 인증 세션 — 온보딩/홈 렌더"
for pair in "온보딩:/onboarding" "홈:/"; do
  nm=${pair%%:*}; u=${pair##*:}
  c=$(code -b "mw_uid=$OWNER" "$BASE$u")
  [ "$c" = "200" ] && ok "$nm($u) 200" || { [ "$c" = "404" ] && skip "$nm($u) 404 — 미머지" || bad "$nm($u) status=$c"; }
done

echo "▶ [4a] 담당범위 격리 (딜 단위 · /api/deals) ★PLAN §3 '멤버는 본인 담당만'"
# 시드: '라마바테크 시설자금'=admin 담당, '가나다상사 운전자금'·'정책자금 상담'=member 담당.
# member(scope=assigned) 응답에 admin 담당 딜이 섞이면 격리 실패.
DO="$TMP/api_owner.json"; DM="$TMP/api_member.json"
ao=$(curl -s -m 15 -b "mw_uid=$OWNER"  "$BASE/api/deals" -o "$DO" -w '%{http_code}')
am=$(curl -s -m 15 -b "mw_uid=$MEMBER" "$BASE/api/deals" -o "$DM" -w '%{http_code}')
if [ "$ao" = "200" ] && [ "$am" = "200" ]; then
  co=$(grep -o '"title"' "$DO" | wc -l); cm=$(grep -o '"title"' "$DM" | wc -l)
  lo=$(grep -c '시설자금' "$DO");        lm=$(grep -c '시설자금' "$DM")
  mo=$(grep -c '운전자금' "$DM")
  echo "      owner deals=$co (admin담당 노출 $lo) / member deals=$cm (admin담당 노출 $lm, 본인담당 $mo)"
  [ "$lo" -ge 1 ] && ok "owner 는 조직 전체 딜 조회(admin 담당 포함)" || bad "owner 가 admin 담당 딜을 못 봄 — 과잉차단"
  [ "$lm" -eq 0 ] && ok "member 는 타인(admin) 담당 딜 차단(0건)" || bad "★담당범위 격리 실패★ member 응답에 admin 담당 딜 $lm 건"
  [ "$mo" -ge 1 ] && ok "member 는 본인 담당 딜은 조회 가능" || bad "member 가 본인 담당 딜도 못 봄 — 과잉차단"
  [ "$cm" -lt "$co" ] && ok "건수 축소 확인(member $cm < owner $co)" || bad "member 건수가 owner 와 같음($cm/$co) — 스코프 미적용 의심"
elif [ "$ao" = "404" ] || [ "$am" = "404" ]; then skip "/api/deals 없음 — 미머지"
else bad "/api/deals 접근 실패 (owner=$ao member=$am)"; fi

echo "▶ [4b] scope 격리 — 칸반 화면(있을 때만)"
KO="$TMP/k_owner.html"; KM="$TMP/k_member.html"
co=$(curl -s -m 15 -b "mw_uid=$OWNER"  "$BASE/dash/$PIPE" -o "$KO" -w '%{http_code}')
cm=$(curl -s -m 15 -b "mw_uid=$MEMBER" "$BASE/dash/$PIPE" -o "$KM" -w '%{http_code}')
if [ "$co" = "200" ] && [ "$cm" = "200" ]; then
  # 시드: '라마바테크 시설자금' = admin 담당 → member 에게 보이면 격리 실패
  o=$(grep -c '시설자금' "$KO"); m=$(grep -c '시설자금' "$KM")
  [ "$o" -ge 1 ] && ok "owner 는 admin 담당 딜 노출($o)" || bad "owner 에게도 안 보임 — 시드/렌더 이상"
  [ "$m" -eq 0 ] && ok "member 는 admin 담당 딜 차단(0)" || bad "★격리 실패★ member 에게 타인 담당 딜 $m 건 노출"
else skip "칸반 미제공(owner=$co member=$cm) — 해당 기능 미머지"; fi

echo "▶ [5] 조직 격리 — 신규 조직에 이전 조직 데이터가 없어야 함"
AID=$(body -b "mw_uid=$OWNER" "$BASE/onboarding" | grep -oE '\$ACTION_ID_[a-f0-9]+' | sed -n 2p)
if [ -n "$AID" ]; then
  H="$TMP/create.h"
  curl -s -i -m 20 -X POST -b "mw_uid=$OWNER" -F "$AID=" -F 'name=T10 스모크 조직' -F 'preset=on' \
       "$BASE/onboarding" -o "$H" >/dev/null
  NEW=$(grep -i '^set-cookie: mw_org=' "$H" | sed -E 's/.*mw_org=([^;]+).*/\1/' | tr -d '\r')
  if [ -n "$NEW" ]; then
    ok "조직 생성 서버액션 동작 (mw_org 발급)"
    NH="$TMP/newhome.html"
    curl -s -m 15 -b "mw_uid=$OWNER; mw_org=$NEW" "$BASE/" -o "$NH"
    leak=$(grep -c '시설자금' "$NH")
    [ "$leak" -eq 0 ] && ok "신규 조직에 이전 조직 딜 0건" || bad "★조직격리 실패★ 이전 조직 딜 $leak 건 노출"
    # 프리셋 전개 확인
    NO="$TMP/newonb.html"
    curl -s -m 15 -b "mw_uid=$OWNER; mw_org=$NEW" "$BASE/onboarding" -o "$NO"
    grep -q '계약상황' "$NO" && ok "업종팩 프리셋 전개(계약상황 필드 존재)" \
      || bad "프리셋 전개 안 됨 — 계약상황 필드 없음(PLAN v0.2.2 파리티)"
  else bad "조직 생성 후 mw_org 쿠키 미발급"; fi
else skip "온보딩 서버액션 없음 — 미머지"; fi

echo "▶ [6] 404 / 서버 에러 로그"
c=$(code -b "mw_uid=$OWNER" "$BASE/__no_such_page__")
[ "$c" = "404" ] && ok "미존재 라우트 404" || bad "미존재 라우트 status=$c"
if [ "$START_SERVER" = "1" ]; then
  e=$(grep -ciE '(error|unhandled|exception)' "$TMP/server.log")
  [ "$e" -eq 0 ] && ok "서버 로그 에러 0건" || { bad "서버 로그 에러 $e 건"; grep -iE '(error|unhandled|exception)' "$TMP/server.log" | head -5; }
fi

echo ""
echo "──────── 스모크 결과: PASS=$PASS FAIL=$FAIL SKIP=$SKIP ────────"
[ "$FAIL" -eq 0 ] && echo "✅ 스모크 통과" || echo "❌ 스모크 실패 — 완료판정 불가"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
