#!/usr/bin/env bash
# check.sh — moawork 품질 게이트
# lint + typecheck + test 를 순서대로 실행한다. 하나라도 실패하면 즉시 중단(비정상 종료).
# CI 와 .githooks/pre-commit 이 공통으로 이 스크립트를 호출한다(단일 진실 게이트).
set -euo pipefail

# 리포지토리 루트로 이동 (스크립트 위치 기준)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ [1/3] lint"
npm run lint --workspaces --if-present

echo "▶ [2/3] typecheck"
npm run typecheck --workspaces --if-present

echo "▶ [3/3] test"
npm run test --workspaces --if-present

echo "✅ check 통과"
