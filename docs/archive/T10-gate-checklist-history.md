# T10 게이트키퍼 판정 이력 (동결)

> ❄️ **2026-08-05 동결. 신규 기록은 Linear 코멘트로. 과거 기록 보존용.**
> **검수 기준부는 `docs/plans/qa-gate.md` 로 이관됐다.** 이 파일은 **판정 이력(측정 로그)** 만 보존한다.
> 새 판정 결과는 여기에 추가하지 않고 해당 Linear 이슈의 코멘트로 남긴다.
> 근거: `docs/plans/system-audit-2026-08-05.md`
>
> 원본: `docs/coordination/T10-gate-checklist.md`(816줄) — 기준부 §0~§4 → `docs/plans/qa-gate.md`, 이력부 §5~ → 이 파일.
> 표기: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패(반려) · `[~]` 부분/후속.

---

## 5. 판정 기록 (측정 로그)

| 트랙 | PR/커밋 | 게이트 | 런타임 스모크 | scope 격리 | DB RLS 침투 | 판정 | 일시 |
|---|---|---|---|---|---|---|---|
| **main 베이스라인** | `f23ed34` | ✅ 초록 | PASS 3 / SKIP 7 | — | — | **T03 미머지 확정** | 2026-07-21 |
| **① T03 on main** | **`97348b1`** (Merge PR #1) | ✅ 초록 | ✅ **PASS 11 / FAIL 0 / SKIP 2** | ⚠️ 조직격리만 | ⛔ 미검증 | **①단계 통과 — core.org done 아님** | 2026-07-21 |
| T03 | `a7bdc9d` PR-0 *(브랜치 한정)* | ✅ 초록 | ✅ 통과(10/10) | ✅ 앱레이어 통과 | ⛔ 미검증 | **후보 — main 머지 후 재검증 대기** | 2026-07-21 |
| T02crm | `cd2193d` *(브랜치)* | ✅ 초록 | — 미실시 | — | ⛔ 미검증 | 대기(②) | — |
| T02boards | `4cbdef3` *(브랜치)* | — | — | — | — | 대기(③) | — |
| T04 | `011f6c6` *(브랜치)* | ✅ 초록 | ✅ 홈 렌더 확인 | ✅ `?as=` 반영 | ⛔ 미검증 | 대기(④) | — |
| T05 | `2e294d8` *(브랜치)* | — | — | — | — | 대기(⑤) | — |

**main 베이스라인 실측(`f23ed34`, 2026-07-21)**: `/login`·`/onboarding`·`/settings/members`·`/dash/*` **전부 404** →
인증·CRM·대시 화면이 **main 에 아직 없음**. `/` 200(기본 페이지), 미존재 라우트 404, 서버 에러 0건.
→ **머지큐 ①T03 이 아직 main 에 들어오지 않았다.** 이 표의 T03 "통과"는 브랜치 결과이므로 **done 이 아니다.**

### ★ ①T03 main 판정 (main `97348b1`, 2026-07-21 · T10 실측)
게이트 `✅ check 통과` + main 스모크 `PASS=11 FAIL=0 SKIP=2`.
**통과**: 미인증 가드 `/`·`/onboarding`·`/settings/members` → 307 `/login` · `/login` 200(계정 3) · 온보딩·홈 200 ·
조직생성 서버액션 303+`mw_org` · **조직 격리**(신규 조직에 이전 조직 딜 0건) · 업종팩 프리셋(계약상황) · 404 정상 · 서버 에러 0건.

**⛔ 미확정 — `core.org` 를 done 으로 올리지 말 것**:
1. **담당범위(딜 단위) scope 격리** — 칸반 `/dash/*` 가 404(T02 미머지)라 **SKIP**. PLAN §3 "멤버는 본인 담당만" 은 **③T02 머지 후 main 에서 확정**.
2. **구글 OAuth 실동작** — 여전히 dev-session 쿠키. Supabase Auth 연결 후 §1-C 재검증.
3. **Postgres RLS 33정책 런타임** — 위 격리는 전부 앱 레이어. Supabase 적용 후 §1-B 침투 테스트 필요.
→ **①단계 게이트로서는 통과**(머지큐 진행 가능). **모듈 완료판정은 보류.**

**①T03 사전 스모크(브랜치 tip `cb6649e`, 2026-07-21 · 머지 전 후보 점검)**: `PASS=11 FAIL=0 SKIP=2` — 머지 후보로 건전.
통과: 미인증 가드 3라우트 → `/login` · `/login` 200(계정 3) · 온보딩/홈 200 · 조직생성 서버액션(`mw_org` 발급) ·
**조직 격리**(신규 조직에 이전 조직 딜 0건) · 프리셋 전개(계약상황) · 404 · 서버 에러 0건.

> ⚠️ **T03 단독으로는 "딜 단위 scope 격리"를 검증할 수 없다.** 칸반(`/dash/*`)이 T02 산출물이라 T03 브랜치에선 404 → SKIP.
> 즉 **PLAN §3 core.org 완료판정의 "멤버는 본인 담당만"은 ①T03 머지만으로 확정 불가**하며, **③T02 머지 후 main 에서 확정**해야 한다.
> ①T03 머지 시점의 판정은 "인증·온보딩·조직격리 통과, 담당범위 격리 미확정"으로 기록할 것.

### 머지큐 진행 현황 (T10 갱신)
- [x] **① T03 머지 → main 스모크 ✅ 통과** — main `97348b1`(Merge PR #1), 게이트 초록 + 스모크 `PASS=11 FAIL=0 SKIP=2`.
      **단, core.org 는 아직 done 아님** — 아래 ①판정 참조(담당범위 격리·DB RLS 미확정).
- [x] ~~② feat/t02-crm-core~~ — **폐기 확정**(중복·오염, 기획2 Round 3). 브랜치 삭제 예정.
      *T10 영향 없음*: 해당 브랜치에 있던 T10 커밋 `ae97140` 은 이미 main 으로 cherry-pick 완료(`8d6cfab`).
- [x] **③ T02 보드엔진 머지 → main 스모크 ✅ 통과** — main `9bd2b7a`(Merge PR #2), 게이트 초록 + 스모크 `PASS=15 FAIL=0 SKIP=2`.
      **★담당범위(딜 단위) scope 격리 확정** — 아래 ③판정 참조.
- [!] **④ T04 머지 → main 스모크 ❌ FAIL 1건** — main `da7dce0`(Merge PR #4), 게이트 초록이나 스모크 `PASS=17 FAIL=1 SKIP=0`.
      **신규 조직에서 MVP 기능 전체 잠김(BUG-0001)** — 아래 ④판정 참조.
- [x] **④-fix BUG-0001 핫픽스 → main 재스모크 ✅ 해소 확인** — main `ee57b0c`, 게이트 초록 + 스모크 **`PASS=19 FAIL=0 SKIP=0`**.
      `createOrg` 가 `MVP_ENABLED_FEATURES` 엔타이틀먼트를 생성하도록 수정됨 → 신규 조직 홈 정상 렌더.
      **단 재검증 중 BUG-0002 신규 발견** — 아래 참조. **core.dash 는 여전히 done 불가.**

### ★ ④-fix 재스모크 판정 (main `ee57b0c`, 2026-07-21 · T10 실측)
**BUG-0001 해소 확인** — 스모크 `PASS=19 FAIL=0 SKIP=0`(전 항목 커버·전 항목 통과).
- `신규 조직 홈이 실제로 렌더됨(기능 잠금 없음)` PASS → 직전까지 '공허한 참'이던 조직격리 검사가 **의미 있는 통과**로 전환.
- **빈 상태(딜 0건 조직) 검증 완료**: 전체 딜 0 · 총매출 `—` · **전환율 0.0%(0/0건) — 0분모 방어 확인** ·
  각 위젯 빈 상태 문구 정상 · `NaN`/`undefined`/`Infinity` 미발생.

### ❌ BUG-0002 — 계약상황 위젯이 프리셋 필드를 못 찾음 (조용한 파손)
- **증상**: 정책자금팩 설치로 `계약상황` 커스텀필드가 **분명히 존재**(온보딩에 7개 필드 중 표시)하는데도,
  **홈 대시보드와 칸반 페이지 양쪽** 계약상황 위젯이 항상 **"— 계약상황 필드가 아직 없습니다 (002 프리셋 로드 후 표시)"**.
  (시드 조직: 딜 3건 + 프리셋 설치 상태에서도 동일 재현.)
- **원인 — field key 불일치**:
  - 프리셋 등록: `app/src/lib/presets/policyfund.ts:40` → **`key: "contract_status"`**, `label: "계약상황"`
  - 위젯 조회: `app/src/lib/dash/aggregate.ts:151` → 기본값 **`fieldKey = "계약상황"`**(한글 **라벨**을 key 로 사용)
  - 호출부(`dash/[pipelineId]/page.tsx:55`, `dash/service.ts:126`)는 `fieldKey` 를 넘기지 않음 → 기본값 사용 → `def` 를 영영 못 찾아 `available:false`.
- **테스트가 못 잡은 이유(중요)**: `aggregate.test.ts:243` 이 **`key:"계약상황"` 픽스처를 직접 만들어** 검증한다.
  실제 프리셋이 만드는 필드와 다른 모양을 테스트가 스스로 지어낸 것 → **단위테스트·CI 는 초록인데 런타임은 파손**.
  → 픽스처를 **실제 프리셋 정의에서 유도**하도록 바꿔야 재발을 막는다.
- **기획 위반**: PLAN v0.2.2 — "계약서는 monday `계약상황` 컬럼(작성여부 포함)". 체크리스트 §3-B `계약상황(monday 파리티)` **실패**.
- **심각도**: 중. 에러 없이 빈 상태로만 보여 **조용히 죽어 있어** 발견이 어렵다(실제로 CI·게이트를 모두 통과해 머지됨).
- **수정안**: key 를 한쪽으로 통일(프리셋 `key:"계약상황"` 또는 위젯 기본값 `"contract_status"`). **key 는 식별자, label 은 표시용**이라는 규약을 명시하고
  프리셋↔소비자 간 key 상수를 공유할 것. + 위 테스트 픽스처 교정.
- **T10 조치**: `smoke.sh` 에 "프리셋 필드가 존재하는데 위젯이 '필드 없음'을 표시하면 FAIL" 검사 추가 → 자동 검출.
- [x] **⑤ T05 커스터마이징 + BUG-0002 핫픽스 머지 → main 최종 스모크 ✅ 통과** — main `cdf45f6`(PR #5 + PR #6).
      게이트 초록(app **309 테스트 / 23 파일** + worker 1) + 스모크 **`PASS=20 FAIL=0 SKIP=0`**. **BUG-0002 해소 확인.**

---

## ★ 머지큐 최종 판정 (main `cdf45f6`, 2026-07-21 · T10)

### 스모크 이력 (매 라운드 검사 항목이 늘었다)
| 단계 | main | 게이트 | 스모크 | 판정 |
|---|---|---|---|---|
| 베이스라인 | `f23ed34` | ✅ | PASS 3 / SKIP 7 | T03 미머지 확정 |
| ① T03 | `97348b1` | ✅ | PASS 11 / FAIL 0 | ✅ 단계 통과 |
| ② t02-crm-core | — | — | — | 폐기(중복·오염) |
| ③ T02 보드엔진 | `9bd2b7a` | ✅ | PASS 15 / FAIL 0 | ✅ **담당범위 격리 확정** |
| ④ T04 대시보드 | `da7dce0` | ✅ | PASS 17 / **FAIL 1** | ❌ **반려**(BUG-0001) |
| ④-fix 핫픽스 | `ee57b0c` | ✅ | PASS 19 / FAIL 0 | ✅ BUG-0001 해소 / ❌ BUG-0002 발견 |
| **⑤ T05 + BUG-0002 fix** | **`cdf45f6`** | ✅ 309테스트 | **PASS 20 / FAIL 0 / SKIP 0** | ✅ **최종 통과** |

### BUG-0002 해소 확증 (main `cdf45f6`)
- 수정 확인: 프리셋 `key:"contract_status"` ↔ 위젯 `POLICYFUND_FIELD_KEYS.contractStatus = "contract_status"` **일치**.
  **권고 3건 모두 반영** — ① key 통일 ② **키 상수 공유**(`POLICYFUND_FIELD_KEYS`) ③ 테스트 픽스처를 `contract_status` 로 교정.
- 런타임 확증: 위젯 문구가 **"계약상황 *필드가* 아직 없습니다"** → **"아직 계약상황이 *입력된 딜이* 없습니다"** 로 전환.
  즉 **필드를 인식**하고 값 부재라는 정상 빈 상태를 표시한다.
- 부수 효과: 필드 key 규약이 전면 영문화(`agency`·`fund_name`·`region`·`exec_amount`·`fee_pct`·`contract_status`·`fee_paid_at`).

### ⑤ T05 커스터마이징 검증
- `GET /api/fields` 200 — 프리셋 7필드가 **영문 key + 한글 label** 로 정상 노출.
- `POST /api/fields` **201** — 커스텀필드 생성 왕복 동작.
- `GET /api/custom-views` 200 — 저장뷰 빈 상태 정상.
- **관찰(결함 아님)**: `member` 도 `POST /api/fields` **201** 성공 → 일반 멤버가 조직 스키마(커스텀필드)를 추가할 수 있다.
  이는 `001_schema_v1.sql:431 fielddefs_rw = is_org_member(org_id)`(역할 무제한)와 **정확히 일치**하므로 구현 결함이 아니라 **스키마 설계대로**다.
  → **앱 레이어와 DB RLS 규칙이 일치**한다는 긍정적 신호. 다만 "조직 스키마 변경을 member 에게 허용"이 의도인지는 **기획 확인 권장**
  (먼데이는 보드 컬럼 편집을 권한으로 통제). 정책 변경 시 **정책과 앱 양쪽을 함께** 고쳐야 한다.

### ✅ 최종 통과 항목 (전 20개)
미인증 가드 4라우트 → `/login` · 로그인 200 · 온보딩/홈 200 · **담당범위 격리(API 4종 + 칸반 2종)** ·
조직 생성 서버액션 · **신규 조직 실제 렌더** · 조직 격리 · 프리셋 전개 · **계약상황 위젯 인식** · 404 · 서버 에러 0건.

### ⛔ MVP 완료판정을 위해 남은 항목 (스모크로 덮을 수 없는 영역)
1. **Postgres RLS 33정책 런타임 침투테스트** ★최우선 — 지금까지 확인된 격리는 **전부 앱 레이어**(`localRepo`).
   Supabase 적용 후 §1-B 를 수행하고, **앱 레이어와 DB RLS 가 같은 규칙인지 대조**해야 한다(한쪽만 막히면 우회 경로).
2. **구글 OAuth 실동작** — 현재 dev-session 쿠키. `/login` 에 google/oauth 링크 0개(실측).
3. **정산 수식 parity** — 대시보드 금액이 `settlements` generated column 이 아니라 **`deal.amount` 근사**
   (화면에 "임시 — 정산 원천 연결 전" 명시). `fee_amount=round(exec×pct/100)`·`total_revenue`·`d180/d365` 대조는 정산 원천 연결 후.
4. **파일 첨부 Storage 격리** — 현재 `deal.custom.files[]` jsonb. 실제 Storage 전환 시 버킷 정책 org 격리 확인.

→ **머지큐 관점에서는 전 단계 통과. 단 위 4건 때문에 "MVP 완료"는 아니다.**

### 검증 방법론 — 이번 머지큐에서 확립된 것
게이트·CI 초록이면서 파손된 사례를 **2건**(BUG-0001·BUG-0002) 잡았고, **T10 자신의 오판도 3건** 잡아 정정했다.
| 함정 | 증상 | 대책(smoke.sh 반영) |
|---|---|---|
| **false pass — 포트 선점** | 남의 브랜치 서버를 검사하고 통과 보고 | 전용 포트 + 선점 시 **ABORT** + **기동 확증**(EADDRINUSE/Ready 로그) |
| **false fail — 빌드캐시** | 브랜치 전환 후 `.next` 잔재가 없는 라우트 참조 → typecheck 실패 | 실행 전 `.next`·`tsbuildinfo` 자동 제거 |
| **공허한 참 — 부정 조건** | 화면이 잠겨 렌더 0 → "딜 0건" 통과 | **렌더됨(긍정 조건) 선행 확인** 후 격리 판정 |
| **픽스처 창작** | 테스트가 실제 프리셋과 다른 필드를 지어내 검증 → CI 초록·런타임 파손 | 위젯이 프리셋 필드를 **인식하는지** 런타임 검사 |
| **미사용 경로** | 시드 조직만 엔타이틀먼트 보유 → 신규 조직 경로 미검증 | 신규 조직 생성 후 **실제 진입**까지 검사 |

**원칙**: 부정 조건(없음/0건)만 보는 검사는 **대상이 존재하지 않을 때도 통과**한다. 반드시 **긍정 조건(실제로 렌더/인식/동작)** 을 함께 확인할 것.

### ★ ④T04 main 판정 (main `da7dce0`, 2026-07-21 · T10 실측) — **반려(FAIL 1)**
게이트 `✅ check 통과`. 스모크 `PASS=17 **FAIL=1** SKIP=0`(SKIP 0 = 처음으로 전 항목 커버).

**통과 — 집계 정확성(원천 대조, owner vs member)**
| 지표 | owner(all) | member(assigned) | 검증 |
|---|---|---|---|
| 전체 딜 | 3 | 2 | `/api/deals` 원천과 일치 ✅ |
| 고객사 | 2 | 1 | 고객사도 담당범위 반영 ✅ |
| 단계별 | 마케팅1·미팅1·계약1 (각 33.3%) | 마케팅1·미팅1·**계약0** (각 50%) | 합계=전체, 비율 합 100% ✅ |
| 전환율 | 미팅도달 66.7%(2/3)·계약 33.3%(1/3) | 미팅도달 50%(1/2)·계약 0%(0/2) | 누적도달 정의대로 ✅ |
| 총매출(추정) | 800,000,000원 (대상 2건) | 300,000,000원 (대상 1건) | 시드 amount 300M+500M / 300M 일치 ✅ |

→ **★RLS 하 집계 확인**: 대시보드 수치가 담당범위를 그대로 반영. **집계 경로가 격리 우회 통로가 되지 않는다.**
→ 빈 상태: NaN·undefined·Infinity 미발생. 재접촉(D+180) 위젯 빈 상태 정상 문구.

**❌ BUG-0001 — 신규 조직에서 MVP 기능 전체 잠김 (온보딩 흐름 A 파손)**
- **증상**: 온보딩에서 조직 생성 후 홈 진입 → 대시보드 자리에 **"현재 플랜에서 잠긴 기능입니다 (Phase 2)"**. 잠긴 `feature_key: core.dash`.
- **원인**: `app/src/lib/repo/local/localRepo.ts` `createOrg()`(75–96) 가 org + owner 멤버만 만들고 **엔타이틀먼트 행을 생성하지 않음**.
  `isFeatureEnabled()`(180–185)는 `enabled===true` 행을 요구 → 행이 없으면 전부 OFF.
  시드 조직만 `seed.ts:281` 에서 `MVP_ENABLED_FEATURES`(crm·custom·org·files·dash·policyfund)를 부여받는다.
  앱 전체에서 `setEntitlement` 호출은 `presets/policyfund.ts:52`(**ind.policyfund 한 개**)뿐.
- **기획 위반**: PLAN v0.2 §5 및 `001_schema_v1.sql:456–463` — "MVP: 모든 플랜에 core.* + MVP 모듈 무료". `createOrg` 가
  001 의 `plan_features → org_entitlements` 전개를 재현하지 않았다(`add_org_owner` 트리거는 재현했으면서 엔타이틀먼트는 누락).
- **영향**: PLAN §4 **흐름 A(로그인 → 조직 생성 → 업종팩 → 홈)의 종착점이 신규 사용자에게 잠긴 화면**이 된다. 첫 사용자 경험 파손.
- **책임 경계**: 표면은 T04(core.dash FeatureGate), **근본 원인은 `createOrg`(T03 파운데이션 repo 레이어)**. 수정 주체 조율 필요.
- **수정안**: `createOrg` 에서 `MVP_ENABLED_FEATURES` 순회 `setEntitlement(org.id, key, true)` — 또는 `isFeatureEnabled` 를 plan_features 기준으로 판정.

**⚠️ T10 자기 결함 — 조직격리 검사가 '공허한 참'이었다**
직전(③)까지 `신규 조직에 이전 조직 딜 0건` 이 PASS 였던 것은 격리가 잘돼서가 아니라 **화면이 잠겨 아무것도 렌더되지 않아서**였다.
→ `smoke.sh` 에 **"먼저 화면이 실제로 렌더됐는지"** 선행 검사 추가. 잠금 문구 감지 시 FAIL + 격리검사 무효 처리.
→ 교훈: **부정 조건(0건)만 보는 검사는 대상이 존재하지 않을 때도 통과한다. 반드시 긍정 조건(렌더됨)을 함께 확인할 것.**

**⛔ 그 외 미확정**
- **정산 수식 parity 미검증**: 대시보드 금액이 `settlements` generated column 이 아니라 **`deal.amount` 기준 근사("임시 — 정산 원천 연결 전")**.
  `fee_amount=round(exec×pct/100)`·`total_revenue` 대조는 정산 원천 연결 후 재검증 필요.
- **계약상황 위젯**: 시드 조직엔 프리셋 미설치라 "필드가 아직 없습니다" 빈 상태로 표시(정상 폴백). 프리셋 설치 조직에서의 표시·변경은 BUG-0001 해소 후 재확인.
- 구글 OAuth·Postgres RLS 33정책 런타임: 여전히 미검증(①③과 동일).

### ★ ③T02 보드엔진 main 판정 (main `9bd2b7a`, 2026-07-21 · T10 실측)
게이트 `✅ check 통과` + main 스모크 `PASS=15 FAIL=0 SKIP=2`.

**★담당범위(딜 단위) 격리 — ①에서 미확정이던 항목, 여기서 확정** (`/api/deals`, 시드 딜 3건 기준):
| 계정 | 조회 딜 | admin 담당 `라마바테크 시설자금` | 판정 |
|---|---|---|---|
| owner (`all`) | **3건** | 노출 1 | 조직 전체 조회 ✅ |
| member (`assigned`) | **2건** | **0건** | 타인 담당 차단 ✅ |

- **직접 접근도 차단**: member 가 admin 담당 딜을 `GET /api/deals/{id}` 로 직접 조회 → **404**(owner 는 200).
  목록 필터링뿐 아니라 **단건 접근까지 막힌다** — 우회 경로 없음.
- → **PLAN §3 core.org "멤버는 본인 담당만" 앱 레이어 충족 확인.**

**2-A 단계 이동 자동화(먼데이 "이동" 재현)**: `POST /api/deals/{id}/move` 200 → `stage_id` 미팅→계약 갱신 확인,
**활동 로그 자동 기록**(`type:"status"`, `content:"미팅 → 계약"`, `actor`=요청자, `at` 타임스탬프) ✅
**2-C 활동기록**: `GET /api/deals/{id}/activities` 200, 이동 후 1건 적재 확인.
**T02b 보드엔진**: `/boards` 200(범용 보드 목록/테이블·칸반/컬럼 에디터), `/policyfund` 200.

**⛔ 여전히 미확정**: ① 구글 OAuth 실동작(dev-session 유지) ② **Postgres RLS 33정책 런타임**
— 위 격리는 전부 **앱 레이어(`localRepo.ts` `isManager(role) || scope==='all'`)**. Supabase 적용 후 §1-B 침투 테스트로 별도 확정 필요.
**앱 레이어와 DB RLS 가 같은 규칙인지 대조**하지 않으면 한쪽만 막히는 우회 경로가 남는다.

### T03 PR-0 상세 판정 (2026-07-21 · T10 실측)

> **판정 대상 ref 주의**: 이 스모크는 브랜치 **`feat/t02-crm-core`(= T03 PR-0 `a7bdc9d` 포함 계열)** 워킹트리에서 실행했다.
> **`a7bdc9d` 는 `origin/main` 의 조상이 아니다** — 검증 시점 `origin/main`(d5e31ba)에는 `app/src/lib/auth/session.ts`·
> `login`·`onboarding` 라우트가 **존재하지 않는다**. 즉 **아래 통과 결과는 해당 PR 브랜치에 대한 것이며, main 에 대한 승인이 아니다.**
> main 머지 시 **동일 클릭스루를 머지 커밋 기준으로 재실행**해야 done 승인이 유효하다.
**통과**: 미인증 가드 307→`/login`(4개 라우트 전부) · `/login` 200(계정 3) · 온보딩 200 · 조직생성 서버액션 **303+`mw_org` 발급** ·
정책자금팩 설치 → **딜 커스텀필드 7개 전개**(진행기관·세부자금·지역 select / 실행액·수수료(%) number / **계약상황 select** / 수수료입금일 date) ·
홈 200 · **scope 격리 실증**(member 칸반에서 admin 담당 `라마바테크 시설자금` **0건**, owner 는 3건 전부) ·
**조직 격리 실증**(신규 조직 홈에 시드 조직 딜 0건) · 로그아웃 쿠키 3종 만료 → `/login` · 404 정상 · **서버 에러 로그 0건**.

**미검증(= done 아님, 후속 필수)**:
1. **구글 OAuth 실동작** — 현재 dev-session 쿠키. Supabase Auth 연결 후 §1-C 재검증.
2. **Postgres RLS 정책 런타임** — 위 격리는 **앱 레이어**. `001_schema_v1.sql` 의 33개 정책(`is_org_member`/`org_role`/`org_scope`,
   companies·deals assigned 조건, 전역 카탈로그 읽기전용)은 **Supabase 적용 후 §1-B 침투 테스트로 별도 확정**.
3. 앱 레이어 격리와 DB RLS 가 **동일 규칙인지 정합 대조**(한쪽만 막히면 우회 경로가 됨).

> 각 트랙 머지 시 위 표 갱신 + `docs/worklog.md`에 T10 판정 항목 기입.

---

## 6. B0 (T01) — Vercel Install Command 오버라이드 제거 + vitest 정식화

### ⚠️ 선결 발견: 프로덕션 빌드가 어느 게이트에도 없다 (2026-07-21 T10 실측)
- `scripts/check.sh` = lint + typecheck + test. **`npm run build` 없음**(`grep -c build scripts/check.sh` → **0**).
- `.github/workflows/ci.yml` 은 `bash scripts/check.sh` 만 실행 → **CI 도 빌드를 돌리지 않음**.
- 즉 **Vercel 이 돌리는 `next build` 는 어떤 게이트도 막지 못한다.** B0 가 빌드를 초록으로 만들어도 **다음 PR 이 조용히 깨뜨릴 수 있다**(BUG-0001·0002 와 동일 구조 — 게이트 사각지대).
- **T10 권고(→T01)**: `check.sh` 에 `[4/4] build` 추가. 그래야 B0 성과가 게이트로 고정된다.
- **베이스라인**: main `37d1598` 에서 `npm run build --workspace app` → **exit 0, 21 라우트**(static `/login`·`/policyfund`·`/_not-found`, 나머지 dynamic). B0 는 이 상태를 **유지**해야 하며 개선 대상은 Vercel 설정 쪽.

### 6-A. vitest 정식화
- [ ] `vitest` 가 **실제로 쓰는 워크스페이스에 선언**되었는가 — 현재 루트 `package.json:23` 에만 `^2.1.9`, `app`/`worker` 는 **미선언**인데 각자 `vitest run` 실행(루트 호이스팅 의존).
- [ ] 호이스팅 의존 제거 후에도 `npm run test --workspaces` 초록.
- [ ] 버전 단일화 · `package-lock.json` 동기 커밋.

### 6-B. Vercel 기본설정 빌드
- [ ] Install Command **오버라이드 제거** 상태에서 빌드 green (기본 `npm install`).
- [ ] Root Directory 와 워크스페이스 구조 정합 — root=`app/` 이면 app 의 `package.json` 만 해석되므로 **6-A 미선언이 곧 실패 원인**.
- [ ] 빌드 로그에 오버라이드 잔재 경고 없음.
- [ ] `www.moa-work.com` 200 **+ 배포 SHA 가 main HEAD 와 일치**(옛 배포 캐시를 초록으로 오인 금지 — false-pass 재발 패턴).
- [ ] 프로덕션에서 §4 클릭스루 최소셋(가드/로그인/홈) 재확인 — **dev 초록 ≠ prod 초록**(RSC/정적생성/빌드타임 env 차이).

> **T10 검증 한계(명시)**: Vercel 대시보드 설정(Install Command·Root Directory·env)은 **저장소 밖**이라 코드로 확인 불가.
> 배포 로그·라이브 URL·SHA 대조로만 간접 판정한다. 설정 원본 확인은 T01 소관.

---

## 7. B1 (T03) — 앱 셸 v0.3 + 구글 OAuth + 실DB RLS 침투테스트

### 7-A. 앱 셸 v0.3 (1단 사이드바 10메뉴 · 브랜드 토큰 · 다크/라이트)
- [ ] 사이드바 **10메뉴 전부 렌더** + 각 링크 목적지 200/307(죽은 링크 0).
- [ ] **엔타이틀먼트 반영** — ※BUG-0001 이 정확히 이 지점에서 터졌다(신규 조직 `core.*` 전면 잠김). **신규 조직 계정**에서 반드시 재확인(시드 조직만 보면 또 가려진다).
- [ ] 브랜드 토큰: 하드코딩 색상이 아니라 **토큰 참조**인지(정의-사용 대조).
- [ ] 다크/라이트 **양방향 전환** + 토큰 일치 + 대비 확인.
- [ ] **긍정 확인 필수**: "깨진 곳 없음"이 아니라 **메뉴 10개 이름·테마 전환 실제 반영**을 확인(BUG-0002 교훈).

### 7-B. 구글 OAuth (§1-C 미검증 해소)
- [ ] `/login` 에 **구글 OAuth 링크 존재**(현행 실측 **0개** — dev-session 뿐).
- [ ] 로그인 → 콜백 → 세션 발급 → 홈 도달.
- [ ] 신규 사용자 → **온보딩 분기**, 기존 사용자 → 홈 직행. 로그아웃 시 세션 완전 만료.
- [ ] **dev-session 우회가 프로덕션에서 비활성**인지 ★보안 — 남아 있으면 인증 전면 무력화.
- [ ] 비밀값(client secret 등) 저장소 부재(env 주입만).

### 7-C. 실DB RLS 침투테스트 ★최우선 · T03 공동 수행
대상: `001_schema_v1.sql` **`create policy` 32개 / RLS 활성 26 테이블**, 헬퍼 `is_org_member` · `org_role` · `org_scope`.

**원칙 — 앱을 우회해 DB 에 직접 붙어서 시험한다.** 앱 레이어 격리 통과는 DB 정책의 증거가 아니다.
- [ ] **조직 격리**: 조직 A 세션(`auth.uid()`)으로 조직 B 행 `select` → **0건**. `insert/update/delete` → 거부.
- [ ] **담당범위 격리**: `member` 로 타인 담당 `companies`/`deals` → 목록 0건 + **단건 지정 조회도 0건**(ID 를 알아도 못 뚫는지).
- [ ] **역할 경계**: `orgs_update`/`orgs_delete` 는 `owner` 만 — `admin`·`member` 시도 → 거부. `members_manage` 동일.
- [ ] **전역 카탈로그**: 읽기 허용 / **쓰기 거부**.
- [ ] **anon 키**: 미인증으로 각 테이블 접근 → 전부 거부.
- [ ] **⭐ 앱↔DB 규칙 정합 대조** — 두 레이어가 막는 집합이 **같은지**. 불일치 시 **느슨한 쪽이 곧 우회 경로**. 특히 `fielddefs_rw = is_org_member`(001:431)는 **member 도 필드 생성 가능**으로 앱과 일치하나, **그 정책 자체가 의도인지 기획 확인 필요**.
- [ ] **정책 커버리지**: RLS 활성 26테이블 중 정책 없는 테이블 = **전면 차단**인지(의도인지) 확인.

**판정 규칙**: 침투 1건이라도 성공 → **즉시 반려**. 부분 통과 없음.

---

## 9. PR 검수 판정 — 8트랙 라운드

### ❌ PR #7 (T09 `feat/t09-settlements`, `54f1baa`) — **반려 · 프로덕션 빌드 파손**

| 검사 | 결과 |
|---|---|
| 정적: 마이그레이션 추가 | 없음 (8-A 해당 없음) ✅ |
| 정적: 계약파일(`lib/types`·`lib/repo/index.ts`) 편집 | 없음 (단일소유 규칙 준수) ✅ |
| 정적: 베이스 신선도 | merge-base `4367015`, main +1 — 신선 ✅ |
| 정적: 조율파일 줄수 | dispatch 353=353, registry 244=244 — 소실 없음 ✅ |
| 정적: 8-B(`custom` 교체) | `updateDeal`·`.custom`·`stage_id` 미사용 ✅ |
| 인증 | 전 라우트 `requireCtx()` 경유 ✅ |
| `check.sh` 게이트 | **초록** — app 327 테스트/24 파일 ✅ |
| **프로덕션 빌드** | **❌ 실패 (exit 1)** |

**⛔ 반려 사유 — 서버 전용 모듈이 클라이언트 번들로 유입**
```
Error: Turbopack build failed
./app/src/lib/auth/session.ts:1  import { cookies } from "next/headers";
  → "next/headers" 는 서버 전용인데 클라이언트 번들에 포함됨
```
**유입 경로(빌드 로그 import trace 실측)**
```
PolicyfundBoard.tsx  ("use client")
  → @/lib/policyfund (배럴)
  → policyfund/settlements.ts        ← PR 신규 파일
  → @/lib/crm (배럴)                  ← settlements.ts:13 ValidationError 임포트
  → crm/context.ts → auth/session.ts → next/headers   ★ 서버 전용
```
**방아쇠는 단 1줄** — `policyfund/index.ts` 에 `export * from "./settlements";` 추가.
`ValidationError` **심볼 하나**를 배럴에서 가져온 대가로 서버 인증 체인 전체가 클라이언트 그래프에 끌려온다.

**해소안(택1)**
1. `ValidationError` 를 배럴(`@/lib/crm`) 이 아니라 **정의 모듈에서 직접** 임포트(권장 — 최소 변경).
2. 서버 전용인 `settlements` 를 `policyfund` 배럴에서 **export 하지 않음**(라우트가 직접 임포트).
3. 서버 전용 모듈에 `import "server-only"` 표식 → 위반이 올바른 지점에서 조기 발견되게.

> **이 건이 §6 경고의 실물 증거다.** `check.sh`·CI 는 **초록**이었고 빌드만 깨졌다.
> 게이트에 build 가 없으면 **이 PR 은 CI 초록으로 머지되어 Vercel 배포가 실패**했을 것이다.
> → `check.sh` 에 `[4/4] build` 추가 권고(→T01)의 근거가 가설에서 **실측 사례**로 바뀌었다.

---

### ✅ PR #8~#12 브랜치 검수 (2026-07-21 · T10 실측, main `e5f7921` 기준)

**전원 브랜치 후보 통과** — 정적 6항목 + `check.sh` + **프로덕션 빌드** 모두 초록.

| PR | 트랙 | 변경 | 베이스뒤처짐 | 8-A 마이그 | 계약파일 | 조율소실 | 8-B custom | check | **build** | 테스트 | 라우트 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| #8 | T06 worker 스캐폴드 | +584/-15 | 1 | 없음 | 클린 | 없음 | 없음 | ✅ | ✅ | 309/23 | 21 |
| #9 | T02 core.crm Supabase | +1415/-0 | 2 | 없음 | 클린 | 없음 | 위임만 | ✅ | ✅ | 337/26 | 24 |
| #10 | T04 공지사항 | +1405/-3 | 2 | 없음 | 클린 | 없음 | 없음 | ✅ | ✅ | 347/25 | 24 |
| #11 | T07 KPI 리더보드 | +1288/-0 | **6** | 없음 | 클린 | 없음 | 픽스처만 | ✅ | ✅ | 333/25 | 21 |
| #12 | T05 status UI | +1033/-164 | 0 | 없음 | 클린 | 없음 | 없음 | ✅ | ✅ | 338/25 | 23 |

**검증 근거**
- **계약 단일소유 준수**: 5개 모두 `app/src/lib/types/**`·`lib/repo/index.ts` 편집 0건.
- **조율파일 소실 없음**: 전 PR 이 main 이상 줄수 보유(`dispatch-queue` 353→353/385/375/407).
- **삭제분 정당성**: #12 의 -164 는 `boards/cells.ts`(-77)·`cells.test.ts`(-49) 통합 = 제목의 "검증엔진 단일화"와 일치. 문서 소실 아님.
- **8-B 미해당**: `custom` 출현부는 테스트 픽스처·행 매핑(`custom: null ?? {}`)·생성 기본값. #9 의 `updateDeal` 은 `this.repo.updateDeal` 단순 위임이라 read-modify-write 위반 없음.

**⚠️ 유효기간 있는 판정 — 아래 조건에서 무효**
1. **브랜치 통과는 후보일 뿐**(기획2 원칙). **완료 판정은 머지 후 `main` 스모크 초록일 때만.**
2. **#11 은 이미 6커밋 뒤처짐** — 머지 순서상 #8·#9·#10 이후면 9커밋 이상 벌어진다. **머지 직전 리베이스 필수**, 리베이스 후 이 판정은 재검증 대상.
3. 위 5건은 **서로 독립적으로** 검사됐다. 누적 머지 시 상호작용(배럴 재노출·타입 충돌)은 **머지 후 main 검사로만** 확인 가능.

**📌 PR #9 관련 중요 사실**: 제목은 "core.crm Supabase" 이나 **마이그레이션 추가 0건**이다.
실DB 스키마 없이 소스 어댑터만 들어오므로 **RLS 32정책 침투테스트는 여전히 불가** — 잔여 항목으로 유지한다.

---

## 13. PR #57·#49 머지 · #48 반려 · DI-A6 판정 (main `db545e0`, 2026-07-30 · T10)

### ✅ PR #57 (T03 R1 진입 UX) — 머지 (main `31dd84e`)
T03 주장 **전부 사실 확인**: 006 `is_platform_admin()` 이 `role='admin'` 을 요구하는데
005 는 belie 를 `role='owner'` 로 넣어 **실제 관리자가 false** 로 판정된다.

**수용기준 7항목**
| # | 기준 | 판정 |
|---|---|---|
| 5 | 승격 단방향 | ✅ 확증 — `if (!isPlatformAdmin && actorEmail)` 진입, `=true` 만. true 를 뒤집는 경로 없음 |
| 6 | 017 없이 폴백 생존 | ✅ 확증 — `app_admin_role` 에 `revoke`/`grant` **0건** → 기본 `PUBLIC EXECUTE` 유지 → 호출 가능 |
| 7 | 014 와 동일 패턴 | ✅ 확증 — `014:56` 이 `app_admin_role(auth.jwt()->>'email') is not null` 사용 |
| 1~4 | 로그인·탈출구·역할·사이드바 | ⚠️ **코드상 성립, 런타임 미검증** — belie 계정 필요(자격증명 입력은 T10 이 하지 않는다) |

**리베이스 정합 수정 1건**: main `366cf7b`(compact pending screen)이 "현재 요청 취소 후 새 회사 시작"
버튼을 제거했는데 PR #57 테스트가 그 문구를 기대해 실패했다. **기능 회귀 아님** — 수용기준 2의
탈출구(`⚙ 플랫폼 관리로 가기`)는 리베이스본에 그대로 있다. **핵심 보안 단언 2건**
(`not.toContain('href="/platform"')`·`not.toContain("플랫폼 관리로 가기")`)은 손대지 않고
부수 회귀확인 1줄만 갱신했다. UI 재설계 의도는 T03 소관이므로 사후 확인 요망.

**발견(차단 아님)**: `app_admin_role(p_email text)` 이 `PUBLIC EXECUTE` 라 **누구나 임의 이메일로
관리자 여부를 확인**할 수 있다. 005 주석의 "이메일 목록 노출 방지" 의도와 어긋난다(005 부터의 기존 상태, 014 도 사용).
**단, 이 권한이 곧 폴백 동작 근거다** → 조이는 순서: ① 017 적용 → ② 폴백 코드 제거 → ③ 권한 조이기.
순서를 바꾸면 폴백이 먼저 죽어 관리자가 다시 갇힌다.

### ✅ PR #49 (T09 정산 화면 + G8) — 머지 (main `db545e0`)
마이그레이션 0 · 계약파일 0 · 삭제 0(+812). worklog 단독 충돌 자동해소(1231 = main 1182 + 블록 49).
리베이스본 check=0 build=0 **899 테스트**. 머지 후 main 동일.

### ❌ PR #48 (T02 CRM 실DB 연결) — **반려**
| # | 위반 | 근거 |
|---|---|---|
| 1 | **기존 마이그레이션 수정** | `006`(+8/-8)·`009`(+4/-4) 직접 편집. CLAUDE.md "새 파일 추가만, 기존 파일 수정 금지" 위반 |
| 2 | **014 번호 충돌** | `014_reserve_crm_route_slugs.sql` 추가 — main 에 이미 `014_platform_metrics_daily.sql` 존재 |

**①은 규칙 위반인 동시에 기능적으로 무효다.** 이미 적용된 DB 에서 006 은 재실행되지 않으므로
예약 슬러그(`companies`·`deals`) 추가가 **프로덕션에 반영되지 않는다**. 신규 환경과 기존 환경의 스키마가 갈린다.
→ **해소**: 슬러그 추가를 **새 마이그레이션(019+)** 으로 옮기고, 006·009 는 원상복구.

### ★ DI-A6 판정 — `platform_metrics_daily` 이중 정의

**정본 = main `014_platform_metrics_daily.sql` (T04). B안 채택.**

| 근거 | 내용 |
|---|---|
| 1 | main 에 **이미 머지**돼 배포 경로에 있다(적용됐을 수 있음) |
| 2 | `016_platform_console_metrics_alignment.sql` 이 이 테이블을 **5회 참조**해 정책·RPC 를 이미 정렬했다. 재정의하면 그것들이 어긋난다 |
| 3 | **★결정적**: 양쪽 모두 `create table **if not exists**` 다 |

**3번이 왜 결정적인가** — 정렬상 `014_platform_console.sql` < `014_platform_metrics_daily.sql`(c<m)이라
T07 것이 **먼저** 실행되고, 그러면 main 014 가 `if not exists` 로 **조용히 건너뛴다**.
에러도 경고도 없이 **스키마가 T07 버전이 되고**, 016 이 기대한 컬럼과 어긋난 채 동작한다.
실패하면 차라리 드러나는데 이 경우는 **무증상**이다. BUG-0002·BUG-0004 와 같은 계열의 사각지대다.

**패배 쪽(T07 PR #56) 수정 지시**
1. `014_platform_console.sql` 에서 `create table ... platform_metrics_daily` **블록 제거**.
2. 추가로 필요한 컬럼이 있으면 **새 번호(019+)** 파일에 `alter table public.platform_metrics_daily add column if not exists …` 로 **additive** 하게만 넣는다.
3. 파일 번호를 **014 → 019+ 로 재배정**(main 에 이미 `014_platform_metrics_daily` 가 있다).
4. 컬럼 기대가 main 정의(`day·org_id·dau·mau·stickiness·active_users·dormant_users·new_deals·computed_at`)와
   다르면 코드를 정본에 맞추거나 ②의 additive 추가로 해소한다. **테이블 재정의는 금지.**

### ⚠️ 번호 충돌 현황 — 규칙 8 재점검 필요
main 에 **`016` 이 두 개** 존재한다: `016_entry_request_dedup`(#57) · `016_platform_console_metrics_alignment`.
서로 다른 대상이라 실행은 되지만 번호 중복은 규칙 위반이고, 위 DI-A6 같은 사고의 온상이다.
**권고**: 신규 마이그레이션은 **PR 생성 직전 `ls supabase/migrations | sort` 로 최신 main 기준 재확인** 후 번호 확정.

---

## 12. ✅ BUG-0004 해소 + 배포 검증 (main `dc0bdc5`, 2026-07-29 · T10)

**PR #59 머지 완료 — 배포 차단 해제.**

### 수정 내용 — `015_fix_org_helper_session_deadlock.sql`
헬퍼 4종(`is_org_member`·`org_role`·`org_scope`·`is_protected_workspace_owner`)에서
`member_account_session_valid()` **선행 조건만 제거**. 006 의 fail-closed 강화
(`membership.status='active' AND organization.status='active'`)는 **유지** — 001 의 느슨한 정의로 돌아간 것이 아니다.

- `member_account_session_valid()` **미삭제** — 세션 무효화는 member account 전용 RPC 에서 계속 유효.
  조직 격리(RLS 기반)와 세션 수명은 다른 관심사이며, 후자를 전자의 전제로 삼아 테넌시 전체가 잠긴 것이 이번 사고다.
- **권한 미변경** — 001·006·011 어디에도 이 4종에 `revoke`/`grant` 가 없어(기본 권한),
  경계를 새로 그으면 무관한 경로를 깨뜨린다. 최소 변경 원칙.
- **번호 재배정**: 작성 중 `014` 가 T04/C4 에 선점되어(`f85178a`) **015 로 변경**.
  §8-A 가 경고한 병렬 번호 충돌이 실제로 발생 — 커밋 직전 `ls | sort` 재확인이 잡았다.

### 검증
| 항목 | 결과 |
|---|---|
| 브랜치 게이트 | check=0 · build=0 · **808 테스트** |
| **머지 후 main** | check=0 · build=0 · **811 테스트** |
| `is_org_member` 최종 정의 | `015_…sql` — 실행부 `session_valid` 호출 **0건** ✅ |
| 마이그레이션 정렬 | `013 → 014_platform → 015_fix` — **015 가 최종 적용** ✅ |

### 배포 검증 (G1 보완 — 이전에는 "빌드 초록"으로 갈음했던 항목)
| 항목 | 결과 |
|---|---|
| `www.moa-work.com` | **200** |
| 구글 OAuth 링크 | **1건** — Supabase Auth 실연결 |
| PostHog(`#53`) | **1건** — 최신 커밋 반영 = 자동 배포 정상 |
| **dev-session 우회** | **0건** — 프로덕션 비활성 ✅ (§7-B 보안 항목 **통과**) |
| 인증 가드 | `/dash`·`/settings/members` 등 **전부 `/login?next=…` 리다이렉트** ✅ |

> **⚠️ `/api/health`·`/api/version` 은 200 이지만 JSON 이 아니라 HTML 을 반환한다** — 라우트가 없는데
> 로그인 리다이렉트로 흡수돼 200 이 된다. 미존재 라우트도 동일(404 미노출).
> **"HTTP 200" 만으로 엔드포인트 존재를 판정하면 안 된다**는 실제 사례.

### 남은 조건 — 코드 수정으로 끝나지 않는다
- **프로덕션 DB 에 011·015 를 적용하는 것은 별개 작업이며 T10 권한 밖**이다.
  015 가 011 의 데드락을 해제하므로 **둘을 함께 적용**해야 안전하다. 011 만 적용하면 전면 장애가 그대로 재현된다.
- 적용 전 **스테이징에서 RLS 침투테스트**로 확인할 것(크리덴셜 주입 필요).
- 현재 프로덕션이 살아 있다는 것은 **011 이 아직 미적용**이라는 정황 근거다(확증하려면
  프로덕션에서 `select prosrc from pg_proc where proname='is_org_member'` 확인 — DB 접근 권한 필요).

---

## 11. ★ 실행계획v1 기준 main 검수 (main `e1a3a05`~`1744d9f`, 2026-07-29 · T10)

> 배경: `613cc67` 이후 **37+커밋이 T10 검수 없이** main 에 누적(Codex 인수 Round 2, C0/C1 워크스페이스,
> OAuth 정식 머지 `#15`, BUG-0003 수정 `#26` 등). 실행계획v1 규칙 8종 + 레인표 + G1~G4 로 실측 검수했다.

### 🔴 BUG-0004 — `is_org_member()` 상시 `false`. **Supabase 연결 시 전면 장애** (배포 차단)

`011_member_account_ops.sql` 이 헬퍼를 재정의하며 세션 검사를 선행 조건으로 걸었다(현재 **최종 정의**):
```sql
create or replace function public.is_org_member(p_org uuid) ... as $$
  select public.member_account_session_valid() and exists (...)
$$;
```
그 `member_account_session_valid()` 는 `current_setting('request.jwt.claim.session_id', true)` 가 비면 **즉시 false**.

**그 클레임을 넣는 배선이 저장소에 없다** (실측, `1744d9f` 기준):

| 확인 | 결과 |
|---|---|
| custom access token hook (`supabase/` 전체) | **0건** |
| `session_id` 클레임을 **설정**하는 SQL | **0건** — 011 은 `current_setting` 으로 **읽기만** |
| 앱의 JWT 클레임 주입 | **0건** — RPC 인자 `p_session_id` 는 JWT 와 무관 |
| 011 이후 되돌린 마이그레이션 | **0건** (012·013 재정의 없음) |

**파급**: `is_org_member()` 는 **RLS 활성 26 테이블의 기반 헬퍼**다. 상시 false 면 침입 차단이 아니라
**정상 사용자 전원이 자기 조직 데이터조차 못 본다**. `org_role()` 도 같은 조건을 물어 역할 경로까지 막힌다.

**왜 안 드러났나 — 게이트 사각지대**: 앱이 Supabase 미연결(인메모리 폴백)이라 이 SQL 이 실행되지 않는다.
그래서 `check.sh` 초록·빌드 초록·스모크 PASS 가 나오고, RLS 침투테스트는 크리덴셜 부재로 **skip** 된다.
**`.env.local` 을 넣는 순간 처음 드러난다.**

**해소안(택1)**: ① custom access token hook 으로 `session_id` 클레임 주입 ② 011 의 세션 종속 제거.
담당: 인증 레인 **T03** 또는 `access_grants`/위임 레인 **T08**.

### 규칙 8 위반 — `is_org_member()` 수정 2건
| 파일 | 날짜 | 내용 | 평가 |
|---|---|---|---|
| `006_public_workspace_entry.sql` | 07-27 | `status='active'` 조건 추가 | fail-closed 강화. 그 자체는 합리적 |
| `011_member_account_ops.sql` | 07-28 | **세션 종속 도입** | **BUG-0004 원인** |

두 건 모두 규칙 전달 이전 커밋이고 격리를 **조이는** 방향이었다. 문제는 011 이
**실현 불가능한 전제(존재하지 않는 JWT 클레임)** 위에 격리 전체를 얹은 것.

> **규칙 8 보강 권고**: "수정 금지"만으로는 이 사고를 막지 못한다(둘 다 선의의 강화였다).
> **"헬퍼가 새 전제(JWT 클레임·세션 등)에 의존하게 만들면 그 전제를 채우는 배선을 같은 PR 에 포함"** 을 추가할 것.

### 라운드 게이트
| 게이트 | 결과 |
|---|---|
| **G1 배포** | ✅ check=0 · build=0 · **782 테스트 / 48 라우트** (`e1a3a05`) |
| **G2 권한** | ❌ **BUG-0004 로 실패** — 실DB 적용 시 전면 차단 |
| **G3 회귀** | ⚠️ 부분 — 정적/빌드는 초록, 실DB 회귀는 크리덴셜 부재로 불가 |
| **G4 워크로그** | ✅ **START/END 규약 도입 확인**(T05 C5 항목). SYNC R1 시점 "미도입"에서 변경됨 |

### 규칙 8종 실측
| # | 규칙 | 상태 | 근거 |
|---|---|---|---|
| 1 | 스위처/어휘 "회사" | ⚠️ 부분 | `WorkspaceSwitcher.tsx` 존재. UI 어휘 '회사' 141 · **'조직' 15건 잔존** |
| 2 | 뱃지 99+ 절단 | ✅ | `SidebarNav.tsx:66`, `layout.tsx:153`, 테스트 존재 |
| 3 | 위임 2시간 · break-glass | ❌ **미구현** | 전 소스 0건 (T08 레인 미착수) |
| 4 | 어드민 등급 super/operator/viewer | ❌ **미구현** | 전 소스 0건 |
| 5 | 두 층위 · 홈택스 차단 | ⚠️ 부분 | 리플레이 제외목록에 `/hometax` 등재. 데이터 층위 분리는 T08 미착수 |
| 6 | `orgs.is_internal` | ❌ **미구현** | 마이그레이션 0건 → 지표에서 내부 조직 미분리 |
| 7 | PostHog | ✅ | US 리전 고정 · `/ingest` rewrites · `maskAllInputs:true`+`maskTextSelector:"*"` · PII scrub + 테스트 |
| 8 | 토큰 하드코딩 / 마이그 번호 | ⚠️ 부분 | 번호 `006`~`013` 3자리 정렬 정상 ✅ / `#c4c4c4` **8곳**(status 팔레트 빈값 기본색 — 브랜드 토큰 아님, 경미) |

### 레인 검사
- `165af69` → `docs/` · `dev-drop/` — **MWC 레인 준수**, 코드영역(app/worker/supabase/scripts) **0건 접촉** ✅
- `1744d9f`(PostHog #53) → `app/src/components/workspace` 포함 — **C5/분석 작업이 T03 셸 레인에 접촉**. 경미하나 레인표상 사전 조율 대상.

### MWC 산출물 커밋 확인
지시된 9파일(`docs/design/design-tokens.md` · `dev-drop/**`)은 **`165af69`(PR #52)로 이미 반영 완료**
(88 files, +10376). 워킹트리 clean — T10 추가 커밋 불요.

---

## 10. ★ 2차 머지큐 최종 판정 (main `6a57489`, 2026-07-22 · T10)

**8개 PR 전량 머지 완료 · main 스모크 초록 → 완료 판정.** 열린 PR 0건.

| # | PR | 트랙 | main SHA | check | build | 테스트 |
|---|---|---|---|---|---|---|
| 1 | #8 | T06 worker 알림 스캐폴드 | `08ec012` | 0 | 0 | 309 |
| 2 | #9 | T02 core.crm Supabase | `6f6f2b2` | 0 | 0 | 337 |
| 3 | #10 | T04 공지사항 | `4d4b92f` | 0 | 0 | 375 |
| 4 | #11 | T07 KPI 리더보드 | `699be64` | 0 | 0 | 399 |
| 5 | #13 | T01 Vercel install fix | `85dc18c` | 0 | 0 | 399 |
| 6 | #14 | T03 B1 앱 셸 + OAuth + RLS 하네스 | `5a3ffd5` | 0 | 0 | 413 |
| 7 | #12 | T05 status UI | `81001f9` | 0 | 0 | 442 |
| 8 | #7 | T09 정산 | **`6a57489`** | 0 | 0 | **460** |

**최종 main 런타임 스모크**: `scripts/smoke.sh` → **PASS=20 FAIL=0 SKIP=0**, 서버 에러 로그 0건.
**조율기록 보존**: `dispatch-queue` 487줄(소실 0) · `worklog` 649줄(T10 항목 제목 보존).

### 잡은 결함 2건 — 둘 다 check.sh·CI 초록 상태에서 파손
1. **PR #7(초기)** — `policyfund/index.ts` 배럴 export 1줄로 서버 전용 `next/headers` 가 클라이언트 번들 유입.
   CI 초록·빌드만 실패 → **게이트에 build 가 없었다면 머지되어 Vercel 배포 실패**. T09 가 배럴 분리로 해소.
2. **PR #12(초기)** — `setCells` 반환을 `{item,errors}` 로 바꿔 **이미 머지된 T04 `notices/service.ts` 파손**.
   브랜치 단독 검수는 초록이었고 **누적 머지 후에만** 드러남 → **리베이스본 검증이 main 오염 전 차단**.
   T05 수정이 T10 제안보다 우수: `.item` 만 꺼내면 검증오류가 조용히 사라지므로, 공지 API 는 **거부**하도록 처리.

### 이번 라운드에서 확립된 절차 (다음 큐에 그대로 적용)
- **PR 검수 = 정적 6항목 + `check.sh` + 프로덕션 빌드**. CI 초록은 빌드를 보장하지 않는다.
- **머지 직전 리베이스본 재검증 필수** — 브랜치 단독 통과는 후보일 뿐. 교차 파손은 리베이스 후에만 드러난다.
- **충돌 자동해소는 `docs/worklog.md` 단독일 때만** (추가 전용, 산술 검증 + 마커 0 + 기존 제목 보존 확인).
  구조적 YAML(`dispatch-queue`)은 자동해소 금지 — 섹션 의미를 깨뜨린다.
- **문서 커밋은 diff 통계의 deletions 를 반드시 확인**. 마크다운/YAML 삭제는 lint·typecheck·test 어디에도 걸리지 않는다.
- 브랜치 전환 직후 `.next` 삭제(오실패 방지) · 전용 포트(오통과 방지).

### ⛔ 남은 미검증 (완료판정 범위 밖 — MVP done 아님)
1. **RLS 32정책 실DB 침투테스트** ★ — 하네스(`app/src/lib/auth/rls-penetration.test.ts`, 5케이스)는 main 에 있으나
   크리덴셜 5개(`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`/`RLS_TEST_ORG_A_EMAIL`/`_PASSWORD`/`RLS_TEST_ORG_B_ID`)
   미주입 시 **skip**. **"하네스 머지됨" ≠ "RLS 검증됨"**. 커버리지도 조직격리 4케이스뿐 —
   담당범위·역할경계·전역카탈로그 쓰기거부·anon 접근·앱↔DB 정합 대조는 미포함.
   ※ 마지막 케이스 `expect(typeof READY).toBe("boolean")` 는 **항상 통과**하는 무의미 단언이라 통과수에 착시를 준다.
2. **구글 OAuth 실동작** — 라우트 존재, 실제 로그인 미검증.
3. **정산 수식 parity** — 실DB generated column 대조 미실시.
4. **파일첨부 Storage org 격리** — 미검증.

### 📌 기록 (머지 판정 미반영, 별도 커밋 보완 예정)
- **manifest 파일 부재** (favicon·icons 메타데이터는 있음).
- **shadcn 매핑 미반영** — `--background`/`--foreground`/`--primary`/`--destructive` 등 표준변수 정의 0개.
- **토큰 이중 정의 드리프트 위험** — `globals.css` 의 `--mw-*`(정본, 값 9개+별칭 5개 **정본 일치 확인**) 와
  `styles/moawork-color-tokens.css` 의 `--moawork-*` 가 같은 색을 다른 이름으로 중복 정의. 한쪽만 바뀌면 조용히 어긋난다.
- **8-A 권고 반영 확인** — T03 이 `004_`/`005_` **3자리**로 추가해 정렬 순서 정상. 4자리였다면 도메인 스키마(001)보다 먼저 적용됐다.
- **보안 확인** — `005_app_admins`: 테이블 RLS 활성 + 직접조회 차단(SECURITY DEFINER 경유), **기존 격리정책 무변경**,
  앱 `isPlatformAdmin` 은 세션 세팅만 되고 **데이터 필터 미사용** → 관리자 권한이 조직격리를 우회하지 않음.

---

## 11. PR #15 · B1b Google OAuth 후보 판정 (2026-07-23 · Codex T10)

**브랜치 후보 PASS · main 완료판정 전.** `feat/codex-t03-oauth` head `47707b2`, base `e774a45`, GitHub mergeable.

| 검증 | 결과 |
|---|---|
| 변경범위·계약파일·마이그레이션 | ✅ auth/session/proxy/UI만, 공용 타입·Repo·DB 스키마 무변경 |
| 비밀값 | ✅ diff credential scan 0, GitGuardian PASS |
| `scripts/check.sh` | ✅ app 471 passed / 5 RLS skipped, worker 14 passed |
| 프로덕션 build | ✅ Next 16 compile·typecheck·22 static generation·전체 route collect |
| 운영 렌더 | ✅ Google CTA 노출, dev 계정·데모 이메일 미노출 |
| 운영 우회 방어 | ✅ `?as=owner` 무효, Supabase env 누락 비공개 경로 fail-closed |
| GitHub CI / Vercel Preview | ✅ 전 체크 PASS, Preview 배포 Ready |

**코드 판정 근거**
- 콜백은 PKCE 교환 후 `public.users`를 보강하고, `app_admin_role()`이 허용한 최초 사용자만 owner 조직을 생성한다. 조직 trigger가 멤버십을 원자적으로 만들며, 이후 세션은 쿠키 값이 아니라 실제 `org_members`를 재검증한다.
- `next`는 단일 `/` 내부 경로만 허용해 `//evil.example`을 포함한 외부 리다이렉트를 차단한다.
- dev-session과 역할 오버라이드는 `NODE_ENV !== 'production'`에서만 렌더·적용한다.

**완료판정 보류 1건** — Vercel Preview는 인증 보호 화면이라 자동 외부 요청으로 로그인 UI를 재확인할 수 없다. main 머지·Production 배포 뒤 실제 Google 계정 선택 → 콜백 → 새로고침 세션 → `beliefkimkim@gmail.com` owner/플랫폼관리자를 라이브로 확인한 뒤 §10의 "구글 OAuth 실동작"을 해소한다.

---

## 8. 교차 위험 — 8트랙 동시 착수 시 매 PR 확인 (T10 실증 2026-07-21)

> 조율 문서에서 제기된 두 위험을 **실행으로 재현 확인**했다. 둘 다 CI 초록으로 통과하며,
> 터지는 시점이 "실제 DB 적용" · "실제 파일 첨부"라서 단위테스트로는 잡히지 않는다.

### 8-A. ⛔ 마이그레이션 번호 혼재 — 신규 파일이 스키마보다 먼저 적용됨
현재 4개 파일은 **우연히** 올바른 순서로 정렬된다:
```
0001_init.sql · 001_schema_v1.sql · 002_seed_policyfund.sql · 003_boards_engine.sql
```
그러나 **4자리 신규 파일을 추가하는 순간 깨진다**(실증):
```
0001_init.sql → 0004_new_feature.sql → 001_schema_v1.sql → 002_… → 003_…
                ^^^^^^^^^^^^^^^^^^^ 도메인 스키마(001)보다 먼저 실행 = 테이블 부재 상태
```
`"0004…" < "001…"` (3번째 문자 `0`<`1`)이기 때문. **B2(core.crm Supabase)가 마이그레이션을 추가하면 즉시 현실화**된다.
- [ ] **신규 마이그레이션은 반드시 3자리 `004_`/`005_`** (4자리 `0004_` 금지). 위반 시 **반려**.
- [ ] 파일 추가 PR 은 `ls supabase/migrations | sort` 결과가 **의도한 적용 순서와 일치**하는지 확인.
- [ ] 근본 해소(권고 →T01/스키마 오너): 번호 체계 일원화 또는 `0001_init` 리네임.

### 8-B. ⛔ `updateDeal` 의 `custom` 통째 교체 — 타 트랙 데이터 소실
`app/src/lib/repo/local/localRepo.ts:340` 실측:
```ts
const { assigned_to, ...rest } = patch;
Object.assign(d, rest);        // ← patch.custom 이 기존 custom 을 통째로 대체(deep-merge 아님)
```
`updateDeal(ctx, id, { custom: { files: [...] } })` 한 번이면 **T05 커스텀필드 값 · T09 정책자금 값이 전부 소실**된다.
조용히 사라지고 에러도 안 난다 — BUG-0002 와 같은 "무증상 파손" 계열.
- [ ] `custom` 을 쓰는 모든 경로가 **read-modify-write**(`getDeal` → `{...deal.custom, 새키}` → 기록)인지.
- [ ] **회귀 검사**: 딜에 커스텀필드 값 + 정책자금 값을 넣은 뒤 파일 첨부 → **기존 값 잔존** 확인(부정 조건만 보지 말고 **값이 남아있음을 긍정 확인**).
- [ ] 근본 해소는 `field_values`(001 정본) 또는 포트 레벨 병합 — 담당 T03(계약 단일 소유).

### 8-C. 8트랙 동시 착수 공통
- [ ] **serial merge 준수** — 머지 직후 main 스모크 통과 전 다음 PR 머지 금지.
- [ ] 각 PR 이 **`app/src/lib/types/**` · `app/src/lib/repo/index.ts` 를 직접 편집했는지**(계약 단일 소유=T03 규칙 위반 시 반려).
- [ ] 브랜치가 **최신 main 리베이스** 상태인지(오래된 베이스면 스모크 결과가 main 을 대표하지 못함).
- [ ] 스모크 전 **`.next` 캐시 삭제 + 전용 포트 + 포트 선점 검사**(`smoke.sh` 내장) — 오통과/오실패 방지.

---

## 부록. 현재 상태 스냅샷 (2026-07-21, 등록 시점)
- 스키마 v1(`001_schema_v1.sql`) 문법 검증 완료 — **런타임 RLS 행동은 Supabase 적용 후 침투 테스트로 확정(T03·T10)**.
- T02 crm 코어는 작업 트리에 산출(도메인 순수 계층 + API 라우트 + InMemory/PostgREST 어댑터), Auth/RLS 실연동은 T03 후속.
- 베이스라인 `check.sh` 초록 확인됨. parity·RLS 런타임 검증은 각 트랙 배포·Supabase 적용 시 착수.
