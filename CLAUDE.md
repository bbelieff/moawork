# CLAUDE.md — moawork

통합관리시스템(moawork) 저장소의 작업 지침. Claude/에이전트는 이 문서를 우선 따른다.

## 프로젝트

- **정의**: 서울경영지원센터의 먼데이(monday.com) 보드를 동일하게 복제하는 웹앱.
- **스택**: Next.js(프론트 + API) · Supabase(DB + Auth) · Node worker(VPS, pg-boss).

## 모노레포 구조

```
app/       Next.js 앱 (프론트 + API 라우트)
worker/    Node 백그라운드 잡 러너 (pg-boss)
supabase/  DB 마이그레이션 (SQL)
scripts/   check.sh 등 게이트 스크립트
docs/      worklog.md, coordination/ (트랙 조율 SSOT)
```

npm workspaces 사용 (`app`, `worker`).

## 품질 게이트

- 모든 변경은 `bash scripts/check.sh`(= lint + typecheck + test)를 통과해야 한다.
- `.githooks/pre-commit` 이 커밋 전에 동일 게이트를 실행한다.
  최초 1회 `git config core.hooksPath .githooks` (루트 `npm install` 시 자동).
- CI(`.github/workflows/ci.yml`)가 push/PR 마다 동일 게이트를 재실행한다.
- **예외 — `wip/*` 브랜치**: 보존 전용이므로 pre-commit 우회(`--no-verify`)를 허용한다.
  단 **머지 금지**이며, main 으로 가려면 `feat/*` 로 승격해 정식 게이트를 통과해야 한다.
  자세한 규약은 [README.md §브랜치 규약](README.md#브랜치-규약).

## SSOT (단일 진실 소스)

1. `CLAUDE.md` (이 문서) — 작업 지침.
2. `AGENTS.md` — 에이전트/트랙 역할.
3. `docs/worklog.md` — append-only 진행 로그. 완료 단위마다 기입.
4. `docs/coordination/` — 트랙 조율 마크다운.
   - `sync/ROUND-*.md` — 전수조사·집행 조치. **최신 라운드가 트랙 상태·규칙의 정본**(계약 단일소유, 승인기록, 미해소 DQ 포함).
   - `T10-gate-checklist.md` — 검수 기준·완료판정 이력(T10 소유).
   - `decision-inbox.md` — 결정 요청/회신.
   > 2026-07-22 SYNC R1 로 `session-registry.yaml`·`dispatch-queue.yaml`·`provider-status.yaml` 은 폐기.
   > 승계 내용은 `sync/ROUND-1.md` §승계 항목에 있다. 원문은 git 히스토리 참조.

## 규칙

- **비밀값 금지**: 키·토큰·비밀번호·연결 문자열을 저장소에 절대 기록하지 않는다. `.env.example` 로만 형태를 남기고 실제 값은 `.env*`(gitignore).
- 커밋 전 반드시 check 게이트 통과.
- 작업 완료 시 `docs/worklog.md` 갱신, 관련되면 `docs/coordination/*`(마크다운) 도 갱신.
- Supabase 스키마 변경은 새 마이그레이션 파일로만 추가(기존 파일 수정 금지).
