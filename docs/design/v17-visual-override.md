# v17 vivid 시각 override (운영 적용 기록)

- 승인: v17 vivid 목업 사용자 승인 + 시각 override issue #761 (2026-09-25).
- 범위: 시각 배선만. 인증·RLS·API·데이터·모델·워크플로·마이그레이션 없음.
- 정본 우선순위(CLAUDE.md): 최신 명시 지시 → issue/date/rationale 있는 시각 override(본 문서) → 목업 v6 → 일반 규칙.

## 출처·복사/각색 (확인일 2026-09-25)

| 원천 | 가져온 것 | 구분 |
| --- | --- | --- |
| Soft UI Dashboard (Creative Tim, MIT, `app/src/styles/moawork-vivid-v17.LICENSE.txt`), https://github.com/creativetimofficial/soft-ui-dashboard | 310deg 쌍 5종: `#ea580c→#facc15`, `#0ea5e9→#06b6d4`, `#22c55e→#98ec2d`, `#eab308→#f97316`, `#ef4444→#ec4899` | copied (각도·스톱·순서 동일) |
| Mobbin Canva 팔레트 https://mobbin.com/colors/brand/canva | 스톱 `#07B9CE` `#3969E7` `#7D2AE7` | 스톱 copied, 다스톱 배치·비율은 모아워크 각색(공식 Canva 그라디언트 아님) |
| Figma Purity UI Dashboard (Simmmple/Creative Tim, CC BY 4.0) | 흰 카드·절제된 간격·유색 아이콘 타일 방향 | 레이아웃 참조만, 색 토큰·자산 복사 없음 |
| Pinterest colorful-dashboard (16핀 열람) | 중립 캔버스 위 vivid 블록 방향 | 영감만, 다운로드 없음 |

CTA 실제 채움은 목업 `vivid-v17.css` 최종 절이 정본: 파랑/보라(`contact`·`dash`)는
`#3969e7→#7d2ae7` + 흰 글자, 그 외 밝은 CTA는 원천 Soft UI 쌍 + `#111827` 글자.

## 실제 라우트 배선 (발명 없음)

| 강조 | 운영 라우트 | CTA |
| --- | --- | --- |
| new | `/newcust` (→ `/boards/<id>`) | 오렌지 `#ea580c→#facc15`, 글자 `#111827` |
| contact | `/contract` (→ `/boards/<id>`) | 블루→바이올렛 `#3969e7→#7d2ae7`, 흰 글자 |
| work | `/work` (→ `/boards/<id>`) | 그린 `#22c55e→#98ec2d`, 글자 `#111827` |
| company | `/companies` | 시안 `#0ea5e9→#06b6d4`, 글자 `#111827` |
| dash | 루트(대시보드) + 폴백 | 블루→바이올렛, 흰 글자 |

보드 주소는 `resolveActiveNavKey(pathname, boardNavKeys)` 로 탭을 되찾고,
모르는 보드는 대시보드 강조로 폴백한다(잔상 금지).
이번 시각 이식 PR은 `s2`/`s3` 독립 라우트·대면 신설을 포함하지 않는다. 상담 흐름 등 승인 목업의 기능 요구사항은 별도 구현 대상이며, 협력업체 기능만 사용자 지시로 보류한다.
미소비 토큰(`s3rose`·`honey`·`partners`·`news`)은 정의만 두고 어떤 선택자도 참조하지 않는다.

## 건드린 자리

- `app/src/styles/moawork-vivid-v17.css` (신규): `html[data-mw-accent]` 아래만 동작.
  표 셀·행·sticky·단일 스크롤·파괴적/비활성 버튼은 선택자에서 제외.
- `app/src/lib/appearance/vivid.ts` (신규): 매핑·검증 순수 모듈.
- `app/src/components/appearance/RouteAppearance.tsx` (신규): 라우트 강조+외관 적용 전담, DOM 미렌더.
- `app/src/components/appearance/AppearanceControl.tsx` (신규): ThemeToggle 옆 작은 팝오버.
  회사 강조 프리셋 10종(id 호환)·효과 on/off, `mw-appearance-v1` 개인 저장. 업무 데이터 무관.
