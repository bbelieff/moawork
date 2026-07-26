# C안 제품 구현 계약 — 내 계정과 팀

- WORK-ID: `ACCOUNT-C-PRODUCT-CONTRACT-01`
- 작성 트랙: Alt Dev‑T04
- 사용자 결정: ROUND‑18 비교안 중 C `내 계정과 팀` 확정, 추가 디자인 탐색 종료
- 상태: DEV‑1 구현 입력용 제품 계약
- 정본 시각 입력: `brand/MoaWork_Admin_Account_Design_4Concepts_v0.1.html`의 C안
- 보안·성장 정본: `docs/design/round-21/03-p0-authz-contract.md`, `06-small-team-growth.md`, `08-test-matrix.md`
- 금지: 이 문서는 UI만으로 권한·세션 폐기·탈퇴 성공을 증명하지 않는다. 서버·DB·RLS·감사 증거 없는 성공 표시는 출시 불가다.

## 1. 결정 요약

C안의 **개인 계정 탭 + 벤토형 요약**을 실제 제품 구조로 채택한다. 첫 화면은 현재 회사, 내 역할, 내 팀, 내 정보, 로그인 기기, 로그아웃을 10초 안에 찾게 한다. 대표에게만 회사 관리 진입점을 더하고, 팀장·사원에게 Platform 등급·지원 단계·권한 계산식은 렌더하지 않는다.

탭은 한 페이지 안의 숨은 `div`가 아니라 주소·뒤로가기·새로고침이 보존되는 실제 route로 만든다. Global Account와 Workspace Profile은 데이터와 URL을 분리한다.

```text
앱 상단 프로필 메뉴
  ├─ 내 계정                 /account
  ├─ 회사와 팀               /w/{workspaceSlug}/profile
  ├─ 로그인 기기             /account/sessions
  ├─ 개인정보와 데이터       /account/privacy
  ├─ 회사 관리 (대표만)      /w/{workspaceSlug}/settings/members
  └─ 이 기기에서 로그아웃    POST /auth/signout
```

Platform 운영 화면은 이 정보 구조의 자식이 아니다. 별도 principal·별도 진입점·별도 권한 계약으로 유지하며 이번 DEV‑1 범위에서 만들지 않는다.

## 2. 현재 제품 코드 대조

| 현재 파일/route | 실측 상태 | C안 적용 계약 |
|---|---|---|
| `app/src/app/(app)/layout.tsx` | 232px 사이드바 하단에 이름·raw 역할/범위와 아이콘형 로그아웃이 있다. 상단에는 검색·알림·테마 토글만 있다. | 상단 우측에 이름이 있는 `AccountMenu`를 추가한다. 로그아웃은 아이콘 단독 행동이 아니라 메뉴의 문장형 항목으로도 제공한다. |
| `app/src/components/shell/SidebarNav.tsx`, `nav-items.ts` | `/account` 진입점이 없다. | 계정은 업무 주 navigation에 섞지 않고 상단 프로필 메뉴로 진입한다. 모바일에서는 같은 메뉴가 첫 화면 상단에 남는다. |
| `/settings/members` | `멤버·권한` 서버 화면 하나뿐이다. 이메일 원문, `owner/admin/member`, `all/assigned` select를 직접 보여준다. 보호 Owner·직책·팀 분리가 없다. | `/w/[workspaceSlug]/settings/members`로 tenant 문맥을 명시하고 기존 URL은 검증된 현재 Workspace로 redirect한다. 일반 role select로 Owner를 변경하지 않는다. 이메일은 기본 마스킹한다. |
| `POST /auth/signout` | 현재 인증 sign-out 후 `/login`으로 이동한다. dev cookie도 지운다. | **현재 기기 로그아웃** 경로로 유지하되 서버의 `revoke_current_session`과 의미를 일치시킨다. 다른 기기까지 로그아웃됐다고 말하지 않는다. |
| 계정·기기·개인정보 route | 존재하지 않는다. | 아래 route/file 계약으로 신설한다. |
| `app/src/lib/auth/session.ts` | Workspace membership보다 Platform role을 우선 합성하는 경로가 있다. | P0 출시 전 `platformRole ?? membership.role` 합성을 제거한다. Platform principal은 Workspace role/scope를 덮어쓰지 않는다. |
| `app/src/lib/auth/roles.ts` | 고객 문구가 `소유자/관리자/멤버`, `전체 보기/내 담당만`이다. | 계정 첫 화면은 `대표/팀장/사원`을 사용한다. 내부 enum과 scope는 보안 상세·로그에만 두고 사용자에게 raw 값으로 노출하지 않는다. |
| `app/src/app/globals.css` | MoaWork light/dark token과 OS 테마 fallback이 있다. `--mw-radius: 14px`; reduced-motion 전역 override는 없다. | 기존 token을 그대로 소비한다. 계정 화면 전용 임의 hex·임의 palette를 만들지 않는다. reduced-motion 규칙을 추가한다. |
| `app/src/app/layout.tsx` | `lang="ko"`, Geist/Geist Mono, 첫 페인트 전 theme 초기화가 있다. | 기존 font stack과 theme 초기화를 유지한다. 계정 화면만 다른 font를 내려받지 않는다. |

