# 디스패치 프롬프트 — B2~B7 + T04신규 (유휴트랙 병렬 배분)  [post-004]

> 작성: 기획-Cowork 2026-07-21 (사장님 지시: 유휴트랙 즉시 배분, B0/B1 안 기다리고 병렬 진행).
> 공통 규약: coordination README §다중 세션. **착수 전** ①session-registry 자기행 갱신 ②레포 실측(app/·lib/·`docs/coordination/_FOUNDATION.md` 규약·001~004 스키마) ③기존물 검색. 커밋=feat/T0x-*, T10 통과분만 main→Vercel 자동배포. 실DB=Supabase(001~004 적용). 색=`brand/assets/MoaWork-Nplus-O-logo-pack-v1.1/moawork-color-tokens.css`(하드코딩 금지). 데이터=가상만.

## 0. 의존성 그래프 & 병렬 전략

```
B0(T01 Vercel) ─ 독립
B1(T03 셸·세션·auth·RLS) ─ 키스톤: 제공물 = 앱셸 layout / getSession(org·role·scope) / Supabase 클라이언트 / entitlement gate
   ├─ B2(T02) SupabaseRepo(crm)+신규/컨텍/업무 화면      … B1 통합 필요(인터페이스 선구현 가능)
   │    ├─ B3(T05) 커스텀필드+status UI+board_views+하위아이템 … B2 데이터
   │    ├─ B4(T09) settlements 화면+상태→그룹 이동(자동화)     … B2 딜
   │    └─ B5(T07) 이달의 계약회사 KPI·리더보드              … B2/B4 집계
   ├─ T04(신규) 공지사항(003 boards)+홈 대시 위젯           … B1 셸(데이터 독립)
   └─ B7부분(T06) worker Phase2 스캐폴드(알림톡·홈택스 골격)  … 독립
기획2 ─ 002 seed(status 라벨+hex·자동화 프리셋)·PLAN-v0.2 동기화·gen types·자동화19전수표
```

**★ 병렬 규칙(핵심): 지금 전 트랙 착수 가능.** 화면·서비스는 **Repo/Service 인터페이스 대상으로 선구현**(로컬 시드로 확인)하고, **실 Supabase 통합만 선행 트랙 머지 후**에 붙인다. "선행"은 데이터 통합 시점 의존이지 착수 시점 의존이 아님. 인터페이스가 없으면 최소 인터페이스를 자기 파일에 정의하고 worklog에 선언(T01/공용이 후속 통합).

**★ 파일 리스(충돌 방지 — 라우트는 메뉴별로 분리되어 안 겹침):**
- T02: `신규업체`·`컨텍업체`·`업무관리` 라우트 + crm repo/service 슬라이스 + 딜/보드 컴포넌트
- T04: `공지사항` 라우트 + boards(003) repo/components + 홈 대시 위젯(`components/dash/*`) + core.dash 서비스
- T05: `설정>커스텀필드` + status 컬럼 UI + board_views 저장 UI + 하위아이템 컴포넌트 + custom repo/service 슬라이스
- T07: `이달의 계약회사` 라우트 + perf repo/service 슬라이스
- T09: `회계` 라우트 + settlements 화면/서비스 + automation-rules 엔진/설정 UI + 업종팩 seed 로더
- T06: `worker/**`
- 공용 `lib/repo/index.ts`·공유 타입 편집은 **worklog 선언 후 직렬**(T01 조율).

---

