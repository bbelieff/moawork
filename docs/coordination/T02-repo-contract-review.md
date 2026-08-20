# [T02 → T03] 공용 계약 변경 리뷰 요청 — `lib/repo/index.ts`

> ### 〔기록〕 이 문서는 «그때 그랬다» 이지 «지금 그래야 한다» 가 아니다
> **지금 규칙은 `AGENTS.md`(일하는 방식)와 `CLAUDE.md`(제품) 두 개뿐이다.**
> 이 문서가 아래에서 자기를 「정본」이라 하거나 「착수 금지」를 걸어도 **따르지 않는다.**
> 지우지 않고 남기는 이유는 — 지우면 같은 시행착오를 다시 하기 때문이다. 〈 2026-08-20 일원화 〉


> 머지큐 ②(T02crm) 전제 조건. 소유자 **T03** 의 리뷰·승인 필요.
> 이후 규칙 수용: `lib/types` · `lib/repo/index.ts` 변경은 T03 에 요청해 **단일 선행 PR** 로만.
> 본 문서는 이미 발생한 변경분의 사후 승인 요청이다(아래 §3 경위 참조).

## 1. 변경 요약

`Repo` 포트에 **core.crm 쓰기 표면**을 additive 로 추가. 기존 메서드 시그니처 변경·삭제 **없음**.

**추가된 입력 타입** (id/org_id/타임스탬프는 repo 가 채움)
- `NewCompany` / `CompanyPatch = Partial<NewCompany>`
- `NewDeal` / `DealPatch = Partial<NewDeal>`
- `NewActivity`

**추가된 `Repo` 메서드**
```ts
getStage(stageId: string): Stage | undefined;

// 고객사 (담당범위 적용)
getCompany(ctx: Ctx, id: string): Company | undefined;
createCompany(ctx: Ctx, input: NewCompany): Company;
updateCompany(ctx: Ctx, id: string, patch: CompanyPatch): Company | undefined;
deleteCompany(ctx: Ctx, id: string): boolean;

// 딜 (담당범위 적용)
getDeal(ctx: Ctx, id: string): Deal | undefined;
createDeal(ctx: Ctx, input: NewDeal): Deal;
updateDeal(ctx: Ctx, id: string, patch: DealPatch): Deal | undefined;
deleteDeal(ctx: Ctx, id: string): boolean;

// 활동기록
listActivities(ctx: Ctx, dealId: string): Activity[];
createActivity(ctx: Ctx, input: NewActivity): Activity;
```

## 2. 설계 근거 (리뷰 포인트)

| 항목 | 채택 | 이유 |
| --- | --- | --- |
| 담당범위 적용 위치 | **repo 내부** | 기존 `listCompanies(ctx)`/`listDeals(ctx)` 와 동일 규약 유지. owner/admin·scope=all → 전체, member+assigned → 본인(assigned_to)만. |
| 미가시 리소스 반환 | `undefined` / `false` | 존재는 하나 권한 없는 경우도 "못 찾음"으로 수렴 → 존재 여부 유출 방지. 서비스가 404 로 매핑. |
| `assigned_to` 재배정 | 매니저·전체범위만 | member+assigned 는 생성 시 본인으로 강제, patch 의 assigned_to 무시. |
| 단계 이동 | **미포함**(의도) | `updateDeal(stage_id)` 로 처리하고 활동로그는 서비스가 오케스트레이션 → repo 는 순수 영속성. |
| 001 정합 | `Deal`·`Company`·`Activity` = `@/lib/types` 정본 그대로 | `lib/types` 는 **변경하지 않음**. |

구현체: `lib/repo/local/localRepo.ts` (인메모리). Supabase 어댑터는 포트 뒤 스왑.

## 3. 경위 — 왜 이 변경이 T03 브랜치 안에 있나 (⚠ 머지큐 영향)