현재 코드가 보여주는 화면과 목표 화면 사이에는 DB 계약 선행이 필요한 항목이 있다. `account_sessions`, 계정/Workspace cutoff, Workspace Profile의 직책·팀, 개인정보 export·탈퇴 상태가 없으면 fixture로 성공을 흉내 내지 않는다.

## 3. 실제 route·파일·컴포넌트 계약

### 3.1 사용자에게 보이는 route

| URL | 제목 | 소유 데이터 | 접근 |
|---|---|---|---|
| `/account` | 내 계정과 팀 | Global Profile 요약 + 현재 membership 요약 | 로그인 사용자 |
| `/account/sessions` | 로그인 기기 | Global Account session registry | 본인만 |
| `/account/privacy` | 개인정보와 데이터 | Global Profile·개인 export·탈퇴 상태 | 본인만, 민감 값 reveal은 재인증 |
| `/w/[workspaceSlug]/profile` | 회사와 팀 | Workspace Profile·membership·team 표시 | 해당 Workspace active membership |
| `/w/[workspaceSlug]/settings/members` | 회사 관리 | 멤버·초대·팀 관리 | 보호 Owner, 위임된 기능은 별도 capability 검사 |

`workspaceSlug`는 표시·route key이지 권한 근거가 아니다. 모든 loader/action은 서버에서 slug→org를 확인하고 active membership과 session cutoff를 다시 검사한다. 권한이 없을 때 Workspace 이름·멤버 수·존재 여부를 응답에 싣지 않는다.

### 3.2 목표 파일 경계

```text
app/src/app/(app)/account/
  layout.tsx                 # route형 계정 navigation
  page.tsx                   # C 벤토 요약
  loading.tsx                # 계정 공통 skeleton
  error.tsx                  # 재시도 가능한 route error
  sessions/page.tsx          # 현재/다른 기기, 세션 폐기
  privacy/page.tsx           # 개인정보, export, 탈퇴 영향

app/src/app/(app)/w/[workspaceSlug]/
  profile/page.tsx           # Workspace Profile과 내 팀
  settings/members/page.tsx  # 대표용 회사 관리

app/src/components/account/
  AccountMenu.tsx            # 상단 진입점, focus 관리
  AccountNav.tsx             # Link + aria-current
  AccountOverview.tsx        # C 벤토
  WorkspaceProfileCard.tsx   # 직책/팀/역할 분리
  SessionList.tsx            # 현재/다른 기기 구분
  DangerActionDialog.tsx     # 영향→가역성→확인→결과
  AccountState.tsx           # empty/loading/error/denied 공통 문법
```

컴포넌트명은 구현 폴더 규칙에 맞춰 조정할 수 있지만 URL, 데이터 경계, server authorization, 문구와 상태 계약은 바꾸지 않는다. 서버 컴포넌트가 조회·권한을 결정하고, client component는 메뉴·dialog·optimistic하지 않은 form 상태에만 쓴다.

## 4. 화면 구조와 역할별 차이