## B2 — core.crm 실 Supabase repo + 파이프라인 화면 (T02)
```
목표: 신규업체·컨텍업체·업무관리를 하나의 deals 파이프라인을 단계필터한 화면으로 구현하고, 데이터 접근을 실 Supabase로.
읽기: 001(companies·pipelines·stages·deals·activities·RLS), _FOUNDATION getRepo 규약, docs/design/먼데이-구조-스펙.md §2(3보드 컬럼).
구현: (1) SupabaseRepo(crm 슬라이스): listDeals(byStage/assignee)·getDeal·moveDealStage·createDeal·updateDeal·createActivity·listActivities·listCompanies. getRepo()가 env 있으면 Supabase, 없으면 local(_FOUNDATION 유지). (2) 화면: 신규업체=stage.kind='marketing', 컨텍업체=meeting/contract, 업무관리=work. 칸반+테이블 토글, 카드 드래그 이동(=moveDealStage), 카드클릭 딜상세(정보·활동 탭). (3) 활동기록(통화/미팅/메모).
의존: B1(세션컨텍스트·셸). 없으면 세션 인터페이스 최소정의 후 선구현, B1 머지 후 배선.
수용: 실DB로 3화면에서 딜 CRUD·단계이동, 담당범위(scope) 반영(멤버=본인담당만), 활동 남음.
금지: 커스텀필드(T05)·정산(T09)·공지(T04) 침범. status 라벨 UI는 T05. 스키마 수정.
```

## B3 — 커스텀필드 + status 컬럼 UI + board_views + 하위아이템 (T05)
```
목표: 먼데이식 "카테고리 자유설정"(대표님 1순위) 구현. field_type 13종+status.
읽기: 003(boards·board_columns·items·item_values·board_views·G1 parent_item_id), 004(field_type 'status'), docs/design/먼데이-실측-버튼시퀀스-DB매핑_v0.1.md §2b(컬럼⋯메뉴·status 라벨 규약).
구현: (1) 컬럼 편집: 추가/타입변경/이름/삭제/복제, options_jsonb 선택지 편집. (2) **status 타입 UI(G7)**: 색라벨 드롭다운(options_jsonb {labels:[{id,label,hex,is_done,index}]} 읽어 렌더), 셀 클릭→라벨 팔레트. (3) **board_views 저장(G2)**: 필터/정렬/표시컬럼/숨김을 뷰 탭으로 저장·전환. (4) **하위아이템(G1)**: items.parent_item_id 확장 서브테이블.
의존: B2(보드/딜 데이터 표시맥락). status 라벨+hex 데이터는 **기획2가 002 seed로 제공**(없으면 더미 라벨로 선구현). 
수용: 조직이 컬럼·선택지·뷰를 만들어 쓰고 새로고침 유지, 상태클릭 동작, 하위아이템 펼침.
금지: 자동화 규칙 실행(T09/G8)·정산·라우트 중복. 스키마 수정.
```

## B4 — settlements 정산 + 상태→그룹 이동 자동화 (T09)
```
목표: 회계(정산) 화면 + 업종팩 + G8 단일 레시피 자동화.
읽기: 001(settlements 수식컬럼 fee_amount·total_revenue·d180·d365), 002(업종팩 seed), 004(board_automation_rules G8), 먼데이-구조-스펙 §3 수식.
구현: (1) 회계 라우트: settlements 목록·입력(실행액·수수료%)→수수료(원)·총매출·D+180/365 자동표시(수식컬럼 read), 수수료입금일·재접촉목록. (2) 업종팩: 002 진행기관·상품·지역 프리셋을 field_defs/board_columns로 로드. (3) **G8 자동화 엔진**: board_automation_rules(status_column_key·status_value→to_group_id) 설정 UI + 실행(상태 변경 시 item.group_id 갱신). 초기 프리셋(신규→컨텍→업무 이동)은 기획2 seed 대기(없으면 사용자 수동설정).
의존: B2(딜). 자동화 프리셋=기획2.
수용: 정산 숫자 자동 일치, 상태 X→그룹 Y 이동 규칙 설정·동작.
금지: 커스텀필드 편집(T05)·KPI(T07). 스키마 수정.
```

## B5 — 이달의 계약회사 KPI·리더보드 (T07)
```
목표: mod.perf — 성과·인센티브 집계 화면.
읽기: 001(incentive_rules·performance_snapshots·settlements), 먼데이-구조-스펙(담당자별).
구현: 이달의 계약회사 라우트: 월별 계약건수·수수료합·총매출 집계, 담당자 리더보드, 인센티브 규칙(고정%/구간%) 최소 편집. performance_snapshots 계산·표시.
의존: B2(딜)·B4(settlements 집계값). 집계 인터페이스 대상 선구현 가능.
수용: 월 스냅샷이 규칙대로 계산·리더보드 표시.
금지: 정산 입력(T09)·커스텀필드. 스키마 수정.
```