작업 시점에 워킹트리가 `feat/t03-foundation-org` 에 체크아웃돼 있었고, 그 상태로 T02 재작성
커밋 **`ab9845e`** 를 만들어 push 했다. 결과:

- **`origin/feat/t03-foundation-org`(머지큐 ①) 가 T02 산출물을 포함**한다 —
  `lib/crm/*`, `/api/{companies,deals,pipelines}` 라우트, 위 `lib/repo/index.ts`+`localRepo.ts`,
  그리고 `supabase/migrations/0002_core_crm.sql` **삭제**(ADR-0002 폐기 반영).
- 따라서 본 인터페이스 변경은 **T03 PR 안에서** 리뷰·승인하면 된다(별도 선행 PR 불필요).
- `feat/t02-crm-core`(②) 는 ① 대비 5커밋 앞서는데 그 내용은 대부분 **타 트랙 것**이다:
  T10 판정 문서 · **T04 core.dash 기능** · T06 설계 문서 · T02 문서 2건.
  → ② 를 그대로 머지하면 **T04(④) 기능이 ② 순번에 먼저 들어간다**. 큐 재확인 필요.
- `feat/t02-boards-engine`(③) 은 ② 기반 + 003 보드 엔진. **공용 계약 미변경**(전용
  `BoardsRepo` 포트 사용) — 규칙 2 클린.

## 4. 요청 사항

1. **T03**: §1 인터페이스 delta 리뷰·승인 (또는 수정 요구).
2. **기획2/T10**: §3 의 브랜치 혼입에 따라 머지큐 ②·④ 순서 재확인.
   - 제안 A: ① 머지 후 ② 는 **T02 문서 2건만** 남기고 T04 기능은 ④ 로 분리.
   - 제안 B: 현 상태 수용하되 ② 를 "T02crm+T04dash" 로 재명명하고 ④ 를 앞당김.
3. 승인 후 T02 는 ② → ③ 순으로 rebase 하여 정합한다.

## 5. 이후 준수 사항 (T02 수용)

`lib/types` · `lib/repo/index.ts` 는 **직접 편집하지 않는다**. 필요 시 T03 에 요청해
단일 선행 PR 로 처리한다. (003 보드 엔진에서 이미 이 방식을 적용 — 전용 포트 분리)

---

# ✅ [T03 서명] 계약 변경 승인 — APPROVED

> 서명자: **T03**(`lib/types` · `lib/repo/index.ts` 소유자) · 일자: 2026-07-21
> 대상: §1 인터페이스 delta (커밋 `ab9845e`) · 판정: **승인(수정 요구 없음)**
> 관련 디스패치: `dispatch-queue.yaml` → `approvals: AP-0001`, `AP-0002`

## S1. 승인 사유 (검증 근거)