### 4.1 `/account` 기본 구조

1. 페이지 제목 `내 계정과 팀`
2. 한 줄 설명 `내 정보와 지금 함께 일하는 회사를 확인해요.`
3. 계정 route navigation: `내 정보` · `회사와 팀` · `로그인 기기` · `개인정보`
4. C 벤토 순서:
   - `내 정보`: 표시 이름, 마스킹 이메일, 역할
   - `로그인 기기`: 현재 기기 포함 개수와 안전 상태
   - `내 회사와 팀`: 현재 회사, 팀, 바로가기
   - `로그아웃`: 현재 기기 주 행동, 모든 기기는 위험 행동

모바일에서는 1열 `내 정보 → 회사와 팀 → 로그인 기기 → 로그아웃` 순서다. CSS order로 화면과 DOM 순서를 다르게 만들지 않는다.

### 4.2 역할별 노출

| 상태 | 첫 화면에 보이는 것 | 추가 행동 | 절대 보이지 않는 것 |
|---|---|---|---|
| 일반 구성원(`member`) | 현재 회사, `사원`, 내 팀, 내 정보, 로그인 기기, 로그아웃 | 내 Workspace 표시 이름 수정, 내 개인정보·기기 관리 | 회사 관리, Owner 이전, 타 팀 멤버 상세, Platform 등급 |
| 팀장 표시(`admin`) | 현재 회사, `팀장`, 자기 팀, 내 정보, 로그인 기기, 로그아웃 | **명시적으로 위임된 경우만** 자기 팀 관리 | Owner 관리, tenant 전체 권한, 위임되지 않은 초대·역할 변경 |
| 대표(`owner`) | 현재 회사, `대표`, 회사 전체 요약, 내 정보, 로그인 기기, 로그아웃 | `회사 관리`, 첫 직원 초대, 별도 Owner 이전 흐름 | 일반 dropdown의 자기 강등·삭제, Platform 권한 합성 |

`대표/팀장/사원`은 Workspace membership의 고객용 표시다. Workspace Profile의 `직책`은 소개 정보이고 권한을 바꾸지 않는다.

| 사용자 문구 | 데이터 출처 | 예 | 권한 영향 |
|---|---|---|---|
| 역할 | membership role | 대표·팀장·사원 | 있음; 서버 판정 |
| 직책 | Workspace Profile | 운영 매니저 | 없음 |
| 팀 | Workspace Profile/team relation | 운영팀 | 관계 표시; 접근권한은 별도 capability/RLS |
| 볼 수 있는 범위 | membership/capability를 번역 | 내게 배정된 업무 | 있음; raw `scope`를 그대로 보이지 않음 |

직책·팀 데이터가 아직 없을 때 role로 값을 만들어 저장하지 않는다. 화면에는 `아직 등록된 직책이 없어요`, `아직 소속 팀이 없어요`라고 표시한다.

## 5. 상태별 화면 계약

모든 상태 문구는 **상황 → 현재 상태 → 다음 행동** 순서로 쓴다. 오류를 빈 상태로 바꾸거나 권한 거부에서 존재 metadata를 노출하지 않는다.

