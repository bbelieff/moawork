# T07 — mod.perf 성과·인센티브 시스템 설계 (Phase 1.5)

> 대상: `mod.perf` (성과 집계 · 리더보드 · 활동량). Phase 1.5 · **벤더불요**(외부 연동 없음, 순수 내부 데이터 집계).
> 근거: `docs/PLAN-v0.2.md` §3 mod.perf(L101–105)·§4 흐름 G(L125), DB 스키마 `supabase/migrations/001_schema_v1.sql`.
> 선행: **T02(core.crm) done** — deals/settlements/activities/stages 스키마·CRUD 제공(DQ-0002 완료).

---

## 0. 요약

- **입력 소스**(모두 T02 core.crm 소유): `settlements`(수수료·계약금·총매출), `deals`(담당자·단계), `activities`(통화/미팅/메모), `stages.kind`(파이프라인 단계 종류).
- **산출물**: `performance_snapshots`(월별 1인 1행) + 리더보드 조회 API + 성과 UI.
- **규칙 엔진**: `incentive_rules`(base × type) → 순수 함수로 인센티브 계산.
- **원칙**: (1) 스냅샷은 **소스로부터 재생성 가능한 캐시**(멱등 upsert), (2) 금액 반올림은 settlements generated column과 **동일 규칙**(`round`), (3) 비밀값 없음(벤더불요), (4) RLS는 `is_org_member(org_id)`에 의존(조직 격리는 T03/T10이 런타임 검증).

---

## 1. 데이터 모델 (기존 스키마 사용 — 신규 마이그레이션 최소)

스키마 v1에 성과 도메인 2테이블이 이미 존재한다(`001_schema_v1.sql` L304–321). **재정의하지 않는다.**

### 1.1 `incentive_rules` — 인센티브 규칙
| 컬럼 | 타입 | 의미 |
| --- | --- | --- |
| `org_id` | uuid | 조직 |
| `name` | text | 규칙명 |
| `base` | `incentive_base` = `fee`\|`down`\|`total` | 인센티브 산정 기준액 |
| `type` | `incentive_type` = `flat_pct`\|`tiered` | 고정% / 구간% |
| `config_jsonb` | jsonb | 규칙 파라미터(아래 §2.3) |

### 1.2 `performance_snapshots` — 월별 성과 스냅샷
| 컬럼 | 타입 | 의미 |
| --- | --- | --- |
| `org_id`,`user_id` | uuid | 조직 · 대상 조직원(`deals.assigned_to`) |
| `period` | text `'YYYY-MM'` | 귀속 월 |
| `contracts_cnt` | int | 계약(실현) 건수 |
| `fee_sum` | numeric | 수수료(원) 합 |
| `incentive_amount` | numeric | 규칙 적용 인센티브 |
| — | unique `(org_id,user_id,period)` | 멱등 upsert 키 |

### 1.3 신규(마이그레이션 `003_perf.sql` 제안 — **선택**)
스키마 v1로 MVP 리더보드는 **충분**하다. 단, 활동량을 스냅샷에 영속화하려면 컬럼 추가가 필요하다. 기존 파일 수정 금지 규칙(CLAUDE.md) → **새 마이그레이션**으로만.

```sql
-- 003_perf.sql (제안, 선행: 001)
alter table performance_snapshots
  add column if not exists activity_score numeric not null default 0,  -- 가중 활동 점수(§3.2)
  add column if not exists activity_cnt   int     not null default 0,  -- 원시 활동 건수
  add column if not exists computed_at     timestamptz not null default now();
-- 리더보드 정렬용 인덱스
create index if not exists perf_snap_org_period on performance_snapshots(org_id, period);
```
> 활동량을 스냅샷에 넣을지, 실시간 집계로만 둘지는 §6 결정사항. 미도입 시 활동량은 API 레이어에서 `activities` 실시간 집계로 제공(스냅샷 스키마 무변경).

---

## 2. 집계 로직

### 2.1 기간 귀속(period attribution) — **핵심 규칙**
"언제의 성과인가"를 하나로 고정한다.

