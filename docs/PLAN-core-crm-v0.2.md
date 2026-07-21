# core.crm (T02 영업코어) — 구현 노트 · v0.2

> 정본 기획 = [`docs/PLAN-v0.2.md`], 정본 스키마 = [`supabase/migrations/001_schema_v1.sql`].
> 이 문서는 그 위에서 T02 가 구현한 **core.crm 앱 레이어**(고객사·파이프라인·딜·활동)를 기록한다.
> ⚠ 초기에 정본 파일 부재로 T02 가 독자 스키마(boards/items)를 저작했으나, 정본(001)이
>   확정되어 **정본 모델(companies/pipelines/stages/deals/activities)에 맞춰 재작성**했다.

## 범위 (PLAN §3 core.crm)

- 목적: 먼데이 4단계(신규고객→컨텍→업무→회계)를 하나의 파이프라인으로.
- 담당 테이블(001): `companies` · `pipelines` · `stages` · `deals` · `activities`.
- 기능: 딜/고객사 CRUD · 단계 이동(먼데이 "이동" 자동화 = 활동로그) · 활동기록 · 담당범위.

### 경계 (T02 가 다루지 않음)
- **수식·정산(settlements, fee_amount/total_revenue/d180/d365)** → **T09**.
  001 의 generated column + `app/src/lib/policyfund/settlement.ts` 가 정본.
- **커스텀필드·저장뷰(field_defs/field_values/saved_views)** → **T05**.
- **조직/RLS/Auth(orgs/org_members, is_org_member 등)** → **T03**(이미 완료).

## 아키텍처 — 공유 인프라 재사용

```
@/lib/types           도메인 타입(001 매핑) — 정본, 재사용
@/lib/repo            저장소 포트 Repo + LocalRepo(인메모리) — 공유
  └ T02 확장: getStage · company/deal CRUD · activities (담당범위 적용)
@/lib/auth/session    세션 → Ctx(org+role+scope) — T03, 재사용
app/src/lib/crm/
  service.ts          CrmService(Ctx 기반 오케스트레이션)
  activity.ts         단계이동 활동로그 문구(순수)
  validation.ts       입력 검증(company/deal/activity/move)
  context.ts          requireCtx (세션 없으면 401)
  http.ts             에러 → 상태코드
  index.ts            배럴 + getCrmService()
app/src/app/api/      companies · pipelines · deals · deals/[id]/move · deals/[id]/activities
```

- **별도 store/PostgREST 어댑터를 만들지 않고** 공유 `getRepo()` 포트를 재사용·확장.
  운영 Supabase 어댑터는 Repo 포트 뒤에서 스왑(공유 계획).
- 담당범위(scope): `owner/admin` 또는 `scope='all'` → 조직 전체, `member+assigned` → 본인
  담당(assigned_to)만. 앱 레이어 가드 + DB RLS(001)의 이중 방어.

## 단계 이동 자동화

딜의 `stage_id` 변경 = `moveDealStage` 로만(활동로그 보장). 부수효과:
- `activities` 에 `type='status'`, `content="이전단계 → 목적단계"` 기록.
- 딜 생성 시에도 최초 배치 로그(`"→ 마케팅"`).
- 단계값 무결성: `updateDeal` 은 `stage_id` 패치를 거부(=/move 로 유도).

## API

| 메서드/경로 | 동작 |
| --- | --- |
| `GET/POST /api/companies` | 고객사 목록(담당범위)/생성 |
| `GET/PATCH/DELETE /api/companies/{id}` | 고객사 상세/수정/삭제 |
| `GET /api/pipelines` | 파이프라인+단계 목록(칸반 소스) |
| `GET/POST /api/deals` | 딜 목록(`?stageId=`,`?companyId=`)/생성 |
| `GET/PATCH/DELETE /api/deals/{id}` | 딜 상세/수정(단계 제외)/삭제 |
| `POST /api/deals/{id}/move` | 단계 이동 + 활동로그 |
| `GET/POST /api/deals/{id}/activities` | 활동 목록(최신순)/추가 |

- Next.js 16: `route.ts` 에 메서드 export, `context.params` = Promise, 세션은 `requireCtx()`.

## 후속 (follow-up)
- [ ] Supabase Repo 어댑터(공유) 연결 시 라이브 통합테스트.
- [ ] core.dash(T04)·mod.perf(T07)가 deals/activities 집계 소비.
- [ ] ind.policyfund(T09) 정산 UI 가 deal ↔ settlement 연결.