| 상태 | 화면 구조 | 정확한 문구/행동 |
|---|---|---|
| Loading | 제목·탭은 유지하고 카드 skeleton, submit 중 중복 클릭 차단 | `계정 정보를 불러오고 있어요.` (`role=status`) |
| 데이터 없음 — 팀 | 빈 카드 + 대표/일반 구성원에 맞는 다음 행동 | 일반: `아직 소속 팀이 없어요. 회사 정보는 계속 볼 수 있어요. 팀 배정이 필요하면 대표에게 알려 주세요.` / 대표: `아직 만든 팀이 없어요. 사람이 늘면 회사 관리에서 팀을 만들 수 있어요.` |
| 데이터 없음 — 다른 기기 | 현재 기기 행은 유지 | `다른 로그인 기기가 없어요. 지금 기기만 로그인되어 있어요.` |
| 오류 — 계정 | 오류 카드, 이전 화면 값으로 성공처럼 표시하지 않음 | `계정 정보를 불러오지 못했어요. 바뀐 내용은 없어요.` + `다시 불러오기` |
| 오류 — 저장 | field 입력 보존, field 인접 오류 또는 alert | `내 정보를 저장하지 못했어요. 입력한 내용은 그대로 두었어요.` + `다시 저장하기` |
| 권한 없음 | 요청 대상 이름·수량 숨김 | `이 화면을 볼 수 없어요. 현재 회사에서 허용된 정보만 볼 수 있어요.` + `내 계정으로 돌아가기` |
| 세션 만료 | 진행 중 form을 성공 처리하지 않음 | `로그인이 만료됐어요. 다시 로그인하면 이어서 확인할 수 있어요.` + `다시 로그인하기` |
| 취소 | 원래 카드 유지, 0 write | `요청을 취소했어요. 바뀐 내용은 없어요.` |
| 성공 — 내 정보 | 바뀐 field 요약 + 다음 행동 | `내 정보를 저장했어요.` + `회사와 팀 보기` |
| 성공 — 기기 폐기 | 폐기 대상명과 현재 기기 유지 표시 | `선택한 기기의 로그인을 끊었어요. 지금 기기에서는 계속 사용할 수 있어요.` |

`error.tsx`는 오류 id를 사용자에게 그대로 노출하지 않는다. 로깅에는 PII·email·session token을 넣지 않은 correlation id만 쓴다.

## 6. 숨은 다음 시퀀스

### 6.1 메인 상단 → 계정 → 회사·팀

```text
상단의 이름 있는 프로필 버튼
  → 메뉴 열림, 첫 focus는 “내 계정”
  → “내 계정” 선택
  → /account, 서버에서 Global Profile + current membership 조회
  → “회사와 팀” Link 선택
  → /w/{workspaceSlug}/profile
  → 서버가 slug, active membership, cutoff 재검사
  → 내 Workspace Profile·팀만 표시
```

메뉴를 `Esc`로 닫으면 focus를 프로필 버튼으로 돌려준다. route 이동 후 `h1`로 focus를 강제 이동하지 않고 브라우저 탐색 관례를 따른다. 필요한 경우 skip link를 제공한다.

### 6.2 Workspace 전환

다른 Workspace를 고르면 해당 membership을 서버에서 검증한 뒤 `/w/{newSlug}/profile`로 이동한다. 현재 기기 세션 행은 새 문맥을 표시한다. 다른 기기 행은 현재 문맥처럼 쓰지 않고 `마지막으로 사용한 워크스페이스: {이름}`이라고 표시한다. 권한을 잃은 Workspace 이름은 세션 목록에서 마스킹하거나 `접근할 수 없는 워크스페이스`로 바꾼다.

### 6.3 현재 기기 로그아웃

```text
“이 기기에서 로그아웃”
  → 영향 dialog
  → POST /auth/signout
  → revoke_current_session + Auth sign-out 확인
  → /login?reason=signed-out
```

Dialog 제목: `이 기기에서 로그아웃할까요?`

설명: `이 브라우저의 로그인만 끝나요. 다른 기기에서는 계속 사용할 수 있어요.`

버튼: `계속 사용하기` / `이 기기에서 로그아웃`

### 6.4 모든 기기 로그아웃

```text
“모든 기기에서 로그아웃”
  → 계정 전체·모든 Workspace 영향 설명
  → “모두 로그아웃” 정확 입력 전 CTA disabled
  → revoke_all_account_sessions
  → account cutoff와 Auth refresh session 폐기 확인
  → /login?reason=all-sessions-revoked
```

Dialog 제목: `모든 기기에서 로그아웃할까요?`

설명: `MoaWork를 사용 중인 모든 기기와 모든 회사에서 로그아웃돼요. 이 작업은 되돌릴 수 없지만 다시 로그인하면 바로 사용할 수 있어요.`

입력 label: `확인하려면 “모두 로그아웃”을 입력해 주세요.`

버튼: `취소` / `모든 기기에서 로그아웃`

