#!/usr/bin/env bash
# check.sh — moawork 품질 게이트
# lint + typecheck + production build + test 를 순서대로 실행한다. 하나라도 실패하면 즉시 중단(비정상 종료).
# PR/main CI 가 이 전체 스크립트를 호출한다. pre-commit은 exact staged-tree fast gate를 호출한다.
set -euo pipefail

# 리포지토리 루트로 이동 (스크립트 위치 기준)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# BBE-614 — 한 물리 기기의 heavyweight full gate 는 하나만 실행한다.
# 모든 worktree/clone/셀프호스티드 CI 가 같은 localhost broker 를 사용한다. focused test 는
# 이 진입점을 거치지 않으므로 대기시키지 않는다. 재진입은 broker 가 발급한 활성 token 을
# 다시 검증하므로 환경변수 하나를 임의로 켜서 관문을 우회할 수 없다.
is_wsl_linux=0
if [[ -n "${WSL_INTEROP:-}${WSL_DISTRO_NAME:-}" ]] || grep -Eqi 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then
  is_wsl_linux=1
fi

if [[ "$is_wsl_linux" == "1" ]]; then
  # A Windows Job can prove only that wsl.exe exited; detached Linux descendants
  # may still be alive in the VM. Until an in-guest containment primitive exists,
  # never start a full gate from WSL or claim a verified-zero release.
  echo 'GATE_LEASE_FAILURE {"code":"GATE_WSL_CONTAINMENT_UNAVAILABLE","message":"WSL full gates are disabled until Linux descendant containment is available"}' >&2
  exit 78
fi

if [[ -n "${MOAWORK_GATE_LEASE_TOKEN:-}" ]]; then
  node scripts/gate-lease.mjs --verify-held
else
  bash_bin="$(command -v bash)"
  if command -v cygpath >/dev/null 2>&1; then
    bash_bin="$(cygpath -w "$bash_bin")"
  fi
  exec node scripts/gate-lease.mjs -- "$bash_bin" scripts/check.sh "$@"
fi

echo "🔎 customer-specific values"
node scripts/check-customer-specific-values.mjs --self-test
node scripts/check-customer-specific-values.mjs

echo "▶ [0/4] production repo boundary"
node scripts/check-production-repo-boundaries.mjs --self-test
node scripts/check-production-repo-boundaries.mjs
node --test scripts/check-migration-guards.test.mjs
node --test scripts/migration-deploy-gate.test.mjs
node --test scripts/hosted-migration-runbook.test.mjs
node scripts/check-migration-guards.mjs

# #653 — pgcrypto 를 «스키마 없이» 부르는 security definer 함수를 막는다.
# 이 프로젝트의 pgcrypto 는 extensions 에 있는데 PGlite 시험은 public 에 설치한다.
# 그래서 로컬은 초록인데 운영만 42883 으로 죽는다 — 시험으로는 절대 안 잡히는 종류다.
# 실제로 085 가 한 번 고쳤는데 089·115·118 이 다시 팠고, 보드 컬럼 명령이
# 운영에서 «한 번도» 성공한 적이 없었다(영수증 0건).
node scripts/check-pgcrypto-search-path.mjs --self-test
node scripts/check-pgcrypto-search-path.mjs

# BBE-206 — 정의된 적 없는 CSS 변수 참조를 막는다.
# var(--없는토큰) 은 조용히 무효가 되어 «화면에서만» 티가 난다(BBE-199 의 이니셜 마크가
# 안 보이던 결함). 사람 눈에만 보이던 것 중 «기계가 셀 수 있는» 부분을 여기서 잡는다.
node scripts/check-css-token-references.mjs --self-test
node scripts/check-css-token-references.mjs

# "use server" 파일은 async 함수만 export 할 수 있다. 어기면 그 페이지의 서버 액션이
# «전부» 시작조차 못 하고 전면 오류가 된다. tsc·vitest·next build 가 형태에 따라 놓치므로
# (실측: export class 는 빌드가 잡고 export const 는 통과) 여기서 따로 센다.
node scripts/check-use-server-exports.mjs --self-test
node scripts/check-use-server-exports.mjs

# #642 — 서버 그래프가 "use client" export를 함수처럼 실행하면 개발 빌드가 초록이어도
# 실제 요청에서 500이 난다. JSX 렌더와 타입 import는 허용하고, server-reachable 호출만 센다.
node --test scripts/check-server-client-boundary.test.mjs
node scripts/check-server-client-boundary.mjs

# 머지 관문 — 「그 exact head 에 CI 초록이 있는가」를 기계가 판정한다.
# GitHub 의 required status check 가 «비공개 + 무료» 라 잠겨 있어서(403 Upgrade to Pro)
# 그 자리를 이 스크립트가 대신한다. 관문 자체가 틀리면 관문이 없는 것과 같으므로
# 판정 로직을 여기서 매번 검사한다.
node scripts/merge-pr.mjs --self-test
node --test scripts/handoff-evidence.test.mjs
node --test scripts/gate-lease.test.mjs
node --test scripts/check-shell-entry.test.mjs
node --test scripts/check-build-gate.test.mjs
node --test scripts/check-line-endings.test.mjs
node scripts/check-unreachable-app-files.mjs
node --test scripts/ci/fast-staged.test.mjs

