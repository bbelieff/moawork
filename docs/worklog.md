# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

## 2026-07-21 — T02 · core.crm MVP 구현 (보드 미러 + 파이프라인 + 저장뷰 + 수식)

- **트리거**: 오너가 기획 v0.2 + DB 스키마 v1 확정 통보. 단, 지정된 `docs/PLAN-v0.2.md` /
  `supabase/migrations/001_schema_v1.sql` 이 저장소에 부재 → 오너 승인 하에 T02 가 core.crm
  스키마 v1 + 설계를 저작.
- **스키마**: `supabase/migrations/0002_core_crm.sql` — boards / pipeline_stages /
  board_columns / items / column_values / saved_views + `org_id` 멀티테넌시 + RLS enable
  (정책 없음=fail-closed). 방식 B(하이브리드 정규화).
- **설계 문서**: `docs/PLAN-core-crm-v0.2.md` — 수식 4개 가정, 자동화 규칙, 트랙 경계 명시.
- **도메인 레이어** `app/src/lib/crm/`:
  - 수식 엔진(수수료·총매출·D+180·D+365) — 가정을 formulas.ts 상단에 문서화, 교정은 그 파일만.
  - 파이프라인 단계 이동 + 자동화(진행중→계약일 자동세팅, 완료→completed_at 스탬프/해제).
  - 저장뷰 필터·정렬 적용, 입력 검증 — 모두 순수 함수 + 단위테스트.
  - 스토어 포트 + InMemory(참조/테스트) / PostgREST(운영, fetch, 의존성 0) 어댑터.
  - 서비스 오케스트레이션 + Next.js Route Handlers(boards/items/move/views CRUD).
- **게이트**: `bash scripts/check.sh` 초록 (app 68 crm 테스트 포함 총 90 통과, lint/typecheck OK).
- **경계 존중**: RLS 정책 본체·조직 모델·Auth = T03, 커스텀필드 옵션 = T05. `org_id` 컬럼 +
  앱 레이어 org 스코핑 + `x-org-id` 임시 컨텍스트(T03 연동 시 교체).