외부 Auth revoke가 실패해도 DB account cutoff가 기존 세션을 즉시 거부해야 한다. 둘 중 하나만 성공한 경우 UI는 완전 성공을 표시하지 않고 재로그인 안내와 서버 복구 상태를 보여준다.

### 6.5 개인정보·export·탈퇴

`/account/privacy`는 `내 개인정보`, `내 데이터 내려받기`, `계정 탈퇴` 순서다. 이메일 원문·민감정보 reveal, export 생성, 탈퇴 확정은 재인증 뒤에만 실행한다.

- 버튼: `내 개인정보 보기·수정`
- 버튼: `내 데이터 내려받기`
- 위험 버튼: `탈퇴 영향 먼저 보기`
- export 설명: `내 계정 정보만 내려받아요. 동료 정보와 회사 업무 자료는 들어가지 않아요.`
- 탈퇴 영향: 소속 Workspace, 보호 Owner 여부, 보관·삭제 범위, 취소 가능 기간을 서버 정책에서 읽어 보여준다.
- 유일한 보호 Owner이면 탈퇴 CTA를 실행하지 않는다: `지금은 탈퇴할 수 없어요. 먼저 다른 구성원에게 대표 역할을 안전하게 이전해 주세요.` + `대표 이전 방법 보기`

목업의 `7일 동안 취소`는 정책·DB 상태가 확정되기 전 제품 상수로 복사하지 않는다. 실제 정책값이 없으면 `탈퇴 정책을 확인할 수 없어 지금은 진행할 수 없어요.`라고 fail closed한다.

## 7. C안 유지·삭제·현실화

| 구분 | 요소 | 제품 처리 |
|---|---|---|
| 유지 | 개인 중심 제목·정체성 헤더 | `내 계정과 팀`, 현재 회사·역할·팀을 첫 viewport에 둔다. |
| 유지 | 내 정보/회사와 팀/로그인 기기/개인정보 탭 | 실제 route Link로 현실화한다. |
| 유지 | 3개 핵심 카드의 비대칭 벤토 | 데스크톱 2열, 모바일 1열로 사용한다. |
| 유지 | 현재/모든 기기 로그아웃 분리 | 서로 다른 RPC·영향 dialog·결과로 구현한다. |
| 유지 | 현재 session과 마지막 사용 Workspace 문구 구분 | session registry의 서버 값으로 표시한다. |
| 삭제 | 상태 선택 dropdown·persona 선택기 | 목업 검수 harness일 뿐 제품 control이 아니다. Story/Test fixture로만 남긴다. |
| 삭제 | C 화면 안의 Platform 1~4급·담당영역·지원 단계 | 계정 제품 IA에서 제거한다. 별도 Platform 운영 제품의 입력이다. |
| 삭제 | client button으로 화면만 숨기고 바꾸는 navigation | URL·back·refresh가 되는 route navigation으로 대체한다. |
| 삭제 | raw 역할/범위 `관리자 · 전체` | `역할`, `직책`, `팀`, `볼 수 있는 범위`로 분리해 번역한다. |
| 현실화 | 가상 세션 2개 | `account_sessions`의 본인 행만 조회하며 raw token은 저장·표시하지 않는다. |
| 현실화 | 가상 export·탈퇴 성공 | 재인증, 서버 상태, 멱등 command, 감사 증거가 있는 경우만 성공한다. |
| 현실화 | 회사 관리 노출 | server-rendered Owner/capability 판정과 direct URL deny를 함께 적용한다. |

## 8. 브랜드 토큰·타이포·테마

컴포넌트는 `globals.css`의 semantic variable만 사용한다.

| 목적 | token | light / dark 정본 |
|---|---|---|
| 주요 행동·선택 탭 | `--mw-primary` → `--mw-moa-violet` | `#6b5cff` / `#8a7cff` |
| 기기·기록 정보 | `--mw-record` → `--mw-work-blue` | `#3478f6` / `#6ea0ff` |
| 흐름·연결 | `--mw-automation` → `--mw-flow-teal` | `#18a999` / `#47cfbc` |
| 사람·팀 | `--mw-people` → `--mw-people-coral` | `#f26b5e` / `#ff8a80` |
| 전경/표면 | `--mw-fg`, `--mw-surface` | `#191a1e`/`#ffffff` · `#f7f8fa`/`#111216` |
| 앱/카드/경계/보조문구 | `--mw-bg`, `--mw-card`, `--mw-line`, `--mw-sub`, `--mw-body` | `globals.css` 정본 |
| 성공/주의/오류 | `--mw-success`, `--mw-warning`, `--mw-error` | `globals.css` semantic 정본 |
| 곡률 | `--mw-radius` | 현재 제품 정본 `14px` |

