# CLAUDE.md — moawork

통합관리시스템(moawork) 저장소의 작업 지침. Claude/에이전트는 이 문서를 우선 따른다.

**읽기 순서**: `CLAUDE.md` → `AGENTS.md` → 최신 `docs/coordination/sync/ROUND-N.md` → **자기 PLAN**(`docs/plans/PLAN-00N.md` 의 담당 WO 카드).
그 외 문서는 필요할 때만 편다. 진행 상태·이력은 저장소가 아니라 **Linear** 에 있다.

## 프로젝트

- **정의**: 서울경영지원센터의 먼데이(monday.com) 보드를 동일하게 복제하는 웹앱.
- **스택**: Next.js(프론트 + API) · Supabase(DB + Auth) · Node worker(VPS, pg-boss).

## 모노레포 구조

```
app/       Next.js 앱 (프론트 + API 라우트)
worker/    Node 백그라운드 잡 러너 (pg-boss)
supabase/  DB 마이그레이션 (SQL)
scripts/   check.sh 등 게이트 스크립트
docs/      plans/ (설계·규약), coordination/ (트랙 조율 SSOT), archive/ (동결된 과거 기록)
```

npm workspaces 사용 (`app`, `worker`).

## 품질 게이트

- 모든 변경은 `bash scripts/check.sh`(= lint + typecheck + test)를 통과해야 한다.
- `.githooks/pre-commit` 이 커밋 전에 동일 게이트를 실행한다.
  최초 1회 `git config core.hooksPath .githooks` (루트 `npm install` 시 자동).
- CI(`.github/workflows/ci.yml`)가 push/PR 마다 동일 게이트를 재실행한다.

## SSOT (단일 진실 소스)

원칙: **상태·이력은 Linear, 규칙·결정은 저장소 문서.** 정본은 층마다 하나만 둔다.

1. `CLAUDE.md` (이 문서) — 작업 지침.
2. `AGENTS.md` — 에이전트/트랙 역할.
3. **Linear 이슈** — 진행 상태·START/END 기록·판정 수치. 저장소에 진행 로그를 쌓지 않는다.
4. `docs/coordination/sync/ROUND-N.md` — **최신 라운드가 규칙·승계의 정본.** 규칙 변경 로그만 남기고 상태 스냅샷은 적지 않는다(§ROUND 작성 규칙 = `docs/coordination/README.md`).
5. `docs/plans/` — 설계도·규약. `PLAN-00N.md`(WO 카드) · `qa-gate.md`(검수 기준) · `ui-guidelines.md` · `naming-rules.md`.
6. `docs/playbooks/` — `worker-onboarding.md`(리스·게이트 체인·함정) · `thinking-protocol.md`.

> **2026-08-05 기록 개편**: `docs/worklog.md` · `decision-inbox.md` · `T02`/`T03` 문서 · T10 판정 이력은
> **동결**돼 `docs/archive/` 로 이동했다(수정·추가 금지, 열람만). T10 의 **검수 기준부**는 `docs/plans/qa-gate.md` 로 이관.
> 근거·수치: `docs/plans/system-audit-2026-08-05.md`.
> 2026-07-22 SYNC R1 로 `session-registry.yaml`·`dispatch-queue.yaml`·`provider-status.yaml` 은 폐기(원문은 git 히스토리).

## 규칙

- **비밀값 금지**: 키·토큰·비밀번호·연결 문자열을 저장소에 절대 기록하지 않는다. `.env.example` 로만 형태를 남기고 실제 값은 `.env*`(gitignore).
- 커밋 전 반드시 check 게이트 통과.
- 착수·완료 시 **해당 Linear 이슈에 START/END 코멘트**를 남긴다(양식: 결과·파일·게이트·NOT_RUN·소비자).
  **END 코멘트가 없으면 다음 배정을 내리지 않는다.** 규칙·승계가 바뀐 경우에만 최신 ROUND 에 1줄 추가한다.
- `docs/archive/**` 는 동결 기록이다. 열람만 하고 수정·추가하지 않는다.
- Supabase 스키마 변경은 새 마이그레이션 파일로만 추가(기존 파일 수정 금지).