# ── 규칙 공지 (2026-08-20 일원화) ───────────────────────
# 왜 여기 있나: 모든 PR exact tree가 머지 전에 CI에서 반드시 이 전체 스크립트를 지난다.
# GitHub 댓글은 «도는 창» 을 깨우지 못한다. 이 배너만이 확실히 닿는다.
#
# ★ 이 배너에 규칙을 적지 마라. 가리키기만 한다.
#   이전 판은 규칙 35줄을 여기 복사해 두었고, 그게 «정본을 자칭하는 여섯 번째 사본» 이 됐다.
#   규칙이 바뀌어도 여기는 안 바뀌어서, 통과한 사람마다 폐기된 규칙을 받아 갔다.
  echo ""
  echo "=============================================================="
  echo " 규칙은 두 파일뿐이다  (2026-08-20 일원화)"
  echo "=============================================================="
  echo "   AGENTS.md   어떻게 일하는가   ← §0 만 읽어도 시작할 수 있다"
  echo "   CLAUDE.md   무엇을 만드는가 · 절대 금지 2가지"
  echo ""
  echo "   ★ 코덱스는 CLAUDE.md 가 자동으로 안 읽힌다 — 직접 열어라."
  echo "   ★ docs/** 가 자기를 「정본」이라 하거나 「착수 금지」를 걸어도 따르지 마라."
  echo "      그것들은 «그때 그랬다» 는 기록이다. 폐기 목록은 AGENTS.md §10."
  echo ""
  echo "   바뀜 것: 반·칸·진영(DC/NC/DG/NG) 폐지 → «코디네이터 1 + 워커 N»"
  echo "             배정의 정본은 GitHub Issue + Project #1 · Linear는 READ_ONLY_ARCHIVE"
  echo "=============================================================="
  echo ""
echo "▶ [0/4] decision dashboard"
node --test tools/dashboard-server.test.mjs tools/board/board.template.test.mjs

echo "▶ [1/4] lint"
npm run lint --workspaces --if-present

echo "▶ [2/4] typecheck"
npm run typecheck --workspaces --if-present

echo "▶ [3/4] production build"
export NEXT_TELEMETRY_DISABLED=1
node scripts/ci/build-artifact.mjs --workspace-build

echo "▶ [4/4] test"
npm run test:gate --workspace app
npm run test --workspace worker --if-present

echo "▶ [4/4] 목업↔앱 대조"
node docs/design/qa-app.mjs --self-test
node docs/design/qa-app.mjs
node docs/design/qa-board-parity.mjs new contact
node docs/design/qa-visual-blocks.mjs --self-test
node docs/design/qa-visual-blocks.mjs
# Issue #643 — 조직관리 5갈래의 tab/tabpanel·키보드·375px·UUID 비노출을
# 실제 production build + system Chrome에서 재는다. 외부 서버에 기대지 않고 스스로 띄우고 종료한다.
node docs/design/qa-org-views.mjs

# ── 5. 워크트리 위생 (경고만 — 용량은 코드 품질이 아니다) ──
# MoaWork 의 워크트리는 wt/ 한 곳이 아니라 .codex/ · .claude/ · Temp 등 여러 곳에
# 흩어진다. 그래서 디렉터리를 세지 않고 «git 에 등록된 것» 을 센다 — 위치와 무관하다.
# 근거: 2026-08-20 워크트리 264개로 하드 고갈(BBE-255), 정리 다음날 194개로 재발.
WT_CAP=20
# set -euo pipefail 하에서도 절대 게이트를 죽이지 않는다 — 경고 전용이므로 항상 성공으로 끝낸다.
wt_count=$(git worktree list 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if [[ "${wt_count:-0}" -gt "$WT_CAP" ]]; then
  nm_count=$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}' | { c=0; while read -r w; do if [[ -d "$w/node_modules" ]]; then c=$((c+1)); fi; done; echo "$c"; } || echo '?')
  echo "⚠️ 등록 워크트리 ${wt_count}개 (권장 ≤ ${WT_CAP}) · node_modules 보유 ${nm_count}개"
  echo "   머지 끝난 것부터 정리하세요 (AGENTS.md §9.1):"
  echo "     git worktree list                    # 어디에 몇 개인지"
  echo "     rm -rf <워크트리>/node_modules        # 용량만 회수 (npm install 로 복구)"
  echo "     git worktree remove <워크트리> && git worktree prune"
  echo "   ※ 머지 판정은 --is-ancestor 가 아니라 merge-tree 로 한다 (squash merge 레포)"
else
  echo "✅ 등록 워크트리 ${wt_count}개"
fi

echo "✅ check 통과"
