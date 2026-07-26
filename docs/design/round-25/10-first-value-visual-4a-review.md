# First Value Onboarding 4안 독립 시각 검수

> WORK-ID: `FIRST-VALUE-VISUAL-4A-REVIEW-01`  
> 독립 reviewer: T10  
> 상태: **PASS — EXACT HTML + HIGH-RISK BROWSER SAMPLE**  
> 제품 구현·merge: **HOLD — 사용자 실화면 선택 필요**  
> 금지 준수: HTML 수정 0 / 제품 코드 0 / DB 0 / Git 0 / deploy 0

## 1. 고정 후보

| 항목 | 독립 read-back |
|---|---|
| 파일 | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_First_Value_Onboarding_4Concepts_v0.1.html` |
| URL | `http://127.0.0.1:4318/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html` |
| bytes | 64,570 |
| lines | 710 |
| SHA-256 | `6FAD81807BE9F97931C09B0E453F3735EB1C88979995E1549182FD24D7617D60` |
| 문서 언어 | `lang="ko"` |
| 외부 script | 0 |
| form submit | 0 |
| secret assignment | 0 |

MWC가 지정한 후보 bytes와 독립 read-back이 정확히 일치한다. 이 판정은 다른 HTML bytes로 승계되지 않는다.

## 2. 판정 요약

| 검수 축 | 판정 | 핵심 근거 |
|---|---|---|
| 4안 실질 차이 | **PASS** | A 카드 자유순서, B 3단계 체크포인트, C 오늘 홈 비선형 재개, D 미리보기·작업 로그 |
| 승인 기본값 | **PASS** | 혼자 시작, 사원 기본·팀장 선택, 고객+업무 함께, 예시 전용, 오늘 홈 재개 |
| persona 분기 | **PASS** | invited lead/employee에서 owner flow·owner tools visible 0 |
| 한글·UX writing | **PASS** | 예외 영문 UI는 MoaWork와 A/B/C/D 식별자뿐 |
| MoaWork 브랜드 | **PASS** | canonical blue/teal/violet/coral과 light/dark foreground/surface 사용 |
| responsive·touch | **PASS** | 1280·390·320 overflow 0, 일반 control 최소 44px, radio label 44px |
| 접근성 | **PASS** | native controls, label 26, unlabeled control 0, status/live 4, focus-visible 3px |
| reduced-motion | **PASS** | actual media match, scroll auto, transition `0.00001s` |
| 보안·진실성 | **PASS** | Platform/위험 admin·실제 PII·secret·실제 저장/전송 0 |
| console | **PASS** | warn/error 0 |

**Overall: PASS**

## 3. 4안 구조·상호작용 차이

### A — 한 장 빠른 시작

- 한 화면에 회사·초대·첫 고객/업무 카드가 모두 보인다.
- 카드별 자유순서와 카드 안 부분복구를 사용한다.
- 실제 표본: `지금은 혼자 시작할게요` 선택 뒤 live status가 “초대는 오늘 홈에서 다시 찾을 수 있어요”로 갱신됐다.

### B — 하나씩 묻는 3단계

- 한 번에 한 질문만 보이는 회사→팀→첫 고객 선형 흐름이다.
- 이전·다음과 체크포인트 복구를 사용한다.
- 실제 표본: `회사 만들고 다음으로` 뒤 1단계 hidden, 2단계 visible, live status “2단계에서 이어가요.” 확인.

### C — 오늘 홈부터

- 회사 1면 뒤 실제 오늘 홈 형태의 체크리스트로 이동한다.
- 초대와 고객/업무를 원하는 순서로 재개하는 비선형 흐름이다.
- 실제 표본: `회사 만들고 시작하기` 뒤 create hidden, home visible, “선택 항목은 원하는 순서로 이어 해요.” 확인.

### D — 완성 모습을 보며 설정

- 왼쪽 설정과 오른쪽 결과 미리보기를 동시에 제공한다.
- 적용 전 review와 작업 로그 단위 복구를 사용한다.
- 실제 표본: `변경 내용 확인하기` 뒤 edit hidden, review visible, “아직 적용되지 않았어요.” 확인.

색상만 바꾼 변형이 아니다. 네 안은 화면 구조, 진행 모델, 복구 단위, 결과를 이해시키는 시각 은유가 각각 다르다.

## 4. 승인 기본값 검수

| 계약 | HTML·브라우저 근거 | 판정 |
|---|---|---|
| 혼자 시작 기본 | 공통 원칙과 B/D radio의 `solo` checked | PASS |
| 팀 초대 선택 | A/C 선택 카드, B/D team 선택, skip·재개 문구 | PASS |
| 초대 역할 사원 기본 | A/B/C role select 첫 option `사원`, 다음 option `팀장` | PASS |
| 첫 고객+첫 업무 함께 | 네 안 모두 두 항목을 한 action·결과·오류 단위로 표현 | PASS |
| 예시는 UI 전용 | 상단 고정 안내, D preview badge, 각 live/status에서 미저장 명시 | PASS |
| 건너뛰고 오늘 홈 재개 | A/B skip, C home checklist, 공통 원칙에 명시 | PASS |

## 5. persona·owner 보호

### 대표

- 회사와 보호된 대표 준비, 선택적 팀 초대, 고객+업무 함께 생성 흐름을 볼 수 있다.
- 네 안 핵심 action 표본이 각각 실제 상태 전이를 만들었다.

### 초대받은 팀장

