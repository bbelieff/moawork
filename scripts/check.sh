#!/usr/bin/env bash
# check.sh — moawork 품질 게이트
# lint + typecheck + production build + test 를 순서대로 실행한다. 하나라도 실패하면 즉시 중단(비정상 종료).
# CI 와 .githooks/pre-commit 이 공통으로 이 스크립트를 호출한다(단일 진실 게이트).
set -euo pipefail

# 리포지토리 루트로 이동 (스크립트 위치 기준)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🔎 customer-specific values"
node scripts/check-customer-specific-values.mjs --self-test
node scripts/check-customer-specific-values.mjs

echo "▶ [0/4] production repo boundary"
node scripts/check-production-repo-boundaries.mjs --self-test
node scripts/check-production-repo-boundaries.mjs
node --test scripts/check-migration-guards.test.mjs
node --test scripts/hosted-migration-runbook.test.mjs
node scripts/check-migration-guards.mjs

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
node --test scripts/check-build-gate.test.mjs
node --test scripts/check-line-endings.test.mjs
node scripts/check-unreachable-app-files.mjs

# ── 규칙 공지 (2026-08-20 일원화) ───────────────────────
# 왜 여기 있나: 모든 세션이 커밋 전에 반드시 이 스크립트를 지난다.
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
npm run build --workspaces --if-present

echo "▶ [4/4] test"
npm run test:gate --workspace app
npm run test --workspace worker --if-present

echo "▶ [4/4] 목업↔앱 대조"
node docs/design/qa-app.mjs --self-test
node docs/design/qa-app.mjs
node docs/design/qa-board-parity.mjs new contact
node docs/design/qa-visual-blocks.mjs --self-test
node docs/design/qa-visual-blocks.mjs

echo "✅ check 통과"
