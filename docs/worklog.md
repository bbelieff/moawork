# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

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