- 명시 속성: `SidebarNav` 활성(`mw-nav-active`, 파랑 폴백 유지),
  `BoardHeader`·`NewLeadIntakeForm`·`WorkflowProgressCell`·`CompanyCsvImport` 주요 CTA
  (`data-mw-cta="primary"`), `WorkspaceMark`(`data-workspace-mark`).
- 라이트/다크·강제색상·모션감소·인쇄 분기 포함. 표 밀도·R3/R7/R11 기존 값 유지.

## 부모 확인용

- `node docs/design/qa-app.mjs`, 관련 vitest, typecheck, lint 결과는 작업 보고 참조.
- 화면 실측(1440×900·375×812, 다크·강제색상 실기기)은 Windows 부모 담당 — 본 작업에서 미실시.

## 부모 시각 통합
GroupBlock은 그룹색의 굵은 세로선과 넓은 틴트를 제거하고 8px 점으로 그룹색을 보존한다. 밝은 배경 위 제목은 본문색으로 읽는다. R3/R7/R11 토큰과 보드 제목 아이콘 타일을 승인 v17에 맞췄다. 드래그·접기·정렬·저장 로직은 유지한다.
## v17 후속 기능과 아이콘 적용 — Issue #797 · 2026-09-25

사용자 승인: v17 목업의 비비드 테마 및 비협력업체 기능을 운영까지 적용. 협력업체 기능만 이번 범위에서 제외한다.

- 정책자금뉴스는 업무도구 아래에서 최신호를 모아워크 셸 내부 iframe으로 표시한다. 읽는 도중 자동 새로고침하지 않으며, 수동 새로고침 또는 5분 이상 지난 화면 복귀 때 갱신한다.
- 승인된 자체 SVG 120개는 `/moa-icons/manifest.json`과 개별 SVG로 제공한다. 20px 원본 좌표계를 보존하고, 신규리드/업체관리/헤드셋 상담/실무/미팅/뉴스를 실제 셸에 적용한다. 임의 스크립트·외부 참조 없는 경로만 포함한다.
- 기본 보드 아이콘은 같은 SVG로 표시하고 사용자 지정 아이콘 값은 보존한다. 저장된 업체·업무 데이터 변경 없이 렌더링만 교체한다.
- 뉴스 팔레트는 승인 목업의 시안 `#07b9ce → #06b6d4`를 사용한다. 파트너 강조와 메뉴는 연결하지 않는다.

상담/계약, 등록/상세/파일/OCR 후속 통합은 #797에서 별도 추적한다. 이 변경만으로 전체 기능 완료를 뜻하지 않는다.

## 보드 위계·그룹 색 띠 복원 — Issue #839 · 2026-10-06

근거: 대표 지시(2026-10-06, 계약업체 실무 화면 정리 요청)와 #839. 위 «부모 시각 통합» 의 «GroupBlock 그룹색은 8px 점» 결정(#761)을 이 절이 대체한다. 승인 방향 목업은 Asana형 정돈 보드(Main.dc)이며 색·간격은 기존 --mw-*/--sp-*/--fs-* 토큰 안에서만 옮겼다.

