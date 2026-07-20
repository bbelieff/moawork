# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

## 2026-07-21 — T01 · Phase 0 → W1 모노레포 기반 구축

- 레포 클론 및 모노레포 골격 수립.
- `app/` — Next.js 16 (TypeScript + Tailwind v4 + App Router, `src/` 구조) 스캐폴딩.
- `worker/` — Node(ESM) + pg-boss 골격, health 유닛테스트 포함.
- `supabase/` — `migrations/0001_init.sql` (app_meta / schema_version) + README.
- `scripts/check.sh` — lint + typecheck + test 단일 게이트.
- `.github/workflows/ci.yml` — push/PR 시 `npm ci` → check 게이트 실행.
- `.githooks/pre-commit` — 커밋 전 check 게이트 (`core.hooksPath=.githooks`).
- 루트 npm workspaces(app, worker) 구성.
- SSOT 4문서 작성: `CLAUDE.md`, `AGENTS.md`, `docs/worklog.md`, `docs/coordination/`.
- check.sh 초록 확인 후 커밋/푸시.