- Coral은 avatar·팀·사람 표시용이며 로고 내부와 위험/성공 의미에 쓰지 않는다.
- Violet은 primary CTA에만 우선 사용한다. 모든 카드에 색을 칠해 정보 위계를 무너뜨리지 않는다.
- 상태는 색 + 아이콘 + 한글 문구를 함께 사용한다.
- `Geist`/system sans 현행을 유지한다. 숫자·slug 외 사용자 UI에 mono를 쓰지 않는다.
- `ThemeToggle`의 local storage와 OS fallback을 그대로 사용한다. 새 화면은 server/client 첫 paint가 같은 token을 본다.
- account CSS/JSX에 hex literal을 추가하지 않는다.

## 9. 모바일·접근성·잔잔한 모션

### 반응형

- 검수 폭: `1280×720`, `390×844`, `320×568`; 라이트/다크 테마를 각각 확인한다.
- 데스크톱: C 벤토 2열, `내 회사와 팀` 카드는 2열 span.
- 모바일: 모든 카드·탭·dialog를 1열로 쌓고 문서 가로 overflow를 0으로 유지한다.
- route navigation은 가로 스크롤 tab strip보다 줄바꿈 가능한 2×2 Link 또는 세로 목록을 우선한다.
- sticky CTA가 화면을 가려 오류·취소·마지막 기기 행에 접근하지 못하게 하지 않는다.
- pointer target은 최소 `44×44px`.

### 접근성

- 프로필 버튼은 접근 가능한 이름 `계정 메뉴 열기`, `aria-expanded`, `aria-controls`를 가진다.
- route navigation은 `<nav aria-label="내 계정과 팀">`; 현재 Link는 `aria-current="page"`를 쓴다. route Link에 억지 `role=tab`을 붙이지 않는다.
- 각 page는 유일한 `h1`; 카드 제목은 순서가 맞는 heading을 쓴다.
- form은 visible label과 field 인접 오류를 가진다. placeholder는 label을 대신하지 않는다.
- 비동기 진행/성공은 `role=status`, 차단 오류는 `role=alert`로 중복 낭독 없이 전달한다.
- dialog는 제목·설명과 연결하고 열 때 첫 안전 행동, 닫을 때 trigger로 focus를 돌린다.
- `:focus-visible`은 `--mw-primary`를 사용하는 3px ring과 충분한 offset을 제공한다.
- avatar·상태점·색만으로 역할이나 안전 상태를 전달하지 않는다.

### 모션

- 메뉴·카드 상태 전환은 opacity/transform `120–180ms ease-out` 안에서 끝낸다.
- layout을 크게 움직이는 spring, 자동 carousel, 장식성 parallax는 사용하지 않는다.
- `prefers-reduced-motion: reduce`에서는 animation을 제거하고 transition을 사실상 즉시 전환한다. 진행 상태는 움직임 대신 문구와 `aria-busy`로 전달한다.
- 로딩 skeleton을 쓸 경우 reduced-motion에서는 shimmer 없이 고정 표면으로 보인다.

## 10. 보안·데이터 선행 게이트

다음은 UI 완료와 별개로 DEV‑1/T03/T09가 충족해야 하는 출시 조건이다.