- 그룹 머리말: 그룹색 14% 틴트 + 3px 레일 + 그룹색 40%를 글자색에 섞은 제목(밝은 노랑·연두에서도 AA). 저장색이 없으면 그룹 id로 고정된 자동색(이름·순서가 바뀌어도 같은 색), hex가 아닌 저장값은 버린다. html 단계 변수(--mw-group-header-bg 등)는 그룹별 색을 참조할 수 없어 걷어 내고 GroupBlock 인라인으로 그린다. 섹션의 --mw-group-accent 로 행 첫 칸에 3px 그룹색 줄을 단다. 사용자 색 선택 UI는 #839 후속이다.
- 진행현황: «단계 검색 + native select» 두 겹 대신 한 줄 색 칩(StagePicker). 검색은 body 포털 팝오버 안, 이동 규칙이 있는 단계는 «보드 이동», 없는 단계는 «상태만 바꾸기 (보드 그대로)». 만들기 경로 없음. 본문 틴트는 6%(머리글 14% 유지), 행 구분선·왼쪽 2px 강조선·떠 있는 그림자는 sticky 칸과 함께 움직이는 안쪽 그림자다(collapse 테두리는 sticky 칸을 따라가지 않는다).
- 위계: 보드 뷰포트에만 --mw-board-canvas(라이트 글자색 3%, 다크는 --mw-bg), 그룹 카드 간격 --sp-4·옅은 그림자, 머리글 줄 --mw-board-head(4%), 칸 구분선 --mw-grid-line(10%), 행 호버 --mw-row-hover(무계층 선택자 — 기존 카드색 규칙을 이긴다), 행 제목 13px/600(500 금지), 상태 칩 600.
- 표시 전용 이모지 정리(presentLabel): 진행현황 칩·선택지·그룹 띠 제목만. 선택지 id·저장값·이동 규칙·board_groups.name·먼데이 매핑 사전은 원문 그대로이고, 그룹 이름 편집칸은 원문으로 시작한다. 이모지만 다른 이름끼리는 원문을 보여 구별한다.
- 표시 훅: 접수 흐름이 단 tr[data-just-added="true"]는 강조색이 서서히 빠진다. 계약업체 실무에서만 보이는 행 중 같은 제목(회사명)이 2건 이상이면 «같은 회사 N건» 칩을 단다(데이터·제목 불변).
- 화면 계약: docs/design/visual-block-contract.json 의 workflow-gate-pinned override(#563 supersedes 보존)와 group-table-assembly override, qa-visual-blocks.mjs 의 진행현황 선택자(칩 열기 → 전이 선택지)를 같은 변경에서 갱신했다. (두 override 의 issue 는 아래 #845 절에서 845 로 옮겼다 — 비표준 키였던 boardHierarchyOverride 는 #845 override 에 합쳤다.)

## 탭 2색 × 깊이 그룹 톤 · 빈 보드 접기 — Issue #845 · 2026-10-06

근거: 대표 지시(2026-10-06, 계약업체 실무 화면 피드백)와 #845. 승인 방향 목업은 `Main.dc`(보드)·`Palette.dc`(탭별 색 깊이)다. 위 #839 절의 «저장색이 없으면 그룹 id로 고정된 자동색» 결정을 이 절이 대체한다.

- **그룹 톤(대표 지시 원문 요지):** 탭마다 메인 2색(그 탭 강조 그라디언트의 두 스톱)이 있고 그룹은 «깊이» 로 구별한다. 색 1 = 본 진행(단계가 나아갈수록 진하게), 색 2 = 곁가지, 회색 = 멈춤(불가·거절·취소). 같은 단계에 나란한 그룹(예: 소진공 접수예정 넷)은 같은 깊이, 색마다 최대 5단계, 제목은 언제나 진한 잉크(AA).
- **토큰:** `--mw-tab-a-1..5`, `--mw-tab-b-1..5`, `--mw-tab-stop`. 기본값(강조 라우트 없음 = 대시보드 폴백과 같은 파랑·보라)은 `globals.css`, 탭별 값은 `moawork-vivid-v17.css` 의 `html[data-mw-accent="new|contact|inperson|work|company|news|dash"]`. 라이트는 Palette.dc 의 사다리(Tailwind CSS 기본 팔레트 300→700, MIT) 그대로, 다크는 600→200(어두운 바탕에서는 깊을수록 또렷하게 — 같은 위계). news 는 두 스톱이 모두 시안이라 색 2를 청록(teal)으로, dash 는 contact 와 같은 파랑·보라로 각색했다.
- **어느 그룹이 몇 단계인가:** `app/src/lib/boards/group-tone.ts`. 기본 탭은 표(화면 이름 기준 — 앞머리 이모지·공백·«(N)» 무시)로 정한다. 계약업체 실무: 준비단계 A1 · 진행중 A2 · 소진공 … 접수예정 넷 A3 · 심사 중 A4 · 승인 A5 · 기업인증 진행 B1 · 소공인(상생) B2 · 관리중 B3 · 해당연도 매출 B4 · 업체관리 B5 · 대출불가 멈춤. 신규리드·상담 관리(단계 보기의 가상 묶음 포함)도 표가 있다. 그 밖의 보드와 표에 없는 그룹은 멈춤 낱말(불가·거절·취소·중단·해당 안) → 회색, 곁가지 낱말(보류·부재·대기·고민) → 색 2, 나머지 → 색 1 을 순서대로 깊게, 앞 낱말이 같은 그룹들은 같은 깊이다.
- **저장된 이관 색(`board_groups.color`)은 지금 쓰지 않는다.** 그룹마다 제각각인 먼데이 색이 «어디가 본 진행인가» 를 가렸다. 사용자가 그룹 색을 직접 고르는 기능(#839)이 들어오면 그 명시 선택이 이 자동 톤을 덮는 override 가 된다(GroupBlock 의 `color` prop 자리).
- **같은 색이 세 곳에:** 그룹 띠(톤 16% 틴트 · 3px 레일 · 톤 40%를 글자색에 섞은 제목 · 10px 둥근 네모 견본), 행 첫 칸 3px 줄(`--mw-group-accent`), 진행현황 칩·선택지 점(옮겨 갈 그룹의 톤 — 단계 = 그룹이 눈에 보인다). 옮겨 갈 그룹이 없는 단계만 상태 팔레트 색이다.
- **빈 보드 접기(Main.dc):** 보이는 행이 0건인 그룹은 표 끝의 «빈 보드 N개 보기» / «빈 보드 접기» 컨트롤 하나로 접는다. 펼치면 제자리 순서로 나오고, 행을 끄는 동안에는 놓을 자리로 모두 나온다. 접지 않는 것: 첫 그룹(새 행이 들어오는 자리), 이 세션에 새로 만든 그룹(만들자마자 사라지지 않게 — 이름 바꾸기·행 추가가 바로 된다), 상담·신규리드 단계 보기의 가상 묶음(고정 단계표라 «(0)» 도 정보다). 화면 배치만 바꾸며 그룹·행·순서·합계는 그대로다.
- **#845 검토 후속(같은 변경):** 진행현황 낙관값은 오류 문자열이 아니라 폼 액션 수명(useOptimistic)에 묶는다 — 같은 문구로 두 번 연속 거절돼도 저장값으로 돌아간다. 보드에 없는 그룹을 가리키는 이동 규칙은 «보드 이동» 에서 뺀다(서버도 값만 저장한다). 행을 옮길 권한이 없으면 다른 그룹으로 옮기는 선택지는 «권한 없음» 비활성. StagePicker 검색칸 role=combobox·aria-expanded·aria-autocomplete, 결과 없음 안내는 listbox 밖 status, 활성 행이 없으면 Enter 무시, Home/End. 시도·시군구 칸은 «✓ 자동 저장됨» 줄을 쌓지 않는다(고칠 것이 있을 때만 보이고 나머지는 낭독 전용) — 계약업체 실무 행이 한 줄로 남는다.
- **화면 계약:** `visual-block-contract.json` 의 group-table-assembly override 를 issue 845 로(#797 은 supersedes 로 보존), workflow-gate-pinned override 를 845 로(#563 supersedes 보존), detailPanelOverride issue 를 845 로 바꿨다. `qa-visual-blocks.mjs` 는 이제 모든 override(블록·supersedes·상세 패널/증빙)에 정수 issue·날짜·근거를 요구하고 비표준 `*Override` 키를 거절한다(`--contract-only` 로 브라우저 없이 RED 4 → GREEN 확인).