- visible owner flow: 0/4.
- visible owner tools: 0/4.
- visible invitee flow: 4/4.
- 회사·역할·팀·첫 배정 업무와 `내 오늘 홈 보기`만 노출된다.
- “회사 생성·대표 변경·고급 권한 화면은 이 경로에 나오지 않아요.”가 명시된다.

### 초대받은 사원

- visible owner flow: 0/4.
- visible invitee flow: 4/4.
- 4/4 모두 사원 역할 문구를 표시한다.
- owner 회사 생성 문구·보호된 대표 action 노출: 0.

## 6. responsive·touch 실제 수치

| viewport | document scrollWidth / clientWidth | concept width | 결과 |
|---|---:|---:|---|
| 1280×900 | 1265 / 1265 | 각 601.5px | overflow 0 |
| 390×844 | 375 / 375 | 각 359px | overflow 0 |
| 320×720 | 305 / 305 | 단일열 | overflow 0 |

- 390·320의 일반 button/input/select 최소 높이: 44px.
- native radio 자체는 13px이나 클릭 가능한 `.choice-row label`은 44px이다.
- 390 다크 화면에서 header, 비교 control, persona control이 한 열로 자연스럽게 줄바꿈된다.
- 1280에서는 A/B와 C/D가 2×2 비교 구조로 보인다.

## 7. light/dark·브랜드

- Light 실제 body: 밝은 paper와 foreground 조합.
- Dark 실제 body: `rgb(12, 13, 16)` / `rgb(247, 248, 250)`.
- theme button의 `aria-pressed`, accessible label, icon이 theme과 함께 갱신된다.
- canonical accents:
  - Work Blue `#3478F6` / dark `#6EA0FF`
  - Flow Teal `#18A999` / dark `#47CFBC`
  - Moa Violet `#6B5CFF` / dark `#8A7CFF`
  - People Coral `#F26B5E` / dark `#FF8A80`
- concept 차이는 팔레트가 아니라 레이아웃·진행·복구 모델로 만든다.

중립 paper/muted/line 토큰은 canonical accent를 대체하지 않고 light/dark surface 계층을 구성한다.

## 8. 접근성·키보드

- native `button`, `input`, `select`, `radio` 사용.
- `label` 26개, unlabeled input/select 0.
- concept별 `role="status" aria-live="polite"` 4개.
- loading 때 `aria-busy`, view/persona/theme에 `aria-pressed` 사용.
- skip link와 main comparison anchor가 존재한다.
- keyboard focus 표본에서 theme toggle이 실제 active element가 되고 3px focus outline이 표시됐다.
- native button semantics와 visible focus가 유지된다.

## 9. reduced-motion·console

CDP media emulation으로 `prefers-reduced-motion: reduce` actual을 검사했다.

| 항목 | 실제 값 |
|---|---|
| media match | `true` |
| html scroll behavior | `auto` |
| body transition | `0.00001s` |
| button transition | `0.00001s` |
| concept transition | `0.00001s` |
| console warn/error | 0 |

## 10. 문구·보안·진실성

- 전체 해요체이며 행동 결과가 button에 드러난다.
- 오류는 실패 단위, 보존된 상태, 다음 action을 함께 설명한다.
- 실제 고객·회원 정보, 데이터베이스 저장, 초대 전송, 권한 변경이 없음을 반복해서 알린다.
- Platform 1~4급, support mode, 위험 admin action, owner 변경 UI가 기본 persona에 없다.
- 실제 PII·secret assignment·외부 script·submit form은 0건이다.
- 화면 성공 상태는 `예시`, `시뮬레이션`, `저장되지 않음` 문구로 실제 성공과 구분된다.

## 11. Blindspot pass

### 전체→부분→전체

- 전체: 작은 조직이 대표 혼자 바로 시작하고 첫 고객·업무의 가치를 빨리 경험해야 한다.
- 부분: 초대 기본값, role, atomic customer/work, invited persona, recovery, responsive, accessibility를 각각 확인했다.
- 다시 전체: 네 안 모두 같은 안전 계약을 지키면서도 선택할 이유가 다르다. 내부 Platform 복잡성을 고객 첫 화면에 노출하지 않는다.

### 확정·미결정

- 확정: 공통 시작 원칙, owner/invited 분기, UI-only 예시, 오늘 홈 재개.
- 미결정: A/B/C/D 중 사용자가 선택할 최종 방향.

### 지금/실험/백로그/기각

- 지금: 네 안 실화면 비교와 사용자 선택.
- 실험: 가장 이해가 빠른 흐름, 중단 후 복귀 선호, 모바일 선호.
- 백로그: 선택안의 제품 route·DB/RPC 연결과 실제 recovery.
- 기각: invited user의 회사 생성, 가짜 저장 성공, 고객/업무 부분 성공, Platform 고급 권한 기본 노출.

## 12. 최종 verdict와 다음 gate

**PASS — exact HTML `6FAD8180...D60`**

필수 수정사항: 없음.

다음 gate:

1. 사용자가 실제 로컬 화면에서 A/B/C/D 중 방향을 선택한다.
2. 선택 전 제품 코드 구현·merge는 HOLD다.
3. 선택 뒤에도 이 HTML의 성공 상태를 실제 DB/RPC 성공 증거로 재사용하지 않는다.
4. 제품 구현 후보는 별도 code/test/browser/security gate를 통과해야 한다.

T10은 HTML, 제품 코드, DB, Git, 배포를 수정하지 않았다.