1. 보호 Owner는 정확히 1명이고 일반 membership form/RPC/DML로 수정·삭제할 수 없다.
2. `role=platformRole ?? membership.role` 및 Platform→`scope=all` 합성을 제거한다.
3. 모든 account/workspace loader와 action은 active membership, org id, account cutoff, Workspace cutoff를 서버에서 확인한다.
4. `revoke_current_session`은 현재 app/Auth session만, `revoke_all_account_sessions`는 계정 전체·모든 Workspace를 폐기한다.
5. Workspace 전환·role/scope 변경·membership 제거 뒤 stale tab, refresh, direct API가 실패한다.
6. Global Profile, Workspace Profile, Membership, Position, Team을 한 payload에서 임의 overwrite하지 않는다.
7. 세션 목록은 raw token·cookie·refresh token을 저장하거나 반환하지 않는다.
8. 개인정보 reveal/export/탈퇴는 재인증·멱등 command·감사를 가진다. audit에 email 원문·민감 payload를 넣지 않는다.
9. Platform-only 사용자는 명시적 Workspace membership 없이 `/w/{slug}` 데이터 0건, write 0건이다.
10. UI에서 숨긴 행동도 direct URL/API/DB에서 같은 결과로 거부한다.

세션 registry와 cutoff가 아직 없다면 `/account/sessions`는 가상 기기 목록이나 가짜 성공을 만들지 않고 다음 blocked state를 쓴다.

`로그인 기기 정보를 안전하게 확인하는 기능을 준비하고 있어요. 지금 기기에서는 로그아웃할 수 있어요.`

## 11. 동일 상태 전후 비교 기준

전후 비교는 같은 candidate SHA, 합성 fixture, 역할, viewport, theme, URL에서 찍는다. 기존 목업과 제품 후보를 섞지 않는다.

| 비교축 | Before — 현재 제품 | After — 수용 기준 |
|---|---|---|
| 진입점 | 사이드바 하단 이름 + 아이콘형 로그아웃, 계정 route 없음 | 상단에서 이름 있는 계정 메뉴, 내 계정·회사/팀·기기·로그아웃을 키보드로 찾음 |
| 정보 구조 | `/settings/members` 한 화면에 raw 권한 관리 | Global Account와 Workspace Profile route 분리, back/refresh 유지 |
| 역할 표현 | `소유자/관리자/멤버`, raw scope | `대표/팀장/사원`; 역할·직책·팀·범위가 별도 label |
| 개인정보 | 이메일 원문이 멤버 목록에 보임 | 기본 마스킹, 본인 reveal은 재인증 |
| 세션 | 현재 signout만 있고 영향 구분 없음 | 현재/다른 기기, 현재/모든 기기 영향과 서버 결과 구분 |
| 상태 | loading/error/empty route 상태 없음 | empty·loading·error·denied·expired·cancel·success가 다음 행동 포함 |
| Owner 보호 | 일반 role form에 Owner 값이 함께 있음 | 대표 관리 control 분리, 자기 강등·삭제 DOM/API/DB 모두 차단 |
| Platform 경계 | session context가 Platform role을 합성 | Account UI에서 Platform 0건, 별도 principal 유지 |
| 반응형 | 고정 232px desktop shell 중심 | 390/320px 1열, 가로 overflow 0, touch 44px |
| 테마/A11y | theme token은 있으나 account flow·reduced-motion 없음 | light/dark 동일 정보 위계, focus/label/live region/reduced-motion PASS |

필수 fixture:

- `ORG-1`: 보호 Owner 1명, 팀 없음, 현재 기기 1개
- `ORG-3`: Owner 1 + 팀장 1 + 사원 1, 현재/다른 기기
- `ORG-10`: 두 팀, 긴 이름·충분한 session 행으로 overflow 확인
- `TENANT-B`: 권한 없는 다른 Workspace, 존재 metadata 비노출

필수 캡처 묶음:

1. `ORG-3 / 사원 / /account / default / D-L·M-D`
2. `ORG-1 / 대표 / /w/{slug}/profile / team-empty / D-D·M-L`
3. `ORG-3 / 팀장 / direct owner-management denied / D-L`
4. `ORG-3 / 본인 / sessions / logout-current·logout-all cancel·success·error`
5. `TENANT-B / direct URL·API denied / metadata 0`

브라우저 증거에는 console error, failed network injection 뒤 retry, 새로고침, theme 유지, keyboard 순회, horizontal overflow, server response, DB 전후 count를 분리해 기록한다.

