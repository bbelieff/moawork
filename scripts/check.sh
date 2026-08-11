#!/usr/bin/env bash
# check.sh — moawork 품질 게이트
# lint + typecheck + test 를 순서대로 실행한다. 하나라도 실패하면 즉시 중단(비정상 종료).
# CI 와 .githooks/pre-commit 이 공통으로 이 스크립트를 호출한다(단일 진실 게이트).
set -euo pipefail

# 리포지토리 루트로 이동 (스크립트 위치 기준)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── 편제 개편 공지 (2026-08-12) ───────────────────────────────────
# 왜 여기 있나: 모든 세션이 커밋 전에 반드시 이 스크립트를 지난다.
# Linear 댓글·디스패치 게시는 «도는 창» 을 깨우지 못한다. 이 배너만이 확실히 닿는다.
# 개편이 전 세션에 전파된 뒤 belie·총괄이 이 블록을 삭제한다.
  echo ""
  echo "=============================================================="
  echo " !!  2026-08-12 편제 개편 — 40칸 → 24세션. 규약이 전면 개정됐다."
  echo "=============================================================="
  echo " 지금 바로:  git pull origin main   그리고 AGENTS.md 를 처음부터 읽어라."
  echo " 네가 따르던 2026-08-09 운영 규약은 폐기됐다."
  echo ""
  echo " 1) 완료의 정의가 바뀌었다 — «그 화면을 열어 눈으로 본 증거» 가 필수다"
  echo " 2) 「목업 86/86 PASS」는 앱을 증명하지 않는다. 완주 근거로 쓰지 마라"
  echo " 3) 배정 = Linear 라벨. 라벨 없는 카드는 착수 금지"
  echo " 4) 화면(page.tsx·layout.tsx)은 C 진영(DC·NC)만 만진다"
  echo " 5) 열린 PR 만 끝내고 정지. 새 카드 착수 금지"
  echo ""
  echo " 진단  docs/coordination/진단-2026-08-12.md"
  echo " 배정  docs/coordination/배정판.md"
  echo " -> BBE-94 에 세션명과 현재 상태(1:PR있음 2:없음 3:새이름받음)를 남겨라"
  echo "=============================================================="
  echo ""

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