- **조율**: DQ-0002 → done (T05/T07/T09 언블록). session-registry T02 → active.
- **후속**: T03 Auth/RLS 정합, PostgREST 라이브 DB 통합테스트, 수식 확정본 반영.
- 앱 라우트 작성 전 `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인
  (route handler 규약: `context.params` = Promise).

## 2026-07-21 — T09 · 정책자금 업종팩 착수 · 데이터 무의존 순수 계층 구현(checkpoint)

- **선행 파일 부재 확인**: 착수 지시가 가리킨 `docs/PLAN-v0.2.md` 와 `supabase/migrations/002_seed_policyfund.sql` 이 **저장소 어디에도 없음**(트래킹/브랜치/스태시/워크트리 전수 확인). 실제 도메인 값(지역 218·상품 59·기관 18·상담 16·계약 11·진행 14·자금 28, 보드 31컬럼)은 지어내지 않고, 그 데이터가 들어오면 꽂히도록 계층만 선구현.
- **구현**(`app/src/lib/policyfund/`, 순수 TS + vitest):
  - `types.ts` — 옵션 카테고리·프리셋 옵션·진행기관·상품·보드 컬럼/아이템 도메인 타입.
  - `settlement.ts`(+test) — 정산 수식: `수수료=집행금액×수수료율`, `총매출=수수료 합`(집행금액 기준 대안 제공), `D+180/D+365`(UTC 기산). 가정 명시.
  - `pipeline.ts`(+test) — 파이프라인 단계별 필터·정렬(미지정 후순위·안정)·개수집계·그룹화(빈 단계 포함). 단계 순서는 시드 옵션 순서를 호출부가 주입(하드코딩 금지).
  - `presets.ts`(+test) — 7개 카테고리 구조 + `EXPECTED_COUNTS`(기획 명세 개수) + `validatePresetCounts()`/`isFullyLoaded()`. 실제 값은 `PRESET_OPTIONS`(현재 빈 값)에 시드 로더가 주입 예정.
  - `index.ts` 배럴, `README.md`(상태·대기 입력·정산 가정 문서화).
- **게이트**: `bash scripts/check.sh` → 초록. 앱 22 테스트(policyfund 21 신규 + format 1) + 워커 1 통과, lint/typecheck OK.
- **남은 작업(차단)**: (1) `002_seed` 확정 → `PRESET_OPTIONS` 로더 연결 + 개수 대조, (2) 보드 31컬럼 레지스트리(기획 v0.2), (3) UI 컴포넌트(선택지 셀렉트·보드 뷰·파이프라인) — 데이터 + T02 보드 CRUD API + Next.js 수정판 문서 확인 후.
- SSOT 갱신: `session-registry.yaml` T09 status → active, `dispatch-queue.yaml` DQ-0009 status → in_progress(남은 항목 blocked_on 명시).

## 2026-07-21 — T10 · 게이트키퍼(검증) 트랙 등록 · 베이스라인 게이트 검증 · 상시대기(checkpoint)

- 역할: 배포마다 **parity**(먼데이 원본 대비 재현 정합성) · **측정** · **RLS 침투테스트**(조직 단위 멀티테넌시 격리) · **완료판정**. 상시 활성.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `scripts/check.sh`, `docs/coordination/*`(session-registry / dispatch-queue / provider-status) 전체 정독.
- **베이스라인 게이트 검증**: `bash scripts/check.sh` 직접 실행 → **초록(exit 0)**. lint + typecheck(app/worker `tsc --noEmit`) + test(app `format.test`, worker `health.test`, 각 1 pass) 통과 확인 → 현 시점 저장소는 게이트 통과 상태.
- **검증 대상 현황**: 도메인 트랙 T02~T09 는 기획 v0.2 + DB 스키마 v1 미확정으로 전부 standby/blocked — **검증할 배포 산출물이 아직 없음**. parity 는 T02(core.crm 보드 미러), RLS 침투테스트는 T03(core.org + RLS) 산출물에 의존하므로 해당 트랙 배포 시 착수.
- **완료판정 기준**: 각 트랙 done 승인은 `check 게이트 통과` + `parity/측정/RLS 검증 통과`를 **모두** 만족할 때만.
- SSOT 갱신: `session-registry.yaml` 에 T10 등록(status: active), `dispatch-queue.yaml` 에 DQ-0010 추가(status: in_progress, 상시 대기형 검증).
- 다음: 트랙 PR/배포 발생 시 parity·측정·RLS 침투테스트 착수. 그 전까지 게이트 초록 유지 감시하며 대기.

## 2026-07-21 — T08 · 홈택스(mod.hometax) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.hometax` 조회→발행(전자세금계산서) + worker 잡(pg-boss 조회·발행 백그라운드 잡).
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/AGENTS.md`(수정 Next.js — 코드 전 `node_modules/next/dist/docs/` 확인), `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 상태: supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만, `worker/src/index.ts` 는 pg-boss 부트스트랩 골격(잡 핸들러 TODO)만 존재 — mod.hometax 도메인 미착수.
- **대기 사유**: 선행 트랙 **T06(mod.notify + VPS 워커 잡 패턴)** 미완료 + 기획 v0.2 확정 + DB 스키마 v1(mod.hometax 도메인 테이블 — 조회/발행/문서로그) 미확정. 홈택스 워커 잡은 T06 이 세우는 pg-boss 핸들러 패턴 위에 얹힌다.
- 외부 의존: 홈택스는 국세청/전자세금계산서 연동 프로바이더 → `provider-status.yaml` 에 `hometax`(kind: tax-invoice, status: planned) 등록. 인증서·API 키 등 비밀값은 env 로만 주입, 저장소 기록 금지.
- SSOT 갱신: `session-registry.yaml` 에 T08 등록(status: standby, depends_on: [T01, T06]), `dispatch-queue.yaml` 에 DQ-0008 추가(status: blocked), `provider-status.yaml` 에 hometax 추가.
- 선행 조건(T06 done + 기획 v0.2 + DB 스키마 v1) 충족 시 착수 순서(안): mod.hometax 마이그레이션 → 조회 도메인/API → 발행 플로우 → worker(pg-boss) 조회·발행 잡.

## 2026-07-21 — T07 · 성과·인센티브(mod.perf) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.perf` 성과 집계 / 리더보드 / 활동량.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 도메인 현황: supabase 는 `0001_init.sql`(메타)만, `worker/src/index.ts` 는 pg-boss 부트스트랩 골격만(잡 핸들러 TODO) — mod.perf 도메인 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(mod.perf 도메인 테이블 — 성과지표/집계 스냅샷/활동로그) 미확정. 특히 활동량·성과 집계의 소스가 **T02(core.crm)** 의 보드/아이템/파이프라인 이벤트이므로 T02 done 전까지 착수 불가.
- SSOT 갱신: `session-registry.yaml` 에 T07 등록(status: standby, depends_on: [T01, T02]), `dispatch-queue.yaml` 에 DQ-0007 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): mod.perf 마이그레이션 → 집계 로직(뷰/pg-boss 주기 잡) → 리더보드 조회 API. 주기 집계 잡은 worker 에서 T06 등 타 트랙과 dispatch-queue 로 조율.

## 2026-07-21 — T09 · 정책자금 업종팩(ind.policyfund) + 정산(settlements) 트랙 등록 · 대기(checkpoint)

- 역할: `ind.policyfund` 진행기관(취급기관) + 상품 카탈로그(60여종) + 지역 조건 + 상품 수식(한도/금리/자격 계산) · `settlements` 정산.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: (1) 선행 트랙 **T02(core.crm)** 미완료 — 정산은 계약/아이템 도메인 위에 얹힘. (2) 기획 v0.2 확정 필요 — 정책자금 상품 60여종 목록·수식(한도/금리/자격) 정의가 업종팩 스키마·엔진의 입력.
- SSOT 갱신: `session-registry.yaml` 에 T09 등록(status: standby, depends_on: [T01,T02]), `dispatch-queue.yaml` 에 DQ-0009 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): ind.policyfund 진행기관/상품/지역 마이그레이션 → 수식 엔진(수식 정의 저장·평가) → settlements 정산(계약 성사 → 수수료/정산 산출·기록, worker 잡 연동).

## 2026-07-21 — T06 · 알림발송(mod.notify) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.notify` 알림톡(카카오)/문자(SMS) 발송 + VPS 워커 발송 잡(pg-boss).
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 도메인 현황: `worker/src/index.ts` 는 pg-boss 부트스트랩 골격만 존재(`boss.work(...)` 잡 핸들러 TODO), `worker/.env.example` 는 `DATABASE_URL` 만. supabase 는 `0001_init.sql`(메타)만 — mod.notify 도메인 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(mod.notify 도메인 테이블 — 템플릿/발송로그/수신자) 미확정. 발송 트리거가 될 도메인 이벤트는 타 트랙(T02 파이프라인 등) 스키마에 의존.
- SSOT 갱신: `session-registry.yaml` 에 T06 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0006 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): mod.notify 마이그레이션 → 프로바이더 어댑터(알림톡/SMS) → pg-boss 발송 잡(재시도·상태 추적). 비밀값(프로바이더 API 키)은 `.env` 로만.

## 2026-07-21 — T03 · 조직·보안 트랙 등록 · 대기(checkpoint)

- 역할: `core.org`(조직/멤버십) + RLS 멀티테넌시(조직 단위 격리) + Supabase Auth 구글 OAuth 로그인.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마·RLS·Auth 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(core.org 도메인 테이블) 미확정.
  RLS는 조직 테이블 구조에 의존하므로 스키마 v1 확정 후 설계·구현.
- SSOT 갱신: `session-registry.yaml` 에 T03 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0003 추가(status: blocked).
- 참고: `app/AGENTS.md` — 이 Next.js는 수정 버전. OAuth 로그인 라우트 작성 전 `node_modules/next/dist/docs/` 확인 필요.
- 선행 조건 충족 시 착수 순서(안): core.org 마이그레이션 → RLS 정책 → Supabase Auth 구글 OAuth 연동.

## 2026-07-21 — T05 · 커스터마이징(core.custom) 트랙 등록 · 대기(checkpoint)

- 역할: `core.custom` 커스텀필드 + 필드 타입별 선택지(옵션) + 저장뷰(saved view) — 먼데이 컬럼 재현.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 선행 트랙 **T02(core.crm)** 미완료. 커스텀필드는 T02 의 보드/아이템 도메인 스키마 위에 얹히므로 T02 done 전까지 착수 불가.
- SSOT 갱신: `session-registry.yaml` 에 T05 등록(status: standby, blocked_on: T02), `dispatch-queue.yaml` 에 DQ-0005 추가(status: blocked).
- T02 완료 시 dispatch-queue 로 작업 이관 후 착수 예정.

## 2026-07-21 — T04 · 문서·대시 트랙 등록 · 대기(checkpoint)

- 역할: `core.files` 문서함 + `contracts` 상태 + `core.dash` 기본 대시보드.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(core.files/contracts/core.dash 도메인 테이블) 미확정.
- SSOT 갱신: `session-registry.yaml` 에 T04 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0004 추가(status: blocked).
- 참고: `app/AGENTS.md` — 이 Next.js는 수정 버전. 앱 코드 작성 전 `node_modules/next/dist/docs/` 확인 필요.
- 선행 조건 충족 시 착수 예정.

## 2026-07-21 — T02 · 영업코어(core.crm) 트랙 등록 · 대기(checkpoint)

- 역할: 신규고객/컨택/업무 보드 미러 + 파이프라인(상담중→계약대기→진행중→완료) + 단계 이동 자동화.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(supabase 도메인 마이그레이션) 미확정.
- SSOT 갱신: `session-registry.yaml` 에 T02 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0002 추가(status: blocked).
- 선행 조건 충족 시 착수 예정.

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