## 12. 사용자 이해 확인 퀴즈

T10은 구현본을 보여준 뒤 아래 4문항 중 2~4개를 묻고 사용자의 답·승인을 기록한다.

1. `내 정보`와 `회사와 팀`은 어떤 정보가 다르다고 느껴지나요?
   - 기대 이해: 내 정보는 회사가 바뀌어도 유지되는 계정, 회사와 팀은 현재 Workspace별 정보다.
2. 이 화면에서 현재 회사와 내 역할, 로그인 기기, 로그아웃을 각각 어디서 찾을 수 있나요?
   - 기대 이해: 첫 화면 카드·route navigation·상단 프로필 메뉴에서 10초 안에 찾는다.
3. `이 기기에서 로그아웃`과 `모든 기기에서 로그아웃`은 영향이 어떻게 다른가요?
   - 기대 이해: 현재 브라우저만 종료 vs 모든 기기·모든 Workspace session 종료다.
4. 팀장이 보인다는 이유만으로 회사 전체 권한이나 대표 관리 권한을 얻나요?
   - 기대 이해: 아니다. 팀장 표시는 직책/역할 정보이며 실제 capability는 서버의 명시적 위임과 membership/RLS가 결정한다.

## 13. DEV‑1 구현 순서와 완료 정의

### Slice 1 — 읽기 가능한 C shell

- `AccountMenu`, `/account`, `/w/[workspaceSlug]/profile` 구현
- 역할·직책·팀 분리, 이메일 마스킹
- 일반 구성원/팀장/대표 server-rendered 노출 차이
- loading/empty/error/denied, mobile/light/dark/a11y

### Slice 2 — 세션

- `account_sessions`, account/Workspace cutoff와 RPC가 준비된 뒤 `/account/sessions`
- 현재/다른 기기 및 현재/모든 기기 폐기
- stale tab·refresh·direct API non-skip 테스트

### Slice 3 — 개인정보

- 재인증 뒤 reveal/edit/export
- 탈퇴 영향 preview, 유일 Owner 차단, 실제 정책 기반 취소/복구
- 서버 command·감사·실패 복구가 없는 기능은 disabled blocked state로 유지

### Slice 4 — 회사 관리 cutover

- 기존 `/settings/members`를 tenant-scoped route로 이관
- 보호 Owner control 제거, 초대/팀/직책/권한 분리
- Platform/Workspace role 합성 제거와 공격 테스트 통과

완료는 JSX가 보이는 시점이 아니다. 같은 candidate SHA에서 다음이 모두 필요하다.

- route·role·상태·viewport·theme 수용 기준 PASS
- console warn/error 0, unlabeled control 0, horizontal overflow 0
- Owner/tenant/session direct API·DB 공격군 PASS
- mock/in-memory 성공이 아닌 실DB non-skip 증거
- T10 독립 검수와 사용자 퀴즈 승인

## 14. 범위 밖과 다음 소비자

이번 결정으로 A/B/D 전체 시안, 관리자 콘솔 4안 비교, Platform 1~4급 UI, 고객지원 3단계 UI, C-level·복수팀·custom hierarchy를 DEV‑1 기본 계정 화면에 넣지 않는다. 내부 P0 계약은 삭제하지 않고 별도 security/platform workstream에 남긴다.

- **DEV‑1**: Slice 1부터 route/file/state 계약대로 구현한다. UI-only 권한 판정과 가상 세션 성공은 금지한다.
- **T01**: 상단 shell 진입점, current Workspace 전환, legacy URL redirect의 제품 navigation 충돌을 검토한다.
- **T09**: Global/Workspace Profile, session registry/cutoff, 개인정보 command의 실제 데이터 준비 상태와 Slice 2·3 gate를 확인한다.
- **T10**: 같은 fixture 전후 비교, hidden sequence, P0 direct 공격, 이해 퀴즈를 독립 실행한다.
- **MWC**: C 선택을 최종 제품 결정으로 유지하고 추가 4안 탐색을 재개하지 않는다. 미결정 정책만 별도 WORK-ID로 연다.