- **계약/수수료**: `settlements.fee_paid_at`(수수료 입금일)의 **연-월**을 귀속 월로 한다.
  - 근거: 인센티브는 **실현(수납)** 기준으로 지급 — `fee_paid_at`이 null이면 미실현 → 스냅샷 제외.
  - 계약금 기준(`base=down`) 규칙일 때도 지급 시점 일관성을 위해 기본은 `fee_paid_at` 사용. 계약금 입금월 기준이 필요하면 규칙 `config.period_anchor:"down_paid_at"`로 오버라이드(§2.3).
- **활동량**: `activities.at`의 연-월(§3).
- 귀속 대상 조직원: `deals.assigned_to`. `settlement → deal.assigned_to`로 조인. 미배정(null) settlement는 **조직 공통(user_id=null) 버킷**에 집계하되 리더보드 순위에서는 제외(참고 표기).

### 2.2 계약건수·수수료 합
대상 기간 `P`, 조직 `O`의 각 사용자 `u`에 대해:

```
rows(u,P) = settlements s
            join deals d on s.deal_id = d.id
            where d.org_id = O
              and d.assigned_to = u
              and to_char(s.fee_paid_at,'YYYY-MM') = P   -- 실현월
contracts_cnt = count(rows)                              -- 수납 발생 건수
fee_sum       = sum(s.fee_amount)                        -- generated col(반올림 완료)
down_sum      = sum(s.down_payment)
total_sum     = sum(s.total_revenue)                     -- generated col
```
`fee_amount`·`total_revenue`는 이미 `round()` generated column이므로 **앱에서 재반올림 금지**(중복 반올림 오차 방지).

> **참고 지표(booked)**: "단계 진입" 기준 계약 건수(파이프라인 KPI)는 `deals.stage_id → stages.kind='contract'` 도달 건수로 별도 산출(대시보드용). 스냅샷의 `contracts_cnt`는 **실현(수납) 기준**으로 통일 — 두 지표를 혼동하지 않도록 UI에서 라벨 구분("수납 N건" vs "계약단계 N건").

### 2.3 인센티브 규칙 평가 (순수 함수)
기준액 선택:
```
base_amount = { fee: fee_sum, down: down_sum, total: total_sum }[rule.base]
```

**`flat_pct`(고정%)** — `config = { pct: number }` (정수 퍼센트, settlements와 동일 관례 3 = 3%):
```
incentive = round(base_amount * pct / 100)
```

**`tiered`(구간%)** — `config = { mode: 'whole'|'marginal', tiers: [{ min: number, pct: number }, ...] }` (min 오름차순):
- `whole`(달성구간 전체적용, 기본): base_amount가 속한 최상위 구간의 pct를 **전체 base_amount에 적용**.
  ```
  pct = tiers에서 min ≤ base_amount 인 것 중 최대 min의 pct
  incentive = round(base_amount * pct / 100)
  ```
- `marginal`(누진): 각 구간 경계 사이 금액에 해당 구간 pct를 적용해 합산.
  ```
  incentive = round( Σ (구간별 해당액 × 구간 pct / 100) )
  ```

규칙 선택: 조직당 규칙 다수 가능 → **활성 규칙 1개**(MVP: `config.active:true` 또는 최근 1개)를 스냅샷 계산에 사용. 향후 역할·업종별 규칙 매핑은 확장(config에 `applies_to` 추가). 반올림은 최종 1회만(`round`), 정수원 단위.

### 2.4 스냅샷 재계산(멱등)
```
recompute(org, period):
  for each user u with rows(u,period) or activities(u,period):
     upsert performance_snapshots
       (org_id, user_id, period, contracts_cnt, fee_sum, incentive_amount[, activity_*])
     on conflict (org_id,user_id,period) do update  -- 멱등
```
- **트리거 시점**: (a) 사용자 버튼 "이번 달 재계산", (b) 월 마감 배치(pg-boss 주기 잡, 매월 1일 새벽 — 전월 확정), (c) settlement/activity 변경 시 해당 월 dirty 표시 후 지연 재계산(선택, 과도한 재계산 방지).
- 벤더불요이므로 (a)+(b)만으로 MVP 충족. 배치 잡은 worker(pg-boss)에 등록하되 **T06이 세우는 잡 핸들러 패턴**을 재사용(중복 부트스트랩 금지) — `dispatch-queue`로 조율.

