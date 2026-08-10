# Repository Structure SSOT

계층 방향은 `lib/types/` → `lib/config/` → `lib/repo/` → `lib/service/` → `app/`·`components/`다. 왼쪽 계층은 오른쪽을 참조할 수 없다. 외부 SDK 직접 호출은 `lib/repo/` 또는 `worker/adapters/`에만 둔다.

| 경로 | 책임 |
|---|---|
| `app/` | Next.js App Router 진입점 |
| `components/` | 재사용 UI |
| `lib/` | 타입·설정·저장소·서비스 계층 |
| `worker/` | 배치·외부 API 프로세스 |
| `supabase/` | 로컬 migration(업무 스키마 미정) |
| `tests/` | 단위·구조 검사 |
| `scripts/` | 단일 품질 게이트 |
| `docs/` | 계획·관제·설계·SSOT·워크로그 |

제품 소스는 500줄 이하로 유지한다. 새 코드 경계는 이 문서에 같은 변경으로 등재한다.

## 로컬 백엔드 모듈 (2026-07-21 · 로컬 우선/Supabase 미연결)

DB 없이 `lib/` 순수 TS 로 도는 백엔드 코어. 어댑터만 나중에 Supabase 로 교체.

- `lib/types/domain.ts` — 도메인 타입(001_schema_v1.sql 대응).
- `lib/repo/formula.ts`(정산 수식·순수) · `lib/repo/access.ts`(담당범위 판정·순수) · `lib/repo/types.ts`(Repo 포트) · `lib/repo/index.ts`(`getRepo()` 팩토리).
- `lib/repo/local/store.ts`·`seed.ts`·`localRepo.ts` — 인메모리 싱글톤 + 가상 시드(조직 A/B) + Repo 구현(**org_id + 담당범위 격리 = RLS 패리티**).
- `lib/service/session.ts`·`authz.ts`·`crm.ts`·`dashboard.ts` — 세션·권한·영업코어(파이프라인/활동/딜)·대시 집계.
- 테스트: `tests/unit/settlement-formula.test.mjs`·`backend-isolation.test.mjs`·`crm-flow.test.mjs`.

**import 규약(결정)**: 상대경로는 명시적 `.ts` 확장자를 쓴다. Node 타입-스트리핑으로 **빌드 없이** tsc·node 둘 다 동작(tsconfig `allowImportingTsExtensions: true`, `npm run test` = `--experimental-strip-types`, Node ≥22.6). 외부 SDK 는 여전히 `lib/repo/`·`worker/adapters/` 에만.
