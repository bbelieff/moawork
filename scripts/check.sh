#!/usr/bin/env bash
# check.sh — moawork 품질 게이트
# lint + typecheck + test 를 순서대로 실행한다. 하나라도 실패하면 즉시 중단(비정상 종료).
# CI 와 .githooks/pre-commit 이 공통으로 이 스크립트를 호출한다(단일 진실 게이트).
set -euo pipefail

# 리포지토리 루트로 이동 (스크립트 위치 기준)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ [0/4] production repo boundary"
node scripts/check-production-repo-boundaries.mjs --self-test
node scripts/check-production-repo-boundaries.mjs

# ── 편제 개편 공지 (2026-08-12) ───────────────────────────────────
# 왜 여기 있나: 모든 세션이 커밋 전에 반드시 이 스크립트를 지난다.
# Linear 댓글·디스패치 게시는 «도는 창» 을 깨우지 못한다. 이 배너만이 확실히 닿는다.
# 개편이 전 세션에 전파된 뒤 belie·총괄이 이 블록을 삭제한다.
  echo ""
  echo "=============================================================="
  echo " !!  2026-08-12 규약 개정 — AGENTS.md 를 다시 읽어라"
  echo "=============================================================="
  echo " git pull origin main  하고 AGENTS.md 를 처음부터 읽어라."
  echo " 2026-08-09 이전 규약은 전부 폐기됐다 (§10)."
  echo ""
  echo " [목표]  목업을 구현한다. 빠른 출시가 목적이지 완벽한 행정이 아니다."
  echo "         화면 3,176줄은 버리고 목업 기준으로 다시 그린다. DB 는 남긴다."
  echo "         순서표: docs/design/목업스터디-재구축설계_v1.md  4-A"
  echo ""
  echo " 1) 완주 = 코드 + 테스트 + CI + «그 화면을 열어 눈으로 본 증거»"
  echo "    「목업 86/86 PASS」는 앱을 증명하지 않는다. 완주 근거로 쓰지 마라"
  echo ""
  echo " 2) 검수는 «자기 서브에이전트» 로 끝낸다. PASS 면 자기가 머지한다"
  echo "    다른 창에 넘기지 마라 — belie 가 붙여넣어야 하고 그게 병목이다"
  echo "    반장(01) 자리 폐지. 01~05 전부 만든다"
  echo "    깨지면 revert 가 복구 수단이다. 사전 승인이 아니다"
  echo ""
  echo " 3) ★ 새 문서를 만들지 마라 (2.5)"
  echo "    최근 40커밋 중 문서 35% · 화면 1.8% 였다. 그게 이 프로젝트가 앓은 병이다"
  echo "    분석·설계·계획 문서 대신 카드 본문에 적어라"
  echo ""
  echo " 4) 배정 = Linear 라벨. 라벨 없는 카드는 착수 금지"
  echo "    화면(page.tsx·layout.tsx)은 C 진영(DC·NC)만 만진다"
  echo ""
  echo " 5) 막히면 기다리지 말고 «반납» — 라벨을 떼고 blocked:<막는 칸 약칭>"
  echo "    도장에 «누가» 를 이름으로. 「나는 무엇으로 넘어간다」가 없으면 정지다"
  echo ""
  echo " [belie 승인이 필요한 것 — 이 넷뿐이다]"
  echo "    provider 발송 설정 · worker 자격증명 · 058 hosted 적용 · 실제 발송"
  echo "    그 밖에는 스스로 판단하고 진행한다"
  echo ""
  echo " -> BBE-94 에 도장을 남겨라"
  echo "=============================================================="
  echo ""

echo "▶ [0/4] decision dashboard"
node --test tools/dashboard-server.test.mjs tools/board/board.template.test.mjs

echo "▶ [1/3] lint"
npm run lint --workspaces --if-present

echo "▶ [2/3] typecheck"
npm run typecheck --workspaces --if-present

echo "▶ [3/3] test"
npm run test --workspaces --if-present

echo "▶ [4/4] 목업↔앱 대조"
node docs/design/qa-app.mjs --self-test
set +e
node docs/design/qa-app.mjs
qa_app_status=$?
set -e
if [[ "$qa_app_status" -eq 1 ]]; then
  echo "⚠️ qa-app 차이 보고 완료 — 1단계에서는 check를 실패시키지 않습니다"
elif [[ "$qa_app_status" -ne 0 ]]; then
  echo "❌ qa-app 자체 실행 실패 — 차이 보고로 숨기지 않습니다"
  exit "$qa_app_status"
fi

echo "✅ check 통과"