## T04신규 — 공지사항 보드 + 홈 대시보드 위젯 (T04)
```
목표: (1) 공지사항(003 임의보드 엔진 첫 실사용) (2) 홈 대시보드 위젯(core.dash).
읽기: 003(boards·board_groups·board_columns·items·item_values), UI목업_모아워크셸_v0.3.html(홈 카드 구성).
구현: (1) 공지사항 라우트: boards 엔진으로 공지 보드 렌더(작성자·공문PDF·내용·상태), CRUD. (2) 홈 대시 위젯: 이번달 요약(계약수·수납·총매출)·오늘 할 일·파이프라인 단계별 건수·최근 활동. 데이터는 core.dash 서비스(deals/settlements 집계)—인터페이스 대상 선구현, 실데이터는 B2/B4 후 배선.
의존: B1(셸에 위젯 배치·라우트). 데이터는 독립/선구현.
수용: 공지 CRUD 동작, 홈 위젯이 셸에 표시(초기엔 시드/집계).
금지: 파이프라인 보드(T02)·정산(T09). 스키마 수정.
```

## B7부분 — worker Phase2 스캐폴드 (T06, 독립)
```
목표: Phase2 벤더 워커의 골격만(실연동·발송 없음, entitlement OFF).
읽기: 001(messages·message_templates·hometax_*), 004(lead_intake_events), infra/README §5(pg-boss), 벤더-계약-가이드.
구현: worker/ 에 pg-boss 잡 스캐폴드 + 어댑터 인터페이스(알림톡 send()·홈택스 fetch()·리드 웹훅 handler()) **스텁**(실호출 미구현, TODO). 외부 SDK는 worker/adapters/에만. env 없으면 no-op.
의존: 없음(완전 독립).
수용: 워커 부팅·잡 등록 스캐폴드 green, 스텁 어댑터 인터페이스 확정(트랙들이 나중에 채움). 실발송 0.
금지: 실 벤더 호출·키 하드코딩·제품 화면. 스키마 수정.
```

---

## ★ 전 트랙 공통 추가 요구 (belie 2026-07-21): 반응형(모바일) 필수
- 모든 화면 **모바일 우선 반응형**. 브레이크포인트 최소 3단(모바일<640·태블릿<1024·데스크톱). 
- **B1(T03)**: 앱 셸 사이드바는 모바일에서 **햄버거→드로어(오프캔버스)**로 접힘, 상단바 유지, 하단 탭바(선택). 이게 셸 계약이므로 다른 트랙이 이를 전제.
- **보드/테이블(T02·T05)**: 모바일에서 가로스크롤 또는 카드형 폴백. 칸반은 한 컬럼씩 스와이프.
- **대시(T04)**: 카드 1열 스택. **정산/KPI(T09·T07)**: 표는 모바일서 요약카드.
- 터치 타깃 ≥44px, 딜 상세·설정은 모바일서 풀스크린 시트. 수용기준에 "375px 폭에서 깨짐 없음" 추가.

## 기획2 요청 (스키마/토큰 — 병렬)
1. **002 seed 보강**: status 타입 컬럼(상담상황16·업종8~10·진행기관·진행상품60여 등)의 **라벨+hex+is_done+index**를 board_columns.options_jsonb로. → B3(status UI)·B4가 소비.
2. **G8 자동화 프리셋 seed**: 신규→컨텍→업무 "상태→그룹 이동" 기본 규칙을 board_automation_rules에. → B4 소비.
3. **자동화 19개 전수표** 추출(트리거 라벨→대상 그룹) → docs/design 실측문서 §3. → B4가 어떤 규칙 seed할지 근거.
4. **PLAN-v0.2 동기화**: D15·O18·G1~G8 반영, 테이블수 35로 갱신.
5. **타입 생성**: `supabase gen types typescript`를 레포에 커밋(app이 공유) — 트랙들이 실DB 타입 사용.
6. **design-tokens.md SSOT**가 brand v1.0 팩(moawork-color-tokens.css)을 정본으로 가리키게 갱신.