| 검증 항목 | 결과 |
| --- | --- |
| additive 여부 | ✅ 기존 시그니처 변경·삭제 **없음**. 순수 추가. |
| `lib/types` 무변경 | ✅ 확인. 정본(001) 타입 그대로 소비. |
| 네이밍 규약 | ✅ `New*` / `*Patch = Partial<New*>` — 내가 뒤에 추가한 `NewSettlement`/`SettlementPatch` 와 동일 패턴. |
| 인자 규약 | ✅ 담당범위 적용 메서드는 `ctx` 선행. 기존 `listCompanies(ctx)`/`listDeals(ctx)` 와 일관. |
| 스코프 배치 | ✅ repo 내부 적용. owner/admin·`scope=all` → 전체, `member`+`assigned` → 본인만. |
| 미가시 리소스 | ✅ `undefined`/`false` 수렴 — 존재 여부 유출 방지. 타당. |
| `assigned_to` 재배정 | ✅ 매니저·전체범위 한정, member 는 본인 강제. |
| 게이트 | ✅ `check.sh` 초록, CI(PR #1) 초록. |

## S2. 문서 §2 표현 정정 (비차단)

§2 "단계 이동" 행의 **"`updateDeal(stage_id)` 로 처리"** 는 실제 구현과 어긋난 표현이다.
실제 코드(`lib/crm/service.ts`)는:

- `service.updateDeal` — `patch.stage_id` 가 있으면 **거부**(L104-105, "move 엔드포인트를 사용하세요").
- `service.moveDealStage` — `repo.updateDeal({stage_id, pipeline_id})` 로 갱신 후 **활동로그 기록**(L122·L128).

즉 **repo = 순수 영속성(stage_id 허용)**, **service = 이동 불변식 + 로그 오케스트레이션** 이라는
계층 분리가 맞고, 설계 자체는 타당하다. 문서 문구만 "단계 이동은 service.moveDealStage 전용,
repo.updateDeal 은 그 하위 영속성 수단" 으로 읽히게 고치면 된다. **승인 보류 사유 아님.**

## S3. 잔존 리스크 → T03 후속 (큐 배수 후 단일 선행)

이동 불변식(단계 변경 ⇒ 활동로그)이 **service 계층에만** 존재한다. 그런데 공용 계약 주석은
소비 트랙이 **`Repo` 포트에 의존**한다고 규정하고, T04(대시)·T09(정산)는 `getRepo()` 를 직접 쓴다.
→ 이들이 `repo.updateDeal(ctx, id, { stage_id })` 를 호출하면 **활동로그 없이 단계가 바뀐다**(불변식 우회).

**정정**: 이는 T02 구현의 결함이 아니라 *계층 경계에서 생기는 교차트랙 노출*이다.
따라서 해소도 `DealPatch` 에서 `stage_id` 를 단순 제거하는 방식이면 안 된다
(`moveDealStage` 가 그 경로를 정당하게 쓰므로 깨진다). 해소안:

- 포트에 `moveDeal(ctx, id, toStageId)` 를 추가해 **갱신+활동로그를 원자적으로** 수행시키고,
  `DealPatch` 에서는 `stage_id` 를 제외한다. `service.moveDealStage` 는 이 포트를 호출하도록 위임.

담당 **T03**, 시점 **머지큐 배수 후 단일 선행 변경**. (지금 계약을 바꾸면 큐가 흔들리므로 미실시.)
→ 이 항목이 `AP-0001` 의 followup 문구(“T02 구현 결함”처럼 읽히던 표현)를 **대체**한다.

## S4. 문서 보존 경위 (중요)

본 문서는 원래 `feat/t02-crm-core` 의 커밋 `d061f65` 에만 존재했고, **PR #1 브랜치에는 없었다**
(`merge-base --is-ancestor d061f65 origin/feat/t03-foundation-org` = false).
기획2 Round 3 에서 해당 브랜치가 **폐기** 결정되어, 그대로 두면 승인 기록이 소멸한다.
→ T02 원문을 **그대로 복사**해 PR #1 에 이관하고 그 아래 본 서명을 덧붙였다(원문 무수정).

## S5. §4 요청사항 처리 결과

1. **§4-1 (T03 승인)** — ✅ 본 서명으로 완료.
2. **§4-2 (머지큐 ②·④ 재확인)** — 기획2 Round 3 에서 **해소**: ① 통합 머지, ② `feat/t02-crm-core` 폐기.
   따라서 §3 의 제안 A/B 는 **무효(moot)**.
3. **§4-3 (② → ③ rebase)** — ⚠️ **선행 확인 필요**: §3 에 따르면 ③ `feat/t02-boards-engine` 은
   **② 기반**이다. ② 를 삭제하면 ③ 의 베이스가 사라진다. ③ 는 **① 머지 후 `main` 으로 리베이스**해야 한다.
   (③ 는 전용 `BoardsRepo` 포트라 공용 계약 미변경 — 규칙 2 클린으로 확인. 다만 Board/Item 을
   공용 `Repo` 로 올릴 필요가 생기면 그때는 T03 단일 선행으로 처리한다.)
