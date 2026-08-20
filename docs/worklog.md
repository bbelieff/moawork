# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

## [모아워크 DC-00] 2026-08-19 — BBE-240 프런트: 원장 버튼을 실제 화면에 꽂았다

- 백엔드(커밋 445d412) 위에 목업 ①②를 실제로 붙였다. `DealLedgerButton.tsx`/
  `LedgerEntryModal.tsx` 는 이미 완성돼 있었지만(백엔드 트랙 산출물) 어느 화면에도
  안 붙어 있었다 — 이번에 두 곳에 꽂았다.
- **계약업체 실무 등 보드(주 진입점)**: `GroupTable.tsx` 행에 `row.deal_id` 가 있을 때만
  「📒 원장」 버튼을 조건부 렌더(BBE-239 의 `canDeleteRow` 패턴과 동일한 자리 —
  `ItemDetailPanel` 다음, `TrashItemButton` 앞). `BoardItem.deal_id` 필드가
  타입에 아예 없어서(BBE-235 트리거가 099 로 실제 컬럼은 채우고 있었는데 TS 타입만
  못 따라갔다) `boards/types.ts` 에 추가 — Supabase 리포는 `select("*")` 라 코드 변경
  없이 바로 나오고, 로컬 리포는 `createItem` 에서 `deal_id: null` 고정(로컬은 BBE-235
  트리거가 없어 자금건 연결이 원천적으로 불가능 — 의도된 제약, 로컬/데모에서는 원장
  버튼이 안 뜬다). 타입을 필수 필드로 만든 파장으로 `assigned_to` 있는 자리마다
  `deal_id` 없는 기존 픽스처 13개가 깨져서 전부 `deal_id: null` 로 채웠다(seed.ts 포함).
- **딜 상세페이지(보조 경로)**: `/deals/[dealId]` 에 "회계 원장" 섹션 신설("담당자"
  다음, "타임라인·댓글" 앞) — 같은 `DealLedgerButton` 재사용(포크 안 함, 지시대로).
- **수납종료 배지**: `DealLedgerButton` 마운트 시점에 `loadDealLedgerAction` 을
  미리 호출해서(행을 열어보지 않아도 바로 보이게) 계약금·수수료 둘 다 있고 전부
  완납이면 배지를 보여준다 — 저장 컬럼이 아니라 로드된 entries 에서 매번 계산
  (`isSettlementClosed`, export 해서 순수 함수로 단위테스트 6건).
  이 eager useEffect 가 처음엔 `react-hooks/set-state-in-effect` 에 걸렸다 —
  `refresh()` 를 이펙트 본문에서 그대로 부르면 동기 setState 라 걸린다는 걸
  lint 가 실제로 잡아냈다. 비동기 콜백에서만 setState 하도록 고쳐서 해결.
- **테스트**: `GroupTable.test.tsx`(deal_id 있는/없는 행 원장 버튼 노출 차이),
  `DealLedgerButton.test.ts`(수납종료 판정 6케이스 — 둘 다 완납/수수료만 미수/계약금만
  있고 수수료 없음/빈 원장/부가세 초과입금도 완납으로 침/로딩·오류 상태),
  `LedgerEntryModal.test.tsx`(계약금 이미 받음 → 버튼 비활성화+안내문·계약조건
  참고텍스트 노출 조건 5건). `status-semantics.contract.test.tsx` 의 무소비처
  가드가 정확히 의도대로 빨개져서(BBE-183 패턴) `DealLedgerButton` 을 소비처
  목록으로 옮기고 코멘트 갱신 — `LedgerExportButton`(CSV 내보내기)은 이번 범위
  밖이라 여전히 무소비처로 남겨둠.
- `bash scripts/check.sh` PASS(app 전체 + worker 97/97, lint 0 error). hosted 적용 0건.
- **못 한 것 — 후속 필요**: ⑦ 실제 화면을 열어 눈으로 본 증거는 없다(이 worktree 에
  Supabase env 가 없어 로컬 서버로 실 데이터를 못 본다 — 기존에도 있던 갭). 딜
  상세페이지에서는 목업이 "항상 보이는 인라인 패널"이었는데, 여기선 "📒 원장" 버튼
  뒤에 숨겼다(컴포넌트 재사용을 우선시한 판단 — 포크해서 인라인 버전을 새로 만들지
  않았다). 연도별 전체 원장(③, 신규 화면)은 이 커밋 범위 밖 — 별도 트랙.

---

## [모아워크 DC-00] 2026-08-19 — BBE-240 병렬 프런트 2개 머지 시도 — 둘 다 무커밋으로 되돌아옴, 백엔드만 커밋

- 총괄 지시: 보드+딜상세 담당·연도별 원장 담당 두 에이전트가 각자 worktree 에서 병렬로
  BBE-240 프런트를 만들었다는 전제로, 그 둘을 review-274 워킹 브랜치에 머지·검증하라는
  것이었다. **실제로는 둘 다 파일을 한 줄도 안 썼다** — 확인 결과:
  - 보드+딜상세 담당(worktree `worktree-wf_0513d517-07a-3`)과 연도별 원장 담당
    (`worktree-wf_0513d517-07a-4`) 은 이 세션에서 이미 정리돼 `git worktree list` 에
    남아있지 않았고, 그 브랜치 이름 자체도 `git branch -a` 에 없다 — 만든 적이 없거나
    커밋 없이 지워졌다는 뜻.
  - 두 에이전트의 구조화 리포트(둘 다 `filesChanged: []`)가 이걸 그대로 증언한다: 둘 다
    "Backend is done — build against this" 라는 전제를 받았는데 실제로는 그 시점에 백엔드가
    존재하지 않아(9-인자 RPC·`fee_terms`·`vatIncluded`/`taxInvoiceIssued` 전부 부재) 시작
    전에 멈췄다고 각자 보고했다.
  - 비교 대조군으로 `worktree-agent-a1e322a7b5e693e2a`(`b07bb30`)를 확인 — `origin/main`
    과 완전히 동일(커밋 0개, diff 0). "두 프런트가 이미 커밋되어 있다" 는 전제 자체가
    이 세션에서는 틀렸다.
  - **따라서 이번 라운드에서 실제로 병합할 프런트 코드가 없다** — 머지 스텝은 스킵하고
    (지어내지 않는다), 그 대신 이미 이 워킹 트리(review-274, 지금 이 브랜치)에 **커밋 안 된
    채로** 얹혀 있던 백엔드 구현(아래 항목, 세션 스레드 `54ccb210-…`)을 검증·정리해 커밋했다.

- **백엔드 커밋 전 발견·수정한 것들** (전부 hosted 미적용 상태에서, 커밋 전에 잡음):
  - 마이그레이션 파일명이 `bbe274` 로 잘못 채번돼 있었다(Linear 실제 카드번호 BBE-240 을
    `mcp__claude_ai_Linear__get_issue`로 직접 조회해 확인). 확인 도중 파일명·logical_key·
    predecessor·주석·`migration-103.test.ts` 의 경로 문자열이 실시간으로 `bbe240` 으로
    정정되는 것도 같은 워킹 트리에서 목격했다(동시 편집 — 다른 트랙이 같은 워킹 디렉터리를
    쓰고 있었다). 재확인 결과 rename 은 완결됐고 `node scripts/check-migration-guards.mjs`
    체인 검증 PASS.
  - 수용 기준 중 "계약금 중복 입력 방지가 서버측에서도 강제됨(우회 가능하면 안 됨)" 이
    최초 버전엔 없었다 — `add_deal_ledger_entry` 에 `p_kind='contract_deposit'` 존재 검사
    + `raise exception 'contract deposit already recorded for this deal'` 가 붙는 것과,
    이를 PGlite 로 실행형 검증하는 `app/src/lib/accounting/deal-ledger-vat.pglite.test.ts`
    가 새로 생기는 것도 같은 방식으로 실시간 관찰 — 지금은 있다.
  - `rm -rf app/.next && bash scripts/check.sh` 를 여러 차례 재실행하며 확정: 최초 2회는
    위 두 가지가 완결되지 않은 중간 상태(다이제스트 불일치, `분할 입금` PGlite 테스트가
    VAT 미포함 부분입금에 `paid_on` 을 채워 constraint 위반)라 실패했고, 안정화된 뒤
    **최종 재실행은 PASS**: app 348 files/2520 tests(2 skip, 무관) · worker 28 files/97
    tests · migration guard 11-chain PASS(foundation=094) · qa-app 차이 보고는 기존
    카테고리, 논-fatal.

- **BBE-240 수용 기준 대조** (Linear 원문 기준, 이 시점 review-274 상태로):
  - ①②③ 전부 실제 데이터로 동작 — **FAIL**. 백엔드(마이그레이션·RPC·서버 액션·읽기 경로)와
    부품 컴포넌트(`DealLedgerButton`/`LedgerEntryModal`)는 있지만, `/work` 보드 행에도
    `/deals/[dealId]` 페이지에도 어디에도 마운트되지 않았다(`grep -rn "DealLedgerButton"
    app/src` → 자기 자신과 contract 테스트 가드 1곳뿐). `/ledger` 신규 라우트도 존재하지
    않는다(`app/src/app/(app)` 아래 `ledger` 없음). 이건 지어내지 않는다 — 이번 라운드
    프런트 담당 2명이 둘 다 무커밋으로 끝났으니 화면 배선은 다음 라운드로 넘어간다.
  - 계약금 중복 입력 서버측 강제 — **PASS**(위 항목, RPC 예외 + PGlite 실행형 테스트).
  - 미수금 계산이 VAT 유무에 따라 정확 — **PASS**: `summarizeDealLedger` 가 entry 단위
    `max(0, amount-received)` 로 계산해 입금액이 금액을 넘어도 음수가 안 나오고,
    `DealLedgerPanel` 의 미수금 `<td>` 도 동일 공식으로 바꼈다.
  - `bash scripts/check.sh` PASS — **PASS**(위).
  - 기존 `deal_ledger_entries`/`add_deal_ledger_entry` 재사용(재발명 금지) — **PASS**:
    035 원문 무수정, 7→9 인자 확장만(구 오버로드는 명시적으로 drop).
  - 종합: **BBE-240 은 미완료.** 백엔드(마이그레이션 103/104 + `accounting/actions.ts` +
    `DealLedgerButton`/`LedgerEntryModal` 부품)만 이번에 review-274 에 커밋됐고, 화면
    배선(① 보드 행 버튼, ①-보조 딜상세 섹션, ③ `/ledger` 신규 라우트+사이드바 탭) 은
    프런트 담당 재실행이 필요하다. hosted 적용 없음, push 안 함 — 총괄 리뷰 후 push.

---

## [모아워크 DC-00] 2026-08-19 — BBE-240 원장 VAT 배선 + 계약조건(deals.fee_terms) 백엔드

- 워크플로 실행 중 파일명·로직키가 `bbe274` 로 잘못 채번됐다(worktree 이름 `review-274` 와
  혼동된 것으로 추정 — 실제 Linear 카드는 BBE-240, `bbe274` 는 존재하지 않는 카드번호였다).
  hosted 미적용 상태에서 즉시 발견해 정정: 마이그레이션 파일 2개 rename +
  logical_key·predecessor·다이제스트 재계산 + 관련 주석·테스트 경로 전부 `bbe240` 으로
  교정. `node scripts/check-migration-guards.mjs` 체인 검증 통과(11 guarded, foundation=094).

- **마이그레이션 2건(신규, append-only)**
  - `supabase/migrations/103_bbe240_deal_ledger_vat_wiring.sql` (predecessor=102) —
    `deal_ledger_entries` 에 `vat_included`·`tax_invoice_issued` 컬럼을 얹고, 035 의
    두 CHECK(`received_amount between 0 and amount` · `paid_on` 일치식)를 `pg_constraint`
    이름 조회로 찾아 교체했다(하드코딩 제약명 금지 — 지시대로). VAT 미포함 행은 035 원래
    의미 그대로, VAT 포함 행만 `amount` 초과 입금과 "조금이라도 입금되면 paid_on 존재"로
    완화했다. `add_deal_ledger_entry` 는 7-인자 버전을 `drop function if exists` 로 지우고
    9-인자(+`p_vat_included`,`p_tax_invoice_issued`) 로 재정의했다 — Postgres 는 함수를
    전체 타입 시그니처로 식별해서 안 지우면 두 오버로드가 모호하게 공존한다. 035 자체는
    한 글자도 안 건드렸다(migration.test.ts 가 원문을 고정). `delete_deal_ledger_entry`·
    `deal_ledger_summary` 도 무접촉(지시대로 — outstanding_total 을 VAT-aware 로 안 만든
    이유는 앱이 그 컬럼을 안 쓰기 때문. 미수금은 애플리케이션 레이어에서 계산한다 — 이게
    옛 `/policyfund/settlements` 를 틀리게 만든 바로 그 실수를 반복 안 하는 지점).
  - `supabase/migrations/104_bbe240_deals_fee_terms.sql` (predecessor=103) —
    `deals.fee_terms text`, additive, 제약·기본값 없음(065 선례와 동일 패턴).
  - 두 파일 다 `node scripts/check-migration-guards.mjs --write <file>` 로 다이제스트를
    파일 완성 후에 계산해 채웠다. `node scripts/check-migration-guards.mjs`(인자 없음)로
    체인 검증 PASS(11 guarded, foundation=094). hosted 적용·고객 데이터 조회는 0건.
  - **계약금 중복 입력 방지는 서버측에서 강제된다**(수용기준 — UI 비활성화는 힌트일 뿐):
    `add_deal_ledger_entry` 안에서 `p_kind='contract_deposit'` 이고 같은 딜에 기존
    `contract_deposit` 행이 있으면 `raise exception 'contract deposit already recorded
    for this deal'`. 새 실행형 테스트 `app/src/lib/accounting/deal-ledger-vat.pglite.test.ts`
    가 035+103 을 PGlite 로 실제 실행해 이 거부·VAT 상한 완화·`fee` 분할입금 허용을 검증한다
    (문자열만 고정하는 `migration-103.test.ts` 와 역할이 다르다).

- **계약조건 배선(6곳, 목업·설계 그대로)** — `Deal.fee_terms`(types/index.ts) →
  `NewDeal.fee_terms`(repo/index.ts, `DealPatch` 자동 상속) → `toDeal()`(supabaseCrmSource) →
  `createDeal()`(localRepo, `updateDeal()` 은 이미 제네릭 patch 라 무수정) →
  `DealInfoTab` 에 "계약조건" 필드(상태 메모 다음) → `updateDealAction` 에
  `fee_terms: str(formData,"fee_terms")||null` 한 줄.

- **`app/src/lib/accounting/` 배선** — `ledger.ts`: `DealLedgerEntry` 에
  `vatIncluded`/`taxInvoiceIssued`, `summarizeDealLedger` 의 오버페이 가드를
  `!vatIncluded && received>amount` 로, `outstandingTotal` 을 순합계(`ledgerTotal-receivedTotal`)
  에서 entry 단위 `max(0, amount-received)` 누적으로 바꿨다(VAT 초과입금 entry 가 다른
  entry 의 진짜 미수금을 가리지 않게). `server.ts`: select 문·`LedgerRow`·`ledgerEntry()` 에
  두 불리언 추가(둘 다 `typeof !== "boolean"` 이면 `DealLedgerReadError`). 새 파일
  `actions.ts`("use server") — `loadDealLedgerAction`(원장+`deals.fee_terms` 를 한 번에 읽음,
  RLS 로만 접근 제한) · `addDealLedgerEntryAction`(035/103 RPC 호출, `attribution_month` 는
  항상 `occurredOn` 에서 서버가 파생 — 클라이언트 값 불신).
  `DealLedgerPanel.tsx`: 미수금 `<td>` 를 `max(0, amount-received)` 로, VAT 뱃지 추가.

- **새 클라이언트 컴포넌트 2개** — `components/board/DealLedgerButton.tsx`(📒 원장 버튼 +
  패널 오버레이, `loadDealLedgerAction` 으로 열 때마다 새로고침) ·
  `components/board/LedgerEntryModal.tsx`(`docs/design/정산-원장-화면-제안_v1.html` 의
  `#overlay` 문구 그대로 — 구분 토글·부가세 포함 체크 시 "입금액에 채우기"·메모는
  이번 범위 밖이라 안 만듦). **어느 보드 행에도 아직 안 붙었다** — 이 카드는 백엔드+부품
  까지고, 화면(page.tsx/보드 컬럼)은 C 진영(DC·NC) 몫이라 여기서 안 건드렸다.
  `status-semantics.contract.test.tsx` 의 "붙는 순간 빨개진다" 가드를 갱신했다 —
  `DealLedgerPanel` 은 이제 소비처(DealLedgerButton)가 있어 it.each 로 옮겼고,
  `DealLedgerButton` 자신이 그 자리를 이어받아 무소비처 상태를 계속 드러낸다.

- 기존 스냅샷 테스트 다수(`Deal` 리터럴에 `fee_terms` 없어서 타입에러 난 곳들 — dash·
  perf·crm·companies·services·seed.ts 등 20여 파일)에 `fee_terms: null` 을 채워 넣었다.
  새 pin 테스트 `app/src/lib/accounting/migration-103.test.ts`(migration.test.ts 스타일 —
  103 원문에서 컬럼·제약·DROP+CREATE OR REPLACE 문자열을 고정).

- `rm -rf app/.next && bash scripts/check.sh` PASS — app 348 files/2520 tests pass(2 skip
  파일 무관), worker 28 files/97 tests 전체 PASS, qa-app 차이 보고는 기존 카테고리 전용
  (이 변경과 무관, 1단계에서 check 를 실패시키지 않음). hosted 적용·고객 데이터 조회·
  비밀값 조회 0건.

- **프런트 트랙에 필요한 계약**
  - 마이그레이션: `103_bbe240_deal_ledger_vat_wiring.sql`(predecessor 102) →
    `104_bbe240_deals_fee_terms.sql`(predecessor 103).
  - RPC: `add_deal_ledger_entry(p_deal_id uuid, p_kind text, p_amount numeric,
    p_received_amount numeric, p_occurred_on date, p_paid_on date, p_attribution_month date,
    p_vat_included boolean default false, p_tax_invoice_issued boolean default false)
    returns uuid`(구 7-인자 버전은 삭제됨).
  - 서버 액션: `loadDealLedgerAction(dealId: string): Promise<LedgerPopupState>`,
    `addDealLedgerEntryAction(input: AddLedgerEntryInput): Promise<AddLedgerEntryResult>`
    (둘 다 `app/src/lib/accounting/actions.ts`).
  - `deals` 컬럼: `fee_terms text null`. `Deal.fee_terms: string | null`.
  - 아직 안 한 일: `DealLedgerButton` 을 실제 보드 행(계약업체 실무 등)에 꽂는 것,
    ⑦ 화면 확인 증거 남기기 — 다음 프런트 카드 몫.

---

## [모아워크 DC-00] 2026-08-19 — 구 `/policyfund/settlements` 제거(총괄 직접 지시)

- 총괄 지시: "지금있는 구 화면을 보고 내가 화내고 있었네 이건 빨리 지워버려" — 정산 원장
  화면 기획 중 이 화면을 실제로 재현한 목업을 보고 즉시 제거 결정.
- 제거 근거(이번 기획 과정에서 확정): `getRepo()`가 메모리 `LocalRepo` 로 가서 저장이
  전혀 안 됨(새로고침하면 사라짐) · 어떤 회사·딜과도 연결 안 됨 · 진행상품/진행기관
  select 는 `toCreatePayload()` 페이로드에 필드 자체가 없어 골라도 버려지는 순수
  UI 장식이었음.
- 삭제: `app/policyfund/settlements/page.tsx`, `components/policyfund/SettlementForm.tsx`,
  `lib/policyfund/settlements.ts`(+test), `lib/policyfund/settlement-form.ts`(+test),
  `api/settlements/route.ts`, `api/settlements/[settlementId]/route.ts`.
- **건드리지 않은 것**(이름이 비슷해서 헷갈리기 쉬움): `lib/policyfund/settlement.ts`
  (단수, `computeSettlement`)는 대시보드 `lib/dash/aggregate.ts` 가 실제로 쓰는
  별개의 살아있는 모듈 — 그대로 둠. `app/policyfund/page.tsx`(정책자금 보드 화면)도
  별개 화면이라 그대로 둠. `@/lib/repo` 의 `Settlement`/`NewSettlement` 리포 포트
  (인터페이스·`LocalRepo` 구현)도 안 건드림 — 죽은 화면이 쓰던 응용 계층만 지웠고,
  그 아래 리포 인터페이스 자체를 걷어내는 건 범위 밖(더 큰 판단이 필요함).
- 흔적 정리: `app-tabs.ts`(work 탭 altHrefs 에서 `/policyfund/settlements` 제거,
  `/policyfund` 는 유지 — 별도 존치 결정 있음), `workspace-namespace.ts`
  (`/w/{slug}/settlements` → `/policyfund/settlements` 별칭 제거, 예약어 세트는 안 건드림 —
  bare-path alias 차단이라는 별개 역할이 있어서), `policyfund/index.ts`(죽은 파일을
  가리키던 배럴 주석 제거). 관련 테스트 3개(`app-tabs-runtime.test.ts`,
  `workspace-namespace.test.ts`, `w/[slug]/route.test.ts`) 갱신.
- `production-repo-boundary-baseline.json` 에서 settlements.ts 항목 제거 +
  `check-production-repo-boundaries.mjs` 의 `BASELINE_CEILING` 31→30(합법적 감소를
  ratchet 스크립트가 명시적 확인을 요구함).
- `bash scripts/check.sh` PASS(app 2502 passed/36 skipped, worker 97/97, qa-app 보고 전용
  기존 35건 그대로).

## [모아워크 DC-00] 2026-08-19 — 정산 원장 화면 제안(비주얼 목업, 코드 변경 0)

- 총괄이 이전 텍스트 질문 3개("입력 화면 위치가 어디인지 모르겠다, 비주얼로 제안해봐")에
  대한 응답으로 `docs/design/정산-원장-화면-제안_v1.html` 작성 — 실제 `--mw-*` 토큰·
  `DealLedgerPanel`/`LedgerExportButton` 기존 구현을 그대로 반영한 클릭 가능한 목업.
- ① 딜 상세페이지(`/deals/[dealId]`)의 「정보→담당자」 다음에 「회계 원장」 섹션이 낄
  자리를 재현(기존 페이지의 `Section` 패턴·zinc 셸 그대로) ② 「+ 입력」 클릭 시 실제로
  열리는 팝업 폼(계약금/수수료 토글, 수수료 선택 시 실행액×수수료율 자동 힌트) ③ 지금
  앱에 없는 신규 화면인 연도별 전체 원장(24/25/26, 월별 그룹, 몬데이 실측 구조 그대로) —
  연도 탭도 실제로 전환됨.
- 구 `/policyfund/settlements` 제거 시점은 화면이 아니라 순수 타이밍 결정이라 텍스트로
  별도 질의(A 즉시 제거 vs B 신규 화면 배포 후 제거).
- Artifact로 게시 후 총괄 반응 대기 — 코드·마이그레이션 변경 0.

## [모아워크 DC-00] 2026-08-19 — BBE-239: 공지사항 작성자 삭제 예외 + 첨부파일 Supabase Storage 이관

- **Part A — 작성자 삭제 예외(공지사항 한정)**: `work.item_delete` 는 role 기반뿐(owner/admin)
  이라 작성자 본인도 자기 글을 못 지웠다. `deleteItemAction`(`boards/actions.ts`)에
  `canDeleteAsNoticeAuthor()` 를 추가 — role 권한이 없어도 보드 source 가
  `core.default-tab/notice` 이고 그 아이템의 `author` 값이 `ctx.user.id` 와 같으면 허용한다.
  서버가 실제 관문이고, `GroupTable`/`BoardWorkspace`/`boards/[id]/page.tsx` 에는 UI 표시
  일치용으로 `authorColumnKey`/`viewerUserId` 를 얹어 작성자에게도 삭제 버튼이 보이게 했다
  (버튼만 보이고 서버가 막으면 허위 UI가 되므로 반드시 같이 갔다). 다른 보드에는
  적용 안 됨(보드 source 로 좁힘). `actions.notice-delete.test.ts` 4건
  (작성자 허용·타인 거부·owner/admin 은 그대로 허용·비공지 보드엔 예외 미적용).
  `perm/boards-ui-gating.test.ts` 의 문자열 검사도 `canDeleteRow`/`canDeleteItems ||` 로 갱신
  (role 권한이 작성자 예외로 대체되지 않는지 계속 지킨다).
- **Part B — 첨부파일을 base64 jsonb 에서 Supabase Storage 로**: `encodeNoticeFile()` 이
  base64 대신 Storage 버킷(`board-item-files`)에 업로드하고 `{id,name,mimeType,size,
  storagePath}` 를 반환한다(`client` 없는 로컬 시드는 기존 base64 로 폴백 — 의도적 타협).
  경로 규약 `{orgId}/{boardId}/{itemId}/{fileId}__{filename}`. **하위호환**: `parseNoticeFile`
  이 레거시 `contentB64` 행과 신규 `storagePath` 행을 둘 다 읽고, `loadNoticeFileBytes()` 가
  분기해서 바이트를 낸다 — 기존에 이미 올라간 공문도 계속 열린다(백필 안 함, 의도적으로
  범위 밖). 다운로드 라우트(`/api/boards/items/[itemId]/files/[fileId]`)는 기존 서명 토큰
  관문(`fileSignedUrl.ts`, 5분 TTL)을 그대로 두고 바이트 소스만 갈아 끼웠다.
  마이그레이션 `102_bbe239_board_item_files_storage.sql` — 버킷 생성 + `storage.objects`
  RLS 3종(select/insert/delete, `storage.foldername(name)[1]` 을 orgId 로 보고
  `is_org_member` 로 격리). PGlite 로 **실제 RLS 강제**(role authenticated 전환)까지 검증
  (`board-item-files-storage.pglite.test.ts` 4건 — 버킷 생성·같은 org 전체 허용·다른 org
  insert 거부·다른 org 파일 select/delete 도 조용히 0행). `official-file.test.ts` 9건
  (업로드 경로 규약·업로드 실패 전파·레거시/신규 파싱·바이트 로드 양쪽).
- 기존 base64 첨부 일괄 이관(백필)은 이 카드 범위 밖 — 신규 업로드부터 우선 전환.
- `bash scripts/check.sh` PASS(app 348 파일/2532 테스트, worker 28/97, lint 0 error).

---

## [모아워크 DC-00] 2026-08-19 — BBE-238 되돌림: 공지사항 is_system=false + 몬데이 실측으로 확장 설계

- 총괄 확인: `is_system=true` 를 넣은 의도적 사유가 **전혀 없었다**("전혀 없지 여기에 대해서는
  내가 특별히 관여 안했어") — 회귀 확정, 되돌림 착수 승인("풀는게 맞지").
- 마이그레이션 `101_bbe238_notice_board_unlock.sql`(066 은 수정하지 않음): 기존 조직 백필
  (`is_system=true` → `false`, `source='core.default-tab/notice'` 대상) + `bbe151_ensure_notice_tab`
  재정의(신규 조직도 애초에 `is_system=false`). PGlite 3/3 통과
  (① 기존 회귀 보드 백필 확인 ② 신규 조직은 처음부터 안 잠김 ③ 재적용 멱등성).
  `bash scripts/check.sh` PASS(lint 0 error/기존 warning 3 · typecheck · app/worker 전체 · qa-app 보고 전용).
- **총괄이 함께 준 확장 요구사항** — 코드 조사로 뒷받침:
  1. 작성/조회는 전 구성원, 삭제는 작성자+상급자만 — 현재 `work.item_delete`
     퍼미션 매트릭스(`perm/matrix.ts`)는 역할 기반뿐(owner/admin only)이라 **작성자 예외가
     없다** — 공지사항 전용으로 새로 추가해야 함(신설 카드 소관).
  2. 「열기」 팝업 편집 — **이미 있음.** `ItemDetailPanel.tsx` 가 모든 보드(GroupTable 공유)에
     `aria-label="... 상세 열기"` 버튼으로 이미 배선돼 있다. `is_system` 만 풀리면 공지사항도
     그대로 작동 — 추가 구현 불요.
  3. 파일 업로드(zip/pdf/hwp/jpg/png) — 확장자는 이미 전부 허용됨(`BLOCKED_EXTENSIONS` 은
     실행파일류만 차단). **그런데 저장 방식이 문제**: 현재 `encodeNoticeFile()`
     (`lib/notices/official-file.ts`)이 파일을 **base64 로 인코딩해 Postgres jsonb
     (`item_values`)에 직접 넣는다** — Storage 연결 전 「로컬 우선」 임시 설계라고 코드
     주석(`lib/services/files.ts` 상단, T04/DQ-0014)에 이미 적혀 있었다. Supabase 무료 요금제
     실측(웹 조사): **DB 500MB**(전체 테이블 공유) vs **Storage 전용 1GB**(별도 쿼터,
     `buildStoragePath()` 헬퍼도 이미 코드에 있음, 미사용). 공문 PDF·스캔 이미지가 쌓이면
     공유 500MB 를 base64(+33% 부풀림)로 잠식하는 구조라 **Storage 로 옮기는 게 맞다**(총괄이
     "확인한뒤 결정해도 좋다"고 위임한 판단 — 클라우드 드라이브 링크 방식은 회사별 별도
     연동·인증이 필요해 자가서비스 온보딩 원칙에 맞지 않아 기각). 별도 카드로 분리, 기존
     base64 첨부와의 하위호환(다운로드 계속 되게) 포함해서 설계 필요.
- **몬데이 실측**(서울경영지원센터 워크스페이스 520253, 보드 `※ 공지사항` id 5025540159):
  `permissions:"everyone"` — 총괄이 말한 "모든 구성원 작성/조회" 와 정확히 일치. 컬럼 구성도
  066 이 이미 1:1 로 베낀 것 확인(작성자·공문PDF·내용정리·점수미달/세금미납/미선정 업체·상태).
  목업(`UI목업_워크스페이스_최종_v6.html`, `UI목업_알림소식_v0.1.html`) 에는 파일저장·삭제권한
  세부가 안 담겨 있음 확인 — 이번 요구사항은 새로 정의되는 것, 놓친 기존 설계 아님.
- 코드 변경 0(연구 단계). BBE-238 은 이 커밋으로 종료 가능(수용 기준 충족) — 확장 3항목은
  후속 카드로 분리해 진행 예정.

## [모아워크 DC-00] 2026-08-19 — 공지사항 완전 잠금 = 회귀 실증 (BBE-238 개설, 코드 변경 0)

- 총괄 요청: "공지사항도 보드를 생성추가편집이 자유롭게 해줘 [...] 먼데이처럼. 그래서 첨부터
  먼데이가 중요한 레퍼런스였던거야" — `board-flexibility-audit` 워크플로(3에이전트+종합)로 응답.
- **결론: 설계가 막은 게 아니라 구현이 설계를 배반했다.** D76/D77(2026-08-12)이 이미
  "기본 탭도 자유 편집, `boards.is_system` 을 잠금 용도로 안 쓴다"를 확정했고, 신규리드·
  컨택관리·계약업체 3탭은 그대로 구현돼 있다. 그런데 이 원칙을 공지사항에 이행하려던
  `BBE-151`(2026-08-16 배포, D77 확정 나흘 뒤)이 `066_notice_atomic_contract.sql:24` 에서
  `is_system=true` 를 심어 정책자금 파이프라인과 동일한 완전 잠금을 걸었다 — 편집 폼이
  사라지고 무관한 배너가 뜬다. 죽은 코드(`notices/types.ts:8`)에 이걸 정확히 예언한 경고
  주석이 있었다("is_system=false 로 둔다 — true 면 CRUD 불가능해진다").
- 부수 발견: 컬럼 이름/타입 변경 UI가 `origin/main` 에도 원래 없음(브랜치 낡음 아님) —
  Linear `BBE-177`(Done)과 실제 배포 범위가 어긋난다. "공지사항" 이름의 두 번째 보드가
  `source` 미기입 경로로 생길 수 있는 gap도 발견.
- `BBE-238`(Urgent) 개설 — 원인·해법 특정됨(신규 마이그레이션으로 `is_system=false` 되돌림),
  단 기존 `is_system=true` 를 넣은 의도적 이유가 있었는지 총괄 확인 대기 중이라 **코드는
  아직 안 고쳤다**. `CLAUDE.md` 의 낡은 "프리셋을 설치해야 들어온다" 문구를 D76 에 맞춰 정정
  (`ensureDefaultTabs` 가 워크스페이스 생성 시점에 이미 4탭을 심는다 — `bootstrap.ts:116`).
  `docs/coordination/총괄-니즈-기록.md` R12·R13 신설(같은 날 두 번째 "있는 문서 안 찾아본" 반복
  자기교정 포함).
- 검증: 문서·Linear·코드 조사만, DB/UI 변경 0. `git diff origin/main -- ColumnEditor.tsx` 로
  브랜치 낡음 가설 배제.

## [/round R1 · 모아워크 DC-00/claude] 2026-08-19 — 수직 한 줄: CSV 등록 → 실무 보드 투영 (BBE-196·235·236)

- 총괄 골: 「수직 한 줄 — 고객사 한 건이 CSV 등록에서 수금까지 끊김 없이 간다」(`/round` 스킬 첫 실행).
- **BBE-196 (Urgent, 방치 이틀) — 직접 수정.** `boards/service.ts` 의 `deleteColumn`·`updateColumn`
  이 `requireEditableBoard(boardId)` 만 보고 `columnId` 가 그 보드 소속인지 안 봤다 —
  편집 가능한 보드 하나면 다른 보드 컬럼을 지울 수 있었다(실증됨). `requireColumnInBoard` 신설,
  교차 보드 삭제/수정 거부 테스트 3건 + 시스템 보드 가드 회귀 테스트 1건 추가(42/42 통과).
  라벨 `DC-00` 신설·부착 — 유휴 세션 부재로 대타 수행(디스패치-루프.md §3.5).
- **BBE-235 (Urgent, 신설) — MVP 급소.** `execute_contact_pipeline_transition`(069)가
  `deals.stage_id` 만 바꾸고 계약업체 실무 보드에 `items` 를 안 넣어, 수금 컬럼 5종·
  062 자동계산·098 실현액 집계가 «전부 있는데 값이 들어올 자리가 없었다». 코드 주석
  `policyfund-contact.ts:109` 이 「구조만 심는다(WO-5)」라 스스로 적어 둔 자리 — 카드가 없어서
  어떤 관제판에도 안 보였다. **함수 본문을 고치지 않고 트리거로 처리** — `contact_to_work`
  커밋 경로가 둘이라 본문을 고치면 한쪽만 고쳐지는 형태가 된다(BBE-212·216 재발 패턴).
  두 경로가 공유하는 `contact_pipeline_transitions.status='committed'` 한 자리에 걸어
  새 경로가 생겨도 자동으로 덮이게 했다. 마이그레이션 `099`, PGlite 4/4 통과
  (변이 검사: items INSERT 를 끄면 4건 중 2건 빨개짐 — 나머지 2건은 «행이 안 생김» 을 재는
  음성 테스트라 초록이 맞음).
- **BBE-236(신설) — CSV 고객사 일괄 등록.** `/platform/demo` 전용이던 파서를 새로 안 만들고
  그대로 재사용, `/companies` 에 재마운트. 저장은 앱이 `supabaseCrmSource.createCompany` 로
  (RLS·담당범위 규칙이 거기 있음) — 마이그레이션 `100` 은 행 저장이 아니라 **멱등 원장**
  (`company_import_requests`, PK(org_id,request_id))만 맡는다. `025` 의 request_id 규약을
  일반 사용자 경로로 복제(RPC 자체는 재사용 안 함 — 그쪽은 플랫폼 관리자+canary 전용 이중 잠금).
  PGlite 3/3(재시도 거절·500행 상한·조직별 멱등 격리).
- **먼데이 실측**(`docs/design/먼데이-마이그레이션-기준.md`) — 총괄 워크스페이스 API 로 구조
  직접 확인(고객 고유값 미수집). 「수금」이 연도별(`24년`·`25년`·`26년`) × 월별 그룹의
  **원장 보드**였다 — 앱엔 이 구조가 없다. `실행액`(수수료 계산 대상 금액) 컬럼도 앱에 대응 없음.
  실제 내보내기 파일은 아직 미확보(총괄 요청 중) — 헤더·formula 표기 확정에 필요.
- **회계 전수 조사**(fork, 코드 변경 0) — 막다른 길 17건 실측. D-01(=BBE-235)이 최상위,
  그 외 원장(`deal_ledger_entries`)이 「있는 척하는 0」(쓰기 코드 0건), 정산 화면이 인메모리라
  새로고침하면 사라짐, 계약금이 다섯 군데에 따로 있어 서로 연결 안 됨 등. 회계 유저플로우
  시각화(총괄 요청 [6][7])의 재료로 확정 — 표준 경로가 아니라 이 17개 막힌 지점을 지도에 넣는다.
- **절차 맵 갱신**: 부품 12/17(71%) → **16/17(94%)**, 사용자 완주 **0/4 → 1/4**.
  ① 이 4/4 로 완성(처음으로 사용자가 «시작» 가능) · ④ 도 4/4. **② 「CSV 로 들어온 고객사가
  아직 보드에 안 뜬다」가 남아 사슬을 막는다** — 다음 라운드 유일 표적.
- **관제판 ASKS 를 동적 코드로 교체**(총괄 지시): 8/19 오전 라운드에서 손으로 적은 5건
  (출시 정의·CSV 범위·③→④ 승인·BBE-196 배정·BBE-198 결정)이 전부 답변으로 풀려 지웠다.
  대신 Linear 실측에서 매 렌더 다시 계산하는 규칙 3개(급한데 주인 없음·프로젝트 미배정·
  needs-hosted 라벨)로 교체 — 실행하자마자 손으로는 못 봤던 BBE-134·BBE-199 를 새로 잡아냈다.
- **PR #273 SQL 을 총괄이 직접 hosted 에서 실행 중** — 서울경영지원센터 org
  (`1f539b7f-c753-4b3d-987b-8f75f65a705b`) 확인: `core.default-tab/new-lead` 보드 1건에
  항목 0건. ⚠️ 화면 표시 「보드 3」과 어긋나 재확인 요청함 — 조인 없는 원 카운트 대조 중.
  **미해결.**
- 검증: PGlite 4/4+3/3, unit 9/9, service.test.ts 42/42, `rm -rf app/.next && bash scripts/check.sh`
  **PASS**(qa-app 차이 35 보고 전용, boundary ratchet 31/31 무변경) — 직접 재실행해 확인.
  커밋 `5ee2735`, push 완료.
- **hosted 미적용** — 099·100 은 파일만 작성, hosted 에 안 붙였다(`.env` 없음). 적용 전
  `087`·`098`·`062` 가 hosted 에 실제로 있는지부터 확인 필요(`BBE-175` 전례).
- 총괄이 코덱스(G 라인) 합류를 예고(2026-08-20 13:00 KST 예정, 별도 예약 안 걸어둠 —
  `docs/coordination/디스패치-루프.md` §3.5 대타 배차 규칙과 `BBE-189`(같은 날짜 예약)가
  이 전환의 정본). 핸드오프 문서는 아직 미작성 — 총괄 지시로 「준비만, 작성은 나중에」.


## [신설 · 모아워크 DC-00/claude] 2026-08-19 — 관제판 V7 + 관측자 에이전트

- 총괄 지시: 「낡은 규칙에 얽매이지 말고 대시보드를 다시 구성」 + 「지켜보는 에이전트를 만들어라」
  + 「일을 위한 일이 아니라 출시 최소조건 정의 갱신·기일 단축·총괄 니즈 학습」.
- **옛 판이 죽은 원인부터 실측**했다. `tools/board/board.template.html:180` 이 `GOAL_IDS` 15장
  (BBE-171~186)을 하드코딩해 두었고 현실은 BBE-234 까지 갔다. **화면이 «무엇이 중요한가» 를
  코드에 박아서 이틀 만에 낡았다.** V7 의 첫 규칙은 «파생하되 고정하지 않는다» 다.
- **「주인없음 41」이 가짜 경보임을 확인**했다. 주인 판정은 `board.template.html:207` 의
  `/^(DG|DC|NG|NC)-\d{2}$/` 라벨인데, 옛 판이 **두 프로젝트를 섞어 세고 있었다** —
  41 중 «경영일지» 11 + 프로젝트 미배정 6 은 **애초에 세션 주인 개념이 없는 카드**다.
  MoaWork 만 세면 열린 39 중 공백 23. **44% 가 노이즈였다.**
  ★ 총괄 지시(「41 해결해」)를 문자대로 실행해 라벨을 채웠으면 숫자는 0이 되고 판은 거짓이 됐다.
- **가장 오래 멈춘 카드 5장이 전부 «경영일지»**(13·8·8·4·4일)다. MoaWork 최고령은 1일.
  진짜 병목은 MoaWork 안이 아니라 모두가 MoaWork 를 보는 동안 멈춘 옆 프로젝트다.
- **작업 방법은 실제로 개선되고 있다** — 완료까지 중앙값 W32 18.4h · W33 41.2h · **W34 7.0h**,
  최대 330.6h → 23.0h. 그런데 8/17 생성 37 vs 완료 16 로 **유입이 더 빨라** 순증이 계속 플러스다.
  「빨라졌는데 왜 안 줄어드나」의 답이 이것이다.
- 산출:
  - `tools/board/v7.artifact.html` — Artifact 로 게시. **굽지 않고 열 때마다 Linear 를 직접 읽는다**
    (`mcp` capability · `list_issues` 1회 · 5분 갱신). 옛 판의 «낡음» 실패 모드가 구조적으로 불가능해진다.
    절: 지금 / **출시까지** / 대사 / 병목 / 주인 / 학습 / 데이터 위생 / 관측자 노트.
    각 절에 «읽는 법» 문단을 달았다 — 총괄이 지표를 «배울» 수 있게 하라는 요구(R4) 반영.
  - `.claude/agents/observer.md` — 관측자. **제품 코드 편집권 없음**(HR 이 제품을 만들지 않는 이치),
    대신 관제판·`docs/coordination/**` 소유. §자기회고가 매 라운드 «출시를 당겼는가» 를 첫 문장으로 강제한다.
  - `docs/coordination/출시-최소조건.md` — 조건 4개 · 막는 카드 7장(6장 열림). **초안, 총괄 확인 대기.**
  - `docs/coordination/총괄-니즈-기록.md` — 「시킨 것」과 「원한 것」의 차이를 R1~R7 로 기록.
- **자동 분류를 쓰지 않은 이유**: 카드 181장 중 **105장에 종류 라벨이 없다.** 기계가
  「이건 출시에 필요한 일」을 판정하면 그건 판정이 아니라 추측이다. 그래서 **조건은 사람이 손으로 적고,
  그 조건을 막는 카드의 상태만 실시간**으로 읽는 구조로 갈랐다.
- 검증: `node --check` 통과 + **실제 Linear 응답 234건으로 계산부를 돌려** 대사·주기·SVG 생성·
  출시 조건 7장의 카드 연결을 전부 확인했다(못 찾은 카드 0). 앱 코드 무접촉이라 `check.sh` 대상 아님.
- **못 한 것**: ① 관측자는 상주하지 않는다 — 호출·스케줄 기반이고 그 한계를 화면에 «언제 썼는지» 로 박았다.
  ② 판이 Linear 만 읽는다. PR·CI·커밋은 아직 안 본다(검수 반려율·CI 실패율은 다음 판).
  ③ **출시 최소조건 4개는 확인받지 못한 내 초안이다** — 틀렸으면 이 판의 제일 중요한 숫자가 통째로 틀린다.

## [실측 · 모아워크 DC-00/claude] 2026-08-18 — BBE-215 P1: 대시보드 0값, 코드로 A/B/C 분류(코드 변경 0)

- 카드: BBE-215 P1(PR #274 linear-linkback, 총괄 지적 「대시보드 정보 이상함(목업대조 요망)」).
  DC-12 검수 지적 3건 반영(`c533238`)과는 별개 — 그건 이미 완료·요약 코멘트까지 게시돼 있었다.
- 착수 전 「겹치지 마라」 경고(PR #246/BBE-186)부터 확인: **이미 main 에 머지**(`2bf7757`)돼 있고
  이 브랜치 HEAD 의 조상이라 충돌 없음을 `git merge-base --is-ancestor` 로 확인 후 착수.
- 총괄 스크린샷의 8개 숫자/라벨(보드3·아이템0·전체업무0·고객사0·원장0·수납—·파이프라인/전환율/계약상황
  빈 상태 문구)을 전부 계산 코드까지 추적. `listBoards`·`listItems`·`listDeals`·`listCompanies` 전부
  `org_id` 스코프·`canSeeAll` 처리가 정상이라 **A(집계 결함) 0건** — 「아마 버그」로 추측해 고치지 않았다.
  나머지 0/—/빈문구는 전부 그 위 파생값이라 독립 결함이 아니다.
- **B(표현 결함) 1건, 목록만**: `StatCard`(전체업무·고객사·보드아이템·원장항목)는 맨 숫자 `0`을 찍는데
  같은 절의 `PipelineWidget`·`ContractStatusWidget`은 이미 "단계가 아직 없어요"식 문구를 쓴다 — 같은
  화면 안에서 표현 방식이 갈린다. 문구 통일 여부는 판단 필요해 코드 미변경.
- **C(구성 결함): 확정 못 함** — 목업 v6 전체 head() 순서 대조를 시간상 다 못 돌렸다. `CompanyStatusSection`
  자체가 이 PR(BBE-215)에서 막 「총괄 확정」된 구성이라 우선순위 낮춰 스킵 — **미검증**으로 남긴다("없음"으로
  보고하지 않음).
- **⚠ 코드로 못 가리는 것**: 스크린샷 세션의 `ctx.org.id` 가 총괄이 보는 그 워크스페이스와 일치하는지는
  코드만으로 판별 불가 — 세션/조직 불일치도 겉보기 증상(보드는 있는데 나머지 0)이 완전히 같다. 이 worktree
  에 `.env` 가 없어 실 Supabase 로 deals/companies/items 행 수를 직접 못 셌다 — **NOT_RUN**.
- 산출물: PR #274 코멘트(`#issuecomment-5329108672`)에 위 분류·근거·다음 단계 그대로 게시. 코드 변경 0 —
  `check.sh` 재실행 불필요(직전 검증 상태 `c533238` PASS 그대로 유효).
- **다음**: B 는 총괄 판단 대기(문구 통일 여부). C 는 재개 시 목업 head() 전체 대조부터. org/세션 일치
  확인되면 A=0 판정이 최종 확정된다.

## [FIX · 모아워크 DC 04/claude] 2026-08-12 — BBE-148 후속: catalog key 를 default-tabs 기준으로 정정

- 카드: BBE-148 후속(제보: DC-03). **새 카드 아님** — 방금 완주한 카드의 결함 수정.
- 발단: `send-guard/catalog.ts` 가 발송 컬럼 6개를 `@/lib/structure-packs`(먼데이 2026-08-05
  실측 id, 예: `color_mm3acc4d`·`color8`)로 등록해 뒀는데, A′ 판정(52a5e80·이 카드보다 나중에
  들어옴) 이후 실제 워크스페이스가 쓰는 정본은 `@/lib/default-tabs`(BBE-145 · 목업 v6 을
  그대로 옮긴 것)다 — 키 체계가 전혀 다르다. `resolveSendColumn` 의 `source==="msg"` 안전망
  덕에 «모르는 칸» 취급으로 막히긴 했지만(자금 리스크는 없었다), 값별 템플릿 정밀도가
  실제 발송 칸에서 전부 fallback 으로 떨어지는 상태였다.
- **조사** — BBE-145(PR #170, DC-03, 미병합)의 실제 소스를 원격에서 직접 읽어 확인
  (`git fetch origin claude/bbe-145-new-lead-tab`). 신규리드 탭의 발송 칸은 3개 —
  `absence_notice`(부재 안내, 6값 단일 컬럼 — 구 실측은 2컬럼으로 쪼개져 있었다) ·
  `consult1_notice`(1차 상담 안내) · `confirm2_notice`(2차 확정 안내). 컬럼 정의에
  `readOnly: true` + `pendingReason: "발송 안전장치 대기 — BBE-148 (DC-04)"` 가 이미 박혀
  있다 — DC-03 이 처음부터 이 카드를 기다리며 잠가 둔 것. `pendingReason` 은 아직 어느
  컴포넌트도 안 읽는다(데이터 계약만 있고 소비자 없음 — grep 으로 확인) — 셀 자체가
  `is_readonly` 로 완전히 잠겨 있어 `planSend` 가 호출되는 경로 자체가 없다.
- **고친 것**:
  - `catalog.ts` — 구 4키(신규리드분)를 새 3키로 교체. 리드컨택 «미팅확정 메세지» 는
    default-tabs 에 아직 없어(BBE-149 대기) 등록하지 않고 `source==="msg"` 안전망에 맡긴다.
    「3차 불가」(`dup__of_ai_2___`)는 default-tabs 에 대응 컬럼이 없어 드롭 — 목업에도
    없던 먼데이 전용 칸이라 A′ 기준 이관 매핑 사전(`structure-packs`, 손 안 댐)에만 남는다.
  - `types.ts` — 잔여 "구조 팩" 표현 정정(A′ 용어 금지).
  - `catalog.test.ts` — `SEOUL_STRUCTURE_PACK` 대조 테스트를 제거하고(더는 정본이 아님)
    default-tabs 신규리드 발송 칸 3개와의 대조로 교체. `@/lib/default-tabs/new-lead` 를
    import 하지 못해(브랜치 미병합) 원격에서 직접 읽은 값을 하드코딩했다 — **#170 이
    머지되면 살아있는 import 대조로 승격해야 한다**고 테스트 주석에 남겼다.
  - `confirm.test.ts`·`history.test.ts`·`plan.test.ts`·`SendConfirmDialog.test.tsx`·
    `preview-send-guard.mjs` — 전부 `color8`/"미팅확정 메세지" 픽스처를 쓰고 있었다
    (카탈로그에서 빠지며 깨졌다) → `consult1_notice`/"1차 상담 안내" 로 교체. 지문 대조
    테스트 1건은 base 와 같은 라벨이 될 뻔해 `confirm2_notice` 로 바꿨다.
- 게이트: `bash scripts/check.sh` **PASS** — app 1663/9skip(195 files) · worker 85 ·
  `qa-app` 175건 변동 없음(구조 무접촉, send-guard 만). 화면 증거 재촬영(1440·375 — 이제
  "1차 상담 안내" 실제 default-tabs 문구로 렌더됨).
- 실발송 0건 불변 — `SEND_DISPATCH_ENABLED=false` 그대로, 이 카드는 카탈로그 키만 고쳤다.
- 인터페이스는 안 바뀐다 — `planSend`/`confirmSend`/`SendConfirmDialog` 시그니처 무변경.
  DC-03 이 셀 편집 경로를 연결할 때 참고할 것은 **키가 이제 맞다는 사실 자체**다.

— [모아워크 DC 04]

## 2026-08-12 — [총괄 지시 반영 · 눌러본 증거 · 모아워크 DC 02/claude] BBE-142 PR #166

- **① 마이그레이션 번호 충돌 해소**: `origin/main` 이 그 사이 058 을 `outbox_delivery.sql`
  (BBE-30, #143)로 선점. `origin/main` 위로 rebase(충돌 없음) 후 내 마이그레이션을
  059(머지 직전 최신+1)로 재번호. 파일 자체엔 자기참조 파일명이 없어 안전하게 rename.
  rebase로 새 outbox 코드가 들어오며 worker `pg` 타입 선언 누락 typecheck 에러가
  났으나 원인은 lockfile-node_modules 불일치(BBE-30이 `pg`/`@types/pg` 버전을 올림) —
  `npm install` 로 해소. 내 diff 와 무관.
- **② BBE-103 잔여 1건**: `nav-items.ts` work 항목 `/policyfund` → `/work` 한 줄.
  단, 이 값은 2026-08-11 MWC 가 "데이터 완성도"(31컬럼 vs 빈 데이터) 근거로 확정하며
  테스트에 "임의 교체 금지"를 박아둔 값이었다 — 이번 총괄 지시("/policyfund 는 셸 밖
  옛 미리보기, /work 는 셸 안의 새 화면. /policyfund 자체는 지우지 않는다")로 그 결정을
  명시적으로 뒤집는 것이라 판단해 그대로 반영했다. `nav-items.test.ts` 가드 문구와
  `app-tabs.ts` 의 canonicalHref(/work)·altHrefs(/policyfund 계열)도 새 결정에 맞춰
  같이 갱신 — 안 그러면 `app-tabs-nav.test.ts` 드리프트 가드가 깨진다.
- **③ 눌러본 증거**: 로컬 dev-session 쿠키(`mw_uid=usr00000-…-a1`)로 로그인 후
  1440px·375px 양쪽에서 사이드바 "업무관리" **실제 클릭** → `/work` 진입, 셸(사이드바
  11개 링크·상단바 알림/다크모드/계정) 유지 확인. 375px 가로 오버플로 0.
  - **막힘 2건, 전부 우회하고 원인 기록**: (a) Windows 에서 Turbopack 이 먼저는
    죽었다가 이번엔 살아있었다(비결정적, 이 세션 환경 이슈, 재확인만) — `--webpack`
    강제 사용 없이 정상 기동. (b) `(app)/work/actions.ts` 가 `node:crypto` 를 직접
    import 하는데, `--webpack` 강제 모드에서는 그걸 못 읽어 500 (Turbopack 에선 정상) —
    내 diff 밖 기존 코드, 참고용으로만 남긴다. (c) `.env.local` 부재 시
    `workspace-entry-server.ts:91`(`loadWorkspaceRoutingSnapshot`)가 `hasSupabaseEnv()`
    분기 없이 무조건 `createClient()` 를 호출해 dev-session 모드에서도 500 — 로컬
    검증용으로만 `supabase/server.ts` 를 임시 패치(더미 URL/키 폴백)해 우회했고, 검증
    직후 `git checkout --` 로 완전히 원복해 커밋엔 안 들어갔다(diff 재확인 완료).
    이 (c) 는 BBE-142 범위 밖의 앱 전역 이슈로 별도 카드감이다.
  - `/work` 화면 자체는 "Work-management read RPC is unavailable — 로컬 데이터로
    대체하지 않았습니다. BBE-29 데이터 계약 활성화 후 다시 시도해 주세요"라는 정직한
    미구현 상태를 보여준다(가짜 데이터 없음) — 이 카드가 만드는 화면이 아니라 이미
    있던 상태다.
- 전체 게이트: `bash scripts/check.sh` 그린(app 184/1570·worker 16/57), rebase 후
  재실행 포함 2회 그린 확인. `git push --force-with-lease`(rebase 후 필수) 로
  `claude/bbe-142-app-shell` 갱신.
- DG-01(1단 재확인)·NG-01(2단, migration 059) 검수 대기 — 여전히 셀프 머지하지 않는다.

---

## 2026-08-12 — [1단 재검수 · 2단 승격 · 모아워크 DC 02/claude] BBE-142 PR #166

- 초판(6탭 골격 + `/presets`)에 대한 1단 자체검수(무유도 서브에이전트)가 **FAIL**: `/presets`가
  D02(설치된 보드 그룹 나열)와 D03(재사용 가능한 구조 템플릿 — 이름·출처보드·컬럼수·공식배지)을
  혼동. 총 개수(32)만 우연히 목업과 일치했을 뿐 카드 형식 자체가 달랐다.
- 커밋 `7c475b7`로 수정 — 목업 원문(`docs/design/UI목업_워크스페이스_최종_v6.html:1115`)의
  카드 형식대로 재구현, 테스트 재작성(4/4 PASS), 전체 게이트 그린(app 184/1570·worker 16/57)
  확인 후 `origin/claude/bbe-142-app-shell`에 push.
- 수정본으로 1단 재검수를 다시 실행 — 이번엔 파일목록 확인 단계에서 이 카드가 새로 추가한
  `supabase/migrations/058_reserve_presets_workspace_slug.sql`을 발견하고 **2단 승격 조항
  ①**(마이그레이션 파일 추가)에 걸려 PASS/FAIL 판정 없이 중단. 부가로 리스(`layout.tsx`/
  `components/shell/**`/`(app)/page.tsx`) 밖 파일 5건(`presets/page.tsx`·`.test.tsx`·
  `workspace-entry/contracts.ts`·`.test.ts`·migration 058)도 함께 보고됨.
- 원문 전체를 PR #166 코멘트와 BBE-94에 요약 없이 그대로 게시(subagent-review.md 규정).
  BBE-142 카드에도 상태 코멘트 게시.
- **다음**: DG-01(1단 재확인) · NG-01(2단, 마이그레이션 트리거) 인계. PR #166은 셀프 머지하지
  않는다 — BBE-103(PR #116, 승격 조항 무해당)과 달리 이번엔 자율 완주(§8) 대상이 아니다.

---

## 재정정 — [모아워크 DC 04] · 2026-08-12 · BBE-148·BBE-117 서명 원상복구 + 기록 위치 정정

append-only 규칙에 따라 아래 두 오류를 정정한다(삭제하지 않고 새 항목으로 남긴다).

### ① 서명 재정정 — 이 세션은 DC 04 다. NC 04 로의 정정은 착오였다

belie 재확인(2026-08-12): NC 반은 **별도로 만든다.** 이 세션은 원래대로 **DC-04** 다.
문서 하단(파일 끝 부분)의 BBE-148 관련 두 항목 —
「서명 정정 — 위 BBE-148 기록의 작성 세션은 [모아워크 NC 04] 다」와
「1단 독립 검수 결과 반영 — [모아워크 NC 04]」— 은 **착오였다.**
그보다 앞서 있던 원본 항목들(`[END · 모아워크 DC 04/claude] BBE-148 발송 4칸 안전장치` 등)의
`DC 04` 표기가 **원래 맞았다.** 정정한다고 고쳤던 것을 다시 되돌린다.

- Linear BBE-148·BBE-117 코멘트, PR #169·#121 본문·코멘트의 서명도 전부 DC 04 로 되돌렸다
  (내용은 그대로 두고 정정 주석만 덧붙이는 방식 — 같은 append-only 정신). PR #169 의 두 코멘트는
  정정 노트 자체가 «NC 이므로 평시 NG-01·2단 DG-01» 이라는 잘못된 라우팅을 적어 두고 있었다
  (원문은 이미 DC 기준 NG-01 로 정확했는데, 정정 노트가 오히려 그걸 뒤집으려 했다) — 그 노트를
  다시 고쳤다.
- **검수 라우팅도 원복** — 작성자가 DC 이므로 §5 기준 평시 짝 **DG-01** · 2단 **NG-01**.
  중간에 NC 기준으로 뒤바꿔 요청했던 것을 전부 원래대로 되돌렸다.

### ② 기록 위치 정정 — 이 파일은 «최신 항목을 위에 추가한다»

파일 맨 위 안내문(`append-only 작업 로그. 최신 항목을 위에 추가한다.`)을 이번에 다시 확인했다.
BBE-148 관련 항목들(END 기록·정정 두 건·1단 검수 반영·서명 정정)을 전부 **파일 끝에** 붙였는데,
그건 이 로그의 «최신 = 위» 관례를 어긴 것이다 — 2026-08-12 기록이 마치 가장 오래된 기록처럼
보이게 됐다. 이 항목부터는 파일 맨 위에 붙인다. 기존 항목은 그대로 두고 위치를 옮기지 않는다 —
append-only 는 «내용 삭제 금지» 이지 «과거 실수의 흔적을 지우는 것» 까지 포함하지 않는다고
판단했다.

### 지금 상태

- PR #169(BBE-148) head `d7270f8` · CI 초록 · 2단 대기 → **NG-01**
- PR #121(BBE-117) head `8238071` · CI 초록 · 1단 PASS(8/8) · 2단 대기 → **NG-01**
- 둘 다 나는 머지하지 않는다. 라벨은 손대지 않았다(DC-04·NC-04 어느 쪽이 맞는 배정인지는
  총괄 판단 대기 — BBE-148·BBE-117 코멘트에 판단 요청 남김).

— [모아워크 DC 04]

## [END · 모아워크 노트북 CT09(260810)/claude] 2026-08-11 — BBE-103 재작업: MWC 정정 반영 완료

- 결과: **PASS**. 앞서 이 세션이 남긴 work→`/work` 변경을 MWC 프로덕션 실측 정정(C작업반장 정정 ①)에
  따라 **철회**하고 company/notice/contact 3건만 확정.
- base SHA 재고: `44b7ffd`(오늘 다수 병합분 — BBE-104 자동화 조건평가 등 포함). 순차 리베이스가
  main 의 BBE-126 아이콘 리팩터(이모지→IconName SVG)와 계속 충돌해, 리베이스 대신 origin/main 위에
  **재작성**(4개 구커밋 대체)으로 처리.
- 산출물: `app/src/components/shell/nav-items.ts`(company→/companies·notice→/notices·
  contact→/contract 추가, work 는 `/policyfund` 유지) + `nav-items.test.ts`(3 테스트, work=/policyfund
  회귀 가드로 정정 사유 인라인 주석 포함).
- 검증: 격리 워크트리 예정(다음 항목에 결과 별도 기록) · `nav-items.test.ts` 단독 3/3 PASS.
- ⚠️ **정정하지 않은 사실 1건(기록용)**: 이전 세션에서 로컬 실측한 구조적 차이 —
  `/work` 는 인증 게이트를 통과(→`/login?error=membership`, 코드상 `(app)` 라우트그룹 내부)하고
  `/policyfund` 는 게이트 밖에서 200 직행(그룹 밖 페이지)한다는 것은 **여전히 사실**이다. 다만
  프로덕션 콘텐츠 실측(31컬럼 렌더 vs 빈 데이터)이 이번 정정의 근거이므로 그 우선순위를 따른다.
  추후 `/work` 데이터 시딩이 끝나면 재검토 대상.
- 리스: `app/src/components/shell/nav-items.ts`+`nav-items.test.ts` — 반납.
- 상대에게 필요한 것: 데탑 CT08 검수 → merge → 배포. 이 세션은 검수자가 아니라 merge 를 직접
  수행하지 않음.

## [START · 모아워크 노트북 CT10(260810)/claude]
- 무엇을: 검수 전담 — 데탑 CT01~CT10(claude/*) PR 독립 검수. 작성자 ≠ 검수자.
- 잡는 파일(리스): PR 코멘트 + docs/coordination/T10-gate-checklist.md 만. 코드 수정 금지.
- 안 만지는 것: app/ worker/ supabase/ 전체, codex/* 브랜치(G 라인 소관, 절대금지 8).
- 산출물: PR별 PASS/FAIL 코멘트(목업 대조 근거 포함) + 게이트 체크리스트 갱신.
- 상대에게 필요한 것: 없음. 착수 전 6단계 완료 — origin/main=c32e01e rebase,
  qa-mockup.mjs 86/86, 결정대장·BBE-73 정독, BBE-94 착수 도장.
- 검수 순서: #113(BBE-102, 0번 관문) → #126(BBE-126) → #130(BBE-116) →
  나머지 claude/* 12건(#116·#120·#121·#123·#124·#125·#128·#129·#131·#136·#141·#142).

## [START · BBE-130(MoaWork)/claude] 2026-08-11 — 프리셋에서 실명 비우기

- task_id: Linear `BBE-130`. base `origin/main = 2bb4a880e77b3a2c83fff7629022819eb5baa0b5`(실측),
  branch `claude/bbe-130-depersonalize`, 전용 worktree `개발프로젝트\.worktrees\bbe-130-depersonalize`.
- 근거: `docs/handoff/결정대장.md` L절 D71~D75(2026-08-10 belie 교정) — "지우는 게 아니라
  비우는 것". 구조(컬럼·타입·업무 상태 아이템 28종·자동 이동 규칙·선택지 세트)는 전부 유지하고
  담당자별 아이템 4종(신규업체 2·컨텍관리 2)의 실명만 비운다.
- file lease: `app/src/lib/structure-packs/**` · `supabase/migrations/035_preset_depersonalize.sql`(신규,
  머지 시점 최신 034 확인 → 035) · `docs/worklog.md`. `031`·`002`는 무수정.

## [END · BBE-130(MoaWork)/claude] 2026-08-11 — 프리셋에서 실명 비우기

- **설계** — `SectionPreset.assigneeSlot?: number` 신설. 담당자별 그룹 4종의 `groupName`을
  실명에서 이모지 접두사만으로 바꾸고 슬롯 번호(0/1)를 달았다. 배열 길이·순서(order)는 그대로
  둬 "아이템 프리셋 종류 수 32(=14+7+11) 불변"을 지켰다 — 항목을 지운 게 아니라 항목 안의
  이름만 규칙으로 바꿨다.
- **설치 동작** — `installStructurePack()`이 조직 멤버를 가입순(`created_at`)으로 정렬해
  받고(`resolveAssignees()`, 기본값 `getRepo().listMembers(ctx.org.id)`, 테스트용 override 가능),
  슬롯 번호만큼 멤버가 있으면 `${접두사}${멤버 표시명}`으로 그룹을 만든다. 멤버가 슬롯보다
  적으면 그 슬롯은 만들지 않는다 — 새 조직(멤버 1명) → 담당자별 그룹 1개, 초대 → 슬롯만큼(최대 2)
  증가. `InstalledBoard.groupIds`가 이제 `sections.length`보다 짧을 수 있다(미채움 슬롯 스킵) —
  기존 코드에 이 배열을 소비하는 곳이 없음을 `git grep`으로 확인 후 반영.
- **담당자 컬럼(D74)**: PR #94(BBE-46 수정)에서 이미 person 타입으로 전환 완료된 상태였다 —
  이번 카드에서 추가로 손댈 게 없었다. 대신 테스트를 "특정 이름 목록에 없다"가 아니라
  "person 컬럼은 정적 `options`를 갖지 않는다"는 구조적 불변식으로 강화했다(향후 다른 이름이
  추가돼도 이 검사가 그대로 잡는다).
- **마이그레이션** — `035_preset_depersonalize.sql` 신규. `031`이 만든 `structure_packs` 행을
  `update ... where key = 'pack.seoul.policyfund1'`로만 갱신한다. 새 `create table` 없음(F9 규칙:
  기존 마이그레이션 무수정 — 031은 그대로 두고 035가 그 위에 최신 내용을 얹는다).
- **검증**(acceptance 항목별):
  · `git grep -i '이대표\|박정화' -- app/src/lib/structure-packs/ supabase/migrations/035_*.sql`
    → **0건**(코드·주석·마이그레이션 전부, 테스트 파일 포함 — 이름 목록 대신 구조 검사로 바꿔
    테스트 자체에도 실명이 안 남게 했다).
  · 아이템 프리셋 종류 수 — 착수 전/후 **32종(14+7+11) 동일**, `seoul-pack.test.ts` 기존 단언 유지.
  · 새 워크스페이스 설치 → 담당자별 아이템 1개(`install.test.ts` "1명 → 1개" 테스트로 고정).
  · 멤버 초대 → 아이템 늘어남(시드 3멤버로 슬롯 0·1 둘 다 채워짐을 확인).
  · `담당자`/`협업자` 컬럼 살아 있음, `person` 타입 유지, 값은 멤버 계정에서 옴.
  · 컬럼 수·타입·자동 이동 규칙 — **착수 전과 완전 동일**(컬럼 배열·유예 컬럼·뷰를 건드리지
    않았으므로 숫자 변화 없음: 신규고객 24·컨텍관리 21·업무관리 24, 유예 9종, 뷰 신규고객1·
    컨텍관리1·업무관리7 그대로).
- 게이트: `bash scripts/check.sh` **PASS** — app 1268 pass/9 skip(신규 8건: seoul-pack 3 + install 3
  net, region 무변화), worker 35 pass. 구조 팩 테스트 41 → **46건**.
- 비주얼: **해당 없음**(마이그레이션 + lib + 테스트만, UI 파일 0건).
- 판정: 코드 완료·게이트 PASS. 노트북 CT10 검수 대기. 자기보고로 PASS 승격하지 않는다.

## [END · 모아워크 노트북 CT08(260810)/claude] BBE-90 — 인증 QA 증거 보강 완료

- **결과 PASS**: `PlatformAccessNotice`의 `platform-forbidden`/`platform-unavailable` 두 상태가
  서로 다른 화면(제목·안내문구)으로 렌더됨을 실제 배포 컴포넌트로 시각 확인했다.
- **방법**: 이 worktree엔 Supabase 실 자격증명이 없고, `(app)/layout.tsx`가 dev-session
  로그인 성공 후에도 `loadWorkspaceRoutingSnapshot()`에서 무조건 `createClient()`를 호출해
  레이아웃째 크래시하는 것을 발견(session.ts의 dev 폴백과 별개 경로 — 범위 밖, 미수정).
  → 컴포넌트가 `error` prop 하나로만 렌더되는 순수 함수라는 점을 이용해 (app) 레이아웃을
  우회, 실제 파일을 `react-dom/server`로 정적 렌더링 → 실제 `globals.css` `:root` 토큰
  그대로 + Tailwind 표준 유틸리티(rounded-xl 등, 고정 스펙)만 적용해 재현.
  재구현·재작성 없음(실제 소스 import).
- **캡처는 세션 중 시각 확인만** — 이 샌드박스에 Playwright/Puppeteer 등 바이너리 저장 도구가
  없어 PNG 파일로 영속화하지 못했다. NOT_RUN 으로 낮추지 않고 방법·결과를 정직하게 남긴다.
- **코드 변경 0**: PR #98(merged)이 이미 구현 정본. check.sh·새 PR·CI·merge·배포는 해당 없음
  — 기존 merge(`main@0e938e3`)·Production 배포·health 증거가 유효하다.
- **반납하는 리스**: 없음(애초에 잡지 않음). worktree `wt-bbe90-silent-deny`는 그대로 둔다
  (커밋 없음, 재사용 가능).
- **Linear**: BBE-90 → Done. 근거 코멘트 남김. 별도 발견(레이아웃 크래시 버그)은 카드화하지
  않고 코멘트에만 기록.
- **이어받을 것**: 없음. belie 승인 아래 배정 문서의 3분할 empty-state 확장 요구는 산출물
  부재로 착수하지 않았다 — 필요하면 총괄이 실제 목업·QA스크립트·결정기록과 함께 재배정.

## [START · 모아워크 노트북 CT08(260810)/claude] BBE-90 — 인증 QA 증거 보강

- 배정 문서가 참조한 `docs/design/dump-mockup.mjs`·`qa-mockup.mjs`(75개)·결정대장 D32·`app/src/components/shell/empty/**` 신규 컴포넌트 요구는 **레포·전체 원격 브랜치·열린 PR 어디에도 근거 없음**을 재확인(직전 배정 때와 동일 결론). belie 확인 후 새 UI 컴포넌트는 만들지 않는다.
- BBE-90 실구현은 PR #98(merged, `main@0e938e3`)로 이미 완료 — `platform-forbidden`/`platform-unavailable` 오류 코드 분리, `PlatformAccessNotice`, 서버 로그 분류. 실제 미완결 항목은 원 구현자 코멘트(2026-08-09)의 **"인증 세션에서 두 상태를 재현하는 QA는 NOT_RUN"** 하나뿐.
- 리스: 없음(코드 변경 없음, 증거 수집만). `app/src/components/shell/empty/**`·`app/src/lib/error/**`는 착수하지 않는다.
- 산출물: `PlatformAccessNotice`의 forbidden/unavailable 두 상태 스크린샷 2종(개발 세션 재현 — 컴포넌트가 쿼리스트링만으로 렌더되어 dev 세션도 프로덕션과 동일 화면).
- 상대에게 필요한 것: 없음.

## [BLOCKED-INVESTIGATION · 모아워크 노트북 CT06(260810)/claude] 2026-08-11 — BBE-21 착수 전 6단계 실행 중 막힘

- 배정: BBE-21(멤버 초대·역할·승인·세션 관리). base `origin/main` = `7520361c2f8620f4e40345098697cffbc571d5fb`(직접 실측, 마이그레이션 최신 034 확인 — 배정 문서 기재값과 일치).
- **착수 전 6단계 ①②③ 전부 막힘** — 필요 파일이 저장소 전체(전 브랜치·히스토리)에 부재:
  `docs/design/qa-mockup.mjs`(착수 게이트 75개) · `docs/design/dump-mockup.mjs`(목업 텍스트 덤프) · `docs/handoff/결정대장.md`(D30·D31).
  Linear 문서 검색도 0건 — git 파일이 아직 미커밋인 것으로 보임. `docs/design/조직·보고체계_설계_v1.md`(BBE-119 설계 정본)도 동일하게 부재.
- 우회 없이 대체 경로만 사용: 로컬 Downloads의 `UI목업_워크스페이스_최종_v6.html`을 Read 도구로 직접 읽음(`file://` 브라우저 접근은 이 세션에서도 타임아웃 — `00_정정-브라우저없이-목업읽기.md`가 설명한 증상과 일치). **보조 증거일 뿐 정본 아님**, 코드 착수 근거로 쓰지 않음.
- **실제 코드 실측**: `member_role`/`member_scope`는 여전히 3역할(owner/admin/member)·2범위(all/assigned)뿐 — 목업의 4역할·부서스코프는 DB에 없음(BBE-119/BBE-122 몫, 둘 다 Backlog·BBE-122가 BBE-119에 blocked_by). 승인 파이프라인(`workspace_entry_requests`, `/settings/members/approvals`)과 세션 관리(`/settings/account/sessions`, 011 RPC 기반 revokeCurrent/revokeAll)는 **이미 상당 부분 구현돼 있음** — 갭은 개별기기 로그아웃·초대 재전송·last-owner 보호·자기권한상승 방지·권한변경 감사기록으로 보임(추정, 코드 미작성).
- CT02 경계 제안(합의 요청 중): BBE-21은 현재 스키마 위에서 초대/승인/세션 완성, 4역할·부서스코프 신설은 BBE-119/122 몫으로 남김.
- 산출물: Linear BBE-21·BBE-94 코멘트만(제품 코드 변경 0, 리스 미선언).
- 상태: **착수 미도장.** CT02 응답 또는 belie 지시 대기.

## [END · BBE-102(MoaWork)/claude] 2026-08-10 — 구조 팩 설치 진입점

- task_id: Linear `BBE-102`, P0. base `f0145a7`(origin/main 실측 — 지시된 `e5e8fa4`보다 2커밋 진행돼 있었다),
  branch `claude/bbe-102-pack-install-entry`, 전용 worktree `개발프로젝트\.worktrees\bbe-102-pack-install-entry`.
- 착수 전 확인: `git grep installStructurePack -- app/src/app` → 0건(진입점 없음 재확인).
  PR #94(BBE-46)는 이미 `main`에 병합돼 있었다(`c1bd2cd`) — 구조 팩·설치 로직은 실재.
- **선행 확인(①) — 031 hosted 적용 여부는 `NOT_RUN`이다.** 로컬 PC에 Supabase 자격증명이 없어
  (`app/.env.local` 부재, CLI 부재 — F9) 객체 실물 조회를 실행하지 못했다. belie 확인용
  읽기 전용 SQL: `select count(*) from structure_packs where key = 'pack.seoul.policyfund1';`
- **다만 이 확인은 이 카드의 실행 여부와 무관하다는 것을 코드로 확인했다** —
  `installStructurePack()`(`lib/structure-packs/install.ts:47`)은 `pack.jsonb`를 hosted
  `structure_packs` 테이블에서 읽지 않고 **TS 상수 `SEOUL_STRUCTURE_PACK`을 그대로 쓴다**
  (`options.pack ?? SEOUL_STRUCTURE_PACK`). 031의 hosted 적용 여부는 설치 버튼 동작에 영향이 없다.
- **더 크고 별개인 발견(코드 실측, hosted 접근 불필요) — 003 보드 엔진에 Supabase 어댑터가 없다.**
  `getBoardsRepo()`(`lib/repo/local/boardsRepo.ts:315`)는 조건 없이 `LocalBoardsRepo`(서버 프로세스
  `globalThis` 인메모리)만 반환한다. `implements BoardsRepo` 구현체는 저장소 전체에 이것 하나뿐이다
  (`grep -rn "implements BoardsRepo"` → 1건). 주석이 스스로 인정한다: "Supabase 연결 후
  SupabaseBoardsRepo 로 교체(포트 뒤 스왑)" — 그 스왑이 아직 없다. `003_boards_engine.sql`이
  Postgres 스키마(boards/board_columns/board_groups/board_items/board_views)는 만들어 두었지만
  TS 계층이 거기 쓰지 않는다. **결과: 설치 버튼으로 만든 보드는 Vercel 서버리스 인스턴스 프로세스
  메모리에만 존재**하고, 콜드스타트·재배포·다중 인스턴스 스케일링에서 사라질 수 있다. 이는 이번 카드가
  만든 문제가 아니라(이미 병합된 BBE-26/47 `#112`의 `/newcust` 진입점도 같은 `getBoardsRepo()`에
  의존해 이 가정을 전제로 만들어졌다) 선행 아키텍처 갭이며, `lib/boards/store.ts`·신규 Supabase
  어댑터가 필요해 이 카드의 좁은 리스(반나절 S급) 밖이다. **후속 카드로 분리 제안**했다(스폰 완료).
- **구현** — 리스 3파일 + 신규 2파일:
  · `app/src/app/(app)/boards/actions.ts` — `installStructurePackAction()` 추가. owner/admin만
    실행 가능(`isManager(ctx.role)` 게이트, 공지 쓰기 게이트와 같은 패턴). `installStructurePack(ctx)`
    호출 후 결과를 flash 쿠키에 담고 `revalidatePath("/boards")`.
  · `app/src/app/(app)/boards/page.tsx` — 3보드 이름이 모두 있는지로 설치 여부 판정,
    미설치 + 관리자일 때만 설치 타일 노출. flash 쿠키를 디코드해 결과 배너로 표시.
  · `app/src/app/(app)/boards/installFlash.ts`(신규) — 설치 결과(생성 보드 n·그룹 n·건너뜀 n)의
    1회성 쿠키 전달. `cellFlash.ts`와 같은 이유·같은 방식: `actions.ts`는 `"use server"`라 동기
    헬퍼를 export 할 수 없어 별도 모듈로 뺐다.
  · `app/src/app/(app)/boards/InstallPackButton.tsx`(신규) — 설치 타일. `NewBoardInline`과 같은
    격자 크기·스타일. 클라이언트 JS 불필요(서버 액션 폼, 이 화면의 기존 방식 유지).
  · 재실행 안전은 새로 만들지 않았다 — `installStructurePack()`이 이미 있는 보드는 자체적으로
    건너뛰는 계약(`InstallResult.skipped`)을 그대로 노출했을 뿐이다.
  · `lib/newcust/**`·`components/newcust/**`·`shell/nav-items.ts` 무접촉(코덱스 BBE-26 점유 확인).
- **검증**:
  · `bash scripts/check.sh` PASS — app 1230 pass/9 skip(신규 3건 포함), worker 21 pass.
  · `npm run build`(production) PASS — `/boards`·`/boards/[id]` 정상 컴파일(동적 라우트).
  · **브라우저 클릭 실측은 `NOT_RUN`이다.** 로컬 `npm run dev`는 Supabase 환경변수 부재로
    `(app)/layout.tsx`가 세션 로딩 단계에서 500(AGENTS §4 "로그인 필요 단계는 대신 진행 안 함" +
    F9 로컬 비밀값 없음과 일치 — 결함 아님). 프로덕션(`www.moa-work.com`)은 이 세션 브라우저에
    로그인 세션이 없어(Google OAuth, 사용자 동의 필요 단계라 대신 진행 안 함) 접근 불가.
    **스크린샷 미첨부** — worker-onboarding §2 "촬영 불가는 머지 중단 사유가 아니다"에 따라
    머지 자체는 막지 않되, PR에 belie/CT02 앞 재확인 요청을 명시했다.
- **NOT_RUN 경계**: ① 031 hosted 적용 여부(자격증명 없음, 판단에 불필요함은 코드로 확인) ②
  실제 클릭 → 보드 3개 생성 → `/boards/[id]` 렌더의 눈으로 본 확인(로그인 불가) ③ 콜드스타트/
  재배포 이후 데이터 잔존 여부(별도 카드 대상 — 애초에 인메모리라 원천적으로 보장 안 됨).
- 판정: 코드 완료·게이트 PASS. 눈으로 보는 확인과 hosted 031 상태는 belie/CT02 몫으로 남긴다.
  자기보고로 PASS 승격하지 않는다.

## [FIX · PLAN-002/WO-1 (BBE-46)/claude] 2026-08-09 — PR #94 반려 2건 수정 (시드 확정 3건 반영)

- 검수 반려(데탑 CT02 2026-08-09 · ✅5/❌2)에 대한 작성자 수정. 인수: 데탑 CT05(260809-2).
- **❌1 base 뒤처짐 해소** — `origin/main@0e938e3` 위로 rebase. 충돌 0.
  CT02 가 지목한 `cf1055d`(BBE-44 `/work` 보드)와 **파일 겹침 0**을 실측했다:
  BBE-44 는 `app/src/lib/work-management/**`·`app/(app)/work/**`, 본 PR 은
  `app/src/lib/structure-packs/**`·`supabase/migrations/031`. 다만 같은 업무관리 구조를
  두 곳이 각자 들고 있다(`work-management/template.ts` 31컬럼 계약 ↔ 팩 업무관리 보드).
  런타임 충돌은 없다 — 팩은 전역 카탈로그 시드, work-management 는 `/work` 실행 계약이다.
  **통합은 WO-7 로 넘긴다**(이번 PR 범위 밖, 코덱스 소유 파일 포함).
- **❌2 시드 확정 3건 반영** (2026-08-05 MW-총괄 판단 · 총괄 2026-08-09 재확인:
  시드 확정은 동일 복제 원칙에 우선한다):
  · **① Name = 업체명**. 3보드 모두 `nameColumn` 계약 신설. 중복 `회사명` 컬럼 제거
    (신규고객 `text_mm2czkqg` · 컨텍관리 `___67` · 업무관리 `text`).
    Name 은 003 엔진에서 `items.title` 이라 컬럼 행으로 만들지 않는다 — 없는 컬럼을
    있는 것처럼 만들지 않기 위해 계약으로만 남겼다(유예 컬럼과 같은 판단).
  · **② 지역 공용 1세트 222지** — `region-options.ts` 신설. R2(업무관리) 표기를 기준으로
    `시도_시군구` 정규화하고 축약형·정식형을 합쳤다(`서울_영등포`+`서울_영등포구`→`서울_영등포구`).
    먼데이 원문 오기 `충북_영통군`→`충북_영동군` 교정(근거: 먼데이-전체스키마-v1 부록 R2 주석).
    두 보드가 `optionRef: "region"` 로 이 한 세트를 참조한다.
  · **③ 담당자 = 멤버(사람) 컬럼 단일화**. 신규고객 선택지형 담당자(`color_mkyeay16`)를
    person 컬럼으로 대체, 컨텍관리 `담당자 구분`(`color_mkx7de80`) 제거. 두 컬럼에 박혀 있던
    직원 실명(이대표·박정화 실장·담당자 미정)이 **전역 카탈로그에서 사라졌다** — 테스트로 고정.
    신규고객 담당자별 저장 뷰 3종은 라벨이 아니라 멤버 id 로 걸어야 하므로 WO-3 로 넘겼다.
- **버그 동반 수정**: `optionRef` 를 설치 때 풀지 않아 지역·사업자유형 컬럼이 **선택지 0건**으로
  만들어지고 있었다(`options: column.options ?? null`). 팩이 `optionSets` 를 들고 설치가 참조를
  풀도록 고쳤고, 세트가 없으면 조용히 넘어가지 않고 던진다. 설치 테스트로 222지·6종 실림을 긍정 확인.
- **먼데이 실측 대조표**(테스트가 강제 — `seoul-pack.test.ts` "① 먼데이 실측 컬럼 수와 대조된다"):

  | 보드 | 먼데이 실측 | 팩(Name+설치+유예) | 제거(중복·우회) |
  | --- | --- | --- | --- |
  | 신규고객 | 28 | **27** = 1+24+2 | 회사명 1 |
  | 컨텍관리 | 25 | **23** = 1+21+1 | 회사명·담당자 구분 2 |
  | 업무관리 | 32 | **31** = 1+24+6 | 회사명 1 |

  업무관리 32는 그대로 대조된다(31 시드 + 중복 1 제거). 아이템 프리셋 32종은 불변.
- 마이그레이션 번호 재확인: rebase 후 `origin/main` 최신 = `030` → **031 유효**(최신+1).
  기존 마이그레이션 무수정(deletions 0)·`$json$` 재생성으로 SQL↔TS 완전일치 유지.
- 게이트: `bash scripts/check.sh` PASS. 구조 팩 테스트 26 → **41건**(지역 7 · 시드 확정 5 추가).
- **미해소(정직 기록)**: 먼데이 실측 카운트 **239지 중 5지**는 저장소 안 자료(R1 218 · R2 문서 수록 234)에
  라벨이 없어 미수록이다. 정규화 결과가 222지인 것은 축약·정식 중복 합침의 결과다.
  지어내지 않았고, 먼데이 API 재수집이 필요하다 — PLAN-003 후보. 제주·세종은 두 원본 모두에 없다.
- 비주얼: **해당 없음**(팩 데이터·설치 로직·테스트만, UI 파일 0건). 검수 ⑥′ 사전판정 유지.

## [END · BBE-8(MoaWork)/claude] 2026-08-09 — hosted 인벤토리 완주: 017 미적용 가설 기각

- 세션 `[모아워크 데탑 CT04(260809)]`. 2026-08-05 정지된 `claude/bbe-8-hosted-inventory` 인수 →
  base `f4f5a12b719ba4237f2d71726e4804cc28d3ce75` 위로 rebase(작업 중 origin/main이 `0e938e3`→`f4f5a12`로 이동, 재rebase).
- lease: `docs/evidence/BBE-8-hosted-inventory.md` 1파일 + 이 worklog append. **제품 코드·hosted DB·Linear 변경 0.**
- **핵심 재판정 — belie hosted 조회 회신 4건 반영**: `is_platform_admin()` = **`APPLIED_017`**,
  `authenticated` EXECUTE = **`true`**, `app_admin_role('beliefkimkim@gmail.com')` = **`'owner'`**,
  hosted 장부에는 **`025`·`030` 2건만** 기록.
  → 2026-08-04 판의 P0 가설 **"017 미적용 → `/platform` 전면 차단"은 기각**된다.
  005 미적용 가설도 함께 기각, 권한 부재 가설(반증 ②)은 **절반만** 기각(권한은 죽고 RPC 오류는 살아 있다).
  증상별로 남은 후보: **`(app)` → `/login?error=membership`은 `org_members` 소속 0(반증 ③)이 유일한 설명**이고,
  **`/platform` 쪽은 `is_platform = false`와 RPC 실행 오류 2개가 살아 있다.**
  소속 0은 migration 문제가 아니라 **데이터 문제**라 해법이 다르다. 확정 질의 Q3·Q6 모두 **`NOT_RUN`**.
- **장부 신뢰성 결론**: 017은 장부에 없는데 적용돼 있다 → **`schema_migrations` 부재는 미적용의 근거가 아니다.**
  적용 판정의 정본은 객체·함수 본문 실물 검사(§6 Q1/Q1-b)뿐. 장부 오독으로 **재적용하는 리스크**를 §7-4에 추가했다.
- **잔여 갭 정직 기록**: `app_admin_role()`은 `role`만 반환하고 017의 판정축은 `is_platform` 컬럼이라,
  `'owner'` 회신은 행 존재를 증명할 뿐 `is_platform = true`를 증명하지 않는다. 신규 질의 **Q6**를 추가했다.
- **직접 실측(전달값 아님)**: migration 전수 = **29개**(`git ls-tree`) — 2026-08-04 판의 "30개"는 오기이며
  당시 표의 행 수도 29였다(append-only 원칙상 옛 기록은 수정하지 않고 산출물 §1에 정정 주석). `0816d2a→f4f5a12`
  구간 `supabase/migrations/` 변경 **0건**. Production 배포 = `5817138319` / **`f4f5a12`** / `success` /
  `2026-08-09T08:54:32Z` → **배포 SHA = origin/main HEAD**.
- **코드 좌표 재실측(#98 반영)**: 실패 리다이렉트가 `/?error=platform` 단일에서
  **`/?error=platform-forbidden`(권한 거부) / `/?error=platform-unavailable`(서비스 장애)** 로 분기됐다
  (`app/src/lib/platform/guard.ts:18-19`). 문서가 요구하던 "오류 vs 거부" 구분이 코드 레벨에서 해결돼
  재관측 시 URL만으로 판별 가능하다. `session.ts:138-141`의 `/login?error=membership` 경로는 유효.
- 별도 카드 4건 제안(실행 안 함): 소속 복구 · Q6가 `false`면 `app_admins.is_platform` 복구(**데이터 조치**) ·
  무인증 `GET /api/version` · 장부 정합 정책.
- **독립 검수(작성자≠검수자) 지적 10건 전량 반영** — 판정 `PASS_WITH_NOTES` → 수정 후 재검수:
  ① "소속 0이 유일한 P0 후보"를 **증상별로 분리**했다. `(app)` 증상의 유일한 설명은 맞으나 `/platform` 쪽에는
  `is_platform = false`와 RPC 실행 오류 **2개가 살아 있다**. ② 반증 ②를 "해소"로 적었으나 실제로는 **절반만** 기각됐다
  (권한 부재는 죽고 RPC 오류는 살아 있다). **URL로 구분 가능해진 것은 진단 능력이지 원인 배제가 아니다.**
  ③ §7-4 완화책이 `supabase migration list --linked` 원장 조회를 권하고 있어 문서 자신의 장부 결론과 모순 → 교체.
  ④ 전달값을 "실측"이라 부른 4곳을 "회신"으로 정정. ⑤ 이 커밋이 worklog 앞에 행을 추가해 자기 인용 줄번호를
  깨뜨린 것을 발견 → `worklog.md@0816d2a:NNN` 형태로 SHA 고정. ⑥ 장부 결론에 대응하는 질의가 없어 **Q1-c 신설**.
  ⑦ `guard.ts:30`→`29`. ⑧ "017을 적용해도 막힌다"의 미적용 전제 잔존 문구 정정. ⑨ 폴백 주석을 "거짓 전제"라 한 것은
  과했다 — `server.ts:202`가 이미 "017 적용 후 no-op"을 예고했다. **틀린 주석이 아니라 조건이 충족된 주석**이며
  카드 제안을 철회했다. ⑩ Q1의 문자열 기반 탐지 한계를 명시.
- **2차 검수에서 내가 새로 넣은 주장이 거짓으로 판명돼 철회했다(재검수 판정 `FAIL` → 정정 후 재제출).**
  ⑨의 대체 근거로 "폴백이 `is_platform=false`를 가려 `/platform`은 막히고 `/workspace-entry`는 열리는
  **비대칭**이 생긴다"고 적었으나 **거짓**이다. 코드 실측 사슬: 폴백이 `isPlatformAdmin=true`로 승격
  (`server.ts:204-213`) → 승격했으므로 `list_pending_workspace_create_requests()` 호출(`server.ts:218-220`) →
  그 함수가 `not is_platform_admin()`에 `42501` 예외(`006_public_workspace_entry.sql:971-973`) →
  `{kind:"error"}` → blocked 화면(`app/src/app/workspace-entry/page.tsx:15`).
  **둘 다 막힌다. 비대칭은 없다.** 폴백이 없었다면 그 RPC를 아예 호출하지 않아 `/workspace-entry`는 정상이었을 것이므로,
  **폴백은 이 경우 상황을 악화시킨다.** 잘못된 진단 지침("비대칭을 017 미적용 징후로 오독 말 것")을
  올바른 것("둘 다 막힌 것을 보고 `is_platform` 축을 배제하지 말 것 — `is_platform=false`가 정확히 그렇게 나타난다")으로 교체했다.
  **증거 없이 반대 방향 결론을 적었다면 다음 진단자를 정확히 틀린 쪽으로 보냈을 사안이다.**
- 2차 검수 추가 정정: "유일한 P0 후보" 무범위 서술 잔존 4곳을 증상 범위로 한정 · `worklog.md:560-562` 인용을
  `@0816d2a`로 고정 · §5 Q2의 "021이 컬럼 추가"는 오기(**제약** 추가) ·
  §8-1 제목의 `RUN` 라벨을 `RELAYED`/`MEASURED`로 정렬.
- 3차 검수 `PASS_WITH_NOTES` 4건 반영: ① **밀린 행 수를 숫자로 적는 것 자체를 금지**했다 — 2·3차에서 연속으로
  틀렸고(68→81→95) 커밋마다 낡는 값이다. SHA 고정만 남긴다. ② "폴백이 없었다면 `/workspace-entry`가 정상 렌더"는
  `selfRouteState === "eligible_entry"` 전제가 필요하다(`route-decision.ts:44`) — **방향(개선 아님)은 무조건,
  결과(정상 렌더)는 전제 아래에서만** 성립으로 분리. ③ 잔존 `RUN` 라벨 2곳(갱신이력·§2 제목)을 `RELAYED`로.
  ④ "폴백 no-op이므로 조치 불필요"는 `is_platform=true` 전제인데 그 전제가 Q6 `NOT_RUN`이다 →
  **Q6가 `false`면 폴백 카드가 되살아난다**는 조건부 5번째 카드를 §7-5에 명시.
- 증거 등급을 **`RELAYED`(belie 회신·이 세션 재현 불가) / `MEASURED`(이 세션 직접 실행)** 로 분리 표기했다.
  `RELAYED`는 `NOT_RUN`이 아니라는 뜻일 뿐 `PASS`가 아니다.
- 게이트: `bash scripts/check.sh` PASS · PR CI PASS · 독립 검수 · squash merge. UI 변경 0이라 비주얼 확인 해당 없음.
- Linear `BBE-8` 도장은 **미수행** — Linear MCP 미인증 + 비대화형 세션이라 OAuth 불가. 초안을 END 보고에 첨부했다.
- 판정: **INVESTIGATION_COMPLETE / P0_HYPOTHESIS_REFUTED / MEMBERSHIP_Q3_NOT_RUN.**

## [END · PLAN-002/WO-1 (BBE-46)/claude] 2026-08-05 — 서울경영 3보드 구조 시드

- 산출물 3층:
  1. `supabase/migrations/031_newcust_structure_pack.sql` — 전역 카탈로그 `structure_packs`
     신설(additive, RLS select-only) + 팩 1행 시드. 기존 마이그레이션 무수정.
  2. `app/src/lib/structure-packs/*` — 팩 데이터(보드 3종) + 설치 로직 + 타입.
  3. 테스트 26건 — 팩 계약 16 · 설치 acceptance 10.
- **아이템 프리셋 32종**(= 탭 안의 그룹, PLAN-002 §1 용어) 분해 등록:
  신규업체 14 + 컨텍관리 7 + 업무관리 11. 코드 명칭은 `sectionPreset` 으로 먼데이 item(행)과 구분했다.
  WO-6 라이브러리가 `allSectionPresets()` 로 그대로 초기 데이터로 쓸 수 있다.
- 실측: monday MCP 로 **구조만** 조회했다(2026-08-05). 컬럼·그룹·라벨 hex 색·저장 뷰 이름만 읽었고
  고객 행 데이터(8,413건)는 조회하지 않았다. 팩 `source` 필드에 출처·시점을 박아뒀다.
- 설치 컬럼: 신규고객 25 · 컨텍관리 23 · 업무관리 25. 그룹 색·컬럼 순서·선택지 순서는 먼데이 원본
  `position`/`labels_positions_v2` 를 그대로 옮겼고 임의 재배열하지 않았다.
- **유예 9종**(구조만 기록, 설치 안 함 — PLAN-003): 하위아이템 3 · 타임라인 1 · 수식 4 · 생성로그 1.
  001 `field_type` enum(13종)에 대응 타입이 없다. `text` 같은 것으로 바꿔 만들면 없는 컬럼이
  있는 것처럼 보이므로 만들지 않고 목록으로 돌려준다. 수식은 원문을 `source` 에 남겼다.
- 저장 뷰: 업무관리 테이블 뷰 7종 생성. 먼데이 실측 9종 중 `캘린더`·`Vibe 뷰 만들기` 는
  003 view kind(table/kanban)에 대응이 없어 제외. **다중값 필터 조건은 WO-3 소유**라
  WO-1 은 뷰 이름·구조만 심었다.
- 드리프트 방지: 팩이 SQL·TS 두 곳에 있으므로 `seoul-pack.test.ts` 가 마이그레이션의
  `$json$` 블록을 파싱해 TS 팩과 **완전 일치**를 강제한다. 한쪽만 고치면 게이트가 깨진다.
- 재설치 안전: 같은 이름 보드가 있으면 건너뛴다. 두 번 눌러도 두 벌 생기지 않고,
  부분 설치 상태에서는 나머지만 채운다(테스트 2건으로 고정).
- 게이트: 실제 `bash scripts/check.sh` PASS(app 1106 pass/9 skip, worker 21 pass),
  production build PASS. `ls supabase/migrations | sort` 에서 031 이 030 뒤 — 적용 순서 정상.
- **계약서 표기와 실측 차이(기록만, 실측을 따랐다)**:
  · 업무관리 컬럼 계약 30 → 실측 32(Name·하위태스크 제외 시 30 — 표기 기준 차이로 보인다).
  · 업무관리 수식 계약 3종 → 실측 4종(`총 매출액` 추가). 4종 모두 유예 목록에 넣었다.
  · 진행 상품 계약 66지 → 실측 항목 59개(먼데이 최대 id 가 66, 실제 항목은 59).
  · 진행 기관 계약 19지 → 명명된 라벨 18 + 빈 슬롯 1.
  · 컨텍관리 그룹명 계약 `계약보류(온·오프)` → 실측 `계약보류(온/오프)`.
- **NOT_RUN**: hosted DB 적용·데이터 변경(계약 범위 밖, 파일 작성까지만) · 먼데이 실데이터 비교 ·
  지역 선택지는 002 `field_presets.region`(218) 참조로 두었고 먼데이 실측 239 와의 차이는 미해소.
- 비주얼: **해당 없음**(migration + lib + 테스트만, UI 변경 0). `docs/plans/README.md` 비주얼
  컨펌 게이트 규정의 "UI 변화가 없는 WO" 조항에 해당한다 — belie 확인 요청.
- 판정: 코드 완료 · 운영 판정은 MW-QA 몫. 자기보고로 PASS 승격하지 않는다.

## [START · PLAN-002/WO-1 (BBE-46)/claude] 2026-08-05 — 서울경영 3보드 구조 시드

- task_id: Linear `BBE-46` (PLAN-002/WO-1, P0). base `0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9`(실측),
  branch `claude/plan002-wo1-structure-seed`,
  전용 worktree `개발프로젝트\.worktrees\claude-plan002-wo1-structure-seed`.
- owner: 이 세션(claude) · reviewer: MW-QA · blocked_by: 없음(WO-2와 병렬).
- 착수 전 실측: 중복 세션 흔적 확인 → `.worktrees\claude-plan002-wo1-structure-seed` **부재**,
  `claude/plan002-*` 브랜치 **부재** → 중복 착수 아님. 마이그레이션 최신은 origin/main 기준 `030`
  (메인 체크아웃 워킹트리는 025 까지만 보였다 — HEAD 가 `e937330` 로 뒤처져 있었다) → 신규 번호 `031`.
- file lease: `supabase/migrations/031_newcust_structure_pack.sql`(신규) ·
  `app/src/lib/structure-packs/**`(신규 디렉터리 전체) · `docs/worklog.md`.
- 신규 네임스페이스를 쓴 이유: PLAN-002 §4 lease 매트릭스에서 `lib/boards/presets*` 는 WO-6,
  `components/newcust/*` 는 WO-2 소유다. 병렬 워커와 파일이 겹치지 않도록 `lib/structure-packs/` 를 새로 팠다.
- 안 만지는 것: 기존 마이그레이션 전부 · `lib/boards/**`(엔진) · `lib/newcust/**` ·
  `components/**` · 계약 파일(`lib/types/**`, `lib/repo/index.ts`) · 타 WO lease 전 경로.
- NOT_RUN 경계: hosted DB 적용·데이터 변경(계약 명시 범위 밖).

## [END · BBE-8/claude] 2026-08-04 — hosted migration·환경 적용 인벤토리 (조사 전용)

- 산출물: `docs/evidence/BBE-8-hosted-inventory.md` 신규 1파일. 제품 코드·hosted DB·Linear 변경 **0**.
- migration 전수 **30개** 목록화(번호·목적·도입 커밋). 번호 중복 `014`·`016` 각 2개, `0001`/`001` 혼재,
  `025→030` 점프를 기록했다. `submit_workspace_create_request`는 `006→009→018→030` **4중 재정의**로 순서 민감도가 가장 높다.
- **hosted 적용 이력 실측 = `NOT_RUN`**: supabase CLI·psql·vercel CLI 부재, `supabase/config.toml` 없음,
  실값 `.env` 없음(레포에 `.env.example` 2개만). 자격증명이 없어 조회 자체를 실행하지 못했다.
  belie 터미널용 읽기 전용 SQL(Q1~Q4 + 일괄 적용여부 Q1-b)을 산출물 §6에 첨부했다.
- **Production 배포 SHA 실측 = RUN**: `gh` deployments API로 Production `5725403660` =
  `0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9`, state `success`, `2026-08-03T11:31:27Z`.
  **배포 SHA = `origin/main` HEAD.** 코드는 최신이다. `www.moa-work.com` alias 바인딩은 vercel CLI 부재로 `NOT_RUN`.
- **017 ↔ 관측 증상 인과 사슬을 코드로 검증**: `/platform`은 `loadPlatformActor`가 `is_platform_admin()`을
  **단독 의존**하며 폴백이 없다(`lib/platform/actor.ts:41`). `006` 정의는 `role='admin'`을 요구하고
  `005` 시드는 `role='owner'`라 항상 false → `guard.ts:25` `/?error=platform` → `(app)/page.tsx` `getSession()` →
  소속 0 → `session.ts:140` **`/login?error=membership`**. MWC 관측과 정확히 일치한다.
- **단, 017 단독 근인으로 단정하지 않았다**(반증 3건 기록): ① `/workspace-entry`에는 `app_admin_role` 폴백이 있어
  017 미적용이어도 열린다(`lib/workspace-entry/server.ts:196-213`) — 둘 다 막히면 다른 원인이다.
  ② RPC **오류·권한 부재**도 `unavailable`로 같은 화면을 만든다. ③ 소속 0은 독립 결함일 수 있어
  017 적용은 `/platform` 복구의 **필요조건이지 `(app)` 진입의 충분조건이 아니다**.
- 권고: Q1이 `NOT_APPLIED_006`이면 **017 단독 선적용**(함수 1개 `create or replace`, 멱등, 테이블·RLS 무변경) 후 재관측.
  나머지는 `015 → 017 → 018 → 020 → 021 → 022 → 023 → 024 → 025 → 030` 순, 별도 계약으로 분리.
  리스크: 순서 역전 시 회귀 부활, 021 제약 실패, 030 컬럼 추가 락, 롤백 스크립트 부재 → 백업 선행.
- 판정: **INVESTIGATION_COMPLETE / HOSTED_STATE_NOT_RUN**. hosted 적용 여부는 belie 조회 회신 전까지 미확정이다.

## [START · BBE-8/claude] 2026-08-04 — hosted migration·환경 적용 인벤토리 (조사 전용)

- task_id: Linear `BBE-8`. 성격: **조회 전용** — 스키마 변경·migration 적용·`db push`·데이터 수정 전면 금지.
- base `0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9`(`git fetch --prune` 후 실측),
  branch `claude/bbe-8-hosted-inventory`,
  전용 worktree `C:\Users\Belief-desktop\Desktop\개발프로젝트\.worktrees\bbe-8-hosted-inventory`.
- file lease: `docs/evidence/BBE-8-hosted-inventory.md` 신규 1파일 + 이 worklog START/END append(계약 명시).
- owner: code session(claude) · reviewer: MWC · blocked_by: 없음.
- 조사 항목: ① migration 전수 목록 ② hosted 적용 이력 실측 ③ 적용/미적용 대조표와 실증상 매핑
  ④ Production 배포 SHA ⑤ 적용 권고(실행은 별도 계약).
- 안전 경계: 비밀값·연결 문자열·토큰 출력·기록 금지("있다/없다"만) · hosted 조회는 집계/존재 확인 수준 ·
  `app_admins` 직접 select 금지(함수 경유) · `--no-verify` 금지.
- NOT_RUN 경계(착수 시 예상): hosted DB 조회·migration 원장·실제 브라우저 로그인 재현.
- 병렬 레인 주의: BBE-6 구현 세션이 같은 레포에서 동시 진행 중 — 해당 브랜치·worktree·파일 미접촉.

## [END · BBE-6/codex] 2026-08-03 — 단일 데모 미선택 상태의 선택 불가 회귀 수정

- task_id: `BBE-6-SINGLE-DEMO-SELECTION-FLOW-02`.
- 구현: 승인된 데모가 정확히 1개이고 저장된 선택이 없을 때도 서버가 검증한 index `0` 선택 버튼을 표시한다.
  이미 선택된 단일 데모의 간결 UI와 복수 데모 선택 흐름은 유지했다.
- 변경 범위: `PlatformDemoWorkspaceTab.tsx`와 집중 테스트만 수정(+11/-1).
  migration·RPC·auth·RLS·BBE-7 저장 경로는 변경하지 않았다.
- PR/머지: [#89](https://github.com/bbelieff/moawork/pull/89) · feature `369b7a322e1893ad6622eda5db7a194170719a33`
  · squash main `9e6fb8b1c90fc40776755ad91c36b0b786eae215`.
- 게이트: 실제 `bash scripts/check.sh` PASS(app 1071 pass/9 skip, worker 21 pass), production build PASS,
  PR CI·main CI·GitGuardian PASS.
- 배포: Vercel Production `dpl_9NVB8Ac5j9ydpcdydBPUfq5AmgsC` READY,
  `www.moa-work.com` alias와 merge SHA 일치.
- 독립 QA: `/platform/demo`에서 버전 `9e6fb8b`, 신규고객·컨택관리·업무관리 렌더,
  사용자 모드 전환 후 관리자 DOM 비노출, 관리자 모드 복귀, console warning/error 0 확인.
  Linear QA receipt `87cea3c3-bf27-41d9-a597-1557dabf43f0`.
- 판정: **PASS_WITH_NOT_RUN_BOUNDARIES**. 단일 데모+`selectedIndex=null` 정확 조건은 기존 선택을
  파괴하지 않기 위해 운영에서 재현하지 않았고, 별도 일반 사용자 계정·hosted DB 변경·신규 실계정 auth·모바일 실기기도 NOT_RUN으로 유지했다.

## [START · BBE-6/codex] 2026-08-03 — 단일 데모 미선택 상태의 선택 불가 회귀 수정

- base `afcfa754e9b40a17e7bba62796bbc2ba06d324fa`, branch `codex/bbe-6-single-option-selection-flow`,
  전용 worktree `C:\Users\Belief-desktop\Desktop\개발프로젝트\.worktrees\bbe-6-single-option-selection-flow`.
- 원인: `PlatformDemoWorkspaceTab`이 데모가 2개 이상일 때만 선택 목록을 렌더했다.
  데모가 1개이고 `selectedIndex=null`이면 “사용할 데모 회사를 선택해 주세요” 문구만 남고 클릭 수단이 없었다.
- file lease: `app/src/components/platform/PlatformDemoWorkspaceTab.tsx`,
  `app/src/components/platform/PlatformDemoWorkspaceTab.test.tsx`.
- owner: code session · reviewer: 독립 Production QA session · blocked_by: 없음.
- NOT_RUN 경계: hosted DB 적용·신규 실계정 auth·모바일 실기기. BBE-7 RPC/migration/저장 컨텍스트는 변경 금지.

## [END · C5-갭] 2026-07-29 — T01 · PostHog 배정본 대비 갭 보정 완료

브랜치 `feat/t01-c5-gap`, **최종 base `origin/main@afeba90`**(리베이스 후). **check 게이트 초록**(app 832 pass / 5 skip · worker 14 pass).

> **리베이스 경위(중요)**: 최초 작업 base 는 `e1a3a05` 였으나 그 사이 main 이 8커밋 진행되며
> analytics 가 대폭 개편됐다(Wave B — `autocapture:false` · 경로 템플릿화 `analyticsRouteTemplate` ·
> `uiHost` 를 env 로 못 바꾸게 US 강제 · capture pending 큐 · 이벤트 4종 **실배선**).
> PR 이 충돌 상태가 되어 리베이스했고, 그 과정에서 **이벤트 처리 방침을 교체 → 병합으로 바꿨다**:
> main 의 4종(`login_result` 등)은 로그인·워크스페이스 4개 컴포넌트에서 **실제 호출 중**이라
> 이름을 바꾸면 그 화면들이 깨진다. 그래서 `WAVE_B_EVENTS`(4) + `ASSIGNED_EVENTS`(10) = **14종**으로 합쳤다.
> main 의 개선분(전면 마스킹·US 강제·pending 큐 등)은 그대로 살렸다.

### 보정한 갭 4건

| # | 갭 | 조치 |
| --- | --- | --- |
| 1 | 이벤트가 배정 목록과 불일치(규약 미준수) | 배정 확정 **10종**(`영역.대상.행동`)을 `ASSIGNED_EVENTS` 로 **추가**(기존 배선 4종은 `WAVE_B_EVENTS` 로 보존). 규약을 정규식 테스트로 강제 |
| 2 | 필수 속성 `plan_tier`·`app_version` **grep 0건** | `AnalyticsIdentity` 가 세션에서 4종을 super property 로 등록 + `useTrack` 이 `app_version` 을 매 이벤트에 주입 |
| 3 | 금액·고객정보 화면이 녹화 제외에 없음 | `/policyfund`(실행액·수수료 31컬럼) · `/contract` · `/newcust`(고객사명·연락처) 추가 |
| 4 | 프록시 경로 `/ingest` = PostHog 공식 예시명 | `/mw-sig`(제품 고유어)로 교체. 상수·rewrites·proxy matcher **3지점 동기화를 테스트로 고정** |

### 산출물

- **신규**: `components/analytics/AnalyticsIdentity.tsx`(필수속성 등록·UUID 식별, DOM 0) ·
  `lib/analytics/version.ts`(빌드 버전, 40자 SHA→7자리) ·
  `lib/analytics/proxy-path.test.ts`(경로 동기화·게이트 실제 동작·US 리전 고정) ·
  `lib/analytics/required-props.test.ts`(필수 4종·샘플링 규칙).
- **수정**: `events.ts`(10종 + `RequiredEventProperties` + `sampleDecision`/`passesSampling` 비용가드) ·
  `config.ts`(경로 상수·제외경로) · `client.ts`(`registerAnalyticsContext`) · `useTrack.ts`(app_version·샘플링) ·
  `proxy.ts`(matcher 경로값) · `(app)/layout.tsx`(Identity 마운트 1곳) · `.env.example`(`NEXT_PUBLIC_APP_VERSION` 형태) ·
  기존 테스트 4종 신규 규약 반영.
- **유지(재작업 없음)**: `scrub.ts` 본체 · Wave B 개선분(전면 마스킹 · US 강제 · pending 큐 · 경로 템플릿) — 손대지 않았다.
- **정책 분기 기록**: main 의 Wave B 페이로드 규칙은 record id 도 금지한다. 배정 지시는 "내부 UUID 허용" 이라
  둘이 어긋난다. 해소: Wave B 4종에는 **기존의 더 엄격한 규칙(id 전면 금지)을 그대로 유지**하고,
  배정 10종에만 "*_id 는 허용하되 **UUID 형태여야 함**" 규칙을 적용했다(테스트로 분리 고정).
  금액 필드는 양쪽 모두 금지 — 배정 이벤트 전수에 대해 별도 테스트로 확인한다.

### 수용기준 대조

| 기준 | 상태 | 근거 |
| --- | --- | --- |
| 프록시 경유 수집 | **코드 충족 · 브라우저 미검증** | `api_host=/mw-sig`, rewrites→`us.i.posthog.com`, matcher 제외. 네트워크 탭 확인은 키 주입 후 필요 |
| PII 전송 0 | **자동 테스트로 고정** | scrub 테스트 + 이벤트 페이로드 PII 키 검사 + 필수속성 비-PII 검사 |
| 리플레이 입력값 미노출 | **충족** | `maskAllInputs:true` + `mask_all_text` + `maskTextSelector:"*"` + `maskTextFn` 2차 스크러빙 |
| 회계/홈택스 녹화 제외 | **충족(범위 확대)** | 기존 4경로 + 금액·고객정보 3경로 추가, 테스트로 고정 |
| 키 레포 미존재 | **충족** | `phc_` 실값 grep 0건. `.env.example` 에 형태만 |

### 남은 것(코드 밖 — 운영)

1. **Vercel/PostHog 환경변수 주입** — `NEXT_PUBLIC_POSTHOG_KEY`(필수) · `NEXT_PUBLIC_APP_VERSION=$VERCEL_GIT_COMMIT_SHA`(권장).
   키가 없으면 SDK 자체를 로드하지 않아 **분석이 완전히 꺼진 상태**로 배포된다(fail-closed).
2. **PostHog 대시보드 — 리플레이 보존기간 30일 설정**. 코드로 지정할 수 없는 프로젝트 설정이다.
3. **프록시 경로 변경 여파** — 이전 `/ingest` 로 나가던 배포본이 있다면 교체 시점에 잠깐 유실될 수 있다(키 미주입 상태면 무해).
4. **계측 배선** — 커스텀 이벤트 실제 호출부는 여전히 **0개**. 화면에 `track()` 을 심는 일은 각 도메인 트랙 레인이라
   T01 은 훅·타입·게이트만 제공했다. `useTrack()` 은 이벤트명·페이로드가 타입으로 고정돼 있어 바로 쓸 수 있다.
5. **data-pii 속성** — 머지본 정책이 `maskTextSelector:"*"`(전체 텍스트 마스킹)이라 속성 부착 없이도 텍스트는 가려진다.
   `[data-pii]` 는 `blockSelector` 로 남아 있어(요소 자체 제외) 필요한 곳에 붙이면 더 강하게 막힌다.

## [START · C5-갭] 2026-07-29 — T01 · PostHog 배정본 대비 갭 보정

- **착수 전 실측 결과 — C5 는 이미 구현·머지되어 있다**: `origin/main@e1a3a05` = PR #27
  `feat(C5): PostHog — SDK·/ingest 프록시·PII 스크러핑·리플레이 전면 마스킹` (머지 2026-07-29 06:55).
  `app/src/lib/analytics/**` 15파일 + `components/analytics/PostHogProvider.tsx` 존재.
  → **중복 구현하지 않는다.** 배정 지시서와 머지본을 대조해 **갭만 보정**하는 것으로 전환한다.
- **머지본에서 이미 충족된 것(재작업 없음)**: 리버스 프록시 경유 전송 · fail-closed 키 형태검증 ·
  `maskAllInputs:true` + `mask_all_text` + `maskTextSelector:"*"`(전면 마스킹) · `maskTextFn` 2차 스크러빙 ·
  값/키/URL 3중 PII 스크러빙(이메일·전화·주민·사업자·카드·IP·JWT) · `respect_dnt` · 키 레포 미존재(phc_ grep 0건).
- **확정된 갭 4건(실측 근거)**:
  1. **이벤트 화이트리스트 불일치** — 배정 10종(`영역.대상.행동`)이 아니라 `deal_created`/`deal_moved`/
     `meeting_logged` 3종. `auth.login.succeeded`·`settle.settlement.saved` 등 **8종 부재**, 네이밍 규약 미준수.
  2. **필수 속성 2종 부재** — `plan_tier`·`app_version` 이 analytics 전체에서 **grep 0건**
     (`org_id`·`role` 은 identify 에만 존재, 이벤트 속성으로는 미주입).
  3. **금액 화면 녹화 제외 누락** — 제외 목록에 `/policyfund` 없음. 해당 보드는 실행액·수수료가
     상시 렌더된다(T09 산출물). `/contract`·`/newcust`(고객사명·연락처)도 미포함.
  4. **프록시 경로가 표준 예시명** — `/ingest` 는 PostHog 공식 문서가 쓰는 대표 경로라
     차단 목록 등재 위험이 있다. 배정 지시 "뻔한 이름 금지" 와 상충.
- **만지는 파일**: `app/src/lib/analytics/{events,config,client}.ts` + 각 테스트 ·
  `app/src/proxy.ts`(matcher 경로값만) · `app/next.config.ts`/`analytics/rewrites.ts`(프록시 경로 상수 반영) ·
  `app/.env.example` · `docs/worklog.md`.
- **안 만지는 것**: `scrub.ts` 본체(견고 — 유지) · `worker/**` · `supabase/**`(마이그레이션 0건) ·
  타 트랙 업무로직 · `lib/types/**`·`lib/repo/index.ts`(계약 = 단일소유) · 리전(US 고정).
- **계측 배선 경계**: 커스텀 이벤트의 실제 호출부는 현재 **0개**(테스트에서만 호출). 화면 컴포넌트에
  `track()` 을 심는 일은 각 도메인 트랙 레인이므로 T01 은 **훅·타입·게이트만 제공**하고 배선은 하지 않는다.
## 2026-07-23 — T02 · [END] 딜 상세 + 고객사 목록 (배정 잔여분) · PR #48 리베이스

- **PR #48 리베이스**: main 이 크게 전진(PostHog·MWC R1 등)해 `origin/main` 위로 리베이스.
  `docs/worklog.md` 충돌은 append-only 문서라 **양쪽 항목 모두 보존**해 해소. 게이트 초록 유지.
- **딜 상세 `(app)/deals/[dealId]`** — 보드 카드 드릴인 대상. 정보/활동/첨부를 세로로 쌓은 서버 렌더.
  - 서버 액션 6종(`actions.ts`): 단계이동(활동로그 자동) · 활동추가 · 기본정보 수정 ·
    계약상황 저장 · 첨부 업로드/삭제. 저장은 전부 `getCrmService()`(env 있으면 실 Supabase).
  - `DealInfoTab`/`DealActivityTab`/`DealFilesPanel` 신규. **T04 가 만들어두고 어디에도 연결되지
    않았던** `ContractStatusField`·`FilesTab` 을 그대로 소비(중복 저작 없음).
  - 담당범위 밖이면 `NotFound` → **404 로 수렴**(존재 유출 방지), 편집 UI 도 비활성.
- **고객사 목록 `(app)/companies`** — 담당범위 적용 표 + 업체별 진행 딜 건수.
- **보드 카드 링크 복구**: 이전에 `/deals/[id]` 부재로 링크를 빼뒀던 워크어라운드 제거.
- **라우트 슬러그 예약**(아래 경계 이슈): `companies`·`deals` 를 예약 목록에 추가.
  넣지 않으면 워크스페이스가 slug='deals' 를 선점해 라우트를 가릴 수 있다(실제 결함).
- 신규 테스트 7건(`dealDetail.test.ts`) — 데이터 조합 · 스코프 404 · 이동 로그 증분 ·
  custom **키 병합**(다른 커스텀값 보존) · null 로 키 삭제 · 활동 추가/차단.
- 게이트 `check.sh` **초록**(앱 758 통과/9 skip · 워커 14), `next build` 초록(라우트 등록 확인).

### ⚠ 경계 이슈 보고 — 예약 슬러그가 마이그레이션에 하드코딩됨

`workspace-entry/contracts.test.ts` 가 **006 파일 내용**을 예약목록의 단일 출처로 비교한다.
그래서 top-level 라우트를 추가하면 006 을 고치지 않는 한 게이트가 빨개진다. 그러나 006 은
이미 적용된 마이그레이션이라 파일만 고치면 **배포된 DB 에는 반영되지 않는다**(CLAUDE.md
"기존 파일 수정 금지" 와도 충돌).

→ 양쪽 다 안전하도록 **006/009 갱신(신규 설치용) + `014_reserve_crm_route_slugs.sql` 추가
(기존 DB 따라잡기용, drop+add 라 재실행 안전)** 로 처리했다. 슬러그 2개를 넣은 것 외에
술어는 원문 그대로다. **workspace-entry 트랙 리뷰 필요** — 근본 해소는 예약목록을 SQL 상수
(테이블/함수)로 뽑아 앱과 한 곳에서 공유하는 것.

- **파킹 유지**: `.env.local` 부재 → 실DB 실행검증 미실시(`liveCrm.test.ts` 는 skip 상태).
  브라우저 검증 NOT_RUN(preview 가 세션 디렉터리 기동). `moveDeal` 비원자성 TODO 유지.
- **첨부만 저장소가 갈린다**: files 서비스가 아직 동기 `getRepo()` 위 → 첨부는 로컬에만 기록.
  T04 가 비동기 소스로 옮길 때까지 한시적. 코드에 명시해둠.

## 2026-07-22 — T02 · [END] B2 재개 — CRM 쓰기경로 실DB 연결 완료 (실행검증은 파킹)

- **전달물**:
  - `lib/crm/asyncService.ts` — `CrmSource` 위 비동기 서비스. 동기 `CrmService` 와 **동일 의미론**
    (딜 생성 시 기본단계 배치 + 활동로그 1건, 단계이동은 move 전용, 담당범위 규칙).
  - `getCrmService()` → `AsyncCrmService` 반환으로 전환. 동기판은 `getSyncCrmService()` 로 보존
    (공용 `Repo` 가 아직 동기라 T04·T09 가 그 위에서 돈다).
  - **API 라우트 7종 실DB 경로 연결** — deals(목록/생성) · deals/[id](상세/수정/삭제) ·
    deals/[id]/move · deals/[id]/activities · companies(2) · pipelines. 라우트 한 벌로
    env 있으면 Supabase, 없으면 로컬(연결 전후 동작 동일 → 회귀 0).
  - `CrmSource` 에 `deleteCompany`/`deleteDeal` 추가(라우트 DELETE 파리티 복구) + 양쪽 구현.
- **테스트**: `asyncService.test.ts` 10건(생성 자동로그·이동 증분로그·move 불변식·스코프·동기판 파리티) +
  `liveCrm.test.ts` 4건(실DB 왕복, 크리덴셜 없으면 skip — T10 rls-penetration 규약 준수).
- **게이트**: `check.sh` **초록** — 앱 656 통과 / 9 skip, 워커 14. `next build` 성공(라우트 전량 등록).
- **service_role 미사용 확인**: 클라이언트는 anon 키만 사용(`client.ts`), 실DB 테스트도 비밀번호 로그인
  JWT 로 RLS 를 통과한다. service_role 키는 코드·문서·env 예시 어디에도 없음.
- **파킹된 블로커**:
  1. `.env.local` 부재 → **실DB 실행 검증 미실시**. 수용기준(딜 생성→이동→활동 1건)은 `liveCrm.test.ts`
     로 자동화해뒀고 크리덴셜 주입 즉시 실행 가능. 현재는 "미검증" 상태가 정직한 판정.
  2. 브라우저 검증 NOT_RUN — preview 도구가 세션 디렉터리를 기동해 이 worktree 변경엔 적용 불가.
  3. `moveDeal` 의 UPDATE + 활동로그 INSERT 가 비원자적(기존 TODO 유지) — 004 이후 RPC 로 합칠 것.
- **다음**: 딜 상세 `/deals/[id]` 화면 · 드래그 단계이동 · 크리덴셜 확보 후 실DB 판정.

## 2026-07-22 — T02 · [START] B2 재개 — CRM 실repo 쓰기경로 + 단계필터 화면 연결

- 브랜치 `feat/t02-crm-supabase-repo` (main d172875 기반).
- **착수 전 실측**:
  - 공용 `Repo` 포트는 **여전히 동기**(`listDeals(ctx): Deal[]`) → Supabase 로 "동일 포트" 구현 불가.
    기존 비동기 포트 `CrmSource`(시그니처 1:1)를 그대로 쓴다. `moveDeal` 은 이미 양쪽에 존재.
  - `SupabaseCrmSource` 는 CRUD·moveDeal(활동로그 포함)·custom 병합까지 **이미 구현됨**.
  - **갭 = 쓰기 경로 미연결**: API 라우트가 `CrmService(getRepo())`(동기 LocalRepo)에 묶여 있어
    env 가 채워져도 딜 생성/단계이동이 실DB 로 가지 않는다. 읽기(보드 3종)만 Supabase 경로.
- **계획**: ①`CrmSource` 위 비동기 서비스 ②API 라우트 연결 ③실DB 통합테스트(env 없으면 skip).
- **블로커(파킹)**: `.env.local` 부재 → 실DB 실행 검증 불가. 코드+테스트를 준비하고 키 제공 시 즉시 실행.

## END 2026-07-30 — T09 · G8 자동이동 엔진 + PR #49 최신화

**1. PR #49 (B4 정산 수식 화면) 최신화**

- main 이 6커밋 앞서 있어 `origin/main`(`1744d9f`) 위로 리베이스. 충돌은 `docs/worklog.md` append 2건뿐 — 양쪽 보존으로 해소. 코드 4파일은 백업 대비 **바이트 동일**(변형 0).
- 확인: 내가 의존하는 계약(`lib/repo/index.ts`·`lib/types/`·`api/settlements/`)은 그 구간에서 **무변경**.

**2. G8 상태→그룹 자동이동 엔진 (착수 언블록 → 구현)**

- **언블록 근거**: `supabase/migrations/004_gaps_and_leadin.sql` 에 `board_automation_rules` 스키마가 내려옴(`board_id`·`status_column_key`·`status_value`·`to_group_id`·`enabled`, unique 3키). 이전 지시의 차단 조건("MWC 가 별도 설계 후 내려보냄")이 충족됨. RQ-0009 의 3개 사유 중 **004 스키마 부재는 해소**.
- **설계 원칙 — 규칙은 데이터, 엔진은 코드**: 먼데이 11그룹(준비→진행→심사→승인→관리→불가) 목록을 코드에 **하드코딩하지 않는다**. 규칙 행으로 주입되므로 **그룹 목록이 미확정이어도 엔진은 완성 가능**하다. 소스가드 테스트가 구체 그룹명 유입을 차단.
- 산출물 `app/src/lib/policyfund/automation.ts` — `indexRules`/`decideMove`/`decideMoves`/`findRuleConflicts`. 부수효과 없음.
- 불변식(테스트 19건 고정): 상태값 공백·null → 이동없음 · 보드/컬럼 격리 · 이미 대상그룹이면 no-op · 비활성 규칙 미발동 · 중복키 선착순(결정적) · 004 unique 위반 사전검출 · 미배치(group_id=null) 아이템도 이동.
- **미포함(별건)**: 영속성(포트/어댑터)·API 라우트·**규칙 시드(11그룹 매핑)**. 시드는 그룹 목록 SSOT 확정 후.

**3. 잔여 블로커**

- ⚠ **11그룹 목록 SSOT 여전히 부재** — 004 에도, 어느 seed·ROUND 문서에도 없음(실측 grep 0건). 엔진은 무관하게 완성됐고, **규칙 시드만 대기**.
- ⚠ **타 트랙 잔존 이슈** — `app/src/app/providers.tsx`(git **미추적**, main·본 브랜치 모두 부재)가 `@tanstack/react-query` 를 import 하는데 package.json **미선언**. 공유 워킹트리에서만 typecheck 실패 → 격리 워크트리로 우회 검증. 해당 트랙 확인 요망.
- 참고: 조율 SSOT 가 `dispatch-queue.yaml` → `sync/ROUND-*.md` 로 이관됨(SYNC R1). 최신 `ROUND-33` 은 `NEXT_WORK: NONE` 이며, 본 작업은 신규 프로그램이 아니라 **기존 T09 배정(B4/G8)의 연속**이다.

## END 2026-07-23 — T09 · B4 정산 수식 화면 완료

- 브랜치 `feat/t09-settlement-form` (base `origin/main` d172875) · 커밋 `dcfbae4`.
- **산출물**
  - `app/src/app/policyfund/settlements/page.tsx` — 서버 컴포넌트. 002_seed 번들에서 진행상품(59)·진행기관(18) 로드 후 폼에 주입.
  - `app/src/components/policyfund/SettlementForm.tsx` — 실행액·수수료%·계약금·수수료입금일 입력 → `POST /api/settlements` → **서버 응답의 파생값 4종을 그대로 표시**.
  - `app/src/lib/policyfund/settlement-form.ts` — 순수 로직 분리(`toCreatePayload`/`toDerivedDisplay`). **산식 없음 = 복사 전용.**
  - `settlement-form.test.ts` 11 테스트.
- **수용기준 달성(화면 재계산 금지)** — 3중으로 고정:
  1. `toDerivedDisplay` 는 복사만 — DB generated column 값이 그대로 화면에 간다.
  2. 정합 테스트: 표시값 == 저장 레코드의 `fee_amount`/`total_revenue`/`d180`/`d365` (+ 002_seed 확정본 회귀가드 3,000,000 / 3,500,000 / 2026-07-09 / 2027-01-10).
  3. 소스가드 테스트: `SettlementForm.tsx` 에 `computeSettlement`·`feeAmount(`·`dPlus(` 등 산식 import 부재, `settlement-form.ts` 에 산술 연산자 부재.
- **파생키 배제**: 페이로드에 `fee_amount`·`total_revenue`·`d180`·`d365` 미포함(서버 400 방지) — 테스트 고정.
- **검증**: 격리 워크트리에서 `check.sh` **초록**(app 657 pass/5 skip, worker 14), `npm run build` **통과**(`/policyfund/settlements` 라우트 등록). dev 서버 실측 — 페이지 **200**, 입력 4종·파생 4칸·프리셋 `<option>` **79개**(59+18+placeholder 2) 렌더, 실제 프리셋 값(`개발기술사업화`·`직접_미소` 등) 확인.
- **미검증(정직 기록)**: 브라우저 클릭스루는 **미실행**. Browser pane 이 https 로 강제 리다이렉트해 접근 실패했고, `/api/settlements` 는 인증 필요(401)라 로그인 없이는 제출 흐름을 끝까지 못 탄다. 제출→표시 왕복은 단위 테스트(repo 경유)로 커버.
- **블로커 처리**
  - ⛔ G8: 착수 금지 지시대로 **미착수**. RQ-0009 파킹 유지.
  - ✅ B-3(공유 워킹트리 타입에러) **부분 해소**: `@supabase/ssr` 은 package.json 에 선언돼 있었고 node_modules 가 stale 했던 것 → `npm install` 로 해소.
  - ⚠ **잔존**: `app/src/app/providers.tsx`(타 트랙 **미추적** 파일, main·내 브랜치 모두 부재)가 `@tanstack/react-query` 를 import 하는데 해당 패키지는 package.json 에 **미선언** → 공유 워킹트리에서만 typecheck 실패. 타 트랙 파일이라 손대지 않고 격리 워크트리로 우회 검증함. 해당 트랙 확인 필요.

## START 2026-07-23 — T09 · B4 정산 수식 화면 (P3, MWC 재개 배정)

- 트랙 T09 / provider claude. 브랜치 `feat/t09-settlement-form` (base = `origin/main` d172875).
- 범위: settlements 수식 **화면** — 실행액·수수료% 입력 → 수수료·총매출·D+180/365 표시 + 002 프리셋 연결.
- **수용기준**: 화면 재계산 금지. 서버(DB generated column) 값을 그대로 표시한다.
- ⛔ G8(상태→그룹 자동이동) **착수 금지** — MWC 별도 설계 대기. RQ-0009 파킹 유지.
- 착수 전 실측: settlements API 2종(`/api/settlements`, `/[settlementId]`) main 반영 확인.
  `lib/repo/supabase/` 어댑터는 **CRM 전용**(settlements 미포함) → 정산은 LocalRepo 경유.
## 2026-07-30 — T03 · 플랫폼 관리자가 어드민에 도달하지 못하는 버그 3건

**START** 2026-07-30 09:40 KST · 브랜치 `feat/t03-r1-entry-ux` (base `fc290f4`)

### 근본원인 — `is_platform_admin()` 이 예약된 관리자를 인식하지 못했다
지시서 진단은 "라우팅에 플랫폼 분기가 없다" 였는데, 실측하니 **앱은 이미 관리자를
operator 뷰로 보내도록 돼 있었다**(`resolveWorkspaceEntryView` 첫 분기).
문제는 그 판정의 입력값이 **항상 false** 였다는 것이다.

`006` 의 `is_platform_admin()` 은 `app_admins.role = 'admin'` 을 요구한다.
그런데 `005` 는 belie 를 **`role = 'owner'`** 로 예약한다. `app_admins.role` 은
005 정의상 "플랫폼 등급"이 아니라 **가입 시 부여할 tenant 역할**이고
(`role text not null default 'owner'`, 주석 "owner + 플랫폼 관리자로 자동 부여"),
플랫폼 축은 `is_platform` 컬럼이다. 006 이 두 축을 한 컬럼으로 오해했다.
→ 유일한 예약 관리자가 조건에 걸려 탈락. "DB 는 정상"이라는 관찰은 맞았고,
**함수가 그 행을 못 읽은 것**이다.
→ `017`: 판정을 `is_platform` 단독으로. (`role='admin'` 으로 데이터를 바꾸는 방식은
   belie 가 회사 생성 시 owner 가 아니라 admin 으로 들어가 005 의도가 깨져서 미채택.)

### 수정 1 — 로그인 후 플랫폼 분기
`decideWorkspaceDestination(rows, target, isPlatformAdmin)` 3번째 인자 추가.
**소속 0 일 때만** 목적지를 `/platform` 으로 바꾸고, 소속이 있으면 기존대로 회사로 보낸다.
`isPlatformAdmin` 은 멤버십 파싱·slug 매칭·fail-closed 에 **개입하지 않는다**(계약 유지) —
테스트로 고정했다(남의 회사 slug 를 next 로 넣어도 관리자여도 fail-closed).
callback 에서 `app_admin_role` RPC 로 판정하고, **실패는 "관리자 아님"으로 수렴**시킨다
(실패를 관리자로 처리하면 조회 장애가 곧 권한 상승이다). 라우팅 테스트 6건 추가.
`app_admin_level()` 은 **레포에 존재하지 않는다** — `app_admin_role()` 만 사용.

### 수정 2 — 진입 화면 탈출구
`[⚙ 플랫폼 관리로 가기]` 를 추가. 처음 pending 뷰에 넣었으나 **테스트가 사실을 정정해줬다**:
관리자는 pending 이 아니라 **operator 뷰**에 착지한다(위 분기가 우선). 도달 불가 UI 를
남기지 않으려고 링크를 operator 뷰로 옮겼다. 그 뷰는 서버가 확인한 `isPlatformAdmin`
일 때만 선택되므로 **일반 사용자에게는 렌더 자체가 되지 않는다**(숨김이 아니라 부재).
테스트 2건(관리자 노출 / 비관리자 마크업 부재 + 기존 출구·문구 불변).

`/platform` 인덱스 페이지는 **main 에 이미 생겼다**(타 세션 `feat/platform-console-shell`).
내가 만들던 리다이렉트 페이지는 폐기했다.

### 수정 3 — 플랫폼 관리자의 회사 생성은 승인 불요
`018`: `submit_workspace_create_request` 에 자동승인 분기 추가. 검증·멱등·advisory lock 은
기존과 동일하게 두고 **그 뒤에** 붙였다. 관리자면 pending 없이 orgs + owner 멤버십을 즉시
만들고 `decision_code='platform_admin_direct_create'` + 감사 이벤트에
`platform_admin_direct_create/self_approved/reason` 을 남긴다(일반 승인과 구분).
반환은 하위호환(기존 `accepted` 유지 + 필드 추가). 재호출은 replay 로 방어하고,
slug 경쟁은 승인 경로와 **같은 키**로 advisory lock. 일반 사용자 경로는 무변경.

앱 배선도 함께: RPC 가 `auto_approved+slug` 를 주면 `redirectTo` 를 실어 보내고 클라이언트가
바로 입장한다 — 이 배선이 없으면 **이미 만들어진 회사를 두고 "승인 대기" 화면에 머문다**.

### 마이그레이션 번호 충돌 처리
내 `014_entry_request_dedup` 이 main 의 `014_platform_metrics_daily` 와 충돌 → **016 리넘버링**.
신규는 `017`·`018`. (커밋 직전 재실측해서 잡았다.)

**END** 2026-07-30 10:05 KST
- **미검증(파킹)**: 실DB 적용 후 동작. 017·018 은 실 Supabase 에 적용돼야 효력이 있고,
  로컬에 크리덴셜이 없어 SQL 실행 검증은 못 했다. 수용기준 5개 전부 **배포+마이그레이션
  적용 후** belie/T10 확인 필요.
- 정적 검증은 전부 통과(check.sh 초록).

---

## 2026-07-30 — T03 · R1 P0 — 오너 권한 고착 + 사이드바 전 메뉴 잠김 해소

**START** 2026-07-30 01:13 KST · 브랜치 `feat/t03-r1-entry-ux` (worktree 격리, base `1744d9f`)

배정: [0순위] public-workspace-entry 머지·배포 · [1순위] C0 진입 UX 3건 · [2순위] C1 스위처.

### [0순위] — **이미 완료 상태였다(실측)**
`git rev-list --left-right --count origin/main...origin/feat/public-workspace-entry` = **`33  0`**.
ahead=0 → 해당 브랜치는 main 에 **전량 포함**돼 있다(다른 세션이 이미 머지). main tip 은
`1744d9f feat: add safe PostHog analytics (#53)` 로 07-22 정체 상태도 아니다.
→ 머지할 대상이 없어 마이그레이션 006 리넘버링·형제 브랜치 통합 이슈도 발생하지 않았다.
브리핑의 "69커밋 적체 / main 07-22 정체"는 **07-27 실측 시점 정보이며 현재와 다르다.**

### P0-a 오너 권한 고착 — **원인은 app_admin_role() 아님**
브리핑 가설은 "앱이 app_admin_role() 을 안 묻거나 실패를 삼킨다" 였으나 실측 결과 **정상 호출**된다
(`session.ts:79`, 에러 없으면 `parseAdminRole(data)` 반영).

진짜 원인은 `lib/account/presentation.ts` 였다. `ctx.isPlatformAdmin` 이 true 면 **실제 org 역할을
무시하고** `roleLabel="회사 역할 확인 중"` + `canManageCompany=false` 로 **고정**하고 있었다.
belie 는 오너이면서 플랫폼 관리자라 이 분기에 걸려 자기 회사를 관리하지 못했다.

그 방어는 "Platform role 이 workspace membership 을 덮어쓸 수 있다"는 전제였는데 **그 전제는
이미 해소돼 있었다** — `session.ts` 의 두 경로 모두 role/scope 를 검증된 `org_members` 행에서만
채운다(`getSupabaseSession`·`getDevSession` 둘 다 `membership.role`). 전제가 사라진 뒤에도
가림막만 남아 P0 가 된 것이다.
(솔직 기록: 그 덮어쓰기는 원래 **내가 B1 에서 넣은 코드**였고, 이후 누군가 strict 하게 고쳤다.
즉 이 가림막은 내 과거 버그를 막으려던 방어였는데 원인이 사라진 뒤 잔재로 남았다.)
→ 분기 제거, 실제 멤버십 역할 사용. 회귀테스트 2건(관리자여도 역할 노출 / 관리자라고 역할이
올라가지 않음 — 두 축의 독립성 고정).

### P0-b 사이드바 전 메뉴 잠김 — **별개 원인**
셸이 `getRepo().isFeatureEnabled(ctx.org.id, key)` 로 판정했는데, `getRepo()` 는 환경과 무관하게
**항상 LocalRepo(인메모리 시드)** 를 돌려준다. 프로덕션의 `ctx.org.id` 는 Supabase 실 UUID 라
그 스토어에 없고 → 전 feature false → **전 메뉴 잠김**.
게다가 Supabase 경로에는 조직 생성 시 `org_entitlements` 행을 만드는 코드가 없어(LocalRepo 만
부여) DB 를 그대로 읽어도 빈 결과다.

→ `lib/entitlements/resolve.ts`(순수 판정) + `server.ts`(환경별 소스) 신설.
판정 규칙은 PLAN v0.2 §5("MVP: 모든 플랜에 core.* + MVP 모듈 무료") 그대로 —
**MVP 기능은 행이 없으면 ON**, 비-MVP 는 행이 없으면 OFF, DB 행은 기본값을 뒤집는 오버라이드,
만료 행은 무시. 조회 실패 시에도 기본값으로 수렴한다(엔타이틀먼트는 노출 제어지 보안 경계가
아니다 — 진짜 경계는 RLS. 조회 실패로 전 메뉴가 잠기면 그게 곧 장애). 테스트 11건.

### C0 진입 UX — 실측 결과 대부분 기구현
- **C0-1 로고 홈 링크: 이미 완료.** `(app)/layout.tsx:83` `<Logo height={30} href={logoHref} />`,
  멤버십 1개면 `/w/{slug}` · 그 외 `/workspaces`.
- **C0-2 pending 출구: 이미 완료.** `WorkspaceEntry.tsx:268-270` 에 다른 회사 보기 / 요청 취소 /
  로그아웃 존재.
- **C0-2 중복 차단: 실제 구멍 발견 → 수정.** 006 이 `join` 은 부분 유니크 인덱스로 막았지만
  (`workspace_entry_one_pending_join_idx`) **`create` 는 일반 인덱스**라 뒤로가기 중복이 그대로
  들어갔다(브리핑 4번 증상과 일치). → `014_entry_request_dedup.sql` 로 사용자당 pending create
  1건 강제 + 기존 중복은 최신 1건만 남기고 `cancelled` 처리(삭제 아님 — 이력 보존).
- **C0-3 승인 도달 경로: 이미 완료.** 사이드바 뱃지 + 상단바 "승인 대기 N건" 링크 존재.

### C1 회사 전환 스위처 — 이미 구현돼 있음
`components/workspace/WorkspaceSwitcher.tsx` + 사이드바 배선(`layout.tsx:98-110`) 존재.

**END** 2026-07-30 02:03 KST
- 실제 코드 변경: P0-a(1파일+테스트) · P0-b(2파일 신설+셸 배선+테스트 11) · 014 마이그레이션.
- **미검증(파킹)**: 프로덕션 실동작 확인 — 로컬에서 Supabase 경로를 태울 크리덴셜이 없다.
  P0 해소 판정("belie 로그인 → 사이드바 잠금 풀림")은 **배포 후 belie/T10 확인 필요**.
- **파킹**: 014 번호는 013 다음이지만 타 브랜치와 충돌 가능(전 브랜치 스캔은 비용 문제로 미실시).
  충돌 시 리넘버링 필요.

---

## 2026-07-29 — T05 · 인라인 셀 오류 표시 (B3 followup 해소)

B3(PR #12)에서 남긴 followup 을 닫는다. `check.sh` 초록(앱 **766** PASS/5 skip · 워커 14) · `next build` 초록.

**문제**: `setCells` 는 관대 정책이라 틀린 셀만 빼고 나머지를 저장한 뒤 사유를 `errors[]` 로 돌려주는데, `boards/actions.ts` 의 `setCellAction`·`moveItemAction` 이 그 반환을 **버리고 있었다**. 사용자에겐 값이 저장되지 않았는데도 아무 안내가 없는 **조용한 실패**로 보였다.

**해결 — 쿠키 플래시(클라이언트 JS 0)**
- 이 화면은 "클라이언트 JS 없이 셀 단위 서버 액션 폼"이 설계 전제(GenericBoardTable 주석)라 `useActionState` 를 쓰지 않았다. 서버 액션이 1회성 쿠키를 남기고 다음 렌더에서 서버 컴포넌트가 읽어 표시한다.
- URL 쿼리를 쓰지 않은 이유: 오류 메시지에 사용자가 입력한 값이 섞여 주소창·리퍼러·로그에 남는다. 쿠키는 httpOnly + 짧은 TTL(10초)로 화면 밖으로 나가지 않는다.
- 소멸: 서버 컴포넌트 렌더 중에는 쿠키를 지울 수 없어(Next 제약) **짧은 TTL 로 스스로 만료**시킨다.
- `lib/boards/cellFlash.ts`(순수) — 인코딩/디코딩/조회. 쿠키는 사용자가 조작할 수 있으므로 구조를 신뢰하지 않고 전부 검사한다(형식 불일치 → 표시 안 함, 항목 단위로 걸러내고 나머지는 살림).
- 표시: 해당 셀 바로 아래 빨간 문구 + `role="alert"` + `aria-describedby` 연결.

**설계 결함 1건 교정(테스트가 잡음)**: 한글은 `encodeURIComponent` 에서 글자당 9자(`%EA%B0%80`)로 부푼다. 처음엔 "글자 수 200 클램프 + 인코딩 1500자 상한"으로 뒀는데, 한글 메시지는 클램프를 통과하고도 상한을 넘어 **잘리는 게 아니라 통째로 버려졌다**(오류를 알리려다 아무것도 안 보이는 상태). → 크기 초과 시 (1) 뒤쪽 오류부터 덜어내고 (2) 하나만 남아도 크면 이진 탐색으로 메시지를 잘라 담도록 고쳤다. "담은 결과는 항상 상한 안" 을 property 로 검증.

**범위**: `setCellAction`·`moveItemAction` 두 경로. 칸반(GenericBoardKanban)은 레인 이동이 `moveItemAction` 을 쓰지만 셀 단위 표시 지면이 없어 이번엔 테이블 뷰에만 표시한다 — 칸반 표시는 별도 건.

## 2026-07-29 — T04 · BUG-0004 영향범위 자체점검 + 배치 env 결정요청

**START** — PR #54 머지 후속. T10 이 §11 에서 **BUG-0004 배포차단** 을 판정해 T04 산출물
영향 범위를 먼저 실측했다.

### PR #54 머지 완료

`gh pr merge 54 --merge` → **main `1e808ab`**, main CI 초록.
착지 확인: `app/platform/metrics/page.tsx` · `lib/metrics/read.ts` · `read.test.ts`.

### BUG-0004 영향범위 — T04 산출물은 **영향권 밖** (실측)

T10 판정: `011_member_account_ops.sql` 이 `is_org_member()` 에 세션 종속을 도입했는데
그 클레임을 채우는 배선이 없어 **상시 false** → RLS 26개 테이블 전면 차단.

**014 는 영향 없음**, 근거 2가지:

1. **`is_org_member()` 미의존** — grep 0건. 집계 표는 tenant 업무데이터가 아니라
   개인정보 없는 수치라 org 멤버십이 아니라 **플랫폼 관리자 여부**로 게이트한다.
   설계 당시 P0 O5(플랫폼/tenant 평면 분리)를 따른 결과가 결과적으로 이 사고를 비켜갔다.
2. **실패 메커니즘이 다르다** — BUG-0004 는 `current_setting('request.jwt.claim.session_id', true)`,
   즉 **단수 클레임 GUC** 를 읽었다. PostgREST v9+ 는 `request.jwt.claims`(복수 JSON)만 채우고
   단수 형태는 채우지 않는다 → 상시 빈 값. 014 의 `auth.jwt()` 는 **복수 형태를 파싱하는
   Supabase 표준 함수**라 같은 유형이 아니다.

자체 점검 중 확인: 014 는 저장소에서 `auth.jwt() ->> 'email'` 을 쓰는 **유일한** 정책이라
선례가 없다 → 근거를 `decision-inbox.md` 에 명시적으로 남겼다.
`email` 부재 인증수단에서는 `is not null` 로 **fail-closed** 된다(안전한 방향).

**T10 의 규칙 8 보강 권고에 동의**한다("헬퍼가 새 전제에 의존하면 배선을 같은 PR 에").
014 는 새 전제를 만들지 않고 기존 `app_admin_role`(005)만 소비하므로 이미 만족한다.

> BUG-0004 해소 자체는 **T03/T08 담당**이라 손대지 않았다. 레인 경계 준수.

### decision-inbox 등재

- **DI-A4** — 야간 배치 env 2종(`CRON_SECRET`·`SUPABASE_SERVICE_ROLE_KEY`) belie 액션 요청.
  외부 콘솔 + 시크릿 발급이라 에이전트가 대신 할 수 없다. 배치 전용이라 BUG-0004 와 독립.
- **DI-A5 회신** — 위 영향범위 분석을 T10 앞으로 기록.

### 파킹 (변동 없음 — 전부 외부 의존)

1. **실DB 미검증** — `.env.local` 부재 + BUG-0004 로 실DB 연결 자체가 막힌 상태.
   014 적용·RLS 판정·배치 왕복 **NOT_RUN** 유지.
2. **플랫폼 전역 고유 사용자** — 014 PK 가 `(day, org_id)` 이고 `org_id` 는 NOT NULL FK 라
   전역 행을 넣을 수 없다. 별도 표(015)가 필요하지만 **배포차단 중 스키마를 더 쌓지 않는다**.
   현재는 콘솔에 "겸직자 중복 계상" 문장으로 한계를 명시.
3. **TTFV 배치 미적재** — 일 단위 표에 코호트 지표는 부적합. 적재 위치 미정.
4. **공지 RLS 예외(DQ-0018)** — 기획 판정 대기.

**END** — 코드 변경 없음(문서 2건). 배포차단 해소는 T03/T08 대기.

---

## 2026-07-29 — T04 · 🔴 `platform_metrics_daily` 이중정의 발견 (T04↔T07)

**START** — PR #58 머지(main `0134975`) 후 열린 PR 목록을 훑다가
**PR #56 "feat(T07): 플랫폼 운영 콘솔 /platform P0 + 운영 분석 지표"** 를 발견해 겹침을 실측했다.

### 실측 결과 — 충돌 아님으로 시작했다가 충돌로 확정

처음엔 **계층 분담**으로 보였다. T07 의 `lib/platform/metrics.ts` 헤더에
*"저장 원본은 `platform_metrics_daily`(야간 배치 롤업)이며 실시간 집계는 하지 않는다"* 가 있어
내 표를 **소비**하는 구조로 읽혔기 때문이다(내 배치 + T07 콘솔).

그런데 T07 이 기대하는 `MetricsDailyRow`(`date`·`writes`·`errors`·`memberCount`)가
내 014 컬럼과 맞지 않아 마이그레이션을 확인했더니 — **T07 도 같은 테이블을 자기 정의로 만든다**.

| | T04 `014_platform_metrics_daily.sql` (**main**) | T07 `014_platform_console.sql` (PR #56) |
|---|---|---|
| PK·날짜 | `(day, org_id)` | `(date, org_id)` |
| 지표 | `dau`·`mau`·`stickiness`·`active_users`·`dormant_users`·`new_deals` | `active_users`·`writes`·`errors`·`member_count`·`last_activity_at` |
| RLS | 정책 있음(관리자 SELECT) | 정책 없음(RPC 전용) |
| 적재 | `upsert_platform_metrics_daily`(앱 배치) | `rollup_platform_metrics_daily`(SQL) |

**파급**: 둘 다 `create table if not exists` 이고 마이그레이션은 **문자열 정렬** 적용이다.
`014_platform_console` < `014_platform_metrics_daily`(`c`<`m`) → **T07 이 먼저 생성되고
내 CREATE TABLE 은 무음 무시** → 내 배치가 없는 컬럼에 INSERT → 런타임 실패.

> **BUG-0004 와 정확히 같은 유형**이다. 정적 게이트는 양쪽 다 초록이고
> `.env.local` 로 실DB 에 적용하는 순간 처음 드러난다.
> 번호 충돌(둘 다 `014`)은 부차적이고, 진짜 문제는 **같은 이름·다른 스키마**다.

### 조치

- `decision-inbox.md` 에 **DI-A6**(이중정의, 해소안 A/B/C + T04 의견 **B**) ·
  **DI-A7**(화면 중복 `/platform/metrics` vs `/platform/analytics`) 등재.
- **PR #56 에 경고 코멘트** — T07 이 모르고 머지하면 실DB 에서 한쪽이 깨진다.
- 내가 일방적으로 정하지 않는다. 스키마 정본 판정은 기획/T10 소관이며
  **콘솔 화면 소유는 T07** 이므로 화면 중복은 T07 머지 후 내가 정리하는 순서가 맞다.

### 교훈 (자기 몫)

직전 항목에서 마이그레이션 번호 충돌을 겪고 "**푸시 직전 최신 main 기준 재확인**"을 교훈으로 적었는데,
이번 건은 그것만으로는 못 막는다. 번호가 달랐어도 **테이블 이름이 같으면 동일하게 깨진다**.
→ 보강: 새 테이블을 만들 때 **열린 PR 전체에서 같은 이름을 검색**해야 한다
(`gh pr list` → 각 브랜치 `git grep "create table .*<name>"`).

**END** — 문서 2건 + PR #56 코멘트. 스키마 판정 대기.

## 2026-07-29 — T04 · C4 지표 콘솔 `/platform/metrics` (배치 후속)

**START** — 재개 지시(자율루프). 직전 배정의 남은 조각을 이어서 진행.

### 선행 PR #47 머지 완료

`gh pr merge 47 --merge` → **main `cc896a8`**, main CI 초록.
산출물 착지 확인: `lib/metrics/*`(7파일) · `api/cron/platform-metrics` · `014_platform_metrics_daily.sql`.
C5 `lib/analytics/` 무결(내 변경 0).

### 선행조건 해제 확인 — C1 메뉴

직전 배정에서 "`/platform` 화면은 C1 메뉴 확정 후"로 보류했던 항목이다. 실측 결과 **확정됨**:
`WorkspaceSwitcher.tsx` 에 `platformHref: "/platform"` 이 있고,
"platform 항목은 **서버 확인 capability** 와 href 가 함께 있을 때만 DOM 에 존재한다" 테스트가 있다.
→ 진입점이 배선됐으므로 보류 해제하고 지표 콘솔을 구현했다.

### 산출물

| 경로 | 내용 |
| --- | --- |
| `lib/metrics/read.ts` | 스냅샷 조회 + `groupByDay` |
| `app/platform/metrics/page.tsx` | 지표 콘솔(읽기 전용) |
| `platform/workspace-requests/page.tsx` | nav 에 "제품 사용 지표" 링크 1줄 추가 |

### 설계 판단

- **읽기에 service_role 을 쓰지 않는다.** 014 의 RLS 정책이
  `app_admin_role(auth.jwt()->>'email') is not null` 을 요구하므로 **로그인 세션 키(anon+쿠키)로
  조회하면 플랫폼 관리자에게만 행이 보인다**. service_role 은 배치 전용으로 남긴다 —
  읽기 경로에까지 그 권한을 끌어오면 RLS 이중방어가 무의미해진다.
- **상태를 3가지로 구분**한다: `not_configured`(DB 미연결) · `error`(조회 실패) · 집계 없음.
  실패를 빈 배열로 뭉개면 화면이 "데이터 0"으로 **거짓말**하게 된다. 오류는 사유를 노출하고
  "수치를 0으로 가정하지 않습니다"라고 명시한다.
- **DB numeric 문자열 방어** — PostgREST 가 `numeric` 을 문자열로 주는 경우가 있어 `toNumber` 로 정규화.
- 게이트는 `workspace-requests` 와 **동일 패턴**(미인증→`/login?next=`, 비관리자→`/workspace-entry?error=permission`).
- 화면 문구에 "고객사의 업무 내용·멤버 이름·고객 정보는 이 화면에 오지 않아요"를 명시 —
  집계 수치만 다룬다는 경계를 UI 에서도 재확인.
- 겸직자 중복 계상(파킹 3)을 숨기지 않고 화면에 문장으로 표기했다.

### 검증

`check.sh` 초록 — app **811** / worker **14** (read.test 3 신규).
`next build` 성공, `/platform/metrics` 라우트 등록 확인.

### 파킹 유지 (변동 없음)

1. **실DB 미검증** — `.env.local` 여전히 부재. 014 적용·RLS 판정·배치 왕복 **NOT_RUN**.
   이번 콘솔도 실데이터 렌더는 미확인(코드 경로만 검증).
2. **플랫폼 전역 고유 사용자** — 조직별 합산이라 겸직자 중복. 화면에 명시로 완화, 정확한 집계는 별도 쿼리 필요.
3. **TTFV 배치 미적재** — 일 단위 표에 코호트 지표는 부적합. 적재 위치 미정.
4. **공지 RLS 예외(DQ-0018)** — 기획 판정 대기.

**END** — `check.sh` 초록 · `next build` 성공 · PR 준비 완료.
## 2026-07-23 — [START · 머지 준비] T06 · PR #57 머지 대비 사전 정합

- 지시: T03 PR #57(T10 승인, 머지 진행 중) + belie 의 DB 마이그레이션 직접 적용 예고 → PR #50 머지 최종 준비.
- 신호를 기다리기 전에 **#57 내용 실측**으로 선행 정합 가능한 항목부터 처리했다.

## 2026-07-23 — [END · 머지 준비] T06 · 015 → 019 리넘버링 · 충돌 1건 예고 · 자기정정 1건

**1) ⚠ 자기정정 — "#57 이 BUG-0004 를 안 고친다"는 내 직전 판단은 틀렸다.**
`gh pr view 57 --json files` 결과가 **잘려서** `015_fix_org_helper_session_deadlock.sql` 이 목록에 안 보였고,
남은 016·017·018 헤더가 모두 "is_org_member() 무수정"이라 반대로 결론냈다.
실제 파일을 열어 확인한 결과 **#57 의 015 가 BUG-0004 정면 수정**이다 —
헬퍼 4종(`is_org_member`·`org_role`·`org_scope`·`is_protected_workspace_owner`)에서 세션 선행조건만 제거하고
006 의 fail-closed 강화(`status='active'` 2종)는 유지한다. `member_account_session_valid()` 자체는 남겨
member account 전용 RPC 에서 계속 쓴다(관심사 분리). → belie 판단이 맞았다.
교훈: `--json files` 는 잘릴 수 있다. **파일 목록만 보고 PR 내용을 단정하지 말 것.**

**2) 리넘버링 `015` → `019`.** #57 이 **015·016·017·018** 을 점유한다(`015_fix_org_helper_session_deadlock`
·`016_entry_request_dedup`·`017_fix_is_platform_admin_role_axis`·`018_platform_admin_direct_create`).
`feat/t01-c5-gap` 도 같은 015 파일을 들고 있다. 내 `015_notifications.sql` → **`019_notifications.sql`**,
헤더 주석과 `app_meta.schema_version` 도 `'019'` 로 동기화.
- 이번엔 선점이 아니라 **확정 정보 기반**이다(#57 은 T10 승인·머지 진행 중). 설령 #57 이 지연돼도 019 는 여전히 유효한 빈 번호라 손해가 없다.
- 번호 이력: `008`(main 007 기준 배정) → `015`(008~014 머지 확인 후) → `019`(#57 의 015~018 확인 후). 매번 **실측 시점의 최신 main/확정 PR 기준**으로만 움직였다.

**3) 적용 순서가 중요하다.** 내 019 의 `audit_select` 정책과 notifications RLS 는 전부 `is_org_member()`·`org_scope()` 위에 얹혀 있다.
→ **#57 의 015 가 먼저 적용돼야 한다.** 그 전에 019 만 적용하면 헬퍼가 상시 false 라 알림이 전부 빈 값으로 보인다(코드 결함 아님).
권장 적용 순서: `011 → 015(#57, BUG-0004 수정) → 016 → 017 → 018 → 019(알림)`.

**4) 머지 충돌 1건 예고.** `git merge-tree` 실측 결과 `app/src/app/(app)/layout.tsx` 가 **changed in both**
(#57 도 셸 레이아웃을 고친다). 나머지 파일은 겹치지 않는다.
직전 라운드에 T03 `WorkspaceSwitcher` 로 같은 파일을 한 번 해소해 본 건이라, 신호 오면 즉시 재해소 가능하다.
해소 원칙은 그대로: **#57 쪽 셸 구조를 살리고 내 `NotificationBell` 마운트만 얹는다**(🔔 자리 신설 금지).

**5) 신호 수신 시 실행할 절차**(사전 확정):
`fetch` → `rebase origin/main` → `layout.tsx` 재해소 → `check.sh` + `next build` → `force-push` → PR #50 `CLEAN` 확인.

- 참고: `supabase/tests/*.pglite.test.mjs` 하네스가 있으나 **`check.sh` 게이트에 미포함**이고 `@electric-sql/pglite` 도 미설치다.
  실DB 적용 전 019 를 드라이런하고 싶다면 이 하네스에 notifications 케이스를 붙이는 선택지가 있다(요청 시 작업).

## 2026-07-23 — [START · 재개] T06 · 재개 지시 대응 · 마이그레이션 번호 정합

- 재개 배정(알림 뱃지+소식창+notifications+Realtime)은 **PR #50 에 이미 전량 구현**되어 있다. 재구현하지 않고 **머지 가능 상태 유지**를 목표로 잡았다.
- main 이 3커밋 전진(`1744d9f`) → PR 브랜치 **리베이스**(충돌 0) → 게이트 재검증 → 푸시. PR #50 `MERGEABLE · CLEAN` 회복.

## 2026-07-23 — [END · 재개] T06 · 008 → 015 리넘버링(충돌 현실화 대응)

- **직전 라운드에 보고한 `008` 4중 충돌이 현실이 됐다.** 그때는 미머지 병렬 브랜치들의 예약 번호였으나, 지금 main 에는 `008_workspace_entry_self_route_state` … `014_platform_metrics_daily` 가 **모두 머지**돼 있다.
  → 내 `008_notifications.sql` 을 그대로 두면 `008_*` 가 **두 개** 공존해 문자열 정렬 적용 순서가 모호해진다.
- **조치**: `008_notifications.sql` → **`015_notifications.sql`** 로 리넘버링(main 최신 `014` 기준 다음 번호). 파일 내 헤더 주석과 `app_meta.schema_version` 값도 `'008'` → `'015'` 로 동기화.
  - 직전 라운드에 "선점 리넘버링은 하지 않는다(다른 브랜치가 안 들어오면 오히려 틀린 번호가 된다)" 고 판단해 보류했고, **실제로 머지된 것을 확인한 시점에** 정합을 잡았다. 판단 근거가 유지된 채 상태만 바뀐 케이스다.
- **선행 마이그레이션 간섭 실측**(008~014 전수):
  - `audit_logs` 를 건드리는 마이그레이션 **없음** → 내 `audit_select` 정책 교체(담당범위 반영)는 여전히 유효.
  - `009_workspace_entry_request_lifecycle` 이 `workspace_entry_request_shape_check` 를 **이미 교체**함. 내 마이그레이션은 해당 제약을 건드리지 않으므로(직전 라운드에 되돌림) 충돌 없음 — 그때 되돌린 판단이 여기서 이득으로 돌아왔다.
  - 009 에 `drop column`·`rename`·`add column` **없음** → 내 트리거가 쓰는 `workspace_entry_requests` 컬럼(`kind`·`status`·`target_org_id`·`requester_user_id`·`id`) 전부 온전.
- 과거 항목의 `008_notifications.sql` 표기는 append-only 원칙에 따라 **수정하지 않는다**(당시 사실 기록). 현재 정본은 `015_notifications.sql`.
- **파킹 유지**: 375px 브라우저 스냅샷 `NOT_RUN`(preview 도구가 세션 디렉터리를 기동해 격리 worktree 를 못 띄움). 대체 증거는 테스트로 고정됨.
- **다음 행동**: PR #50 검수 대기. 추가 구현·중복 PR 없음.

## 2026-07-23 — [START · 재배정] T06 · MWC 실행계획v1 재배정 대조

- 재배정 내용(뱃지 규칙·소식창 2탭·주어 표시·딥링크·묶기·notifications 신규·Realtime+60초 폴링·RLS/scope/조직격리·금액·개인정보 금지·가입요청→오너 숫자+승인화면 딥링크·375px)을 **기존 산출물과 1:1 대조**했다.
- 결론: **전 항목이 PR #50 에 이미 구현·머지대기**. 재구현하지 않는다(중복 작업·리베이스 충돌 유발).

## 2026-07-23 — [END · 재배정] T06 · 대조 완료 · PR #50 검수 대기 · 신규 리스크 1건 보고

**1) 착수 게이트 — 이미 충족.** "T03 셸 이후 착수" 조건의 T03 셸·스위처는 **이미 main 에 있다**
(`components/workspace/WorkspaceSwitcher.tsx`·`WorkspaceMark.tsx`·`shell/SidebarNav.tsx`·`nav-items.ts` 실측).
PR #50 은 그 위로 **이미 리베이스 완료**(base `e1a3a05`)이며 충돌 해소도 끝났다 — 상태 `MERGEABLE · CLEAN`.

**2) 재배정 요구사항 대조 — 전 항목 구현됨(PR #50).**

| 요구 | 상태 |
|---|---|
| 숫자=할 일(진입 무관)·점=안 본 변화·모두 읽음은 점만·99+ | ✅ `lib/notify/badge.ts` + **27 테스트** |
| 소식창 2탭 · 주어 표시 · 딥링크 2클릭 · 반복 묶기 | ✅ `components/notify/*`, `messages.ts`, `grouping.ts` |
| notifications 신규 · Realtime + 60초 폴링(팝업 금지) | ✅ `008_notifications.sql`, `NotificationBell.tsx` |
| RLS 우회 금지 · scope=assigned · 타 조직 혼입 0 · 금액/PII 금지 | ✅ `visibility.ts`(RLS 1차 + 앱 2차), 템플릿 고정 |
| 가입요청 → 오너 숫자 + `/settings/members/approvals` 딥링크 | ✅ definer 트리거(승인 화면 신규 생성 안 함) |
| 375px | ✅ 폭·스크롤 테스트 고정 / ⏸ 브라우저 스냅샷은 파킹(아래) |

**3) ⚠ 신규 리스크 — 마이그레이션 `008` 4중 충돌(보고).**
열린 브랜치 전수 조사 결과 `008_` 접두가 **4갈래**다:
`008_notifications.sql`(T06/이 PR) · `008_support_access_delegation.sql`(T08 PR #46) ·
`008_workspace_entry_self_route_state.sql`(PR #47·#48·#49·#51 **4개 브랜치 공통**, +009·010·011).
- 내 번호는 규칙(**최신 main 기준 배정**)을 따랐고 배정 시점 main 최신은 `007` 이었다 — 규칙 위반 아님.
- 그러나 미머지 병렬 브랜치가 같은 번호를 쥐고 있어, **머지 순서에 따라 008_* 3종이 공존**하면 문자열 정렬 적용 순서가 모호해진다(T10 이 이전에 보고한 `001_` vs `0001_` 혼재와 같은 계열).
- 파일명이 달라 git 충돌은 안 나므로 **조용히 통과할 수 있는 종류의 문제**라 미리 보고한다.
- 조치: **선점 리넘버링은 하지 않는다**(다른 브랜치가 안 들어오면 오히려 틀린 번호가 된다). 코디네이터가 머지 순서를 정하면 rename 1회로 즉시 정합 — 요청 시 바로 반영한다.

**4) 레인 변경 인지 — 회사 스위처.** 재배정에서 내 레인은 `notifications · 벨/소식창` 이고 **스위처는 T03(셸·스위처)** 이다.
직전 배정에는 "회사 스위처(다른 회사 건수)"가 내 수용기준에 있어 PR #50 이 `WorkspaceChooser.tsx` 를 건드렸다
(선택적 prop `badges` 추가 + 건수만 조회, 내용 미조회 — additive).
레인 기준으로는 경계 밖이므로 **T03/T10 판단에 맡긴다**: 유지하거나, 요청 시 해당 1파일만 되돌린다(나머지와 결합 없음).

**5) 파킹 유지.** 375px 브라우저 스냅샷 `NOT_RUN` — preview 도구가 세션 디렉터리(타 트랙 브랜치)를 기동해
격리 worktree 를 띄우지 못함. 대체 증거(`panelWidthAt(375)=351 < 375`, `min-h-0`+`overflow-y-auto`, Badge SSR 8건)는 반영됨.
머지 후 세션 트리에서 T10 촬영 요망.

**다음 행동**: PR #50 검수 결과 대기. 재구현·중복 PR 없음.

## 2026-07-23 — T05 · C5 PostHog 인수인계 — END

배정 2건 완료. `check.sh` 초록(앱 **736** PASS/5 skip · 워커 14) · `next build` 초록. 신규 analytics 테스트 포함 136 PASS.

**1) `useTrack` 훅** — `lib/analytics/useTrack.ts`
- 이벤트 이름·페이로드가 **타입으로 고정**된다(화이트리스트 밖 이름·미정의 필드는 컴파일 단계에서 차단). 런타임 `isAllowedEvent` 는 2차 방어선 — `any` 캐스팅 우회도 막는다.
- 훅을 못 쓰는 지점을 위해 동일 계약의 함수형 `track` 도 제공. 분석 비활성·SDK 미로드 시 조용히 무시(제품 코드가 분석 때문에 죽지 않는다).

**2) 커스텀 이벤트 3종** — `lib/analytics/events.ts`
- `deal_created`/`deal_moved`/`meeting_logged` 페이로드를 **id·enum·수량만** 받도록 타입 정의. 상호·이름·연락처·메모는 타입 단계에서 불가.
- 화이트리스트 **10종** = 커스텀 3 + SDK 7(`$pageview`·`$pageleave`·`$autocapture`·`$rageclick`·`$identify`·`$set`·`$snapshot`). SDK 7종은 실제로 켠 설정에서만 나오는 것으로 한정했다.
- `before_send` 를 `gateAndScrub` 로 교체 — **화이트리스트 게이트 → 스크러빙** 순서. 목록 밖 이벤트는 내용 정리 없이 즉시 폐기(null).

**수용기준 검증**
- 화이트리스트 외 발송 0: 허용 10종 전부 통과 + 미허용 12종(정의외 커스텀·survey·exception·대소문자/공백 변형·빈 문자열) 전부 null 확인.
- PII 페이로드 부재: 커스텀 3종 대표 페이로드의 키에 PII 조각(name·phone·email·memo·amount 등 19종) 0건, 값은 스칼라·64자 이하로 제한. 허용 이벤트에 PII 가 섞여도 스크러빙되는지 별도 검증.
- 리플레이 마스킹: `maskAllInputs` · `maskTextSelector "*"` · `[data-pii]` 블록 · 입력 마스킹 · 이중방어 `maskTextFn` · 폰트/교차출처 iframe 미수집 확인. 경로 제외는 `ReplayPathGate` 가 진입 시 `stopSessionRecording`, 이탈 시 재개.

**⚠ 경로 실측 정정**: `/account` 는 **회계가 아니라 "내 정보"**(→ `/settings/account` 리다이렉트)였다. 회계 전용 화면은 현재 저장소에 **없다**. 개인정보 화면이라 제외 근거는 유지하고 `/settings/account` 를 함께 추가했으며, `/hometax`(T08 대기)·`/settlements`(API 만 존재)는 화면 신설 시 자동 적용되도록 접두사를 미리 넣었다. 접두사는 경계(`/` 또는 끝)를 확인해 `/accounts`·`/account-settings` 는 휩쓸리지 않는다.

**🅿 파킹(블로커) — 커스텀 이벤트 UI 배선**
3종 이벤트를 실제로 발생시킬 **UI 호출부가 아직 없다**(실측: 클라이언트에서 `api/deals`·`api/activities` 호출 0건, `StageBoardView` 는 읽기 전용 서버 컴포넌트이며 주석에 "단계 이동은 후속" 명시). 딜 생성·이동·미팅기록 UI 신설은 이 배정의 스코프(useTrack + 이벤트 3종) 밖이라 만들지 않았다. → 해당 UI 를 만드는 트랙이 `useTrack()` 을 호출하면 그대로 동작한다. 다음 백로그로 이월.

**미검증**: 브라우저 런타임(실제 이벤트 전송·리플레이 동작)은 NOT_RUN — PostHog 키가 `.env.local` 에 없고(저장소에 `.env.example` 만 존재) 공유 트리는 타 트랙 브랜치라 preview 로 이 브랜치를 검증할 수 없다.

## 2026-07-23 — T05 · C5 PostHog 인수인계 — START

- 인수: 별도 "C5 PostHog" 세션 중단 → T05 가 이어받음. 브랜치 `feat/c5-posthog`(`0bdd5ba`) 실측 확인(`feat/t01-c5-analytics` 는 부재).
- 인계 상태: `lib/analytics/`(scrub·config·rewrites·env·client·배럴) + `PostHogProvider` + `/ingest` rewrites + proxy matcher 제외까지 구현됨(1315줄, 테스트 3파일).
- **미완 실측 2건**: (1) `useTrack` 훅 부재(grep 0건), (2) 커스텀 이벤트 3종 미배선 — `deal_created`/`deal_moved`/`meeting_logged` 가 테스트 문자열로만 존재하고 발송 경로 없음.
- 배정 범위(P2): 위 2건만. 스코프 추가 금지.
- 수용기준: 이벤트 10종 화이트리스트 외 발송 0 · PII 페이로드 부재 · 리플레이 마스킹(maskAllInputs·data-pii·회계/홈택스 경로 녹화 제외) 확인.
- base = origin/main `421c586` 위로 rebase 완료(무충돌).
## 2026-07-22 — [START · C2] T06 · 인앱 알림(뱃지 · 소식창)

- 지시: belie 직접(디스패치 경유 없음). 상단바 🔔 는 **이미 존재** → 자리 새로 만들지 않고 내용만 연결.
- 착수 전 실측: 🔔 는 `(app)/layout.tsx` L95-104 의 **inert `<div>`**(title="알림"만) · `SidebarNav` 에 `badges` 슬롯이 있으나 **숫자 전용**이고 레이아웃이 전달 안 함 · **셸 내 회사 스위처 없음**(전환은 `/workspaces` `WorkspaceChooser`) · 승인 화면 `/settings/members/approvals` **이미 존재**(owner 전용, 파라미터 없음) · `activities` 는 **딜 종속**이라 조직 피드 부적합, `audit_logs` 는 테이블·RLS 만 있고 **앱 코드 0** → 재사용 적합 · 앱 테스트는 **node 환경(jsdom·RTL 없음)**.
- 마이그레이션 번호는 추측하지 않고 실측(최신 `007`) → **`008_notifications.sql`**.

## 2026-07-22 — [END · C2] T06 · 인앱 알림 완료 · PR #27

- **핵심 계약 구현**: "봤다(read_at)"와 "했다(resolved_at)"를 **다른 컬럼**으로 분리.
  숫자=`is_action && resolved_at is null`(화면 진입으로 안 사라짐) · 점=미열람(진입 시 사라짐).
  ⚠️ 지시의 컬럼 목록에는 `resolved_at` 이 없었으나, `read_at` 하나로는 "화면만 열어도 할 일이 사라지는" 사고를 막을 수 없어 **추가**했다(계약 충족을 위한 필수 추가).
- **스키마 008**: `notifications`(+`resolved_at`) · `notification_surface_seen`(화면별 점 워터마크 — 행마다 read 찍지 않고 시각 하나로 판정) · `audit_logs` **재사용**(신설 안 함) + `audit_select` 정책 **교체**(기존은 `is_org_member` 만이라 assigned 멤버가 남의 딜 소식까지 봄. RLS 는 OR 합성이라 좁히려면 교체가 유일) · 가입요청 **definer 트리거**(오너 전원에게 숫자 알림, 처리 시 자동 resolve).
- **뱃지 테스트 27개로 계약 고정** — 특히 *화면 진입만으로 숫자 안 사라짐*, *모두 읽음=점만 제거·숫자 유지*, *처리해야 감소*, *99+ 절단*.
- **UI**: 기존 🔔 자리에 `NotificationBell` 연결 · 패널 2탭(내 알림/회사 소식) · 주어 필수 표기 · 반복행동 묶기(10분 창) · 딥링크 · [모두 읽음]/[전체 보기] · 사이드바 점/숫자 · 회사 스위처 건수(**건수만** 조회, 내용 미조회).
- **프라이버시**: 문구를 자유 조립이 아닌 **고정 템플릿+주어**로만 생성 — 금액·개인정보는 파라미터로 받지도 않는다. 템플릿 전수 숫자 미포함 테스트.
- **판단 기록 3건**:
  1. 딥링크 `deal → /boards/{id}` 는 **오답**(그 `[id]`는 **보드** id) → 404 위험. `/policyfund?focus=` 로 교정.
  2. 최상위 `/notifications` 라우트는 기존 가드 테스트가 **예약 slug 미등록**으로 정확히 차단. 예약 목록이 006 제약 2곳+함수 1곳+TS 1곳(**4중 복제**)이고 가드 테스트가 006 만 정본으로 읽어, 하드카피 동기화는 드리프트 위험(실제로 옮겨쓰다 join 절을 느슨하게 쓰는 실수를 1회 자체 검출). → **이미 예약된 `/settings/notifications`** 로 이동해 타 트랙 계약 무수정. 목록 단일화는 소유 트랙 몫으로 남김.
  3. 기존 🔔 는 `hidden sm:flex` 라 **375px 에서 보이지 않았다** → 수용기준(375px)과 충돌하므로 상시 표시로 교정.
- **검증**: `check.sh` 초록 — app **646** 통과(신규 notify 59) / worker 14, `next build` 성공(`/settings/notifications` 등록 확인).
- **파킹(블로커)**: 375px **브라우저 스냅샷 NOT_RUN**. preview 도구가 **세션 디렉터리**(현재 T09 브랜치)를 기동해 격리 worktree 의 내 변경을 띄우지 못함(실측 확인, 서버 즉시 정지). Bash 로 dev 서버 기동은 금지 규칙. → 대체 증거로 **폭 계산·스크롤 제약을 테스트로 고정**(`panelWidthAt(375)=351 < 375`, `min-h-0`+`overflow-y-auto`) + Badge SSR 렌더 테스트 8건. T10 이 세션 트리에서 머지 후 스냅샷 촬영 요망.

## 2026-07-28 — T04 · C4 인수: 지표 순수함수 + platform_metrics_daily 야간 배치

**START** — 2026-07-28 KST. 배정: MWC「T04 C4 계속, P2」. 자율루프.
범위: 순수 메트릭 함수 + 야간 배치 롤업. **`/platform` 화면은 C1 메뉴 확정 후 → 이번 범위 제외.**

### 인수인계 실측 (C4 → T04)

- `git fetch --all` 후 원격에 **C4 브랜치 없음**(`feat/c4-*`·`*admin*` 0건) → C4 미푸시로 판단, 신규 구현.
- sync 라운드의 "C4" 매칭은 전부 **해시 문자열 일부**였다(`…5CC7DBC6604CE8C4`). 실제 C4 세션 기록 없음.
- 기준 main = `421c586`. 워크트리가 12커밋 뒤처져 있어 최신 main 에서 `feat/c4-admin-metrics` 분기.
- 참조 문서 실재 확인: `docs/coordination/sync/ROUND-18.md`, `docs/design/round-21/03-p0-authz-contract.md`,
  `supabase/migrations/005_app_admins.sql`(`app_admin_role`), `app/src/lib/auth/admin.ts`.

### 설계 판정 — 왜 스냅샷인가 (실시간 집계 금지의 근거)

P0-AUTHZ-CONTRACT 를 읽고 **전 조직 실시간 집계는 구조적으로 불가**라고 판정했다.

- `O5` — 플랫폼 권한은 tenant RLS 를 우회하지 않는다.
- 공격테스트 `11` — Platform-only 사용자의 tenant table SELECT 는 **0**이어야 한다.

→ 콘솔이 전 조직 `activities`/`deals` 를 실시간으로 훑으면 이 경계를 넘는다.
따라서 **배치만** service_role 로 집계하고, 결과는 **개인정보 없는 수치만** 표에 남기며,
콘솔은 그 표만 읽는다. 배정의 "실시간 집계 금지 유지"와 P0 계약이 같은 결론이다.

기존 세션 배선이 이미 계약을 지키고 있음도 확인했다 — `session.ts` 는 `isPlatformAdmin` 을
별도 축으로 두고 `role` 을 membership 값 그대로 쓴다(§11 이 금지한 `role = platformRole ?? membership.role` 합성 없음).

### 산출물

| 경로 | 내용 |
| --- | --- |
| `lib/analytics/types.ts` | `ActivityEvent`·`Stickiness`·`DormancyVerdict`·`TtfvEntry`·`DailyRollup` |
| `lib/analytics/metrics.ts` | 스티키니스(DAU/MAU) · 휴면 · TTFV **순수 함수** |
| `lib/analytics/rollup.ts` | KST 하루 경계 + 하루치 롤업 계산 + 플랫폼 합계 |
| `lib/analytics/batch.ts` | `MetricsSource`/`MetricsSink` 포트 + 배치 러너(I/O 없음) |
| `lib/analytics/batch-supabase.ts` | service_role 어댑터 (서버 전용) |
| `api/cron/platform-metrics/route.ts` | 야간 배치 엔드포인트 |
| `014_platform_metrics_daily.sql` | 스냅샷 테이블 + RLS + 멱등 upsert RPC |
| `app/vercel.json` | cron 등록 (`0 19 * * *` UTC = KST 04:00) |

설계 결정 몇 가지를 코드에 고정했다.

- **순수성**: `new Date()` 를 내부에서 부르지 않고 `asOf` 를 인자로 받는다 →
  야간 배치(과거 날짜 백필)와 화면이 **같은 코드**를 쓴다.
- **휴면 ≠ 미활성**: 활동 이력이 한 번도 없는 사용자를 `neverActive` 로 분리했다.
  온보딩 실패와 이탈은 대응이 다르므로 한 수치로 뭉개지 않는다.
- **TTFV 편향 방지**: 미도달 건을 중앙값·평균에서 제외하되 `reachRate` 를 항상 함께 반환한다.
  도달한 것만 평균내면 낙관 편향이 생긴다.
- **이상 데이터 무음 처리 금지**: 파싱 불가 시각은 건너뛰고, 도달<기산점인 음수 소요시간은
  0 으로 클램프하지 않고 `pending` 처리한다.
- **부분 실패 정직 보고**: 한 조직이 실패해도 배치는 계속하되 **0 행으로 채우지 않고**
  `failures` 로 돌려주며, 라우트는 207 로 응답한다(200 으로 감추지 않는다).
- **인증 미설정 시 거부**: `CRON_SECRET` 이 없으면 503. 인증 없이 전 조직을 훑는 경로를 열어 두지 않는다.

### 수용기준 대조

| 기준 | 결과 |
| --- | --- |
| 더미 데이터 **수동 카운트**와 롤업 결과 일치 | **PASS** — `rollup.test.ts` 의 "수용기준" describe. 멤버 5명·이벤트 9건(시스템/타조직/깨진시각 잡음 포함) 픽스처를 손으로 세어 DAU 2 · MAU 4 · stickiness 0.5 · 활성 4 · 휴면 1 · 신규딜 2 를 기대값으로 못박고 전체 행 `toEqual` 로 고정 |
| 테스트 초록 | **PASS** — analytics 67개 신규(metrics 36 · rollup 20 · batch 11). 전체 `check.sh` 초록 = app **667** / worker **14** |
| `/platform` 화면 제외 | 준수 — UI 미착수 |
| 실시간 집계 금지 유지 | 준수 — 콘솔용 실시간 경로를 아예 만들지 않았다 |

`next build` 성공, `/api/cron/platform-metrics` 라우트 등록 확인.

### 파킹 (블로커 — 다음 백로그로)

1. **실DB 미검증** — `.env.local` 부재(`ls .env*` = `.env.example` 만). 014 적용·RPC 호출·RLS 판정은
   미실행. 순수 함수와 배치 로직은 인메모리 포트로 전량 검증했으나 **DB 왕복은 NOT_RUN**.
2. **마이그레이션 번호 = `014`** — 최초에 `009` 로 잡았으나 rebase 해 보니 main 이 그 사이
   `009_workspace_entry_request_lifecycle` ~ `013_member_hierarchy_authz` 를 추가해 **번호가 충돌**했다.
   `014_platform_metrics_daily.sql` 로 재배정했다(코드 주석 참조도 함께 정정).
   → 교훈: 마이그레이션 번호는 **푸시 직전 최신 main 기준으로 다시 확인**해야 한다.
   P0 계약 §8.5~8.6 의 "008+/009+" 는 논리 단계명이며 실제 번호와 무관하다(§2 가 재배정을 허용).
3. **플랫폼 전역 고유 사용자 미지원** — `platformTotals` 의 `dauSum` 은 조직별 고유 사용자의 단순 합이라
   한 사람이 두 조직에 속하면 중복 계상된다. 전역 고유 집계는 조직 경계를 없앤 별도 쿼리가 필요하다.
   현재는 오해 방지를 위해 필드명을 `dauSum` 으로 두고 주석에 명시.
4. **TTFV 배치 미적재** — 순수 함수(`ttfv`/`ttfvSummary`)는 완성했으나 `platform_metrics_daily` 는
   일 단위 표라 코호트 지표를 담기 부적절하다. 적재 위치(별도 표 or 온디맨드)는 화면 요구 확정 후 결정.

### rebase 중 발견 — `lib/analytics` 디렉터리 충돌 (해소)

PR 생성 후 main 이 진행돼 rebase 하다가 **C5(PostHog)가 이미 `app/src/lib/analytics/` 를
점유**한 것을 발견했다(`index.ts` add/add 충돌). 배정 문구가 "`lib/perf/` 또는 `lib/analytics/`
하위"였는데 실제로는 **둘 다 선점**돼 있었다 — `perf`=T07(매출 성과), `analytics`=C5(이벤트 수집).

같은 디렉터리에 성격이 다른 두 모듈을 섞으면 배럴 `index.ts` 가 영구 충돌 지점이 되므로
내 모듈을 **`app/src/lib/metrics/`** 로 분리했다. `analytics/index.ts` 는 C5 원본으로 되돌렸다.

| 모듈 | 소유 | 성격 |
| --- | --- | --- |
| `@/lib/analytics` | C5 | 이벤트 **수집**(PostHog SDK·스크러빙·리플레이) |
| `@/lib/perf` | T07 | **매출** 성과(정산·리더보드) |
| `@/lib/metrics` | T04(C4) | 사용 지표 **집계**(스티키니스·휴면·TTFV) |

`metrics/metrics.ts` 는 경로가 중복돼 `metrics/compute.ts` 로 이름을 바꿨다.
Vercel 배포 실패 1건도 해소했다 — `vercel.json` 스키마가 추가 속성을 거부하는데
설명용 `_comment` 배열을 넣은 것이 원인이었다(주석은 cron route 헤더로 이동).

**END** — 2026-07-28 KST. `check.sh` 초록 · `next build` 성공 · PR #47 생성.
다음: rebase 후 CI 재확인. `/platform` 화면은 C1 메뉴 확정 대기.


## 2026-07-23 — MoaWork Control · OAuth 조직 프로비저닝 장애 수정 진행

- 프로덕션 Google 로그인 후 `login?error=provisioning`을 재현하고 Supabase Auth·REST·Postgres 로그와 정책·트리거 상태를 읽기 전용으로 대조했다.
- OAuth와 사용자 upsert는 성공했으나 `POST /orgs?select=id`가 `42501`로 롤백되는 것을 확인했다. INSERT 정책이나 owner 트리거 부재가 아니라, `insert().select()`의 RETURNING 행이 owner 멤버십 생성 전에 SELECT RLS를 평가하는 실행 순서 충돌이었다.
- 조직 UUID를 애플리케이션에서 먼저 생성하고 표현 응답 없이 삽입하도록 콜백을 수정했다. RLS와 owner 자동생성 트리거는 그대로 유지했다.
- 회귀 테스트 1건을 추가했다. `scripts/check.sh` PASS(app 472 passed / 5 skipped, worker 14 passed), Next.js 프로덕션 빌드 PASS를 확인했다.
- PR·GitHub 체크·Vercel Production 배포와 동일 계정 재로그인은 아직 진행 중이며, 운영 완료로 과장하지 않는다.

## 2026-07-23 — MoaWork Control · 루트 AGENTS 지침 정합화

- 최신 GitHub `main`을 다시 대조해 `c1e8ffd`(PR #15 병합), 열린 PR 0건을 확인했다. 로컬 canonical `main`은 `e774a45`로 1커밋 뒤라 공유 checkout을 갱신·수정하지 않고 최신 `origin/main` 기반 독립 문서 worktree를 만들었다.
- 루트 `AGENTS.md`가 폐기된 `session-registry.yaml`·`dispatch-queue.yaml` 사용을 요구하는 documentation drift를 확인했다.
- `AGENTS.md`를 최신 Markdown ROUND 정본 규칙, T01~T10 역사 식별자, 필요 시 생성하는 범용 DEV-1~3, 독립 T10, 단일 writer·file lease, `wip/*` 보존, 코드·운영 완료 분리 검증 체계로 정합화했다.
- controller·writer·lease·OAuth 운영 검증 잔여 상태는 `docs/coordination/sync/ROUND-3.md`에 기록했다.
- 비밀값은 기록하지 않았다. `scripts/check.sh` PASS(app 471 passed / 5 skipped, worker 14 passed)와 의도한 3파일만 변경·문서 삭제 0건을 확인했다.
- PR [#16](https://github.com/bbelieff/moawork/pull/16): GitHub CI·GitGuardian·Vercel Preview·Preview Comments 전부 PASS, mergeable. T10 문서 게이트 `PASS / MERGE AUTHORIZED`; 병합 후 이 작업을 END로 닫는다.

## 2026-07-23 — Codex-Failover-Control · Claude 소진 인수 START

- belie가 Claude 주간 사용량 소진과 Codex 인수를 명시 승인했다.
- GitHub main `613cc67`, 열린 PR 0건, `origin/wip/t03-oauth` 존재를 다시 실측했다.
- 기존 `서울리드프로젝트/모아워크`는 원격·커밋 없는 기획 작업본으로 보존하고, 새 `moawork-canonical` 클론을 사용한다.
- 활성 writer는 `Codex-T03-OAuth` 하나로 제한한다. 보존 WIP에서 새 Codex 전용 worktree로 승격하고 T10 검증 후 PR·배포한다.
- 상세 controller·writer·file lease·수용기준은 `docs/coordination/sync/ROUND-2.md`가 정본이다.

## 2026-07-23 — Codex-T03-OAuth · B1b 구현 및 로컬 T10 게이트 PASS

- Claude 보존 브랜치 `origin/wip/t03-oauth`를 최신 main 위의 격리 브랜치 `feat/codex-t03-oauth`로 승격하고, 선언되지 않은 TanStack provider·Tailwind 설정은 최종 범위에서 제외했다.
- `@supabase/ssr` 기반 브라우저/서버/Proxy 세션, Google 1차 CTA, PKCE 콜백, 로그아웃을 배선했다. 콜백은 `public.users` 프로필을 보강하고 `app_admin_role()` 결과가 있는 최초 계정에 owner 조직을 재시도 안전하게 만든다.
- 세션 구현은 Supabase 환경에서 `auth.getUser()`와 실제 `org_members`만 신뢰한다. 운영에서는 dev-session 버튼과 `?as=` 역할 오버라이드를 렌더·적용하지 않으며, Supabase 환경변수 누락 시 비공개 경로를 fail-closed 처리한다.
- 오픈 리다이렉트 방어 테스트를 추가했다. 비밀값은 커밋하지 않았고 환경변수 이름만 사용한다.
- 로컬 T10: `scripts/check.sh` PASS — app **471 passed / 5 skipped**(실DB 자격증명 없는 RLS 침투), worker **14 passed**. Next 16 프로덕션 빌드 PASS(22 static page generation, 전 라우트 수집).
- 프로덕션 서버 렌더 실측: `/login` 200, Google CTA=true, 개발 계정 라벨=false, 데모 이메일=false. Supabase env 없는 비공개 `/?as=owner`는 `/login?error=config` 307로 차단.
- 잔여: PR 검수·main 머지·Vercel 배포 뒤 실제 Google 계정 선택→콜백→owner/플랫폼관리자 세션을 라이브 판정해야 최종 완료다.
- PR [#15](https://github.com/bbelieff/moawork/pull/15) 생성. GitHub CI·GitGuardian·Vercel Preview 전 체크 PASS, mergeable. T10 브랜치 후보 판정은 `docs/coordination/T10-gate-checklist.md` §11에 기록했다.

## 2026-07-22 — T05 · B3 상태컬럼 UI · board_views CRUD · 003 검증엔진 단일화

브랜치 `feat/t05-b3-status-views` (base=main `14a1c91`). check.sh 초록 — 앱 **338** 테스트(+29).

**지시 문서 부재**: 배정이 가리킨 `docs/coordination/next-prompt_B2-B7.md` 가 **전 ref·전 워킹트리·디스크 어디에도 없음**(DQ-0011 때 003/T02b 지침 부재와 동일 패턴). 지시 메시지의 요약을 스펙으로 삼아 진행했고, 요약의 전제 2건을 실측으로 정정했다:
- ❗ **"004 스키마의 board_views"** → 004 마이그레이션은 **존재하지 않음**. `board_views` 는 **003_boards_engine.sql:73** 에 이미 있고 main 에 랜딩됨. 새 마이그레이션 없이 003 위에 구현(스키마 무변경).
- ❗ **"status 컬럼"** → 001 `field_type` enum 13종에 `status` 는 **없다**. 먼데이 상태 컬럼 = `select`/`multiselect` 를 **색 칩으로 렌더**하는 표현 문제이며 색 출처는 `FieldOption.color`. 스키마 변경 불필요.

**(1) 003 통합 followup — 검증 엔진 단일화** (기획2 판정 이행)
- `lib/boards/cells.ts` 를 자체 구현 → **T05 레지스트리(`lib/custom/field-types`) 위임 어댑터**로 전환. 2중 구현 제거.
- 구 `normalizeCellValue`/`validateAgainstOptions` **제거** — 형식 오류를 조용히 null 로 수렴시켜(데이터 유실) 관대 정책과 배치. 대체 = `validateCell() → {ok, value, error}`.
- 위임 과정에서 **엔진 쪽 실제 결함 2건**을 발견해 엔진에서 교정(보드 파리티 복원 + 커스텀필드도 동시 수혜):
  - `number` 가 `"1,200,000"`·`"₩1,200,000"` 을 거부 → 천단위/통화기호 허용.
  - `date` 가 입력을 10자로 잘라 ISO 일시(`2026-08-01T00:00:00Z`)를 형식오류로 처리 → ISO 날짜부 수용. **달력 검증은 유지**(`2026-02-30`·`2026-13-01` 은 계속 거부 — 구 boards 는 롤오버로 통과시켜 잘못된 날짜를 저장했다).

**(2) setValues 검증 훅 — 관대+인라인 / 무결성 엄격**
- `BoardsService.validateValues()` 가 쓰기 경로 단일 관문. 통과분만 저장, 실패분은 `errors[]` 로 반환(throw 아님). 한 셀이 틀려도 **나머지는 저장**되고 **기존 값은 null 로 덮이지 않는다**.
- 예외: `isIntegrityField`(exec_amount·fee_pct·fee_paid_at)는 정산 generated column 의존 → 하드 거부(throw).
- `setCells` 반환이 `ItemWithValues` → `{item, errors}` 로 변경(인라인 피드백 지면 확보).

**(3) status 컬럼 UI**
- `lib/boards/status-palette.ts` — 옵션 색 해석(지정색 우선 → id 해시 기반 **결정적** 팔레트 배정), hex 정규화, WCAG 명암비/글자색 선택, 더미 상태 옵션(시드 확정 시 더미만 제거).
- `components/boards/StatusCell.tsx` — `StatusPill`/`StatusCell`(읽기, 고아 값은 회색 칩+id 노출로 가시화)·`StatusSelect`(편집, 선택 색을 컨트롤에 적용). `GenericBoardTable` 배선.
- **접근성 실측 교정**: 칩은 작은 텍스트라 AA 4.5:1 필요. 먼데이 원색 red/blue/purple/teal 은 흰·검 **어느 글자색으로도 4.5 미달**(최대 ~4.1)이라 hue 유지한 채 어둡게 조정. 명암비 property 테스트가 회귀를 잡는다.

**(4) board_views CRUD API** (003 기반, 마이그레이션 없음)
- 포트에 `getView`/`updateView` + `ViewPatch` 추가(전용 BoardsRepo 포트 — T03 공용계약 `lib/repo/index.ts` 무변경), local 어댑터 구현.
- 서비스: `listViews`/`getDefaultView`/`createView`/`updateView`/`deleteView`.
- 기본 뷰는 T05 `pickDefaultView` **재사용**(2중 구현 금지) — shared 우선 → name ASC → id ASC (기획2 OQ-4 재판정).
- 라우트: `GET|POST /api/boards/[boardId]/views` (`?default=1`), `PATCH|DELETE /api/board-views/[viewId]`. `lib/boards/http.ts` 로 boards 에러→상태코드 매핑(400/401/404/409).

**⛔ 미착수 — 하위아이템(subitems): 스키마 부재로 차단**
003 `items` 에 `parent_item_id` 가 **없다**(전문 확인). 하위아이템은 마이그레이션이 필요한데 ADR-0002 규칙상 **스키마 정본은 기획 세션이 단독 작성**하므로 T05 가 쓰지 않는다. → `DQ-0013` 으로 기획에 요청 등록. 나머지 3건은 스키마 무변경으로 완료.

## 2026-07-21 — T03 · B1 앱 셸 v0.3 + 브랜드 토큰 + 관리자 자동부여(4b) + RLS 침투테스트 하네스

브랜치 `feat/t03-shell-auth` (격리 worktree). check.sh 초록 + `next build` 성공.

**입력 자산 실측**: 지시서가 가리킨 `docs/design/UI목업_모아워크셸_v0.3.html`·`brand/assets/...` 는
앱 레포(전 브랜치)에 **없었고**, 기획 워크스페이스
`C:/Users/belie/Desktop/Belief/서울리드프로젝트/` 에 존재했다(remote 없는 별도 로컬 레포,
`chore/day0-harness`). 거기서 **무수정 복사**해 앱 레포로 반입.

- **디자인 토큰**: `design-tokens.md §1` 정본을 `app/src/app/globals.css` 에 투입(`--mw-*`).
  원본 `moawork-color-tokens.css` 는 `app/src/styles/` 에 사본 보존(동기화 대상).
  컴포넌트는 hex 하드코딩 0 — 전부 `var(--mw-*)` 참조. Tailwind `@theme inline` 매핑 추가.
- **로고**: 락업/심볼 light·dark SVG → `app/public/brand/`, 파비콘·PWA 아이콘 → `app/public/icons/`.
  `components/brand/Logo.tsx` 의 `Logo`/`Symbol` 이 CSS(.mw-only-light/dark)로 테마 자동 전환
  (JS 리렌더 없음). 최소너비 규칙(락업 120px·심볼 16px) 반영.
- **제품명**: `PRODUCT_NAME` = **"MoaWork"** (design-tokens §5 / O1·DI-2 확정, 기존 "모아워크" 교체).
- **앱 셸**: `(app)/layout.tsx` 1단 사이드바 232px(11메뉴, 목업 IA 1:1) + 상단바(검색·알림·다크토글).
  메뉴 잠금은 **서버 엔타이틀먼트 판정**을 사이드바로 내려 표시. 라우트 없는 메뉴는 "준비 중"
  비활성(타 트랙 화면 침범 금지).
- **다크/라이트**: `data-theme` + `prefers-color-scheme`. root layout 인라인 스크립트로 FOUC 차단,
  `ThemeToggle` 은 `useSyncExternalStore` 로 DOM·미디어쿼리를 구독(state 복제 없음 →
  OS 테마 변경도 즉시 반영).
- **4b 관리자 자동부여**: `lib/auth/admin.ts` — `resolveAdminGrant(email, rpc?)`.
  실DB 의 `app_admin_role()` RPC 가 있으면 우선, 없으면 005 seed 와 동일한 폴백 allowlist.
  RPC 가 명시적 null 이면 폴백으로 뒤집지 않는다(권한상승 방지), RPC 실패는 폴백(로그인 유지).
  `Ctx.isPlatformAdmin` 추가(선택 필드, additive). 테스트 15건.
- **RLS 침투테스트**: `lib/auth/rls-penetration.test.ts` — 조직A→조직B의 companies/deals/orgs
  SELECT=0건 + member/assigned 본인 담당만. **fetch 로 PostgREST 직접 호출**(supabase-js 는
  어느 워크스페이스에도 선언 안 된 팬텀 의존성이라 회피). 크리덴셜 없으면 skip.
- **마이그레이션 동기화**: `004_gaps_and_leadin.sql`·`005_app_admins.sql` 반입(무수정).
  앱 레포에 없어 4b 근거가 비어 있었음.

**미완(정직 보고)**
- 수용기준 "다른 조직 데이터 절대 안 보임(실DB RLS)" — **미검증**. 크리덴셜 부재로 테스트가 skip.
  → `docs/coordination/decision-inbox.md` DI-A2 로 요청.
- 구글 OAuth 실동작 — Google Cloud 클라이언트·redirect 등록이 belie 액션(DI-A1). 코드는 dev-session 폴백 유지.
- **런타임 클릭스루 미실행** — `preview_start` 가 세션 cwd(메인 워킹트리, 타 트랙 브랜치)를 잡아
  내 브랜치를 띄우지 못했고 3000 포트도 타 트랙 점유. 대신 `next build` 성공으로 라우트·RSC·
  클라이언트 경계까지 검증. **완료 판정은 T10 클릭스루 스모크 이후.**
- Vercel 배포 반영 — main 머지 후.


## 2026-07-21 — T01 · B0 Vercel 워크어라운드 회수 (Install Command 오버라이드 제거·정식화)

- **원인 규명**: `app/tsconfig.json` 의 `include: ["**/*.ts"]` 가 `app/vitest.config.ts` 를 타입체크
  대상에 포함하는데, 그 파일이 `vitest/config` 를 import 함. 그런데 `vitest` 는 **루트 devDeps 에만**
  있고 app 워크스페이스에는 선언되어 있지 않았음 → app 을 단독 설치하는 Vercel 빌드에서 모듈
  해석 실패 → 임시로 Install Command 오버라이드
  (`npm install --prefix=.. && npm install --no-save -D vitest`) 를 넣어 우회하던 상태.
- **조치 = (A)안 채택**: `app/package.json` devDependencies 에 `"vitest": "^2.1.9"` 추가.
  루트와 **동일 스펙**이라 npm 이 단일 버전(2.1.9)으로 dedupe — 중복 설치 없음(설치 패키지 수 불변 422).
  (B)안(tsconfig 에서 `vitest.config.ts` exclude)은 설정 파일을 타입검사에서 빼는 회피책이라 미채택 —
  vitest.config.ts 를 계속 타입 보호 대상으로 유지하는 편이 정식화에 부합.
- **검증**:
  - `bash scripts/check.sh` **초록** — lint + typecheck + test(app 309/23파일, worker 1).
  - **Vercel 상황 재현**(핵심): app 트리를 워크스페이스 루트 없이 복사 → 오버라이드 **없이**
    기본 `npm install`(396 패키지) → `npm run typecheck` **exit 0** → `npm run build`
    **exit 0(21 라우트)**. 즉 기본 Install Command 로 빌드 green 이 성립함을 로컬에서 확인.
- **경계 준수**: app 워크스페이스만 수정. `worker/`·`supabase/` 무수정(diff 로 확인).
  루트 `package-lock.json` 은 워크스페이스 공용 lockfile 이라 함께 갱신됨(app→vitest 기록).
- **남은 것(레포 밖 · 디스패치/Cowork 소관)**: Vercel Project Settings → Build →
  **Install Command 오버라이드 삭제 후 기본값 복귀**. 이 커밋이 main 에 머지된 **뒤에** 해제해야
  안전(먼저 지우면 머지 전까지 빌드 실패). 이후 기본설정 빌드 green + www.moa-work.com 정상 확인.
- 브랜치 `feat/t01-vercel-install-fix` — main 직행 없이 **T10 검수 대기**(다중 세션 규칙).

## 2026-07-22 — T07 · B5 KPI 리더보드 + 이달의 계약회사 (집계·위젯 선구현)

- 브랜치 `feat/t07-perf-leaderboard-b5` (base `cdf45f6`). DQ-0017.
- **집계 엔진**(`app/src/lib/perf/aggregate.ts`, 순수 함수 · I/O 없음)
  - 귀속월 = `settlements.fee_paid_at`(수납일). `fee_paid_at=null` 인 **미실현 정산은 제외**(설계 §2.1).
  - 담당자 귀속 = `settlement.deal_id → deal.assigned_to`. 담당자/딜이 없는 건은 **미배정 버킷**으로 모아 순위에서 제외하되 조직 합계에는 포함.
  - 지표: 수납건수 · 실행액 합계(`exec_amount`) · 수수료 합계(`fee_amount`). `fee_amount` 는 001 generated column(이미 round)이라 **앱에서 재반올림하지 않는다**.
  - 순위: 동점은 순위 공유 후 건너뜀(1,2,2,4). tie-break = 수수료 → 실행액 → 건수 → 이름.
  - 이달의 계약회사: 같은 모집단을 `deal.company_id` 로 묶어 수수료 내림차순, 1위를 `top` 으로. 고객사 미연결 건도 별도 행으로 보존(합계 정합).
  - 월 경계(`monthRangeKst`)·구간 판정(`inRange`)은 **T04 core.dash 헬퍼 재사용** — 대시보드와 "이번 달"이 어긋나지 않도록 재작성 금지.
- **조립 계층**(`lib/perf/service.ts`): `@/lib/repo` 포트만 의존. 표시명은 전역 `listUsers()` 가 아니라 `listMembers(orgId)` 를 거쳐 조회(타 조직 사용자 유출 방지).
- **위젯**(`app/src/components/dashboard/perf-widgets.tsx`, 프레젠테이션 전용): `LeaderboardWidget`, `MonthlyContractCompanyWidget`. 0건이면 '—'/빈 상태(NaN·빈화면 금지). 포맷터·컨테이너는 T04 `@/lib/dash/format`·`Widget` 재사용.
- 검증: perf 24 테스트 신규(집계 16 + 서비스 8). `bash scripts/check.sh` 초록 — app 333 통과(25 파일) · worker 1 통과.
- **배선 상태**: 화면 라우트에 아직 연결하지 않았다. `getRepo()` 구현체가 현재 LocalRepo(인메모리)이므로, **B2 가 Supabase 어댑터로 교체하면 service 코드 수정 없이 실 DB 로 전환**된다(어댑터 스왑). 정렬 토글·월 선택기 UI 는 배선 시 추가.
- 지시문서 `docs/coordination/next-prompt_B2-B7.md` 는 **전 브랜치·전 히스토리에서 발견되지 않았다**(T09 RQ-0009 와 동일 관측). 프롬프트 요약본을 근거로 착수했다.
- ⚠ 위젯 경로가 지시대로 `components/dashboard/` 라 T04 의 `components/dash/` 와 이원화됐다. 통합 여부 T10 판정 요망.
- 남은 DQ-0007 범위(인센티브 규칙 평가 · `performance_snapshots` 영속화 · 활동량)는 설계 §6 정책결정 4건 확정 후 진행.

## 2026-07-21 — T02 · B2 core.crm Supabase 소스 + 단계 보드 3종 라우트 (PR #9)

- 브랜치 `feat/t02-crm-supabase` (main 4367015 기반 — 지시된 cdf45f6 은 그 조상이라 최신 main 사용).
- **배정 지시서 부재 보고**: `docs/coordination/next-prompt_B2-B7.md` 가 전 ref·워킹트리에 없다.
  프롬프트 본문 요약 + 정본(001/002)만으로 착수 — 스키마 추측은 하지 않았다.
- **Supabase 실연결** `lib/repo/supabase/`: 환경변수 클라이언트(미설정 시 null·로컬 폴백) +
  001 테이블 직결 `SupabaseCrmSource` + `getCrmSource()` 팩토리. 담당범위를 쿼리단에 이식.
- **설계 판단**: 공용 `Repo` 는 **동기**라 네트워크 DB 구현 불가. 계약 파일은 T03 단독 소유이므로
  별도 **비동기 포트 `CrmSource`** 를 두고 시그니처를 1:1 로 맞췄다(Promise 래핑만 차이).
  → T03 판단 요청: 공용 포트 비동기 전환 여부(전환 시 단일 선행 PR).
- **보드 = stage_kind 필터 뷰**(새 테이블 없음): `stageBoards.ts`/`boardData.ts` +
  `(app)/{newcust,contract,work}` + `StageBoardView`.
- ⚠️ **명명 확인 요청**: 지시서의 `/contract`="컨텍관리" 인데 002 시드상 컨텍관리=kind `meeting`,
  `contract` kind 는 별개 단계(계약). 보드 **이름**을 정본으로 보고 meeting 에 묶음(한 줄로 교체 가능).
- 게이트: `check.sh` 초록(앱 337 테스트·신규 28 + 워커 1), `next build` 로 3개 라우트 등록 확인, 회귀 0.
- 한계(후속): 딜 상세 `/deals/[id]` 미구현이라 카드 링크를 걸지 않음(404 방지) · 드래그 이동 미포함 ·
  Supabase 실계정 스모크 미실시(환경변수 부재).

## 2026-07-21 — T06 · worker Phase 2 알림 발송 스캐폴드(스텁)

- 배정: B2-B7 배치의 T06 파트(worker Phase 2 스캐폴드). ⚠️ 지시된 `docs/coordination/next-prompt_B2-B7.md` 는 **저장소 전 ref·워킹트리·히스토리 어디에도 부재** — 지어내지 않고 배정 프롬프트의 요약(잡 스텁 / 발송 인터페이스 / 독립 작업)만을 근거로 착수. DQ-0011·DQ-0014 와 동일 패턴이라 dispatch 에 보고.
- 산출물 `worker/src/notify/`:
  - `types.ts` — 채널·`NotifyMessage`·`SendResult`(+`sendOk`/`sendFailed`). 정본 `message_channel`(alimtalk/sms)과 배정이 요구한 email 을 **구분**해 타입화(`isSchemaChannel`).
  - `provider.ts` — `NotificationProvider` 포트(이메일/SMS/알림톡 공통) + `resolveProvider`, 영속성 포트 `MessageLoader`/`MessageStatusSink`.
  - `providers/stub.ts` — `StubProvider`(무해·비발송). 벤더 미정(DI-5)이라 실 구현체 없음.
  - `job.ts` — 큐명 `notify.send`, 페이로드 검증(`isNotifySendJobData`), `processNotifyJob`. **재시도 의미론**: 일시 오류=throw(pg-boss 재시도), 영구 오류=failed 종결.
  - `register.ts` — `createQueue`(retryLimit 3·backoff) + `work` 등록. **pg-boss v10 확인 반영**: 핸들러가 잡 **배열(batch)** 을 받고 `createQueue` 가 필수(v9 암묵 생성 없음).
  - `pending.ts` — 미구현 DB 어댑터. 로더가 항상 null → 잡이 들어와도 **실발송 0건**(오발송 원천 차단).
- `worker/src/index.ts` 의 `TODO(후속 트랙)` 자리에 `registerNotifyWorker` 배선.
- 검증: `bash scripts/check.sh` **초록** (app 309 / worker 14 — notify 13 신규), 부팅 스모크(골격 모드) 정상, `npm run build`(tsc) 성공.
- 경계: 스키마 마이그레이션·앱 API·벤더 구현 **미포함**(Phase 2). 기존 파일 수정은 `worker/src/index.ts` 배선 1곳뿐.
- 브랜치: 지시된 `cdf45f6` 기반으로 시작했으나, main 이 그 뒤 `docs/worklog.md` 를 변경(T10 판정이력 150줄 복구)해 머지 충돌이 T10 복구분을 훼손할 위험 → **origin/main 으로 리베이스**(delta 는 docs 전용, 코드 영향 0).
- 후속: 벤더 확정 시 `providers/solapi.ts` 추가 · `pending.ts` → Supabase 어댑터 교체 · entitlement 게이트 · T02 단계이동 트리거 구독.
## 2026-07-21 — T09 · B4 정산 모듈 + /api/settlements (부분 완료 · G8 차단 보고)

- 브랜치: `feat/t09-settlements` (base = `origin/main` 4367015).
- **산출물**
  - `app/src/lib/policyfund/settlements.ts` — 정산 업무로직. 검증(`parseCreateSettlement`/`parseUpdateSettlement`) + 서비스(`SettlementsService`, repo 포트 소비) + 집계(`summarize`/`dueBy`).
  - `app/src/app/api/settlements/route.ts` — GET(목록+집계, `?dealId=` 필터) / POST(생성 201).
  - `app/src/app/api/settlements/[settlementId]/route.ts` — GET / PATCH / DELETE. 미가시 리소스는 404 로 수렴(존재 유출 방지).
  - `settlements.test.ts` 18 테스트. 게이트 초록(app 360 / worker 1).
- **정산 필드**: `exec_amount` · `fee_pct` · `fee_paid_at` · `down_payment` — 지시대로 4종 처리. 키 상수는 `POLICYFUND_FIELD_KEYS`(T04 소유 `lib/dash/aggregate.ts`) **참조만**, 편집 없음.
- **파생값 정책**: `fee_amount`·`total_revenue`·`d180`·`d365` 는 001 generated column = 읽기 전용. 입력에 섞이면 **400 거절**. 집계는 저장된 파생값을 그대로 합산(재계산 금지 = SSOT 유지). `localRepo.derive` 산식이 `settlement.ts`(002_seed formulas 확정본)와 1:1 일치함을 실측 확인.
- **⚠ 차단 보고 — G8 상태→그룹 자동이동 미착수 (근거 부재)**
  1. 지시 문서 `docs/coordination/next-prompt_B2-B7.md` 가 **워킹트리·전 브랜치 히스토리 어디에도 없음** → T09 파트 원문 확인 불가.
  2. **`004` 마이그레이션 없음**(0001/001/002/003 까지). `board_automation_rules` 테이블은 **전 브랜치 grep 0건** → 자동이동 규칙의 스키마 근거 부재.
  3. **11개 그룹(준비→진행→심사→승인→관리→불가) 목록이 SSOT 에 없음.** `003` 의 `board_groups` 는 빈 테이블 정의(name/color/sort_order)일 뿐이고, `002_seed` 의 "업무관리" 키는 **컬럼 31종** 목록이지 그룹 목록이 아님.
  → 테이블 형태를 모른 채 구현하면 004 확정 시 전량 재작성이므로 착수하지 않음. **004 스키마 + 11그룹 SSOT 확정 후 재개**.
- 참고: 지시된 base `cdf45f6` 는 현재 main tip(`4367015`)의 **조상**이며 그 사이 4커밋은 전부 T10 문서(코드 델타 0). 코드 동일 + T10 B0·B1 검수 기준 문서 포함을 위해 main tip 에서 분기함.
- 다음: PR → T10 검수. G8 은 근거 확정 시 별건 착수.

## 2026-07-21 — T10 · 머지큐 전 단계 main 런타임 스모크 완료 · 최종 판정

- **결과**: 머지큐 ①T03 → ③T02보드엔진 → ④T04 → ⑤T05 **전 단계 main 스모크 통과**. 최종 main `cdf45f6`, 게이트 초록(app 309테스트/23파일), 스모크 **PASS=20 FAIL=0 SKIP=0**.
- **판정 원칙**(기획2): *브랜치 승인 ≠ main 승인. "완료"는 main 스모크 초록일 때만.* 매 머지 직후 `main` 에서 `npm run dev` 클릭스루 재검증.
- **스모크 이력**: 베이스라인 3 → ①11 → ③15 → ④17(**FAIL 1**) → ④fix 19 → ⑤**20**. 검사 항목이 라운드마다 증가.
- **잡은 결함 2건 — 둘 다 게이트·CI 초록 상태에서 파손**:
  - **BUG-0001**(반려): `createOrg` 가 MVP 엔타이틀먼트를 만들지 않아 **신규 조직에서 core.* 전면 잠김** → 온보딩 흐름 A 종착점 파손. 시드 조직만 엔타이틀먼트를 가져 가려져 있었다. T03 핫픽스(`ee57b0c`)로 해소.
  - **BUG-0002**: 프리셋 `key:"contract_status"` vs 위젯 `fieldKey:"계약상황"`(라벨을 key 로 사용) 불일치로 **계약상황 위젯이 조용히 영구 빈 상태**. 단위테스트가 실제 프리셋 대신 자기 픽스처를 지어내 검증해 CI 가 초록이었다. T04 핫픽스(`d8394bf`)로 해소 — key 통일 + `POLICYFUND_FIELD_KEYS` 상수 공유 + 픽스처 교정.
- **확정된 검증**: 미인증 가드 4라우트 · **담당범위 격리**(API 4 + 칸반 2, member 는 타인 담당 딜 목록·**단건조회(404)** 모두 차단) · 조직 격리 · 집계 정확성(단계별·전환율·금액이 원천과 일치, **집계도 담당범위 반영**) · 빈 상태 0분모 방어 · 프리셋 전개 · 서버 에러 0건.
- **산출물**: `scripts/smoke.sh`(20항목 자동 검증, 종료코드 판정) · `docs/coordination/T10-gate-checklist.md`(판정 이력 + 기준 + 검증 방법론).
- **⛔ MVP 완료판정 잔여 4건**(스모크로 덮을 수 없음): ① **Postgres RLS 33정책 런타임 침투테스트**(현재 격리는 전부 앱 레이어 — Supabase 적용 후 앱↔DB 규칙 일치 대조 필수) ② 구글 OAuth 실동작(현재 dev-session) ③ 정산 수식 parity(금액이 `deal.amount` 근사, "임시" 표기) ④ 파일첨부 Storage org 격리.
- **방법론 원칙**: *부정 조건(없음/0건)만 보는 검사는 대상이 존재하지 않을 때도 통과한다 — 긍정 조건(실제 렌더/인식/동작)을 함께 확인할 것.* BUG-0001·0002 가 모두 이 위반이었다. 병렬 워크트리 환경에서는 **포트 선점(오통과)** 과 **빌드캐시 잔재(오실패)** 도 함께 통제해야 한다(`smoke.sh` 에 가드 내장).

## 2026-07-21 — T05 · 기획2 판정 반영(비-throw 계약 · 값 정책 · 정본 키맵) · 003 은 followup

- **엔진 계약 변경**: `validateValue(type, raw, ctx) → {ok, normalized, error?}` **추가 — 던지지 않는다**. 던질지 흘릴지는 호출부(정책)가 결정. 기존 `normalize()`(throw)는 엄격 호출부용으로 유지(추가만, breaking 없음).
- **값 정책 = 관대 + 인라인 피드백**(`applyValues()`, PUT 라우트 기본 경로): 유효값만 저장, 무효값은 **저장하지 않고** `errors[key]` 로 사유 반환(기존 값 보존) → UI 인라인 표시. **⛔ 조용한 null 수렴 금지**(T02b 현행 방식 기각). 응답 `{ok,values,errors}`, errors 있어도 200.
- **무결성 필드만 엄격**: `exec_amount`·`fee_pct`·`fee_paid_at` → 하드 거부(400). 근거: 001 settlements generated column(fee_amount/total_revenue/d180/d365)이 의존 → 틀린 값이 조용히 잘못된 금액·일자를 만든다.
- **정본 키맵 대응**: `createField({key})` 로 정본 key 명시 지원(생략 시에만 label 파생). 명시 key 중복은 **거부**(조용히 `_2` 붙이면 정본과 어긋남). 확인 결과 `presets/policyfund.ts` 는 이미 ASCII key 사용 중이라 위반 없음 — 본 변경은 그 경로가 서비스를 타도 정본 key 가 보존되게 하는 것. `deriveKey` 는 사용자 생성 필드에만 적용(사용자 데이터, 코드 조회 key 아님).
- 테스트 +10 (custom 75→**85**): 무효값 미저장·기존값 보존·무결성 필드 throw·ok=true 경로·정본 key 사용·중복 key 거부·validateValue 비-throw 4종.
- **003 통합은 followup PR 로 분리**: `cells.ts` 위임 + `boardsRepo.setValues` 검증 훅은 **T02b 머지 모듈 수정 + 003 동작 변경**이라 리뷰 단위를 분리(T02b·T09 영향). 범위는 설계 §13.4 에 확정 기록.
- PR #5 는 이 커밋 포함해 **머지 가능** 판정(게이트 초록).

## 2026-07-21 — T05 · 머지큐 ⑤ 정합 실행 (rebase + repo/API 배선) · 003 이중화 발견

- **rebase**: 4커밋 squash → `origin/main`(da7dce0) 위 1커밋. 충돌은 `worklog`·`dispatch-queue` 2건뿐, **코드 충돌 0**(신규 디렉터리). worklog 양측 보존, queue 는 최신 항목 채택 + T02 `resolved:` 주석 보존.
- **정합 완료**:
  - `domain-types.ts` vendor → **`@/lib/types` 재export** 전환(형태 완전 동일 확인 후, 모듈 내 import 경로 불변으로 9파일 무수정).
  - **`Repo` 포트 확장** — 커스텀필드 스텁 2개 → 전 표면(정의 get/update/reorder/delete+값프루닝, 값 get/set, 저장뷰 CRUD+공유∪개인 가시성) + `FieldDefPatch`/`SavedViewPatch`. `LocalRepo` 구현(스토어 배열은 T03 이 마련해 둔 것 사용, 스토어 무변경).
  - **`RepoCustomStore`** 어댑터 + `getCustomService()` — 운영은 공용 Repo, 테스트는 InMemory 유지.
  - **API 5 라우트**: /api/fields(+[fieldId]), /api/custom-views(+[viewId], ?default=1), /api/entities/[entityId]/values. 수정판 Next 규약(params=Promise) 준수.
  - `custom/http.ts` 별도 — crm 의 toErrorResponse 는 crm ValidationError 만 400 매핑해서 core.custom 에러가 500 이 되는 문제 회피. 세션은 T03 `@/lib/auth/session` 직접 사용.
  - `repo-store.test.ts` 6종(값 정규화 round-trip·옵션 id 검증·org 격리·삭제 프루닝·뷰 가시성/기본뷰·config 왕복). custom 69→**75**.
- **게이트**: `check.sh` 초록 — 앱 **287→** (전 트랙 통합) 통과, 타 트랙 무영향.
- ⚠️ **003 어댑터 미착수(의도) — 판정 요망**: T02b `boards/cells.ts` 가 동일 성격 엔진을 병행 구현(해당 파일이 스스로 "머지 정착 후 공용화" followup 명시). 어댑터를 얹으면 **3중 구현**이라 중단하고 통합안 제시(설계 §12.2). 두 엔진 의미가 실제로 다름 — T05=엄격(throw), T02b=관용(null 수렴); 특히 **`date` 가 정규식만 통과해 "2026-02-30"·"2026-13-01" 이 그대로 저장**되고, `boardsRepo.setValues` 는 타입·옵션 대조 없이 raw 기록. 정산(D+180/365)·대시보드가 이를 소비하면 조용히 틀린 결과. 권고=(가) 엄격 통일(cells.ts 를 T05 레지스트리에 위임). 타 트랙 머지 모듈이라 단독 수정하지 않고 판정 대기.

## 2026-07-21 — T05 · OQ-4(기본 뷰) 규약 확정·구현 — 마지막 미결 해소

- **경위**: 1차 판정 "기본 뷰 = `created_at` ASC" 를 구현하려 스키마 실측 → **`created_at` 이 001 `saved_views`·003 `board_views` 양쪽 모두 부재**(001 은 다른 8개 테이블에, 003 은 `boards`/`items` 에만 있음 — 두 뷰 테이블만 누락). `id` 는 `gen_random_uuid()`(v4 랜덤)이라 생성순 대용 불가 → "created_at ASC + 마이그레이션 없음" 양립 불가를 보고하고 선택지 3안 제시. **재판정으로 (C) 채택**.
- **확정 규약**: `pickDefaultView()` — **shared 우선 → name ASC → id ASC(tie-break)**. 마이그레이션 없음.
  - `sort_order` 미사용 — 사용자 재정렬 시 기본이 바뀌지 않도록(판정 의도).
  - 이름 비교는 로케일 비의존 코드유닛 순서 — 기본 뷰 선택은 표시 정렬과 달리 ICU 버전에 흔들리면 안 되므로 **결정성 우선**.
  - 후보 타입 `DefaultViewCandidate{id,name,shared}` → 001 `saved_views` 와 003 `board_views` 가 둘 다 만족(구조적 타이핑) → **두 표면이 같은 함수 공유**.
- **구현**: `views.ts` 에 `pickDefaultView()`/`compareDefaultView()`, `service.ts` 에 `getDefaultView(orgId,userId,entity)`, `index.ts` export. **테스트 7종 추가**(빈 목록·shared 우선·name ASC·id tie-break·입력순서 무관(결정성)·sort_order 무시·003 board_views 형태 적용) → custom 테스트 **62 → 69**.
- **Phase 후속 대비**: `created_at`+`is_default` 가 두 테이블에 동시 추가되면 **`compareDefaultView()` 한 함수만 교체**, 호출부 불변으로 설계.
- **범위 판단**: 본 작업은 타 트랙·003 의존이 0인 **자기 브랜치 내 순수 엔진 로직**이라 대기 중에도 수행. **정합(@/lib/repo·API·rebase)은 계속 보류** — 머지큐 ①③④ 완료 후.
- 게이트: `check.sh` 초록. 상태: **standby** 유지. 이로써 T05 미결 0.

## 2026-07-21 — T05 · 머지큐 5번 배정 · 003 입력 반영 확인 · 대기 전환(checkpoint)

- **머지큐 확정(기획2)**: ①T03 → ②T02crm → ③T02boards → ④T04 → **⑤T05**. T02·T04 머지 후 공용계약 안정화되면 착수. 그때까지 **대기**.
- **003 실측 — T05 입력 3건 전부 반영 확인** (`003_boards_engine.sql`, 커밋 `d5e31ba`, feat/t02-boards-engine). ③T02boards 가 T05 보다 먼저 머지되므로 선제 확인함:
  - ① 저장뷰 구멍 → **`board_views` 별도 테이블 신설**. 001 `saved_views` 미건드림 → 폐기된 0002 때의 중복 충돌 재발 없음.
  - ② `board_columns.type` = **`field_type`(001 13종 enum) 재사용** + `options_jsonb` → 레지스트리/옵션 엔진 이중화 없음.
  - ③ `item_values(item_id, column_key, value_jsonb)` — 001 `field_values(entity_id, field_key, value_jsonb)` 와 **구조 동일**.
  - ⇒ **재작업 없음.** 설계 §11.4 에 두 표면 매핑표 확정 기록. `field-types`/`options`/`views`/`validation` 수정 없이 재사용, `store` 어댑터는 키 이름 매핑 수준으로 얕음. 흡수할 차이 2건: 뷰 컬럼 필드명(`columns_jsonb`↔`visible_columns_jsonb`), `board_views.kind`(table/kanban) → `ViewConfig` 선택 필드로 확장.
- **정합 게이트 여전히 미충족** → 코드 작업 없음. T05 는 큐 **마지막**이라 앞 4개 랜딩 후 그 위에서 rebase → `domain-types.ts` 를 `@/lib/types` 재export 로 1줄 정합 → repo/API/003 어댑터 순(설계 §11.5).
- **예상 리스크(기록)**: 앞 4트랙이 모두 SSOT 문서(worklog/registry/queue)를 편집하므로 ⑤ 머지 시 해당 문서 충돌 확실 — append 병합으로 해소 예정. 코드(`app/src/lib/custom/`)는 신규 디렉터리라 충돌 없음.
- 상태: **standby**(대기). 게이트 초록 유지, 브랜치 `feat/t05-custom-fields` 머지 대기.

## 2026-07-21 — T05 · 기획2 지시 접수(정합 순서 준수) · ADR-0003 영향 분석 · 정합 보류

- **지시(기획2 순환)**: 001 정본 확인 · 구현 착수 가능 · **T02 재작성 + 공용계약 안정화 후 정합 순서 준수** · 워킹트리 격리(git worktree) 사용.
- **대응**: 엔진 구현은 이미 완료(5f09cd2). 지시의 핵심인 **정합 순서**를 지켜 `@/lib/repo` 넓히기·PostgREST 어댑터·API 라우트는 **착수 보류**. 본 커밋도 격리 worktree 에서 수행.
- **정합 게이트 실측(origin/main = de69db6)** — 전부 미충족:
  - T03 파운데이션(`@/lib/types`·`@/lib/repo`·`@/lib/auth`) main 부재(feat/t03-foundation-org 에만).
  - T02 001-재작성 main 부재 — main 의 `crm/service.ts` 는 재작성 전 boards/items 구버전.
  - `0002_core_crm.sql` 폐기 미반영(main 에 아직 존재). `003_boards_engine.sql` 전 ref 부재.
  - ⇒ 공용계약 미안정화 확인. **`domain-types.ts` vendor 유지**(파운데이션이 main 에 없어 단독 컴파일 유일 수단). 안정화 후 `export * from "@/lib/types"` 1줄 정합.
- **ADR-0003 영향 분석**(설계 §11 신설): 003 `board_columns`/`item_values` 는 core.custom 과 **동일 커스터마이징 표면** → "먼데이 컬럼 재현"이 001 `field_defs` 와 003 `board_columns` 두 곳에 걸침. 코드 실측 결과 `field-types`/`options`/`views`/`validation` 은 **저장소 무관이라 그대로 재사용**, `store`/`service` 만 003 어댑터 추가(재작성 아님). 003 확정 전 어댑터 작성은 스키마 추측이라 금지.
- **기획 요청(003 작성 시 반영 요망, 설계 §11.3)**:
  1. **저장뷰 구멍** — DQ-0011 의 003 산출물에 `saved_views` 없음. 001 `saved_views.entity` 는 `field_entity`(company|deal)라 **보드를 못 가리킴**. 임의 보드 저장뷰 위치를 003 에서 확정할 것(board-scoped 테이블 추가 vs enum 확장). 미정 시 `0002` 때와 같은 중복 재발.
  2. `board_columns` 타입·선택지는 001 규약 준수(`field_type` 13종 + `options_jsonb={options:[{id,label,color,order,archived}]}`) — 엔진 이중화 방지.
  3. `item_values` 는 옵션 **라벨이 아닌 id** 저장 — 핵심 불변식.
- 게이트: worktree 에서 `check.sh` 초록 유지. SSOT: registry/queue 에 정합 게이트·003 입력 반영.

## 2026-07-21 — T05 · 커스터마이징(core.custom) 엔진 구현 (branch: feat/t05-custom-fields)

- **트리거**: OQ-1 해소(ADR-0002) — 정본 = A안 `001_schema_v1.sql`, B안 `0002_core_crm.sql` 폐기.
- **브랜치 사유**: main 공유 워킹트리에서 다수 트랙이 동시 commit/reset/checkout 중 → 경합으로 커밋 유실 발생. 격리 위해 `git worktree` 로 `feat/t05-custom-fields`(base origin/main) 분리, 공유 트리 미간섭. 검증 후 PR/머지.
- **전달물** `app/src/lib/custom/`(순수 TS + vitest, **62 테스트 신규**):
  - `field-types.ts` — 13종 `FieldTypeSpec` 레지스트리(normalize/isEmpty/comparable/operators). 옵션 id 멤버십·달력일·email/url/phone 검증.
  - `options.ts` — 옵션 연산(add/rename/recolor/reorder/archive/unarchive), **id 불변 보장**, 고아 진단.
  - `views.ts` — 001 saved_views(jsonb) ↔ `ViewConfig` 어댑터 + 타입-인지 `applyView`.
  - `store.ts` — `CustomStore` 포트 + `InMemoryCustomStore`(org 격리·값 PK upsert·프루닝·뷰 가시성).
  - `validation.ts` — 요청 파서 + `deriveKey`/`uniqueKey`(**한국어 라벨 지원**, 예약어·중복 회피).
  - `service.ts` — 오케스트레이션(key 파생·옵션 id 발급·값 정규화·프리셋 락·뷰 CRUD), `index.ts` 배럴.
  - 도메인 타입은 committed `@/lib/types`(FieldDef/FieldValue/SavedView/FieldOption/FieldType 13종) 사용 → 타입정합 완료. 영속성은 자체 포트(정착 후 `@/lib/repo` 정합).
- **OQ 결정(구현 반영)**: OQ-2 타입변경=라벨만·OQ-3 프리셋옵션=락·OQ-5 캐시=미구현(정본 field_values). OQ-4 기본뷰=belie 결정 대기.
- **게이트**: worktree 에서 `bash scripts/check.sh` → 초록(앱 138 + 워커 1, custom 62 포함).
- **followup**: `@/lib/repo` 넓히기·PostgREST 어댑터·API 라우트(Next.js 수정판 문서 선확인)·RLS(T03)·T02 뷰엔진 공용화 — 모두 T02 001-재작성 정착 후.
## 2026-07-21 — T03 · hotfix BUG-0001 — createOrg 엔타이틀먼트 미생성

T10 main 스모크 반려 건. **내 코드의 규약 위반**이 맞다.

- 증상: `createOrg()` 가 org + owner 멤버만 만들고 `org_entitlements` 행을 만들지 않았다.
  `isFeatureEnabled()` 는 `enabled=true` 행을 요구하므로 **신규 조직에서 core.\* 전부 잠김**
  (FeatureGate 전면 자물쇠). 시드 조직만 `seed.ts` 에서 MVP 기능을 받고 있어 가려져 있었다.
- 위반한 규약: PLAN v0.2 §5 "MVP: 모든 플랜에 core.* + MVP 모듈 무료".
- 수정: `createOrg` 에서 `MVP_ENABLED_FEATURES` 를 순회해 엔타이틀먼트 행 생성
  (`source: "plan"` — 시드와 동일 의미론. `setEntitlement` 는 `source:"manual"` 이라 미사용).
- 회귀 가드: `localRepo.test.ts` 에 "신규 조직에 MVP 기본 엔타이틀먼트를 부여한다(BUG-0001)"
  추가 — MVP 기능 전건 ON + Phase 2(mod.notify/mod.hometax) 는 OFF 유지까지 검증.
- 채택하지 않은 대안: `isFeatureEnabled` 를 plan_features 기준 판정으로 변경.
  로컬 store 에 plans/plan_features 테이블이 없어 지금은 과한 변경 — Supabase 전환 시
  `plan_features → org_entitlements` 합산으로 정리하는 게 맞다(주석에 명시).
- 반영: main 직접 hotfix(기획2 승인). 작업은 격리 worktree 에서 수행.

## 2026-07-21 — T04 · DQ-0014 판정 반영 — 파일 첨부를 jsonb(deal.custom.files[])로 전환

- **기획2 판정 수령**: MVP 로컬 우선에서는 전용 테이블 없이 **jsonb 저장**
  (딜 = `deals.custom.files[]`, 임의보드 = `item_values`). 신규 마이그레이션 금지.
  전용 attachments 테이블은 Supabase Storage 연결 시 **기획이 004 로 작성**.
- **적용**: `lib/services/files.ts` 를 자체 인메모리 Map → **Repo 경유 jsonb** 로 재작성.
  - 순수 jsonb 헬퍼 `readFileRefs` / `appendFileRef` / `removeFileRef` (불변, 형식 방어).
    배열이 아니거나 원소 형식이 어긋나면 걸러낸다(런타임 jsonb 신뢰 금지).
  - 서비스는 기존 `Repo.getDeal/updateDeal(custom)` 만 사용 → **공용 인터페이스 무변경**
    (피드백 #2 준수). org·담당범위 격리는 Repo 가 그대로 보장.
  - 기존 custom 키(예: `계약상황`)를 덮어쓰지 않음을 테스트로 고정.
- **머지큐**: ①T03 → ②T02crm → ③T02boards → **④T04** → ⑤T05.
  현재 origin/main 에 T03(a7bdc9d)·T02crm(ab9845e) **미머지 확인** → rebase 대기 상태.
  선행 머지 완료 후 `git rebase origin/main` 하여 재푸시 예정.
- 파일 서비스 테스트 40개. `bash scripts/check.sh` **초록**(앱 179 + 워커 1).

## 2026-07-21 — T04 · core.files 로컬 구현 + 정산 임시추정 (브랜치 feat/t04-dash)

- **워킹트리 격리**: `git worktree add ../wt-t04 -b feat/t04-dash` (공유 워킹트리 커밋 금지 규약 적용).
  origin/main 기준으로 분기했으나, 대시보드 코드가 **T03 파운데이션(a7bdc9d)·T02 정본
  재작성(ab9845e)에 의존**해 그 위에 쌓인 스택 브랜치로 구성. main 은 건드리지 않음.
- **기획2 피드백 #1 반영** — 정산 집계가 '—' 대신 **`deal.amount` 기반 임시 추정**으로 폴백:
  `provisionalSettlementFromAmounts()` + `settlementSummaryOrProvisional()`,
  `SettlementSummary.provisional` 플래그. 화면에 **"임시" 뱃지**와 산출 불가 항목(계약금·수수료)
  안내를 함께 노출해 실측과 혼동되지 않게 함. 교체 순서는 TODO 주석에 명시
  (T03 포트 선행 추가 → T09 구현 → T04 실측 교체).
- **피드백 #2 준수**: 공용 인터페이스(`@/lib/types`, `@/lib/repo/index.ts`) **미변경**.
  파일 기능은 아직 공용 포트에 없어 T04 자체 서비스로 분리.
- **core.files 로컬 구현** (독자 CREATE TABLE 금지 → 마이그레이션 없이 로컬 우선):
  - `lib/services/files.ts` — 딜 파일 첨부 인메모리 스토어 + 검증.
    크기 제한(10MB) · **실행/스크립트 확장자 24종 차단** · **경로 탈출 방지**
    (`sanitizeFileName`: 경로 구분자·제어문자 제거) · org 격리 · `buildStoragePath()`
    (첫 세그먼트=org_id, Storage 버킷 RLS 대비).
  - `components/deal/ContractStatusField.tsx` — **계약상황 select**. 선택지는 하드코딩이 아니라
    `field_defs`('계약상황', 002 프리셋)에서 로드, 값은 `deals.custom[key]`.
    → 기획 §3 core.files **완료 기준("계약상황이 딜에서 표시·변경됨") 충족**.
  - `components/deal/FilesTab.tsx` — 흐름 C '문서' 탭. 업로드 전 클라이언트 1차 검증 + 다운로드.
- 신규 테스트 30개(파일 서비스) + 정산 임시추정 7개. `bash scripts/check.sh` **초록**(앱 169 + 워커 1).
- 남은 것: 파일 메타 스키마(DQ-0014, 기획 단일 PR 대기) · Storage 서명URL 교체 · 딜 상세 화면(T02) 배선.

## 2026-07-21 — T04 · core.dash 기본 대시보드 구현 (core.files 는 스키마 대기)

- **기획 v0.2 + 스키마 v1 정독**: `docs/PLAN-v0.2.md`, `supabase/migrations/001_schema_v1.sql`.
  정본 모델 = `deals`/`pipelines`/`stages`/`settlements` (ADR-0002, B안 `0002_core_crm` 폐기).
- **디스패치 보고**(지시 사항):
  - `DQ-0014` [요청→기획] **core.files 스키마 부재** — `core.files` 는 plan_features 에
    기능키로 등록(MVP ON)됐지만 뒷받침 테이블이 정본 어디에도 없음. "새 SQL 만들지 마 ·
    스키마 변경은 기획이 단독 작성"(DQ-0011 원칙)에 따라 직접 저작하지 않고 요청.
    착수 시 만든 초안 `0003_core_files_dash.sql` 은 **회수**(추측 금지 + 폐기된 B안 참조).
  - `DQ-0015` core.dash 분리 착수 — 확정 기획상 대시보드는 "집계=뷰/파생, 이중저장 금지"라
    **새 테이블 없이 구현 가능** → core.files 대기와 분리.
  - `DQ-0004` 갱신: contracts 상태는 `field_defs` '계약상황' 프리셋으로 충족(별도 테이블 불요,
    Phase 2 확인). blocked_on 을 DQ-0014 하나로 정리.
- **구현 (`app/src/lib/dash/`)** — 전부 순수 함수, I/O 없음:
  - `aggregate.ts` — 단계별 건수/비율, 전환율(분모=전체 딜·분자=kind 첫 단계 이상 도달,
    **0분모 방어**), 계약상황 분포(field_defs 옵션 id·라벨 매칭, archived 제외),
    **KST 월 경계**(`monthRangeKst`, 반열린 구간), 정산 요약·재접촉(D+180/365).
  - `service.ts` — `buildDashboard(ctx)`: Repo(담당범위 적용) → 집계 조립. 저장 안 함.
    "계약단계 도달"(파이프라인 KPI) vs "이번달 수납"(수수료입금일 기준 실현) **라벨 분리**(T07 지적 반영).
  - `format.ts` — 0건/미가용 시 `0` 또는 `—` (NaN 금지).
- **화면**: 홈 `(app)/page.tsx` 의 "대시보드 스텁" → **실제 대시보드로 대체**(상단 고정 요약 4종 +
  파이프라인·전환율·계약상황·이번달수납·전체정산·재접촉 위젯). 드릴다운
  `(app)/dash/[pipelineId]` = 보드별 상세(단계별 딜 목록). `FeatureGate(core.dash)` 적용.
- **경계 준수**: 정산 수식은 **T09 확정본**(`policyfund/settlement.ts`) 소비(재저작 없음),
  딜 상세 화면은 **T02 소유**라 링크/중복 구현하지 않음.
- 신규 테스트 63개(집계 42 · 서비스 8 · 포맷 13). `bash scripts/check.sh` **초록**(앱 201 + 워커 1).

## 2026-07-21 — T02b · 사용자 임의 보드 엔진 구현 (003, ADR-0003) — 브랜치 feat/t02-boards-engine

- **선행 해소**: DQ-0011 요청분(003_boards_engine.sql · T02b-boards-engine.md · ADR-0003)이
  T01 push(`d5e31ba`)로 유입 → 즉시 착수. **격리 워크트리** `../wt-t02` (규칙 1).
  base = feat/t02-crm-core(정정된 deals 모델) + origin/main 머지(003 확보).
- **데이터 레이어** `app/src/lib/boards/`:
  - `types.ts` 003 6테이블 1:1 · `cells.ts` 13 field_type 정규화/선택지검증/비교/표시
  - `store.ts` **전용 BoardsRepo 포트**(공용 `lib/repo/index.ts` 미변경 — 규칙 2 준수)
  - `service.ts` 보드/컬럼/그룹/아이템/셀 + 칸반 그룹핑(select 컬럼 또는 board_groups)
    + **시스템 보드 편집 가드**(정책자금은 deals 소유) + EAV 오염 방지(미정의 키 무시)
  - `validation.ts` 입력 검증. **33 테스트 신규**(cells 16 · service 17)
- **로컬 어댑터** `lib/repo/local/`: `boardsRepo.ts` + `store.ts` Db 확장 + `seed.ts`
  (시스템 보드=정책자금 메타 + 예시 사용자 보드 1개: 컬럼 4·그룹 2·아이템 3·셀 값).
  items 담당범위 = 003 RLS 동일 규칙.
- **UI**: `(app)/boards`(목록 — 시스템+사용자 통합 UX) · `(app)/boards/[id]`(테이블/칸반 토글,
  그룹 기준 전환) · `components/boards/`(GenericBoardTable 셀 인라인편집 · GenericBoardKanban ·
  ColumnEditor 13타입+선택지 · NewBoardDialog) · `actions.ts` 서버 액션.
  로컬 스토어가 **서버 인메모리**라 API 왕복 없이 서버 액션 + revalidatePath 로 구현.
- **로컬 실검증**(npm run dev, 포트 3210): 보드목록 렌더 · 테이블 셀값 바인딩(제목/select/date) ·
  칸반 레인(대기1·진행중1·완료1·미지정0) · **서버액션 왕복**(아이템 생성 반영) ·
  **member 계정 본인 담당 2건만**(scope 격리) · **홈 대시보드 딜 집계 정상 = deals 회귀 0**.
- **게이트**: `bash scripts/check.sh` 초록 — app **163 테스트** + worker 1, lint/typecheck OK.
- **규칙 준수**: 신규 SQL 없음(003만) · 공용 계약 미변경 · 001 deals/stages/settlements 불변.
- **후속**: dnd-kit 드래그(데이터 경로 동일, 핸들러만) · TanStack 훅(현재 서버액션) ·
  T05 `lib/custom/field-types` 와 `boards/cells` 공용화(병행 브랜치라 독립 구현).

## 2026-07-21 — T04 · core.dash 기본 대시보드 구현 (core.files 는 스키마 대기)
## 2026-07-21 — T03 · settlements 엔티티 포트 선행 추가 (worktree 격리)

기획2 피드백 #3 반영. 정산 포트를 **파운데이션에서 선행 정의** → T09 가 업무 로직을 구현하고
T04 는 소비만 한다(**T04 가 공용 인터페이스를 직접 수정하지 않도록**).

- `lib/types`: `Settlement` 추가. 001 의 **generated column**(`fee_amount`·`total_revenue`·
  `d180`·`d365`)은 **읽기 전용**으로 표기, 쓰기는 base 컬럼만.
- `lib/repo/index.ts`: `NewSettlement`/`SettlementPatch` + 포트 6종 —
  `listSettlements`·`getSettlement`·`getSettlementByDeal`·`createSettlement`·
  `updateSettlement`·`deleteSettlement`. 소유/소비 경계를 주석에 명시.
- `lib/repo/local/localRepo.ts`: 구현. 파생값은 001 식을 그대로 재현
  (`round(exec×pct/100)` · `down+fee` · `fee_paid_at±180/365`, UTC 날짜 연산),
  **쓰기마다 재계산**. 담당범위는 **상위 deal 가시성**을 따른다(접근 불가 딜엔 생성/수정 거부).
- `store`/`seed`: `settlements` 배열 추가(시드 비움 — 생성은 T09 몫).
- 테스트 5종 추가(총 11): 파생 계산·입금일 null·수정 시 재계산·member 스코프 격리·접근불가 딜 거부.
- **프로세스**: 피드백 #4 반영 — 이번 작업부터 **git worktree 격리**에서 수행(공유 워킹트리 커밋 금지).
  공유 트리는 그사이 다른 트랙이 브랜치를 `feat/t02-crm-core` 로 전환해 있었음(격리의 필요성 재확인).

## 2026-07-21 — T02 · core.crm 정본 스키마 정합 재작성 (boards/items → deals/companies)

- **원인**: 초기 구현 직후 정본 `docs/PLAN-v0.2.md` + `001_schema_v1.sql` 이 다른 트랙 커밋으로
  유입됨. 정본 모델(companies/pipelines/stages/deals/activities)이 내 독자 저작(boards/items)과
  근본적으로 달랐고, 수식/저장뷰 경계도 T09/T05 소유로 확인됨. 오너 결정=**PLAN 경계 준수**.
- **폐기(삭제)**:
  - `supabase/migrations/0002_core_crm.sql`(경쟁 모델) → T05 의 saved_views 스키마 충돌 해소.
  - `app/src/lib/crm/{formulas,pipeline,views,templates,store,postgrest,context,types}` +
    구 API 라우트(boards/items/views) — boards/items 모델 산출물.
- **재작성(정본 001 기반)**:
  - 공유 `@/lib/repo` 포트를 core.crm 쓰기로 확장 — companies/deals CRUD, activities,
    getStage. 담당범위(scope) 격리(owner/admin/all=전체, member+assigned=본인 담당만).
  - `app/src/lib/crm/`: service(오케스트레이션)·activity(이동 로그 문구)·validation·
    context(`@/lib/auth` 세션 → Ctx, 없으면 401)·http.
  - API: `/api/companies`·`/api/pipelines`·`/api/deals`·`/api/deals/[id]/move`·
    `/api/deals/[id]/activities`. 단계 이동은 move 로만(활동로그 보장), updateDeal 은 stage 거부.
  - `docs/PLAN-core-crm-v0.2.md` 정본 정합 내용으로 갱신.
- **경계 정정**: 수식/settlements=**T09**(정본 = generated column + policyfund/settlement.ts),
  커스텀필드/저장뷰=**T05**, 조직/RLS/Auth=**T03**(완료). 별도 store/PostgREST 어댑터 미제작 —
  공유 Repo 포트 재사용(운영 Supabase 어댑터는 포트 뒤 스왑).
- **게이트**: `bash scripts/check.sh` 초록 (app 76 테스트, 그중 crm/repo 신규 29).
- **조율**: DQ-0002 done 노트 정정, DQ-0005(T05) saved_views 충돌 resolved 표기, T02 registry 갱신.

## 2026-07-21 — T03 · 공용 파운데이션(PR-0) — 로컬 우선 세션·Repo·엔타이틀먼트 + 온보딩/멤버 UI

브랜치 `feat/t03-foundation-org`. Supabase 연결 전, **dev-session + repo-레벨 scope** 로
공용 파운데이션을 먼저 착지시켜 T02·T04 를 언블록한다(구글 OAuth·DB RLS 는 Supabase 연결 후).

- **안정 인터페이스(소비 트랙용)**:
  - `lib/types/index.ts` — 001_schema_v1 도메인 타입 수동 정의(정본). 역할/enum도 여기로 통합, `lib/auth/roles.ts` 는 위계/가드만.
  - `lib/repo/index.ts` — `Repo` 포트 + `getRepo()`. `lib/repo/local/{store,seed,localRepo}` = 인메모리 구현. **담당범위 규칙**: owner/admin·scope=all → 조직 전체, member+assigned → 본인(assigned_to)만.
  - `lib/auth/session.ts` — `getSession(): Promise<Ctx>`(Next16 cookies async) + `getSessionOrNull` + `applyAs`(?as 오버라이드). dev-session 쿠키(mw_uid/mw_org/mw_as).
  - `lib/entitlements.ts` — `isEnabled(ctx, key)`(feature_key 기반, 001 org_entitlements 반영).
  - `lib/presets/policyfund.ts` — `installPolicyfundPreset(ctx)` → 딜 커스텀필드(field_defs) 전개 + 엔타이틀먼트 ON(idempotent).
  - `lib/product.ts` — `PRODUCT_NAME`(단일 상수) + FEATURES/MVP 기본 기능 집합.
- **UI**(수정판 Next16 — proxy 규약·async cookies/searchParams·route group 확인):
  - `app/(auth)/login` — dev-session 계정 선택 로그인(서버액션 쿠키).
  - `app/(app)/layout.tsx` — 인증 셸(getSession 가드 → 미인증 /login). `page.tsx` 홈(=`/`, ?as 역할전환·스코프 시연·FeatureGate 데모), `onboarding`(조직생성+auto-owner+정책자금팩), `settings/members`(멤버·권한, owner/admin만 역할변경).
  - `components/auth/FeatureGate.tsx` — Phase 2 모듈 자물쇠(mod.notify 등).
- **테스트**: `localRepo.test.ts`(6) — 스코프 격리(member 본인만/owner 전체)·프리셋 설치·idempotent·auto-owner. `roles.test.ts`(9). check.sh 초록.
- **라우트 정리**: 기존 Supabase OAuth `app/login/page.tsx`·루트 `page.tsx` 제거(각각 `(auth)/login`·`(app)/page.tsx` 로 대체). 이번 세션 초반 만든 Supabase SSR 레이어(`lib/supabase/*`·`proxy.ts`·`app/auth/*`·`membership.ts`·@supabase deps)는 **이 PR 에 미포함**(로컬 우선 파운데이션에 집중) — 워킹트리에 dormant 로 두고 Supabase 연결(내일) 시 별도 커밋. 이 PR 은 @supabase 의존 없이 자족(CI 정합).
- **완료기준 대응**: ①/login→온보딩→홈 무에러 ②installPolicyfundPreset→field_defs 생성(테스트) ③?as=member 본인 담당만(테스트) ④FeatureGate 자물쇠 ⑤lib/repo·types·auth 안정 존재 + check.sh 초록.
- 후속: (Supabase 연결 후) LocalRepo→SupabaseRepo 어댑터 스왑·dev-session→구글 OAuth·DB RLS 침투테스트(T10). T02/T04 는 `lib/repo`·`lib/types`·`lib/auth` 소비.

## 2026-07-21 — T09 · 정책자금 보드 UI + 번들 프리셋 스냅샷

- **UI**(수정판 Next.js16/App Router·React19·Tailwind v4, `node_modules/next/dist/docs` + T02/T03 페이지 패턴 확인 후):
  - `app/src/components/policyfund/OptionSelect.tsx` — 선택지 카테고리 셀렉트(개수 뱃지, region 218 등 대용량 네이티브 처리).
  - `app/src/components/policyfund/PolicyfundBoard.tsx` — 업무관리 31컬럼 테이블(가로 스크롤·타입 뱃지·formula 툴팁) + 단계 필터/정렬 컨트롤(`pipeline.ts` 소비).
  - `app/src/app/policyfund/page.tsx` — 서버 컴포넌트, 보드 + 7종 선택지 카탈로그. T03 프록시로 인증 뒤(정상).
- **번들 프리셋 스냅샷**: `app/src/data/policyfund-presets.json`(002_seed 추출) + `bundled.ts` 로더. MVP 오프라인 렌더용, 프로덕션은 DB industry_modules 로드로 교체.
- **드리프트 가드**: `bundled.test.ts` — 스냅샷 **실데이터**로 `validatePresetCounts`(218/59/18/16/11/14/28) + 31컬럼 + 6단계 + 수식정의 검증. 시드 변경 후 스냅샷 재생성 누락 시 실패.
- **게이트**: `bash scripts/check.sh` → 초록. 앱 **115 테스트**(policyfund 37) + 워커 1, lint/typecheck(tsx 포함) OK.
- 남은 배선: 번들→DB industry_modules 로드 교체, 보드 아이템(행)·formula 셀 계산 = T02 API + `settlement.computeSettlement` 연동. T02 crm/formulas.ts 확정본 정합(DQ-0009 followup).

## 2026-07-21 — T03 · 조직·보안 — 인증/인가 앱 레이어 (구글 OAuth + RLS 세션 플러밍)

**정정(중요)**: core.org 스키마·RLS·auto-owner 는 이미 `001_schema_v1.sql`(스키마 v1 정본)에
완비돼 있었다 — `orgs`/`users`/`org_members`(member_role: owner/admin/member, member_scope:
all/assigned), 헬퍼 `is_org_member`/`org_role`/`org_scope`, 트리거 `add_org_owner`, 전 도메인
테이블 RLS. 착수 초기엔 이 파일이 리포에 없어 `0002_core_org.sql`(organizations/profiles 재정의)을
작성했으나, 정본 확인 후 **중복·충돌(특히 `org_members` 재정의로 적용 실패)** 이라 폐기했다.
따라서 T03 실제 산출물은 **그 스키마 위의 앱 인증/인가 레이어**다(001 에 없는 부분).

- **Supabase SSR 세션 플러밍** (RLS 가 작동하려면 요청에 세션 JWT→`auth.uid()` 가 있어야 함):
  - `app/src/lib/supabase/server.ts` — RSC/라우트/액션용 서버 클라이언트(Next16 async `cookies()`).
  - `app/src/lib/supabase/client.ts` — 클라이언트 컴포넌트용 브라우저 클라이언트.
  - `app/src/lib/supabase/env.ts` — env 가드(NEXT_PUBLIC URL/anon key, 비밀값 저장소 금지).
- **세션 게이트**: `app/src/proxy.ts` — Next16 `middleware`→`proxy` 규약(문서 확인). 매 요청
  세션 갱신 + 미인증 시 `/login` 리다이렉트, 인증+`/login`→홈. env 미설정 시 fail-open(개발 편의).
- **구글 OAuth**: `/login`(소셜 버튼, `signInWithOAuth`), `/auth/callback`(코드교환 +
  `public.users` upsert — 001 에 auth.users→users 트리거가 없어 앱에서 프로필 보강),
  `/auth/signout`(POST).
- **인가 lib**: `app/src/lib/auth/roles.ts`(member_role/member_scope, `atLeast`/`isManager`,
  타입가드) + `roles.test.ts`(9 테스트). `membership.ts`(서버 가드 `getMyMembership`/`getMyRole`/
  `requireRole`/`requireManager`). 역할 모델은 스키마 정본에 정합 — 프로즈의 4역할(viewer)은
  스키마에 없어 미채택.
- deps: `app/package.json` 에 `@supabase/ssr`·`@supabase/supabase-js` 추가(lock 동기화).
- `bash scripts/check.sh` **초록**(lint + typecheck app/worker + test, 앱 109→auth 9 포함).
- 후속: (T02) context.ts 세션 연동 언블록 · (T10) 라이브 RLS 침투테스트는 provider 프로비저닝 후 ·
  마이그레이션 번호 혼재(001_ vs 0001_) 정합은 T10/스키마 오너 조율 필요.

## 2026-07-21 — T09 · 정책자금 업종팩 데이터 로직 계층 (확정 시드 반영)

- **트리거**: 기획 v0.2 + DB 스키마 v1 확정 통보. 착수 시점 지정 파일(`docs/PLAN-v0.2.md`, `supabase/migrations/002_seed_policyfund.sql`) 부재 → 순수 계층 선구현 후, **두 파일 랜딩 확인**(T02 core.crm done 과 함께)하여 확정본에 정합.
- **시드 전수 검증**: `002_seed_policyfund.sql` (industry_modules.presets_jsonb) 파싱 → 개수 실측 = 지역 **218**·상품 **59**·진행기관 **18**·상담상황 **16**·계약상황 **11**·진행상항 **14**·자금명 **28**, 업무관리 보드 **31컬럼** (사용자 명시치·PLAN 과 정확히 일치).
- **구현** (`app/src/lib/policyfund/`, 순수 TS + vitest):
  - `settlement.ts`(+test) — **확정 수식**: 수수료(원)=`round(실행액×수수료%/100)`(정수 %), 총매출=`계약금+수수료(원)`, D+180/365=`수수료입금일+n일`(미입금 null). 002_seed formulas 블록과 1:1.
  - `presets.ts`(+test) — 시드 JSONB → 7개 선택지 카테고리 로더(`loadOptionCategories`, field_presets + board_columns 옵션 출처 매핑) + `validatePresetCounts`(실측 개수 대조).
  - `board.ts`(+test) — 보드 컬럼 추출(`getWorkBoardColumns`=업무관리 31컬럼), select 옵션 ref(region/product)/inline/redacted·formula 해석.
  - `pipeline.ts`(+test) — 단계 필터·정렬·집계·그룹화(단계 순서는 시드 pipeline_stages 주입).
  - `types.ts` 원본 JSONB 구조 + 앱 도메인 타입, `fixture.ts` 테스트 픽스처, `index.ts` 배럴.
- **⚠ 크로스트랙 정합 이슈 발견**: T02 `crm/formulas.ts` 는 **가정** 기반(총매출=수수료×1.1 부가세, D+n=계약일 기준, base=계약금액)이라 확정 시드와 불일치. 정산(settlements)은 T09 소유이므로 확정 정의를 `policyfund/settlement.ts` 에 두고, T02 수식컬럼 엔진 정합을 **DQ-0009 followup** 으로 요청.
- **게이트**: `bash scripts/check.sh` → 초록. 앱 **109 테스트**(policyfund 31 신규 포함) + 워커 1 통과, lint/typecheck OK. 타 트랙(T02 crm·T03 auth) 산출물과 충돌 없이 통합.
- **남은 작업(UI)**: 선택지 셀렉트 · 업무관리 31컬럼 보드 화면 · 파이프라인 필터/정렬 UI — 데이터·로직 준비 완료, T02 보드 CRUD API 소비 + `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인 후 착수.
- SSOT: `session-registry.yaml` T09 delivered/followup 기입, `dispatch-queue.yaml` DQ-0009 followup(T02 정합·UI).

## 2026-07-21 — T05 · 커스터마이징(core.custom) 커스텀필드 엔진 설계(checkpoint)

- T02 done(DQ-0002) 확인 → T05 언블록. `git pull`(up to date) 후 지시된 소스 정독:
  `docs/PLAN-v0.2.md` §3(core.custom), `supabase/migrations/001_schema_v1.sql`의 `field_defs`·`field_values`·`saved_views`(+ `field_type` 13종·`field_entity` enum), T02 산출물(`app/src/lib/crm/{types,store,views,validation}.ts`).
- **설계 문서 작성**: `docs/design/T05-custom-fields-design.md`.
  - 필드 **타입 레지스트리**(13종 `FieldTypeSpec` — 정규화/isEmpty/comparable/연산자, 타입별 value_jsonb 저장형 표).
  - **선택지(옵션) 관리**: `options_jsonb` = `{options:{id,label,color,order,archived}[]}`, **저장값은 옵션 id**(라벨 아님) → 라벨/순서 변경에도 저장값 불변(먼데이 동작). add/rename/reorder/archive, 고아 값 진단.
  - **field_defs/field_values 생명주기**: key slug 파생·UNIQUE, 타입변경 정책(MVP 거부), 값 정규화 upsert(PK entity_id+field_key)·프루닝, `deals.custom`은 읽기 캐시로만.
  - **저장뷰**: T02 `views.ts`(applyView/matchFilter) + `validation.ts` **재사용**, 001의 filters/sort/columns_jsonb ↔ ViewConfig 어댑터, 개인/공유·기본뷰.
  - **레이어링**: T02 패턴 그대로 — `CustomStore` 포트 + InMemory/PostgREST 어댑터 + service + Next.js API 라우트(app/AGENTS.md 경고 반영: 코드 전 `node_modules/next/dist/docs/` 확인).
- ⚠️ **착수 선결(BLOCKER) 발견·명시**: 커스터마이징 레이어를 정의하는 마이그레이션이 **두 벌 공존** — `001_schema_v1.sql`(field_defs/field_values) vs `0002_core_crm.sql`(board_columns/column_values). 특히 **`saved_views` 테이블이 두 파일 모두 `create table`**(001:210, 0002:144, 컬럼 상이) → 중복 생성 충돌. 어느 모델이 정본인지(안 A: 001 / 안 B: 0002) 코디네이터 판정 필요(설계 §0/§7/OQ-1). **판정 전 구현 미착수**(경계 존중).
- 참고: 착수 지시의 "custom_views"는 실제 스키마에 없음 — 테이블명은 `saved_views`(001·PLAN §3 일치). 설계는 `saved_views`로 표기.
- SSOT 갱신: `session-registry.yaml` T05 standby→active(delivered: 설계문서, blocked_on: 스키마 정합), `dispatch-queue.yaml` DQ-0005 blocked→in_progress.
- check 게이트 초록 확인 후 커밋·푸시.

## 2026-07-21 — T06 · 알림발송(mod.notify) Phase 2 설계 문서 작성

- 트리거: 오너가 기획 v0.2 + DB 스키마 v1 확정 통보 → `docs/PLAN-v0.2.md` §3/§4(mod.notify·흐름 E) + `001_schema_v1.sql`(message_channel/message_status enum, message_templates·messages 테이블, RLS) 정독.
- 확인: **mod.notify 는 Phase 2(벤더)** — MVP plan_features 미포함(entitlement OFF, `001_schema_v1.sql` L461-462). 스키마상 테이블은 `message_templates`·`messages`(문서상 명칭). 설계는 미리, 활성화는 Phase 2 계약 후.
- 산출물: **`docs/design/T06-notify-design.md`** — 발송 파이프라인(App→messages(queued)→pg-boss `notify.send`→VPS 워커 벤더 어댑터→상태갱신·재시도), 트리거 3종(수동/단계이동 자동/정산 D+180·365 스케줄), 벤더 어댑터 추상화, 알림톡→SMS 대체발송, entitlement 게이트, Phase 2 추가 마이그레이션(`00X_notify_phase2.sql`: channel/retry_count/provider_message_id/scheduled_at 등) 제안.
- **벤더 비교표(비용·API·리드타임)**: SOLAPI/팝빌/NHN Cloud/NCP SENS/알리고/비즈엠. 권장 = 1차 SOLAPI(DX·단일벤더), 전략대안 팝빌(홈택스·세금계산서 통합). belie 계약 결정(DI-5) 요청.
- 조율: T02 단계이동→알림 트리거 이벤트 계약 필요(dispatch-queue). mod.hometax 트랙과 벤더 통합 논의.
- 기존 마이그레이션 미수정(규칙 준수) — Phase 2 착수 시 새 파일로 additive.



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

## 2026-07-27 — T09 · Public Workspace Entry release close / next queue (coordination only)

- WORK-ID: `PUBLIC-WORKSPACE-ENTRY-01-CLOSE-HOLD-AND-NEXT-QUEUE`.
- clean isolated coordination branch `docs/public-workspace-entry-close-hold`에서 `ROUND-32.md`만 새로 작성하고 본 worklog에 append했다. product candidate branch와 기존 dirty worktree는 수정하지 않았다.
- `PUBLIC-WORKSPACE-ENTRY-01` candidate `351a5305ad935e3bbffd41b0adb3c24783b6bc02` / tree `92bb09be2bb25ded02b671396b7cb8c6764625fe`, Draft PR #22, CI #96 SUCCESS, Vercel Preview Ready 및 T10 exact-SHA/Preview PASS 증거는 보존한다.
- release state는 **`BLOCKED_OPERATIONAL / RELEASE_HOLD / NOT_DEPLOYED`**: hosted `006` 미적용, recoverable hosted DB backup/dump·authorized DB connection/maintenance window·migration ledger proof·safe authenticated fixtures/accounts 부재. hosted DB/authenticated visual/merge/deploy/production readback은 `NOT_RUN_BY_GATE`다.
- exact unblock은 승인된 recoverable backup/dump path + authorized DB connection/maintenance window + isolated safe authenticated test accounts/fixtures의 동시 제공이다. 이 조건도 independent review와 release approval을 대체하지 않는다.
- PR #19는 conflict/superseded comment 뒤 closed unmerged, PR #20은 Draft/HOLD이며 PR #22 뒤 rebase·migration renumber·entitlement/default-pipeline/stage dependency reconciliation이 필요하다.
- `SIDEBAR-LEADS` 및 external `TEMPLATE-PUBLISHER` framing을 supersede했다. MoaWork의 목표는 가입한 고객 workspace 안에서 고객 운영체계를 구현하는 것이며, reusable blueprint는 internal delivery accelerator다. public external CRM template marketplace는 범위 밖이다.
- 8개 후속 project queue는 기록만 했고, PR #22 `RELEASE_HOLD` 중 시작하지 않는다. Consumer: T06. `INTERNAL_SUBAGENT_ONLY: NONE`.

## 2026-07-27 — T09 · Public Workspace Entry production release close (coordination only)

- WORK-ID: `PUBLIC-WORKSPACE-ENTRY-01-RELEASE-CLOSE`. 기존 `ROUND-32`의 `RELEASE_HOLD`는 당시 사실로 보존하고, `ROUND-33`에서만 현재 상태를 승격했다.
- PR #22 candidate `351a5305...`는 main merge `ea42be870359c0c57490fdf9b9b094d2e197992d`로 반영됐고 Production migration `006`이 atomically applied 됐다. slug-only backfill은 private snapshot/rollback 아래 approved canonical value 한 row만 적용했으며 owner/membership/name/data는 변경하지 않았다. slug 및 exact-one owner anomaly는 0이다.
- post-apply helper ACL gap(anon `3/3`)은 hosted forward-fix로 anon/PUBLIC `0/3`, authenticated `3/3`, direct anon denial `3/3`을 확인했다. PR #24 head `ef3d58d...`는 T10 PASS 뒤 main `915730df3ced1c845b4e3622ad59278d91580f7f`로 merged 됐다.
- Vercel Production deployment `99t1H9RDWx1SGKogizpyfaMvDzcL` success와 canonical domain public routing evidence를 기록했다. `/login` HTTP 200, protected deep path/query login redirect 보존, zero-membership과 non-member generic routing, console 0을 확인했다.
- current release는 **`MERGED / PRODUCTION_DEPLOYED / PARTIALLY_LIVE_VERIFIED`**. safe real one-membership/two-plus chooser 및 approval mutation browser fixture는 nonblocking `NOT_RUN`으로 남긴다.
- PR #19는 closed superseded, PR #20은 Draft/HOLD(rebase/renumber/reconciliation)다. old PR #23 docs draft는 stale hold record로 supersede/close 대상이며 correct docs-only publication을 별도 검증·merge한다.
- 후속 8개 프로그램은 `NEXT ONLY / NOT_STARTED`; `DYNAMIC-WORKSPACE-BUILDER-01`은 `PAUSED_BY_USER_PRIORITY`다. 제품/DB/migration/deploy write는 수행하지 않았다. `INTERNAL_SUBAGENT_ONLY: NONE`.

## 2026-07-28 — T03 · BUG-0003 딜 custom 통째 교체 + 단계 우회 (계약 소유 세션)

- **증상(무증상 파손)**: `Repo.updateDeal` 이 `Object.assign(d, rest)` 라 `patch.custom` 이 기존 `deal.custom` 을 **통째 교체**했다. 파일첨부 등이 `updateDeal(ctx, id, {custom:{files:[…]}})` 를 호출하면 T05 커스텀필드 값·T09 정책자금 값(exec_amount/fee_pct/fee_paid_at)이 **에러 없이** 전량 소실된다.
- **수정**: `app/src/lib/repo/custom-merge.ts` 의 `mergeCustom()` 단일 규약으로 **키 단위 병합**. patch 에 없는 키는 보존, 있는 키만 대체, 값이 `null` 이면 키 삭제(`setFieldValue` 의 "null = 셀 삭제"와 동일).
  - 병합 깊이는 한 겹뿐(값은 통째 대체). 재귀 병합은 `custom.files[]` 에서 **삭제한 첨부를 되살린다** — 의도적으로 하지 않는다.
  - `LocalRepo` 와 `SupabaseCrmSource` 가 **같은 함수**를 쓴다(구현체 간 규약 드리프트 차단).
- **단계 우회 차단**: "단계 변경은 move 전용(활동로그 보장)" 불변식이 서비스에만 있어 `getRepo().updateDeal(ctx,id,{stage_id})` 로 활동로그 없이 단계가 바뀌었다.
  - `DealPatch = Partial<Omit<NewDeal,"stage_id">>` — 타입에서 표현 불가로 바꾸고, 런타임 본문 우회는 구현체가 throw.
  - 포트에 `moveDeal(ctx,id,toStageId)` 추가 — 단계 갱신과 활동로그 기록을 **함께** 수행한다. `CrmService.moveDealStage` 는 이제 포트에 위임하고 사용자용 오류 타입 변환만 담당한다.
  - `parseUpdateDeal` 은 본문의 `stage_id` 를 400 으로 거부(기존 메시지 유지).
- **회귀 판정 기준**: "에러 없음"이 아니라 **값 잔존의 긍정 확인**. 새 구현을 옛 `Object.assign` 으로 되돌리면 `localRepo.test.ts` 의 4건이 실패하는 것까지 확인했다.
  - 신규: `repo/custom-merge.test.ts`(8), `repo/local/localRepo.test.ts` 의 병합·moveDeal 9건, `crm/service.test.ts` 의 포트 직접호출 2건.
  - `services/files.test.ts` 의 가짜 포트도 `mergeCustom` 을 쓰도록 고쳤다 — 가짜가 실제와 다르면 그 파일의 보존 테스트가 현실을 검증하지 못한다.
- **남긴 TODO(T02)**: Supabase 경로의 custom read-modify-write 와 이동+로그는 트랜잭션이 아니다(jsonb `||` / RPC 로 이관 필요). 코드에 TODO 로 명시.
- 게이트: `bash scripts/check.sh` 초록(app 587 passed / 5 skipped, worker 14 passed).

## 2026-07-28 — T03 · BUG-0003 merge → production deploy → 공개 health (완주)

- WORK-ID: `BUG-0003-DEAL-CUSTOM-MERGE-RELEASE`. 사용자 자율 머지 승인 아래 `구현 → 게이트 → PR → CI/mergeable → merge → deploy → 공개 health` 체인을 끝까지 실행했다.
- **MERGE_READY**: PR [#26](https://github.com/bbelieff/moawork/pull/26) — CI `check (lint + typecheck + test)` PASS, GitGuardian PASS, Vercel Preview PASS, `mergeable=MERGEABLE / mergeStateStatus=CLEAN`.
- **MERGED**: squash merge → main `e3c2f83dc8a647ec163716042169058f3f5fe22d` (14 files, +407/-30). merge 후 main 위 CI 재실행도 success.
- **DEPLOY_SUCCESS**: Vercel Production deployment `5625724746`, ref `e3c2f83d`, state `success` (2026-07-27T16:03:07Z). 최신 Production 배포가 이 SHA다.
- **PRODUCTION_VERIFIED (공개 health)**: canonical domain `https://www.moa-work.com/login` → HTTP **200** (`Server: Vercel`, `X-Vercel-Cache: MISS`, `<title>MoaWork — 통합관리시스템</title>`). apex `moa-work.com` → 308 → `www`. 보호 경로 `/dash/abc?x=1` → 307 → `/login?next=%2Fdash%2Fabc%3Fx%3D1` 로 deep path·query 보존 확인.
- **NOT_RUN(비차단)**: 인증 세션이 필요한 실시나리오(딜 custom 부분수정·단계 이동 활동로그)의 live 검증은 하지 않았다. 이번 변경은 사용자 가시 UI 변화가 없는 내부 계약 수정이며, 회귀 근거는 exact SHA 위 CI(587 passed / 5 skipped)와 옛 구현 되돌림 시 4건 실패 확인이다. `LIVE_DATA_VERIFIED` 로 승격하지 않는다.
- 배포 대상 도메인이 저장소 정본 어디에도 기록돼 있지 않아 매번 재발견이 필요했다 — 위 canonical domain을 여기 남긴다.
- consumer: T02(Supabase 트랜잭션 TODO), T04/T05/T09(custom 병합 규약). NEXT_WORK 없음.
## 2026-07-28 — C5 · PostHog (SDK · 프록시 · PII 스크러빙 · 리플레이 마스킹)

- 착수 전 실측: `PostHog` 는 워킹트리·전 브랜치 히스토리 138커밋 grep **0건**. `docs/coordination/` 의 최신 정본(`ROUND-33`)·`decision-inbox.md`·`PLAN-*.md` 어디에도 C5 항목이 없고, 기획2의 PII 스크러빙 dev-drop 도 존재하지 않는다. 따라서 수용기준은 사용자 지시문을 정본으로 삼고 순수함수를 직접 구현했다.
- base 는 `origin/main@7dc30f0`(T03 BUG-0003 머지 뒤 rebase). 다른 트랙의 dirty 워킹트리(`feat/t09-settlements`)는 건드리지 않고 별도 worktree 에서 작업했다. rebase 충돌은 본 worklog 말미 한 곳뿐이었고 T03 기록을 그대로 둔 채 뒤에 이어 붙였다.
- `app/src/lib/analytics/` 신설 — `scrub`(PII 순수함수) · `config`(env·init 옵션·리플레이 정책) · `rewrites`(프록시) · `env`(NEXT_PUBLIC 리터럴 판독) · `client`(no-op 안전 래퍼) · `index` 배럴 · README.
- **스크러빙 3중**: 민감 **키** 통째 마스킹 + 문자열 **값** 패턴(이메일·휴대/유선전화·주민등록번호·사업자등록번호·카드·IP·JWT/Bearer) + **URL** 쿼리 allowlist(목록 밖은 값 마스킹, 파라미터형 해시는 폐기). 정체불명 객체·깊이/배열 초과는 fail-closed 로 마스킹한다. `board_name` 등 업무 키는 사람 이름이 아니므로 보존한다.
- **리플레이 마스킹**: `maskAllInputs` + `maskTextSelector: "*"` 로 텍스트·입력 전부 차단, `maskTextFn` 으로 한 번 더 값 스크러빙, `[data-mw-no-record]` 는 녹화 제외. posthog-js 1.407 `SessionRecordingOptions` 에 unmask 계열 옵션이 없음을 타입 실측으로 확인했고 선택적 노출은 지원하지 않는다.
- **프록시**: `/ingest/*` → next.config rewrites(`static` 규칙 우선). 목적지는 `NEXT_PUBLIC_POSTHOG_HOST` 를 https 일 때만 채택하고 아니면 기본 리전으로 떨어진다(평문 전송 금지). `app/src/proxy.ts` matcher 에서 `ingest(?:/|$)` 를 제외 — 로그인 화면 이벤트 확보 + 비콘마다 세션 검증 왕복 제거. 경계를 붙여 `/ingestion` 은 계속 인증 게이트를 통과한다.
- **fail-closed 기본값**: 키 미설정·형태 불일치·`NODE_ENV=test` 면 SDK 청크조차 로드하지 않는다. `respect_dnt`, `person_profiles: identified_only`, `capture_pageview: false`(App Router 직접 전송), `autocapture` 는 켜되 `mask_all_text`/`mask_all_element_attributes` 로 내용 차단. deprecated `sanitize_properties` 대신 `before_send` 를 쓴다.
- **비밀값**: 키 값은 코드·로그·에러 메시지·본 문서 어디에도 없다. `.env.example` 에 형태(`phc_` + 영숫자 20자 이상)와 "개인/서버 키 금지" 경고만 추가했다.
- 게이트: `bash scripts/check.sh` 초록(lint · typecheck · app 668 PASS/5 skip · worker 14 PASS — 신규 81). `npm run build` 초록. `routes-manifest.json` 의 `/ingest/*` rewrite 2건과 `functions-config-manifest.json` 의 matcher 정규식을 빌드 산출물에서 직접 확인했다.
- RLS: 마이그레이션·DB 접근 **0** — 해당 없음. 375px 반응형·브랜드 토큰: `PostHogProvider` 는 DOM 을 그리지 않고 CSS·색상 리터럴을 추가하지 않는다(하드코딩 0). 두 항목 모두 "영향 없음"이며 통과로 승격하지 않는다.
- **미수행**: 브라우저 런타임 검증. preview 도구가 세션 프로젝트 디렉터리(다른 트랙의 워킹트리)를 기동해 이 worktree 에 닿지 않았고, 그 트리에 의존성을 설치하지 않았다. 실제 PostHog 키가 없어 수집·리플레이 종단 확인도 `NOT_RUN` 이다. 정적/빌드 산출물 검증만 근거로 남긴다.

## 2026-08-03 — MWC · coordination sole-writer 승계와 Linear 운영 루틴

- 사용자가 MWC의 coordination sole-writer 권한을 명시 승인했다. 범위는 coordination 문서와 append-only worklog이며 제품 코드·DB·배포·Linear 상태 변경 권한은 포함하지 않는다.
- 공유 `main` clean, `HEAD = origin/main = 2c126f23550d1031ff486c73cdaae9865cd0c06e`, GitHub connector 기준 열린 PR 0건을 재검증했다.
- `ROUND-34.md`에 Linear를 점유·의존성·검토·이정표·출시 운영판으로, GitHub main/PR/CI를 기술 정본으로 명시했다.
- 모든 세션은 작업 발견 시 Linear 중복 검색부터 수행하고, `task_id`·base SHA·전용 branch/worktree·owner·file lease·reviewer·blocked_by·acceptance criteria·hosted/auth NOT_RUN 경계를 갖춘 명시적 lease 뒤에만 구현한다.
- BBE-5 live 관찰에서 mode 선택 button 두 개는 DOM에 존재하지만 무스타일이라 선택 UI로 인식하기 어렵다. `FAIL / BLOCKED_NO_LEASE`로 기록하며 제품 수정은 하지 않았다.

## 2026-08-03 — [START · BBE-32/codex] 고객사 승인 대기열과 첫 진입 연결

- task_id `BBE-PLATFORM-ORG-ONBOARDING-01`, Linear `BBE-32`, base `eecaed0294aa95dfce908b6a0e5a9087013fa121`, branch `codex/bbe-platform-org-onboarding`, 전용 worktree `C:\Users\Belief-desktop\Desktop\개발프로젝트\.worktrees\bbe-platform-org-onboarding`에서 착수했다.
- lease는 `/platform/organizations` 페이지, 신규 `PlatformOrganizationsPanel`과 테스트, platform CSS 네 파일로 한정했다. DB·migration·RLS lease는 없으며 기존 원자적 회사 승인 RPC를 사용한다.
- acceptance는 고객사 관리 탭에서 실제 pending 요청을 찾고 승인·거절할 수 있는 첫 진입 흐름, 정직한 빈/불가 상태, 중복 클릭 차단, 390px 반응형, PR·CI·Production QA다. 실제 hosted 승인 mutation과 별도 일반 사용자 최초 신청, 모바일 실기기는 `NOT_RUN` 경계다.

## 2026-08-03 — [END · BBE-32/codex] 고객사 승인 대기열과 첫 진입 연결

- PR [#90](https://github.com/bbelieff/moawork/pull/90)을 squash merge해 `main@34758537c1321d67d9220907dc218148f6951cdc`가 됐다. feature commit은 `ee116cfa6d59ec7acde31ddd977c758f018675a1`이다.
- `/platform/organizations`를 숨겨진 기존 승인 기능과 연결했다. 승인 대기 수, 회사명·주소·요청 시각, 첫 진입 3단계, 승인·거절 제어, 안전 집계, 빈/불가/처리/성공 상태를 제공하며 고객 업무·개인정보는 노출하지 않는다.
- 게이트는 focused 4 PASS, `bash scripts/check.sh` app 1075 PASS/9 SKIP·worker 21 PASS, lint·typecheck·production build PASS, PR 및 main CI PASS다.
- Vercel Production `dpl_BM2g6txphAHZ1iN2rVBuqZZU4iZd`가 exact merge SHA로 READY이고 canonical `https://www.moa-work.com/platform/organizations`에 연결됐다.
- 독립 MWC Production QA는 `PASS_WITH_NOT_RUN_BOUNDARIES`(Linear receipt `a93e6bf7-49dd-43b1-822a-e752259cb314`): 실제 승인 대기 2건과 3단계 렌더, 사용자 모드의 관리자 DOM 비노출, 관리자 복귀, 390×844 무가로오버플로, console warning/error 0을 확인했다.
- 실제 승인·거절 및 owner 멤버십 생성, 별도 일반 사용자 최초 신청, hosted DB/migration 변경, 모바일 실기기는 `NOT_RUN`이다. DB/schema/RLS 변경은 0이며 Linear `BBE-32`는 Done이다.

## 2026-08-10 — [START · 모아워크 데탑 CT08(260810)/claude] BBE-116 로고가 셸에 없다

- Linear `BBE-116`, base `7520361c2f8620f4e40345098697cffbc571d5fb`(#115), branch `claude/bbe-116-brand`, 전용 worktree `.worktrees/bbe-116-brand`.
- 착수 전 실측으로 D44의 전제("Logo가 셸에 미연결")를 정정했다 — `app/(app)/layout.tsx`에 이미 연결·홈 링크 동작 중이었고, `grep Logo shell/*.tsx`가 0건인 이유는 콜사이트가 `shell/` 폴더 밖이라서였다. 실제 미충족 수용 기준은 회사별 로고·로고 없을 때 이름 대체 2건뿐.
- lease: `app/src/components/brand/**`(신규 `WorkspaceBrand`) · `supabase/migrations/035_*.sql`(신규 파일, `orgs.logo_url` nullable 추가) · `app/src/lib/types/index.ts`(`Org.logo_url` 선택 필드) · `app/src/lib/auth/session.ts`(select·parseOrg 각 1줄). `app/(app)/layout.tsx`는 00_배정판에 소유자가 없어 BBE-94에 선언 후 2줄(import+JSX)만 접촉 — BBE-126(CT07)과 겹칠 가능성 대비.
- acceptance: 로고 왼쪽 위·클릭 시 홈(기존 동작 유지) · 회사마다 다른 로고(구조적으로 가능, 값 채우는 관리 UI는 범위 밖) · 로고 없는 회사는 이름 대체(오늘 전 회사 해당).
- Production QA·스크린샷은 로컬 preview가 이 worktree가 아닌 launch.json 디렉터리를 띄우는 기존 제약과 `(app)` 셸의 실 로그인 요구가 겹쳐 `NOT_RUN` — 정적 렌더로 갈음, PR #130 본문에 마크업 증거 첨부.

## 2026-08-11 — [START · 모아워크 노트북 CT02(260810)/claude] BBE-112 온보딩 엔진 — 연습 회사 + 퀘스트 + 판정

- task_id Linear `BBE-112`, base `origin/main@c32e01e56c209500835a7640a54b061726ee8e49`(`git fetch` 후 실측),
  branch `claude/bbe-112-onboarding`, 전용 worktree `개발프로젝트\.worktrees\bbe-112-onboarding`.
- 착수 전 6단계: `node docs/design/dump-mockup.mjs`(전체·new 탭) 열람 · `node docs/design/qa-mockup.mjs`
  → **86/86 통과**(55도 75도 아님, 목업이 계속 개정 중) · `docs/evidence/온보딩녹취-실무흐름-01.md` 전문 열람.
- **배정서 대 결정대장 불일치 발견**: 배정서 "덮는 결정: D58 D59 · H-4"이나, 결정대장을 실측하면
  D58(→BBE-110·125)·D59(→BBE-122, 관찰만)는 §G/H-3 자체 카드 매핑상 BBE-112를 가리키지 않는다.
  H-4는 "온보딩"이라는 단어가 겹치지만 **실제로는 컨설턴트가 고객사에 먼데이를 인계하는 녹취**(온보딩
  엔진과 다른 뜻)이고, H-4의 개별 결정(D60~D68)은 전부 BBE-124·107·105·111·118·114·109로 매핑돼 있다.
  **§G의 D45b("온보딩 = 자동화 규칙에서 퀘스트를 생성. 연습용 회사에서 실제 조작으로 판정") 가 §J 카드
  대조표에서도 BBE-112·113으로 직접 매핑되는 유일한 정본 결정**이다. D45b + D71~D75(카드 본문에 이미
  전문 인용)를 정본으로 진행한다. H-4는 실무 맥락 참고자료로는 읽었으나 판정 기준으로 쓰지 않는다.
- **연계 확인**: D45b는 "규칙→퀘스트 생성"을 BBE-113(노트북 GT07 소유)에 맡긴다. 이 카드(BBE-112)는
  **엔진**(연습 회사 격리 · 퀘스트 카탈로그 저장소 · 판정 방식)을 소유한다. GT07이 기다리는 "판정 방식"은
  아래 판정 계약으로 확정해 BBE-94에 공개한다: 퀘스트는 `judge_kind`(고정 어휘, 자유 SQL 아님) +
  `judge_params(jsonb)`로 정의되고, `onboarding_quest_defs` 테이블에 행으로 저장된다 — GT07은 자동화
  규칙을 이 스키마의 행으로 변환해 넣기만 하면 된다(신규 judge_kind가 필요하면 별도 협의).
- **아키텍처 결정** — 격리 방식: `orgs`/`org_members`(001)의 기존 RLS 경계를 그대로 재사용한다.
  연습 회사 = 고유 `org_id` 하나의 진짜 `orgs` 행(신규 `orgs` 컬럼 추가 없음, 001 무수정) — 이러면 격리는
  "모든 쿼리가 이미 org_id로 스코프된다"는 기존 불변식에 **공짜로 올라탄다.** 별도 필터 로직을
  코드 전역에 추가할 필요가 없다(추가했다면 어디선가 빠뜨릴 위험 = "경계가 무너지면 카드 전체 무효").
  신규 레지스트리 테이블(`onboarding_practice_workspaces`)이 "이 org_id는 연습용, 소유자는 누구"만 기록.
- **실측 — 보드 데이터가 실제로 어디 사는지**: `app/src/lib/repo/local/boardsRepo.ts`의 `getBoardsRepo()`는
  현재 **무조건 `LocalBoardsRepo`**(프로세스 전역 인메모리 싱글턴)를 반환한다 — Supabase 백엔드는 아직
  없다(포트 주석 "Supabase 연결 시 같은 포트에 끼운다" = 미래형). `supabase/migrations/003_boards_engine.sql`의
  `boards/items` 테이블은 **현재 런타임 경로에서 쓰이지 않는다.** 따라서 퀘스트 판정은 SQL로 `items`
  테이블을 조회해선 안 되고(존재하지도 않는 상태를 볼 것), **`BoardsRepo` 포트(TS)를 통해** 실제 상태를
  읽어야 한다 — 포트 추상화 덕에 나중에 Supabase 백엔드가 생겨도 판정 코드는 그대로 간다.
- 리스: `app/src/lib/onboarding/**` · `app/src/components/onboarding/**` ·
  `supabase/migrations/035_onboarding.sql`(작업명 — 034가 현재 최신, 단 BBE-116도 오늘 035를 문서에
  적어놨다(`orgs.logo_url` 추가) — **번호 충돌은 머지 시점에 재확인**, 지금은 안전하게 035로 작업하고
  PR 직전 `git fetch` 재실측 후 필요시 036으로 rename한다).

## 2026-08-11 — [END · 모아워크 노트북 CT02(260810)/claude] BBE-112 온보딩 엔진 — 연습 회사 + 퀘스트 + 판정

- PR 제출(머지는 검수자 데탑 CT03 승인 후). branch `claude/bbe-112-onboarding`, head 는 본 커밋.
  base 재확인 `origin/main@c32e01e`(변동 없음, 착수 시와 동일) · 마이그레이션 최신 여전히 `034`
  → `035_onboarding.sql` 번호 유지. BBE-116 과의 035 충돌 가능성은 검수자에게 별도 명시.
- `supabase/migrations/035_onboarding.sql`: 001 무수정. 신규 3테이블
  (`onboarding_practice_workspaces` 레지스트리 · `onboarding_quest_defs` 카탈로그 ·
  `onboarding_quest_progress` 진행기록) + 5함수(`is_my_practice_workspace`·
  `ensure_my_practice_workspace`·`list_onboarding_quests`·`record_quest_progress`·
  `read_my_practice_progress`) + 씨드 퀘스트 3건. 격리는 새 컬럼·필터를 추가하지 않고
  001의 기존 org_id RLS 경계에 올라탄다(연습 회사 = 진짜 orgs 행 하나, 001의 `add_org_owner`
  트리거로 자동 owner화). **로컬 pglite 자체검증**(스크래치패드, 미커밋) 13개 시나리오
  **13/13 통과** — 특히 ④~⑦·⑪이 "B가 A의 연습 회사를 못 보고, 진짜 org에는 판정 자체가
  거부됨"을 직접 증명한다.
- **판정 대상이 003 boards/items Postgres 테이블이 아님을 실측으로 확인**: `getBoardsRepo()`가
  현재 무조건 `LocalBoardsRepo`(인메모리 싱글턴)를 반환해 003 스키마는 런타임에서 안 쓰인다.
  그래서 판정은 SQL이 아니라 `BoardsRepo` 포트(TS)로 실제 상태를 읽는다 — 나중에 Supabase
  백엔드가 붙어도 포트만 교체되면 판정 코드는 그대로 간다.
- `app/src/lib/onboarding/quests.ts` — judge_kind 고정 어휘 3종(`item_created`·`item_in_group`·
  `column_value_set`), 전부 `BoardsRepo` 상태 읽기(자유 SQL·코드실행 아님). 이것이 **BBE-113
  (노트북 GT07)이 기다리던 판정 방식**이다 — GT07은 자동화 규칙을 `onboarding_quest_defs` 행으로
  변환해 넣기만 하면 되고, 새 judge_kind가 필요하면 이 파일에 추가 협의한다. BBE-94에 공개함.
- `app/src/lib/onboarding/server.ts` — `ensurePracticeWorkspace`(연습회사 확보 + 기존
  `installStructurePack` 재사용으로 구조 설치, 아이템은 안 만듦=D71~D75와 동일 원리) ·
  `evaluatePracticeQuests`(판정 후 최초 통과만 기록, 실패는 permission/unavailable로 구분).
- `app/src/components/onboarding/OnboardingPanel.tsx` + `actions.ts` — 연습 시작 진입 화면 ·
  퀘스트 목록(통과 N/전체) · 다시 확인 폼(FormData 기반 `"use server"`, notices/perm 관례 따름) ·
  권한없음/장애 두 화면 분기.
- 테스트 4파일 25건: `quests.test.ts`(12, 교차 조직 격리 증명 포함) ·
  `OnboardingPanel.test.tsx`(7) · `seed-contract.test.ts`(2, 씨드 judge_kind ↔ JUDGES 어휘
  드리프트 가드). 전부 값 긍정 확인(F12).
- 수용 기준 대조: 연습 회사 생성·분리 — pglite ①②③④⑤⑥ 통과 · 퀘스트 목록·통과 — UI+judge
  테스트 · 시스템이 실제 동작으로 판정 — judge_kind 3종이 checkbox 아닌 실제 BoardsRepo 상태
  읽기 · 연습 데이터가 진짜 집계에 안 섞임 — org_id 격리가 구조적 보장(003 pipeline 새로 만들지
  않음, 기존 RLS 불변식 그대로 재사용) + quests.test.ts 교차조직 테스트로 재확인.
- 게이트: `bash scripts/check.sh` **PASS** — app 137 files/1284 tests(신규 25) · worker 35.
  비밀값 스캔 0 · 하드코딩 hex 0(처음부터 `--mw-*` 토큰만 사용) · `app_admins` 직접 select 0 ·
  변경 파일 = 리스 정확히 3패턴 + `docs/worklog.md`.
- NOT_RUN: hosted DB 적용(F9, 로컬 비밀값 없음) · 화면 스크린샷(로컬 `(app)` 셸이 Supabase env
  없이는 500이라는 기존 제약 — 로그인 우회 임시패치로 검증할 수도 있으나 이 카드는 라우트에
  아직 연결돼 있지 않아 그 자체가 대상 화면이 없다. BBE-122와 같은 사유로 와이어링 후속 필요:
  `OnboardingPanel`을 실제로 띄울 진입 라우트가 이 카드 리스 밖(설정 메뉴 등)이다).

## 2026-08-11 — [START · 모아워크 DC 02/claude] BBE-142 앱 셸 — 목업 「탭 6개 한 화면」 구조

- task_id Linear `BBE-142`, base `origin/main@36a68353bf3812f706883e1ced8dd538583aec56`
  (`git fetch` 후 실측 · 직전 내가 머지한 BBE-103(#116) 바로 다음 커밋), branch
  `claude/bbe-142-app-shell`, 전용 worktree `개발프로젝트\.worktrees\bbe-142-app-shell`.
- 발행 경위: BBE-103 완주 후 §8 반납 역제안이 그대로 카드가 됨(총괄 확인).
- **BBE-140(qa-app.mjs) 참조**: 아직 미머지(`codex/bbe-140-qa-app`, NG-02). 지시대로 그 브랜치의
  `docs/design/qa-app.mjs`·`dump-mockup.mjs` 갱신분을 **로컬 실행 전용으로만** 빌려 쓴다 —
  내 브랜치에는 커밋하지 않는다(파일 소유는 NG-02, 내 리스 밖). 스크립트를 읽어보니 "탭 위치 차이"
  체크는 `mockTab.nav` 존재 여부만으로 무조건 찍는 하드코딩이라(앱 쪽 비교 대상이 아직 없음),
  내가 무엇을 만들어도 이 필드 자체는 안 줄어들 수 있다 — PR에 이 관찰을 그대로 적는다.
- **주소 실측**: `find app/src/app -name page.tsx` = **39개**(카드 표기 "25개"와 다름 — 최근
  BBE-46/BBE-16/온보딩 등 병합으로 늘어난 것으로 보임, 정정 기록). 목업 6탭 매핑:
  신규리드→`/newcust`+`/boards`+`/boards/[id]` · 리드컨택→`/contract` · 계약업체 실무→`/policyfund`
  (BBE-103에서 MWC가 실측 근거로 확정, 재검토 안 함)+`/work`(신규, 데이터 비어있음)+`/policyfund/settlements` ·
  업체관리→`/companies`+`/companies/[companyId]` · 공지→`/notices`+`/notices/[noticeId]` ·
  **프리셋 라이브러리 → 대응 주소 0건(신설 필요)**. 나머지(대시보드·설정·계정·플랫폼 어드민·온보딩·
  워크스페이스 전환)는 카드가 명시한 대로 "탭 밖"으로 분류.
- 리스: `app/src/app/(app)/layout.tsx` · `app/src/components/shell/**` ·
  `app/src/app/(app)/page.tsx`(탭 진입 라우팅 한정). 프리셋 라이브러리 페이지 신설은 리스 밖 새 파일이라
  "조립은 남의 부품을 만지는 일"(카드 본문) 원칙으로 진행하되 다른 세션 소유 흔적 없음을 확인했다.
- 방침: 175건을 이 카드로 없애려 하지 않는다. new/work 탭의 기존 href(각 `/newcust`·`/policyfund`)는
  이미 근거 있게 확정된 결정이라 재검토하지 않고 그대로 둔다 — "틀만 세운다"에 집중.

## 2026-08-12 — [END · 모아워크 DC 02/claude] BBE-142 앱 셸 — 목업 「탭 6개 한 화면」 구조

- PR 제출. branch `claude/bbe-142-app-shell`. base `origin/main@36a6835`(변동 없음).
- `app/src/components/shell/app-tabs.ts`(신규) — 목업 6탭 ↔ 앱 주소 정본 매핑.
  `canonicalHref`는 new/work 둘 다 BBE-103 확정값 그대로 유지(재검토 안 함) · 프리셋만 신규.
  `OUT_OF_TAB_HREFS`로 대시보드·설정·계정·플랫폼 어드민·온보딩·인증 등 "탭 밖" 명시 분류.
  드리프트 가드 테스트(`app-tabs.test.ts`)가 실제 파일시스템의 모든 `page.tsx`를 스캔해 6탭
  또는 탭밖 목록 어디에도 없는 라우트가 생기면 실패한다 — 유령 주소·누락 주소 둘 다 막는다.
- **주소 실측 정정**: 카드 표기 "25개" → 실측 **39개**(page.tsx 기준). 최근 병합(BBE-46/16/온보딩
  등)으로 늘어난 것으로 보인다. worklog에 기록만 하고 카드 수치를 임의로 안 고쳤다.
- `app/src/app/(app)/presets/page.tsx`(신규) — 프리셋 라이브러리, 이전엔 대응 주소 0건이었다.
  `allSectionPresets()`/`SEOUL_STRUCTURE_PACK` 실데이터로 아이템 프리셋 32종을 보드별로 나열
  (하드코딩 아님 — 테스트가 팩 실제 개수와 대조). 뷰 프리셋은 저장뷰 시스템과 미연결이라
  가짜 개수를 만들지 않고 "아직 없음"으로 정직하게 표시. 편집기는 범위 밖(NG-05가 후속 카드로 쪼갠다).
- `icons.tsx`에 `preset` 심볼 추가 — 목업 원본 `<symbol id="i-preset">` 그대로 포팅(D43).
  `nav-items.ts`에 6번째 탭 연결(`/presets`), members 다음 위치 — 목업 자체 NAV 배열도
  preset을 "업무" 그룹이 아니라 "설정" 그룹에 둬서(실측: `NAV=[...["설정",[...,"preset",...]]]`)
  같은 취지로 배치했다(현재 nav-items.ts는 섹션 구분 없는 평면 목록이라 순서로만 근사).
- **리스 밖 불가피한 접촉 1건**: `/presets` 신규 라우트가 001/006/021 계열의 예약 슬러그
  가드(`RESERVED_WORKSPACE_SLUGS`)를 건드려 기존 테스트(`workspace-entry/contracts.test.ts`)가
  실패했다. `contracts.ts`에 "presets" 한 줄 추가 + 새 마이그레이션
  `058_reserve_presets_workspace_slug.sql`(021과 같은 패턴으로 drop/재생성, 021 파일 자체는
  무수정) + DB-TS 대조 테스트를 "021 하드코딩"에서 "가장 최신 정의 파일 자동 탐색"으로 보강
  (021 이후 006·009·014도 같은 제약을 순차 갱신해 온 이력을 실측하고서야 이 구조를 알았다).
  전부 내가 새로 만든 라우트가 유발한 필연적 결과라 "조립은 남의 부품을 만지는 일"(카드 본문)
  범위로 판단해 처리했다. 로컬 pglite로 `slug='presets'` 거부를 직접 확인(①PASS).
- **BBE-140(qa-app.mjs) 실행 결과**: `codex/bbe-140-qa-app` 브랜치에서 스크립트 2개를 로컬에
  임시로만 반입해 실행(커밋 안 함, 실행 후 원상복구 확인) — **차이 합계 175건, 카드 인용값과
  일치**(같은 버전 확인). 다만 "탭 위치 차이"(new/contact/work 각 1건, 총 3건 — 카드가
  줄어들길 기대한 항목)를 코드로 실측하니 `if(mockTab.nav)` 조건 하나로 **무조건** 찍히는
  하드코딩이었다 — 앱 쪽 실제 nav 데이터를 아직 아무 것도 비교하지 않는다. 즉 이 3건은
  내가 무엇을 만들어도 qa-app.mjs 자체가 앱 nav를 읽게 갱신되기 전까지는 줄지 않는
  **구조적 한계**다. NG-02(BBE-140)에 그대로 넘긴다 — 내 카드의 실패가 아니라 측정 도구의
  다음 확장 지점이다.
- 화면 확인(1440px+375px, 로컬 webpack dev 서버 + 로그인 상태): `/presets` 렌더 확인(아이템
  프리셋 32, 보드 3개 그룹, 뷰 프리셋 정직 미구현 표시) · 사이드바 `preset→/presets` href 실측 ·
  375px 가로 오버플로 0 · 콘솔 앱 에러 0. **스크린샷 PNG는 이번에도 확보 못 함** — BBE-103과
  동일한 컴포지팅 제약이 재현됨(재현성 재확인, 세션 탓 아니라 환경 탓으로 굳어지는 패턴).
- 게이트: `bash scripts/check.sh` PASS — app 184 files/1569 tests(신규 15) · worker 57.
  `npm run build` PASS(39개 라우트 전부, `/presets` 포함, 깨진 것 없음). `app_admins` 직접
  select 0 · 하드코딩 hex 0 · 비밀값 0.
- 변경 파일: 리스 3패턴(`layout.tsx` 무변경·`shell/**` 5개 신규/수정·`(app)/page.tsx` 무변경)
  + 불가피 접촉 3개(`workspace-entry/contracts.ts`·`.test.ts`·신규 migration 058)
  + `docs/worklog.md`. `layout.tsx`·`(app)/page.tsx`는 결과적으로 안 건드렸다 — 사이드바만
  손대면 충분했다.

## 2026-08-12 — [END · 모아워크 DC 04/claude] BBE-148 발송 4칸 안전장치 (부품)

- 카드: BBE-148 · 브랜치 `feat/bbe-148-send-guard` · base `7733876`
- 목업 정본에서 출처가 «✉ 발송» 인 칸의 값을 바꾸면 **고객에게 문자가 나가고 건당 비용이 든다.
  되돌릴 수 없다.** 그 칸에 «확인 한 단계» 를 끼우는 **부품**이다. 탭 화면은 만들지 않았다
  (탭은 DC-02/DC-03 소유). 발송 칸을 쓰는 모든 탭이 이 부품을 공유한다.
- `app/src/lib/send-guard/` — 카탈로그(어떤 칸이 발송인가) · 계획(누구에게·몇 건·무슨 문구·얼마) ·
  확인 게이트 · 이력 · 문구 템플릿. `app/src/components/send-guard/SendConfirmDialog.tsx` — 확인 화면.
- ★ 발송 칸 판정을 **목업 4칸이 아니라 앱 구조 팩 실측 6칸** 으로 잡았다. 목업은 «부재 메세지»·
  «악성부재 메세지전달» 을 «부재 안내» 하나로 합치고 «AI_3차불가» 를 뺐다. 목업 4칸만 등록하면
  **앱에 실제로 서 있는 발송 칸 2개가 무방비로 남는다.** `catalog.test.ts` 가 구조 팩을 훑어
  카탈로그 밖 발송 칸이 하나라도 있으면 실패시킨다.
- ★ 「확인 없이는 아무 요청도 나가지 않는다」를 타입으로 못박았다 — `SendRequest` 는 브랜드 타입이라
  객체 리터럴로 만들 수 없고 `confirmSend()` 만 만든다. 게이트 5개(확인 유무 · 계획 지문 · 건수 ·
  대량 시 직접 입력 · 보낼 건 유무)를 전부 통과해야 한다. 확인과 실행 사이에 대상·값·비용이
  바뀌면 지문이 달라져 거부된다.
- ★ 「건수를 직접 입력해야 눌린다」를 `disabled` 토글이 아니라 브라우저 기본 폼 검증
  (`required` + `pattern`)으로 만들었다. **JS 가 죽어도 제출이 막힌다.** 서버가 같은 것을 또 센다.
- ★ **실제 발송 0건.** 통로는 «보존하되 활성화 금지»(BBE-30) — `SEND_DISPATCH_ENABLED=false` ·
  `assertDispatchAllowed()` 는 항상 던진다. 테스트에서 실제 API 를 부르지 않는다(fetch 스텁으로
  호출 0 확인). provider 설정 · worker 자격증명 · 058 hosted 적용은 belie 개별 승인 사항이라
  이 카드 밖이다.
- 함께 고친 것: `lib/field/source.ts` 의 msg 배지 tone 을 `danger` 로(기존엔 ✎·▼ 와 같은 중립 톤
  이라 «눈에 띄게 다르다» 가 성립하지 않았다) · `FieldBadge` 에 danger 톤 클래스 추가.
  새 hex 없이 `--mw-error` · `--mw-tint-coral` 토큰만 썼다.
- 화면 확인: `node docs/design/preview-send-guard.mjs` 로 제품 컴포넌트를 제품 스타일시트
  (globals.css)로 렌더 → **1440px · 375px 직접 촬영**. 증거와 재현 방법은
  `docs/design/round-BBE-148/README.md`. 로컬 `(app)` 셸은 `.env` 의 Supabase 값이 빈 값이라
  500 이다(2026-08-11 부터의 기존 갭 · 이 카드 탓 아님). 그래서 라우트 대신 하네스로 찍었고,
  검수자가 같은 명령으로 같은 그림을 다시 만들 수 있다.
- 촬영 메모: 윈도우 크롬은 창 폭을 약 500px 아래로 줄이지 않아 `--window-size=375` 로 찍으면
  레이아웃은 더 넓게 잡히고 그림만 잘린다. 처음 찍은 375 그림이 실제로 잘려 있었다 →
  폭 375px `iframe` 껍데기로 다시 찍었다.
- 그리다가 눈으로 잡은 것 2건: ① 보낼 건이 0인데도 «실제로 나갈 문장» 을 띄우고 있었다(나가지
  않을 문장이다) → 「보낼 건이 없어 나갈 문장이 없습니다」로 교체. ② 목업 `setCell` 은
  «미팅 미지정» 을 idle 값에서 빠뜨려 미지정으로 되돌려도 발송으로 판정한다 → 카탈로그가
  칸별 idle 값을 따로 갖게 해서 막았다.
- 게이트: `bash scripts/check.sh` **PASS** · 신규 테스트 53건(app) · qa-app 차이 175건으로
  **변동 없음**(부품이라 구조 팩을 건드리지 않았다 — 구조 축소 0).
- 마이그레이션 추가 **없음** · `app_admins` 직접 select **0건** · 비밀값 **0건**.
- NOT_RUN: hosted 배포·health(이 카드는 라우트를 추가하지 않는다) · 실제 발송(의도적으로 막음).
- 후속으로 남기는 것(소비자 없는 부품은 만들지 않는다 — AGENTS.md §3):
  ① DC-03 신규리드 관통이 `planSend`→`SendConfirmDialog`→`confirmSend` 를 셀 편집 경로에 연결
  ② 지금 `GroupTable` 의 `window.confirm` 은 대상·건수·문구·비용을 못 보여 주고 **서버가 다시
     검사하지 않는다** — 셀 편집 경로가 이 부품으로 갈아탈 때 함께 걷어내야 한다
  ③ 구조 팩 `PackColumn` 에 출처(source) 메타가 없어 qa-app 이 «앱 출처 정의 없음» 을 17건
     보고한다. 카탈로그는 라벨·key 로 우회했으나 정본은 팩에 출처를 넣는 것이다(별도 카드)

### 정정 — 같은 날 [모아워크 DC 04] · BBE-148 (append-only 규칙에 따라 위 기록은 남기고 여기에 덧붙인다)

위 기록의 「`SendRequest` 는 브랜드 타입이라 **객체 리터럴로 만들 수 없고**」는 **과한 주장이었다.**
브랜드는 «실수로 만드는 것» 만 막는다. `as SendRequest` 로 억지로 캐스팅하면 타입은 뚫리고,
TypeScript 로 그것을 막을 방법은 없다.

그래서 `verifySendRequest()` 를 더했다 (`fffb2a1`). 요청이 들고 있는 내용만으로 지문을 다시
계산해 확인 화면이 보여 준 계획과 같은지 센다 — 확인 뒤에 대상 목록이나 비용이 바뀐 요청,
게이트를 건너뛴 지어낸 요청은 값에서 걸린다. `assertDispatchAllowed(request)` 가 통로가
열린 뒤에도 이것을 다시 본다. 테스트 4건 추가(신규 합계 57건).

**다만 이것도 «사람이 확인했다» 를 증명하지는 못한다.** 그 증명은 서버가 `planSend()` 로 계획을
**새로 계산해** `confirmSend()` 에 넘겨, 사람이 본 지문과 지금 지문이 같은지 보는 것으로만 성립한다.
그것이 이 부품의 진짜 잠금이고, **소비하는 화면이 반드시 그 순서로 불러야 한다** — DC-03 에 인계한다.

### 1단 독립 검수 결과 반영 — [모아워크 DC 04] · BBE-148

서브에이전트 독립 검수(부모 결론 미주입)가 8항목 중 **8번(확인 게이트 우회)에서 구멍 1개를 실측**했다.
판정은 **「2단 승격 필요 — ② 발송·과금」**. 원문은 PR #169 코멘트에 그대로 붙였다.

**잡힌 것** — `verifySendRequest()` 가 「사람이 확인했다」를 전혀 증명하지 못했다.
`planFingerprint()` 의 재료가 **전부 요청 자기 필드**라, 위조자가 지문을 스스로 계산해 넣으면
자가일관성 검사를 그냥 통과한다. 검수자가 실행 출력으로 `true` 를 보여 줬다.
내 테스트 「지어낸 요청은 걸린다」는 지문을 `"0".repeat(64)` 로 넣어 둬서 **막힌 것처럼 보이게 했다** —
지문을 계산할 줄 아는 호출자에게는 무력했다. 지적이 맞다.

**고친 것** (`app/src/lib/send-guard/ticket.ts` 신설)

- **확인표(1회용 티켓)** 를 도입했다. 확인 화면을 그릴 때 서버가 난수 id 로 발급하고
  (`issueConfirmationTicket`), 발송 요청을 만들 때 **태운다**. 요청 본문만 보고는 지어낼 수 없고,
  한 번 쓰면 사라지므로 같은 확인으로 두 번 보낼 수도 없다.
- `confirmSend(plan, confirmation, store, nowMs)` — 시그니처가 바뀌었다. **확인표 검사가 ⓪번**이고
  그다음이 기존 5개다. 확인표는 계획 지문·발급받은 사람에 묶이고 10분 뒤 만료된다.
  틀린 확인표로 반복해 찔러 볼 수 없게, 손댄 확인표는 실패해도 태운다.
- `verifySendRequest` → **`isSelfConsistentRequest`** 로 이름을 낮췄다. 그것이 잡을 수 있는 것은
  「만들어진 뒤 내용만 바뀐 요청」뿐이라는 것을 이름과 주석에 명시했다.
- 테스트로 **한계까지 고정**했다 — 「지문까지 정확히 계산한 위조는 자가일관 검사를 통과한다(`true`)」를
  ★ 표시로 남겨 두고, 바로 다음 테스트에서 **같은 위조가 확인표 관문은 못 넘는다**를 증명한다.
  숨기지 않고 어디까지가 보장인지 코드로 적어 뒀다.
- 검수자가 지적한 대로 **인터페이스에 확인표 자리를 지금 넣었다.** 나중에 넣으면 DC-03 이 다시 고쳐야 한다.

**함께 고친 것** — `SendConfirmDialog` 가 배럴(`@/lib/send-guard`)로 값을 가져오고 있었다.
배럴은 `plan.ts` 를 끌고 오고 그것은 `node:crypto` 를 부르므로, 소비하는 쪽이 이 화면을
`"use client"` 안에서 그리면 **빌드가 깨진다.** 순수 모듈(`exclusions.ts` 신설 · `template.ts`)에서만
값을 가져오도록 바꾸고, 임포트 자리를 테스트로 못박았다.

**검수자가 지적한 신고 오류 2건도 맞다** — PR 본문의 「신규 테스트 53건」은 과소 신고였고
(당시 실측 57건), 「1단 검수 결과를 PR 코멘트에 붙인다」는 검수 시점에 아직 미이행이었다. 둘 다 정정·이행했다.

게이트 재실행: `bash scripts/check.sh` **PASS** · 신규 테스트 **85건**(app 전체 1632 passed) ·
qa-app 차이 **175건 변동 없음** · 화면 증거 재촬영(1440·375, 확인표는 hidden input 이라 그림은 동일).

**2단은 NG-01 이 봐야 한다** — 돈 축이다. 나는 PASS 를 내지 않고, 자기 PR 을 자기가 approve 하지 않는다.

### 서명 정정 — 위 BBE-148 기록의 작성 세션은 **[모아워크 NC 04]** 다

append-only 규칙에 따라 위 기록은 그대로 두고 여기에 덧붙인다.

**위 BBE-148 항목 셋(END 기록 · 정정 · 1단 검수 반영)의 `모아워크 DC 04` 표기는 오기다.** 작성 세션은
**NC**(노트북 클로드) **04** 이며, 2026-08-12 belie 확인으로 정정했다. **코드·게이트 결과는 그대로다.**

- Linear `BBE-148` 에 붙은 라벨 `DC-04` 는 **손대지 않았다.** 라벨 변경 = 배정 변경이고
  그것은 총괄 소유다(AGENTS.md §4 · §6.2 «대행이 못 하는 것»). 판단 요청 3안을 `BBE-148` 코멘트에 남겼다.
- 잘못 찍힌 내 도장은 없다 — `BBE-148` 코멘트 0개 · `BBE-94` 내 코멘트 0개였고(실측),
  이번에 처음으로 `[모아워크 NC 04]` 서명으로 남겼다. 기존 라운드 기록의 «DC-04» 표기는
  디스패치·총괄이 남긴 그들의 기록이라 내가 고치지 않는다.
- PR #169 본문과 내 코멘트 2건의 서명도 정정했다(내용은 고치지 않고 정정 주석만 덧붙였다).

**실질 영향 — 검수 라우팅이 바뀐다.** AGENTS.md §5 기준 작성자가 NC 이므로:

```
평시 짝 검수   NC ↔ NG  →  NG-01
2단(돈)        NC → DG  →  DG-01      ← 정정 전에는 NG-01 에만 요청했다(DC 기준)
```

카드가 «DC-04 산출» 로 정리되면 둘이 뒤바뀐다. 어느 쪽이든 NG-01·DG-01 이 한 번씩 보므로
커버리지는 같다 — 순번 판단은 총괄에게 맡기고, 나는 두 반장 모두에게 요청을 남겼다.

**다음 자리** — 정정된 내 칸 `NC-04` 는 «프리셋 라이브러리·뷰»(라벨 설명) ·
«구조 팩 컬럼·타입·**출처** 계약 P0»(BBE-94 조립순서 코멘트)이다. 위 기록이 남긴 후속 ③
— 구조 팩 `PackColumn` 에 출처 메타가 없어 `qa-app` 이 «앱 출처 정의 없음» 을 17건 보고한다 —
이 그 칸의 일이다. **`[NC-04]` 라벨이 붙으면 착수한다. 라벨 없이 착수하지 않는다(§4②).**

## 2026-08-12 — BBE-146 DB 바닥 정합화 부품 납품 [모아워크 DG 02]

- base `origin/main@7733876`, branch `codex/bbe-146-board-foundation-reconcile`.
- hosted BBE-141 실측의 052 partial drift(`status`만 존재)를 전제로, 기존 migration을 수정·재실행하지 않고 provisional `059_board_foundation_reconcile.sql`을 append-only로 작성했다. 머지 직전 최신+1 재번호화가 필수다.
- 순서: 052 정합화 → 054 → 055 → 056. `field_type`은 17종(001의 13종 + status/people/money/calc)으로 유지하며 multiselect/url을 삭제하지 않는다.
- 적용 후 `board_columns.source/right_pinned/move_rule_jsonb/is_readonly`, `field_source` 6종, 권한 054/055 객체가 생긴다. 057/058 outbox·발송은 무접촉이다.
- rollback SQL과 hosted 적용 전 체크리스트를 동봉했다. enum label은 PostgreSQL에서 안전한 DROP VALUE가 없어 rollback 후에도 보존한다.
- PGlite partial-drift fixture에서 동일 migration 2회 실행 및 rollback PASS. 전체 `scripts/check.sh` PASS: app 1569 pass/9 skip, worker 85 pass. qa-app 기존 차이 175건은 보고 전용.
- hosted 적용·고객 데이터 조회·비밀값 조회는 수행하지 않았다. 소비자 BBE-145 착수 전 hosted 적용은 별도 belie 승인과 DC-01, NC-01 2단 검수가 필요하다.

## 2026-08-12 — BBE-146 범위 확장: BBE-107 상세 배치 저장 [모아워크 DG 02]

- PR #166이 migration 059를 점유한 open 상태임을 재확인해 BBE-146 파일을 provisional 060으로 재키잉했다. 머지 직전 `origin/main` 최신+1 재확정은 그대로 필수다.
- `boards.detail_layout_jsonb jsonb not null default '[]'`와 nullable `board_groups.detail_layout_jsonb`를 같은 정합화 migration에 포함했다. group NULL은 board 기본 상속, `[]`은 의도적 빈 배치로 구분한다.
- `is_valid_detail_layout(jsonb)`와 CHECK로 배열 원소의 string `key` 및 `source=column|detail` 계약을 보장한다. `board_columns.sort_order`, 기존 값, 기존 migration, 057/058은 변경하지 않았다.
- PGlite에서 known partial drift, migration 2회 실행, rollback, 이미 두 layout 컬럼이 있는 fixture, NULL/`[]` 회귀, 잘못된 JSON 거부를 실행형으로 검증했다.
- hosted DB 적용·고객 데이터 조회·비밀값 조회는 0건이다.
- 검증: node PGlite 2/2 PASS, 앱 focused 래퍼 1/1 PASS, 전체 `scripts/check.sh` PASS(app 1569 pass/9 skip, worker 85 pass, qa-app 보고용 diff 175). 앱 런타임 파일 변경이 없어 별도 production build는 불필요하다고 판정했다.

## 2026-08-13 — BBE-140 qa-app 실제 앱 정본 복구 착수

- `qa-app.mjs`가 BBE-156 이후 빈 구조 팩을 앱으로 간주해 차이가 175→4로 축소된 회귀를 제거했다.
- 목업은 `extractMockupContract()`를 재사용하고, 앱은 `default-tabs/**`의 실제 `DefaultTab` export와 셸 `APP_TABS`를 읽는다.
- 제품 기본 탭이 아직 main에 없으면 그룹·컬럼·이동규칙을 0으로 숨기지 않고 `제품 기본 탭 상실`로 보고한다.
- `MOVE2`가 있는 탭에서는 낡은 `MOVE`와 합치지 않아 신규리드 자동 이동 6규칙을 중복 계상하지 않는다.

## 2026-08-18 — BBE-214 보드 전환 지연 측정 + 로딩·툴팁·뷰 순서 [모아워크 DC-19]

- base `origin/main@4eae66b`. 총괄 운영 보고(「탭 로딩시 불필요한 화면」·「보드이동시 아주 느림」)에서 시작했다.
- **고치기 전에 쟀다.** `app/src/app/(app)/boards/[id]/page.roundtrips.test.tsx` 가 `createClient()` 를 세는 가짜로 바꾸고 실제 페이지 함수를 그대로 돌린다. 헬퍼를 목으로 갈아끼우지 않아 왕복 수는 추정이 아니라 실측이다.
- 시간을 단언하지 않는다. 같은 매크로태스크에 발행된 왕복을 한 물결로 함께 응답시키고 «물결의 수 = 직렬 단계»(임계 경로)로 센다. 기계·부하와 무관해 회귀 검사로 쓸 수 있다.
- **측정 전:** `/boards/[id]` 왕복 25 · 직렬 20. `?savedView=` 붙으면 29 · 24. 탭 클릭 한 번은 `/contract` 경유지(4 · 4) + `/boards/[id]` 라서 합계 29 · 24 이고 **HTTP 요청이 2번 순차**다.
- 원인 셋: ① `getBoardDetail` 이 한 화면에 3번 돈다(`listItems`·`listDeletedItems` 가 각각 또 부른다) ② 그 안의 세 읽기가 서로 독립인데 직렬이다 ③ `loadEffectivePermission` 에 캐시가 없어 권한 RPC 가 6번 나간다.
- **측정 후(이번 PR):** `service.ts` 의 `getBoardDetail`·`listItems`·`listDeletedItems` 만 병렬화해 **직렬 20 → 12**, 탭 클릭 24 → 16. 왕복 «횟수» 는 25 로 그대로다 — 중복 제거는 호출부 변경 또는 쓰기 무효화가 필요해 후속 PR 로 미뤘다.
- 「불필요한 화면」의 정체: `/newcust`·`/contract` 는 화면이 아니라 **redirect 경유지**다. 그 구간에 셸만 뜨고 `<main>` 이 비어 있었다. `loading.tsx` 8개(Next 규약, 기존 `settings/members/loading.tsx` 와 같은 방식)로 «로딩 중» 을 보이게 했다.
- 툴팁 잔상: `AppTabs` 의 네이티브 `title` 이 원인. 이 `<nav>` 는 레이아웃에 있어 화면을 옮겨도 언마운트되지 않고, 브라우저가 그린 title 툴팁은 앱이 지울 수 없다. 탭 라벨 title 은 바로 옆 `<span>` 과 같은 글자라 정보 손실 없이 뗐고, 잠금 설명은 `aria-label` 로 옮겼다.
- 뷰 탭 순서: 목업 `UI목업_워크스페이스_최종_v6.html` `head()` 가 정본이다 — `:1810` 보드 이름 → `:1821` 보기 → `:1841` 필터. 앱은 테이블·칸반 분기에서 뒤집혀 있었고 flat/calendar 는 이미 옳았다. `BoardWorkspace` 에 `savedViewsSlot` 을 더해 이름 아래·필터 위로 옮겼다.
- 변이 검사 7종을 손으로 깨뜨려 전부 빨간불 확인(로딩 제거·빈 문자열·감춤 / 툴팁 되붙이기 / 뷰 배선끊기·위로 이동 / 병렬을 직렬로 되돌리기). 「뷰가 필터보다 위」 테스트가 «슬롯 미렌더» 변이에서 살아남아(-1 비교) 가드를 보강했다.
- 못 한 것: **벽시계 서버 응답 시간은 못 쟀다.** 이 worktree 에 `.env` 가 없어 실 Supabase 에 못 붙는다. 왕복·직렬 단계를 정본으로 쓴다 — 시간 단언은 기계·부하에 흔들려 회귀 검사로 쓸 수 없다.
- `bash scripts/check.sh` PASS. qa-app 차이 35건은 기존 보고 전용.

## 2026-08-20 — 계약업체 실무 컬럼 재편(구분 신설 · 상품명칭 · 세부명칭) + 래칫 35→39

- 총괄 직접 지시. **모든 계약이 «자금» 이 아니다** — 인증·지원금·기타용역이 섞여 있어 «자금명» 이라는 이름 자체가 틀렸다. 최상위 분류 «구분»(자금·지원금·인증·기타용역)을 맨 앞에 신설하고, 자금명→**상품명칭** · 진행 상품→**세부명칭** 으로 이름을 고쳤다.
- **key 는 얼렸다. 라벨만 바꿨다.** `item_values` 는 `(item_id, column_key)` 로만 묶여 있고 `board_columns` 로의 FK 가 없다(`003_boards_engine.sql:64-70`). key 를 바꾸면 기존 셀 값이 전부 고아가 되고, 그 위에 «빈 새 컬럼» 이 하나 더 생긴다(`install.ts:199-211` 은 key 로만 대조하는 insert-if-missing). 그래서 `fund_name`·`product` 는 그대로 두고 label 만 고쳤다. 라벨과 key 가 어긋난 것은 사고가 아니라 **의도** 라서 두 줄 모두에 주석을 박았고, `contract-work.test.ts` 에 key↔label 대응을 못박는 테스트를 새로 넣었다.
- **기존 워크스페이스는 이름이 바뀌지 않는다.** 기본 탭 보수(`ensureDefaultTabAdditive`)에는 `updateColumn` 이 아예 없다 — 「기존 컬럼은 절대 갱신하지 않는다」가 그 함수의 계약이다. 이름 변경은 **새로 만드는 워크스페이스에만** 적용된다. 이미 쓰고 있는 회사가 새 이름을 보려면 제품이 이미 가진 `rename_column`(`068:135`, label 만 바꾸고 key 는 유지)으로 화면에서 직접 바꿔야 한다. 이건 결함이 아니라 «회사가 자기 컬럼 이름을 자유롭게 정한다» 는 기본 탭 원칙의 결과다.
- **다만 «구분» 은 기존 워크스페이스에도 생긴다** — key 가 없으니 drift 가 잡히고 `createColumn` 이 돈다. 단 `sort_order: existing.length`(`boardsRepo.ts:85`)라서 **맨 뒤(28번째)에 붙는다.** 새 워크스페이스만 맨 앞이다. 또 `repair-on-entry.ts:38-40` 이 owner/admin 이 아니면 일찍 반환하므로, **소유자나 관리자가 /work 를 한 번 열어야** 나타난다. 순서를 맞추려면 별도 1회성 `sort_order` 마이그레이션이 필요한데, 회사가 스스로 바꾼 순서를 덮어쓸 위험이 있어 **총괄 판단 전까지 손대지 않았다.**
- 래칫: `REGRESSION_CEILING` 35 → **39**(실측. 추정 아님). 늘어난 4건은 전부 이번 지시로 인한 라벨 차이다 — 목업에만 2(자금명·진행 상품) + 앱에만 3(구분·상품명칭·세부명칭) − 1(«진행 상품» 선택지 차이가 라벨 불일치로 사라짐). 그 −1 은 개선이 아니라 라벨 기준 대조(`qa-app.mjs:189-191`)의 부작용이다. **39 를 «문제가 3건 늘었다» 로 읽으면 안 된다.** CLAUDE.md 「기준의 우선순위」 1번(총괄 직접 지시)이 2번(목업)보다 우선한다.
- 테스트는 약화하지 않고 새 기대값으로 고쳤다(27→28 컬럼, `진행 상품`→`세부명칭` 조회, 툴바 렌더 라벨). 선택지 목록은 하나도 건드리지 않았다 — 진행기관 18 · 세부명칭 59 · 진행상항 14 전량 그대로다.
- 손대지 않은 이웃: `work-management/template.ts:13` 이 `legacy("product", "진행 상품", …)` 을 따로 선언한다. `/work` 가 같은 데이터를 보여주는지는 BBE-210 미검증이라 이번 범위 밖으로 뒀다 — 같다면 이름 변경이 반쪽이다.
- `rm -rf app/.next && bash scripts/check.sh` PASS. `차이 합계: 39개 (천장 39) · 판정: DIFF`.

## 2026-08-20 — 정산 리포트 화면 (/ledger 「리포트」 탭) + CSV 내보내기 소비처 확보 [BBE-198]

- 총괄 승인 설계 그대로다: **화면 리포트를 정본으로, 거기서 「🖨 인쇄 · PDF 저장」 + 「CSV」 두 버튼만.**
  엑셀(.xlsx)은 새 라이브러리가 필요해서 「엑셀로 또 가공해야 한다」는 요구가 실제로 나올 때 붙인다
  (`docs/design/정산-리포트-시안_v1.html` §②). PDF 는 브라우저 인쇄로 공짜로 얻는다 — 라이브러리 0.
- 구조는 시안 §② 를 따랐다: 필터바 · 리포트 머리(조건 줄 + 출력 도장) · 그룹 머리 + 소계 줄 · 마지막 합계 줄.
  열 11개는 육하원칙판이다 — 업체 · 담당자 · 진행기관 · 상품명칭(세부명칭) · 수납구분 · 발생일 · 입금일 ·
  금액(공급가) · 입금액 · 미수금 · 계산서. **업무 ID·원장 ID 같은 내부 식별자는 싣지 않는다.**
- **필터는 넷뿐이다** — 기간·업체·담당자·수납구분. 시안이 그렸던 기관·상품 필터는 총괄이 이번 회차에서 뺐다
  (시안 §② 경고문의 ⓒ 안). 열로는 계속 보여주되 거르는 축으로는 쓰지 않는다.
- ★ **「구분」 과 「수납구분」 을 갈랐다.** 원장의 `kind`(계약금/수수료)는 화면에서 **「수납구분」** 이다.
  「구분」 은 2026-08-20 부터 계약업체 실무 보드의 다른 컬럼(자금/지원금/인증/기타용역) 이름이라
  같은 낱말을 쓰면 두 축이 화면에서 섞인다. 렌더 테스트가 `>구분<` 이 라벨로 서는 것을 막는다.
- 계산은 재구현하지 않았다. `ledger.ts` 에 `entryOutstanding()`(= `max(0, 공급가-입금액)`)을 뽑아
  원장 패널·연도별 원장·리포트 셋이 **한 함수**를 부르게 했다. entry 단위인 이유는 그대로다 —
  부가세 초과입금 한 건이 다른 건의 진짜 미수금을 순합계로 상쇄해 「0원」 으로 가리는 것을 막는다.
- **진행기관·상품명칭·세부명칭은 원장에 없다.** 계약업체 실무 보드 셀(`item_values`)에 있고 딜과는
  `items.deal_id`(`087:14`)로 이어진다. 평평한 조회 3번으로 읽는다 — boards(source=core.default-tab/contract-work)
  → items(살아있고 deal_id 있는 행) → item_values(`institution`·`fund_name`·`product`).
  PostgREST 임베드를 **일부러 안 썼다**: `items→boards` FK 가 둘(003:50 + 087:20-21), `item_values→items` 도
  둘(003:66 + 087:30-31)이라 PGRST201 로 실패한다. 이 저장소에 그 문법 전례가 없다.
- ★ **이 보강 경로는 절대 throw 하지 않는다.** `YearlyLedgerReadError` 는 셀 하나짜리 실패가 아니다 —
  `ledger/page.tsx` 가 그걸 잡아 **화면 전체**를 「원장을 불러오지 못했어요」 로 바꾼다. 상품명 하나 때문에
  원장이 통째로 사라지면 안 되므로 3번 조회 전체를 `try { … } catch { return new Map(); }` 로 감쌌다.
  원장·딜(리포트의 본문)의 엄격함은 그대로 두었다.
- **빈 칸 ≠ 「데이터 없음」.** 정상인데 비는 경로가 넷이다 — ① 회사가 계약업체 실무 탭을 지웠다(D77 허용)
  ② 그 딜이 업무관리로 이동한 적 없다/휴지통에 있다 ③ 컬럼을 지웠다 ④ **RLS 비대칭** — 원장은
  `deals.assigned_to`(035:28-50), 셀 값은 `items.assigned_to`(061:162-183)로 갈리고 099:94-102 은 투영
  «시점» 에만 복사한다. 그래서 assignee 범위 멤버는 원장 줄은 보되 상품명은 못 볼 수 있다(닫히는 쪽이라 안전).
  이 때문에 「데이터 없음」 같은 단정 문구를 넣지 않았다 — 그 사용자에게는 거짓말이 된다.
- **컬럼을 «이름만» 바꾸면 값이 그대로 나온다**(`068:135` rename_column — key 유지). key 를 얼려둔 결정의 대가다.
  **컬럼을 «지우면» 값이 계속 보인다**: `board_columns` 행만 사라지고 `item_values` 는 남는다
  (BBE-177, `deleteColumn`). 이건 의도된 선택이다 — 오류가 없고, 조회가 하나 적고, 지난 리포트를 다시 뽑아도
  같은 수가 나온다. **총괄 판단이 필요하다**: 「상품명칭 컬럼을 지웠는데 리포트엔 옛 값이 남는다」 가 싫다면
  `board_columns(key)` 조회를 하나 더 붙여 가려야 한다 — 실패 지점이 하나 늘어나는 값을 치르고.
- CSV 는 새로 쓰지 않고 **기존 코드를 늘렸다**(`export/ledger-csv.ts`). BOM(`﻿`)·수식 실행 방어
  (`safeSpreadsheetCell`)·`danger.csv_export` 권한 + 위험행동 기록(감사 실패면 파일을 만들지 않는다)을
  전부 그대로 쓴다. 리포트판은 열이 달라 `createLedgerReportCsvExport` 로 나눴고 BOM·이스케이프 규약은 공유한다.
  **소계·합계 줄은 CSV 에 넣지 않았다** — 시안 §② 비교표가 CSV 를 「엑셀로 열어 피벗·정렬」 용도로 못 박았고
  소계 줄이 섞이면 그 정렬이 깨진다. 소계·합계는 화면과 인쇄(PDF)의 몫이다.
- **BBE-198 이 요구한 «소비처» 가 생겼다.** `LedgerExportButton` 이 처음으로 화면에 붙는다
  (`LedgerReportView` 필터바). `status-semantics.contract.test.tsx` 의 무소비처 가드에서 위 `it.each`
  소비처 목록으로 옮겼고, 남은 목록이 «비었다» 는 사실과 훑기가 실제로 돌았다는 사실까지 단언하게 고쳤다
  (빈 배열이라 조용히 통과하는 상태를 막는다). 버튼에서 기간 입력은 뗐다 — 조건의 정본은 화면 필터바다.
- 원장 조회는 **한 번만** 돈다. `loadLedgerScreen` 이 행 한 벌을 읽어 연도별 탭과 리포트 탭이 거기서 갈라진다
  (`toYearlyLedgerRows`). 같은 페이지에서 같은 표를 두 번 훑지 않는다.
- 인쇄: `@media print` 를 globals.css(셸 — `aside`·`header`·`[data-print="hide"]` 를 걷어내고 A4 가로, 색은
  강제로 밝게)와 accounting.module.css(표 — 행 단위 페이지 넘김, 머리행 반복)에 나눠 넣었다.
  다크 테마로 인쇄하면 종이 한 장이 통째로 검게 나오므로 인쇄용 토큰을 밝은 값으로 되돌린다.
- 기본 모드는 그대로 **「연도별」** 이다 — 이 커밋으로 기존 사용자의 첫 화면이 바뀌지 않는다.
- 테스트: `report.test.ts` 33건(표 기반 — 상품 라벨 5조합 · 필터 11조합 · 묶기 3축 × 소계/합계 일치 ·
  «묶는 방식이 매출을 바꾸지 않는다» · 초과입금이 미수금을 가리지 않는다 · 결정적 정렬),
  `LedgerReportView.test.tsx` 10건(열 머리 11개 · 수납구분/구분 분리 · 조건 줄과 출력 도장 · 소계/합계 ·
  보드 값 없을 때 대시 · 미입금/계산서 · 출구가 둘뿐 · 빈 결과 안내 · 인쇄 표식),
  `ledger-csv.test.ts` +7건(열·BOM·미수금 음수 없음·빈 값·수식 방어·파일명·뒤집힌 기간).