---

## 3. 활동량 측정 기준

### 3.1 소스와 원시 집계
`activities(type, actor, at, deal_id, org_id)` — T02가 파이프라인/딜 활동 기록 시 적재.
- 귀속: `actor`(수행자) · `at`(발생시각의 연-월).
- 원시 카운트: type별 건수. `type ∈ {call, meeting, memo, status}`.

### 3.2 가중 활동 점수(activity_score)
활동의 질을 반영해 가중합한다. **`status`(단계이동 자동로그)는 사람이 만든 활동이 아니므로 점수 제외**(중복·자동 생성 → 어뷰징 방지).

| type | 의미 | 가중치(기본) |
| --- | --- | --- |
| `call` | 통화 | 1 |
| `meeting` | 미팅 | 3 |
| `memo` | 메모/기록 | 0.5 |
| `status` | 단계이동(자동) | **0 (제외)** |

```
activity_cnt   = count(activities where actor=u, month=P, type ≠ 'status')
activity_score = Σ weight[type] * count(type)
```
- 가중치는 조직 설정으로 조정 가능(`org_settings` 또는 규칙 config; MVP는 상수 기본값 + 코드 상수).
- **측정 기준 원칙**: ① 자동 생성 이벤트 비계량(status), ② 동일 딜 동일 type 단시간 중복은 향후 스팸 필터(선택), ③ 활동량은 **성과(계약)와 분리된 축** — 리더보드에서 별도 컬럼/탭으로 노출(활동 많다고 순위 1위 아님).

### 3.3 활동량의 위치
활동량은 인센티브 산정에 **직접 반영하지 않는다**(계약·수수료가 성과의 정본). 리더보드 보조 지표·코칭 지표로만 사용. 인센티브에 활동 가중을 넣는 규칙은 Phase 2 이후 검토.

---

## 4. 리더보드 UI

### 4.1 화면 구성 (흐름 G: 사이드바 `성과·조직` → 리더보드·인센티브)
1. **리더보드**(`/perf` 기본 탭)
   - 월 선택기(기본 이번 달). 정렬 기준 토글: **인센티브 / 수수료합 / 계약건수 / 활동점수**.
   - 순위 테이블: 순위(🥇🥈🥉) · 이름/아바타 · 계약(수납)건수 · 수수료합(₩) · 인센티브(₩) · 활동점수. 본인 행 하이라이트.
   - 각 행 월별 추세 스파크라인(최근 6개월 스냅샷). 합계 푸터(조직 total).
   - 미배정 버킷은 순위 밖 "조직 공통" 행으로 별도 표기.
2. **내 성과**(개인 대시보드 탭)
   - 이번 달 계약/수수료/인센티브 카드 + 목표 대비(목표는 추후) + 활동 breakdown(call/meeting/memo).
   - 재접촉 알림 연계 훅(settlements `d180`/`d365`) — 표시만, 발송은 mod.notify(Phase 2).
3. **인센티브 규칙**(admin 전용 탭, `org_role ∈ {owner,admin}`)
   - 규칙 목록·편집(base·type·config). `tiered` 구간 편집 UI(구간 추가/삭제, min·pct). "이 규칙으로 이번 달 재계산" 버튼.

### 4.2 데이터·권한
- 리더보드는 `performance_snapshots` 조회(스냅샷 캐시). "지금 재계산" 시 §2.4 recompute 호출.
- **RLS**: `performance_snapshots`·`incentive_rules`는 `is_org_member(org_id)` 정책(L440–441) → **조직원은 조직 전체 스냅샷 열람 가능**(리더보드는 조직 공개). 규칙 편집은 앱 레이어에서 `org_role` admin 이상으로 가드.
- `member_scope='assigned'`(내 담당만) 사용자도 **리더보드 집계 수치는 열람**(개인 딜 원장 접근과 무관 — 스냅샷은 집계값). 개별 딜 드릴다운 링크는 scope 존중.
- 반응형: 홈처럼 모바일 상단 고정 요약(PLAN core.dash 원칙과 정합).

### 4.3 렌더링
- 서버 컴포넌트로 스냅샷 조회 → 순위 계산은 조회 시 `order by`(인덱스 `perf_snap_org_period`). 클라이언트는 정렬 토글·기간 전환만.
- 순위 동점 처리: 인센티브 → 수수료합 → 계약건수 순 tie-break, 그래도 동점이면 이름 오름차순.

---

## 5. 구현 계층 (T02/T09 관례 준수)

```
app/src/lib/perf/
  types.ts        성과/규칙/스냅샷/활동 타입
  incentive.ts    인센티브 규칙 평가(순수 함수, §2.3)  + 단위테스트
  aggregate.ts    rows→스냅샷 계산(순수 함수, §2.2)     + 단위테스트
  activity.ts     활동 가중 점수(순수 함수, §3.2)        + 단위테스트
  store.ts        PerfStore 포트(소스 조회 + 스냅샷 upsert) + InMemory 어댑터
  postgrest.ts    PostgrestPerfStore(SUPABASE_URL/KEY 있을 때)
  service.ts      recompute / leaderboard / rules CRUD 오케스트레이션
  index.ts        getStore()/getService() 팩토리(crm/index.ts 패턴 동일)

app/src/app/api/perf/
  leaderboard/route.ts        GET  ?period=YYYY-MM&sort=incentive
  snapshots/route.ts          GET  개인/조직 스냅샷
  snapshots/rebuild/route.ts  POST { period } → recompute(멱등)
  rules/route.ts              GET/POST/PATCH  인센티브 규칙(admin 가드)

app/src/app/(dash)/perf/...   리더보드/내성과/규칙 페이지

worker/  월 마감 재계산 pg-boss 잡(선택) — T06 핸들러 패턴 재사용
```
- **순수 계층 우선**(T09 방식): `incentive.ts`·`aggregate.ts`·`activity.ts`는 DB 무의존 순수 함수 → 테이블 없이도 `bash scripts/check.sh` 초록. 스토어/어댑터/UI는 그 위에 얹는다.
- 비밀값: 없음(내부 집계). Supabase 접속키는 `.env`로만(기존 crm 어댑터와 동일 주입).

---

## 6. 결정 요망 / 열린 항목

1. **활동량 영속화 여부**: 스냅샷 컬럼 추가(`003_perf.sql`, §1.3) vs API 실시간 집계. → 리더보드 정렬 성능·이력 보존 위해 **영속화 권장**. belie/게이트 승인 시 003 추가.
2. **인센티브 규칙 다중 적용**: MVP는 조직당 활성 규칙 1개. 역할·업종별 규칙 매핑은 Phase 2.
3. **tiered 기본 모드**: `whole`(달성구간 전체적용) vs `marginal`(누진). 한국 영업 인센티브 관행 확인 후 확정 — 기본안 `whole`.
4. **계약건수 정의**: 스냅샷=실현(수납, `fee_paid_at`) 기준 확정. 계약단계 진입 건수는 대시보드 보조지표로 분리.
5. **재계산 트리거**: 버튼 + 월 배치. settlement 변경 즉시 재계산은 부하 검토 후 도입.

---

## 7. 검증(T10 게이트키퍼 연계)

- **집계 정합성**: 스냅샷 재계산 멱등성(같은 입력 → 같은 값), fee_sum = Σ settlements.fee_amount(generated col과 원 단위 일치, 재반올림 없음).
- **RLS 침투**: 타 조직 스냅샷/규칙 비열람(Supabase 적용 후 T03/T10). 규칙 편집 admin 가드.
- **활동량 어뷰징**: status 자동로그 점수 제외 확인, 동일 딜 반복 활동 스팸 필터(선택) 회귀 테스트.
- parity: 먼데이 성과 화면과 지표 정의 대사(수수료·인센티브 계산이 먼데이 수식과 일치).

---

## 부록 · 근거 인용
- `docs/PLAN-v0.2.md` L101–105 (mod.perf 요구), L110 (수수료(원)=실행액×%/100, 총매출=계약금+수수료), L125 (흐름 G), L133–135 (RLS·수식 컬럼·정수 퍼센트).
- `supabase/migrations/001_schema_v1.sql` L17–26 (enums), L156–184 (deals/activities), L233–252 (settlements generated cols), L304–321 (incentive_rules/performance_snapshots), L440–441 (perf RLS 정책).
