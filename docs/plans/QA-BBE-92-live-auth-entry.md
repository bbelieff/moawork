# QA-BBE-92 — 라이브 인증 진입 QA 절차서 (BBE-5 잔여)

> 작성: 모아워크 데탑 CT10(260809) · 2026-08-09 KST
> 모드: **준비 + 가능 범위** — 실계정 로그인 단계는 belie 파킹
> 리스: `docs/plans/QA-BBE-92-live-auth-entry.md` (신규 1개) · **코드 변경 0**
> 근거 정본: `docs/coordination/sync/ROUND-34.md` §4 · `docs/plans/branch-triage-2026-08-09.md` L61

---

## 0. 대상과 기준선

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 기준 브랜치 | `origin/main` = `0e938e3` | `git rev-parse origin/main` (2026-08-09 fetch) |
| 로컬 체크아웃 | `cf1055d` — **origin/main 대비 3 커밋 뒤** | `git rev-list --left-right --count HEAD...origin/main` = `0  3` |
| 프로덕션 | `https://www.moa-work.com` (apex → 308 www) | 아래 §A |
| 프로덕션 ↔ SHA 바인딩 | **NOT_RUN / 미검증** | Vercel 배포 ID를 SHA로 매핑할 수단 없음. ROUND-34 §4와 동일 판정 유지 |

**주의(F7).** 이 절차서의 코드 인용은 전부 `origin/main` 실측이다. 로컬 워킹트리(`cf1055d`)에는
`#95·#97·#98` 3건이 없으므로 로컬 grep 결과로 판정하지 않는다.

기준선 이후 인증 진입에 직접 영향을 주는 커밋 3건:

| SHA | 제목 | QA 영향 |
| --- | --- | --- |
| `cc3144a` | 승인 직후 조직의 첫 화면 잠금 해제 (#95) | 시나리오 E→C 전이 직후 첫 화면 |
| `64c3dc7` | 현재 로그인 이메일과 사용자 모드 표시 (#97) | **계정 대조 수단 확보** — thinking-protocol 사례 1의 근본 원인 해소 |
| `0e938e3` | 플랫폼 권한 거부와 서비스 장애 구분 (#98) | `/?error=platform-forbidden` ↔ `platform-unavailable` 분리 |

---

## 1. 진입 경로 계약 (코드 실측)

```
미인증 요청
  └─ proxy.ts:75  →  307 /login?next=<safeNextPath>        공개경로 = /login, /auth/*  (proxy.ts:18)

/login  →  Google OAuth  →  /auth/callback?code=…&next=…
  ├─ code 없음 / 교환 실패 / getUser 실패      → /login?error=auth      (route.ts:20,25,31)
  ├─ users upsert 실패                         → /login?error=profile   (route.ts:43)
  ├─ rpc is_platform_admin === true            → /mode(+next)           (route.ts:55-65)
  │     · mw_mode · mw_org · mw_uid · mw_as 쿠키 전부 삭제 — 이전 모드 재사용 금지
  └─ 그 외 → decideWorkspaceDestination(멤버십, next힌트)   (workspace-routing.ts:180)
        · next=/w/{slug} & 해당 활성멤버십 정확히 1건 → 그 경로 + mw_org 설정
        · next=/w/… 인데 매칭 0 또는 2+            → /workspace-entry?error=routing
        · 소속 0 → /workspace-entry · 소속 1 → /w/{slug} · 소속 2+ → /workspaces
        · 멤버십 행 파싱 실패(미지의 status 등)     → fail-closed (routing.ts:186)

/mode  (page.tsx:20)
  ├─ 미인증           → /login?next=/mode…
  ├─ snapshot=error   → /workspace-entry?error=routing
  └─ decideModeDestination(preference, platformAccess, memberships)   (contract.ts:86)
        · preference=platform & granted → /platform
        · preference=null    & granted → **선택 화면 렌더**  ← BBE-5 대상 화면
        · 그 외(비관리자 · preference=user) → decideUserModeDestination

선택 클릭 = POST /mode/preference  (preference/route.ts:12)
  ├─ granted   → mw_mode 서명쿠키 설정 후 **/mode 로 되돌아감** (직접 /platform 아님 — 2홉)
  ├─ denied    → 403 {"error":"mode_forbidden"}
  ├─ unavailable → 503 {"error":"mode_unavailable"}
  └─ 잘못된 mode → 400 {"error":"mode_invalid"}
```

**핵심 사실 1** — 선택 화면(`/mode` chooser)은 **플랫폼 관리자에게만** 뜬다
(`contract.ts:98` — `preference === null && platformAccess === "granted"`). 일반 멤버는 `/mode`를
직접 열어도 선택 화면을 볼 수 없고 자기 회사로 넘어간다. BBE-5 재현에는 **플랫폼 관리자 계정이 필수**다.

**핵심 사실 2** — 클릭은 `/platform`으로 직행하지 않는다. `POST /mode/preference` → `/mode` →
`/platform` 의 2홉이다. 리다이렉트를 세는 검증에서 이걸 실패로 오판하지 말 것.

---

## 2. ROUND-34 결함의 현재 상태 (코드 레벨)

ROUND-34 §4 판정: *"두 선택 항목은 DOM button으로 존재하지만 class·배경·테두리·padding과 pointer
cursor가 없어 일반 텍스트처럼 보였다"* → `FAIL`.

`origin/main` 실측 — 해당 스타일이 **전부 존재한다**:

| ROUND-34가 없다고 한 것 | origin/main 위치 | 값 |
| --- | --- | --- |
| class | `mode/page.tsx:71,92` | `styles.choice` + `styles.platformChoice`/`userChoice` |
| 배경 | `mode-page.module.css:91` | `background: var(--mw-card)` (+108-115 톤 분기) |
| 테두리 | `mode-page.module.css:88` | `border: 1px solid var(--mw-line)` |
| padding | `mode-page.module.css:87` | `padding: 22px` (min-height 174px) |
| pointer cursor | `mode-page.module.css:93` | `cursor: pointer` |
| (추가) 키보드 포커스 | `mode-page.module.css:103` | `.choice:focus-visible` outline 3px |

수정 커밋: `61e3c94 fix: make mode choices clearly interactive (#80)`.
회귀 방지 테스트 존재: `app/src/app/mode/page.test.ts:19-25` (cursor·focus-visible·반응형 단정).

→ **코드 레벨 = 해소됨.** 남은 것은 실제 렌더 화면의 육안 확인뿐이며, 그것이 BBE-92의 본체다.

---

## 3. §A 비인증 경로 실측 — **실행 완료**

실행: 2026-08-09 KST · `HttpWebRequest` `AllowAutoRedirect=false` · 쿠키 없음 · 프로덕션.

| # | 요청 | 결과 | Location | 판정 |
| --- | --- | --- | --- | --- |
| A1 | `GET https://moa-work.com/` | `308` | `https://www.moa-work.com/` | ✅ canonical 308 |
| A2 | `GET /login` | `200` | — | ✅ 게이트 ⑨ 충족 |
| A3 | `GET /` | `307` | `/login?next=%2F` | ✅ |
| A4 | `GET /mode` | `307` | `/login?next=%2Fmode` | ✅ |
| A5 | `GET /mode?next=%2F` | `307` | `/login?next=%2Fmode%3Fnext%3D%252F` | ✅ 중첩 인코딩 보존 |
| A6 | `GET /platform` | `307` | `/login?next=%2Fplatform` | ✅ 어드민 평면 미노출 |
| A7 | `GET /workspaces` | `307` | `/login?next=%2Fworkspaces` | ✅ |
| A8 | `GET /workspace-entry` | `307` | `/login?next=%2Fworkspace-entry` | ✅ |
| A9 | `GET /w/demo` | `307` | `/login?next=%2Fw%2Fdemo` | ✅ 딥링크 보존 |
| A10 | `GET /demo` (별칭) | `307` | `/login?next=%2Fw%2Fdemo` | ✅ 별칭→정규 변환 (proxy.ts:78-80) |
| A11 | `GET /auth/callback` (code 없음) | `307` | `/login?error=auth` | ✅ 공개경로 통과 후 자체 거부 |
| A12 | `GET /auth/signout` | `405` | — | ✅ POST 전용 |
| A13 | `POST /auth/signout` | `303` | `/login?reason=signed-out` | ✅ 303(메서드 전환) |
| A14 | `GET /mw-sig/static/array.js` | `200` | — | ✅ 분석 프록시 게이트 제외 유지 |
| A15 | `GET /nonexistent-path-qa-bbe92` | `307` | `/login?next=%2Fw%2Fnonexistent-path-qa-bbe92` | ⚠️ §E-2 |

`/login` 본문 검사 (200, 22,868 bytes):

| 확인 | 결과 |
| --- | --- |
| Google 로그인 버튼 문자열 | 있음 ✅ |
| `개발용 계정` 블록 | **없음** ✅ — 운영에서 dev 로그인 미노출 (`login/page.tsx:22,125`) |
| 이용약관 고지 | 있음 ✅ |
| `cache-control` | `private, no-cache, no-store, max-age=0, must-revalidate` ✅ |
| `strict-transport-security` | `max-age=63072000` ✅ |

**§A 종합: 15/15 PASS.** 미인증 경계는 계약대로 닫혀 있다.

---

## 4. §B 계정 유형별 시나리오 — **belie 로그인 필요 (파킹)**

`P` = 플랫폼 관리자(`is_platform_admin` RPC true) · `n` = 활성 멤버십 수.

| ID | 계정 유형 | 검증 지점 | 기대 결과 (코드 근거) |
| --- | --- | --- | --- |
| B1 | **P · n≥1** | 로그인 직후 착지 | `/mode` 선택 화면 (callback:55) — 회사로 직행하지 **않음** |
| B2 | P · n≥1 | 선택 화면 육안 | 카드 2장이 **테두리·배경·커서 있는 버튼**으로 보임 (ROUND-34 FAIL 항목) |
| B3 | P · n≥1 | 키보드 Tab | 두 카드에 포커스 링(3px outline)이 보임 (`css:103`) |
| B4 | P · n≥1 | "플랫폼 운영" 클릭 | `/platform` 도달 (2홉: `/mode/preference` → `/mode` → `/platform`) |
| B5 | P · n≥1 | "내 워크스페이스" 클릭 | n=1 → `/w/{slug}` · n≥2 → `/workspaces` (`contract.ts:71-80`) |
| B6 | P · n≥1 | 클릭 후 재로그인 | 다시 `/mode` 선택 화면 — 이전 선택이 자동 재사용되지 않음 (callback:61) |
| B7 | **P · n=0** | 로그인 직후 착지 | `/mode` (callback의 관리자 분기가 먼저 걸림) · §E-1 참조 |
| B8 | P · n=0 | "내 워크스페이스" 클릭 | `/workspace-entry` (`contract.ts:77`) |
| B9 | **일반 · n=1** | 로그인 직후 착지 | `/w/{slug}` + `mw_org` 쿠키 설정 (callback:80-86) |
| B10 | 일반 · n=1 | `/mode` 직접 진입 | 선택 화면이 **뜨지 않고** `/w/{slug}` 로 넘어감 |
| B11 | 일반 · n=1 | `/platform` 직접 진입 | `/?error=platform-forbidden` + "관리자 모드를 사용할 권한이 없어요" 배너 (`guard.ts:15-20`) |
| B12 | **일반 · n≥2** | 로그인 직후 착지 | `/workspaces` 선택 목록 |
| B13 | 일반 · n≥2 | `/w/{내 slug}` 딥링크 로그인 | 해당 회사로 직행 (`routing.ts:190-204`) |
| B14 | 일반 · n≥2 | `/w/{남의 slug}` 딥링크 | `/workspace-entry?error=routing` — 조용한 성공 금지 |
| B15 | **소속 0** | 로그인 직후 착지 | `/workspace-entry` (신청 화면) |
| B16 | 소속 0 | `/w/{임의 slug}` 딥링크 | `/workspace-entry?error=routing` |
| B17 | 전 유형 | 계정 메뉴 열기 | **로그인 이메일 전문이 보임** (`AccountMenu.tsx` `loginEmail`, #97) |
| B18 | P만 | 계정 메뉴 | `사용자 모드` 뱃지 노출 (일반 계정에는 미노출 — `serverConfirmedCanAccessPlatform`) |
| B19 | 전 유형 | 로그아웃 | `/login?reason=signed-out` (A13에서 303 확인 완료) |
| B20 | 전 유형 | 로그아웃 후 뒤로가기 | 보호 경로 재접근 시 `/login` 으로 재차단 |

### 판정 기준

- **PASS** = 기대 착지 URL 일치 **+** 화면에 기대 요소가 실제로 보임 **+** 콘솔 에러 0.
- **FAIL** = URL은 맞는데 화면이 비거나 요소가 안 보이는 경우도 포함한다(무증상 파손, F12/사례 3).
  판정 기준은 "에러 없음"이 아니라 **기대 값이 남아 있음의 긍정 확인**이다.
- **NOT_RUN** = 해당 유형 계정이 없어 못 돌린 항목. **PASS로 승격하지 않는다.**
- 계정 유형이 헷갈리면 §D-0 대로 **계정 메뉴의 이메일을 먼저 적는다.** 사례 1이 하루를 태운 원인이
  정확히 "어느 계정으로 보고 있는지 몰랐던 것"이다.

### 화면·데이터 확인 지점

| 확인 대상 | 어디서 보나 |
| --- | --- |
| 현재 계정 | 우상단 계정 메뉴 → 이름 아래 이메일 전문 |
| 플랫폼 권한 유무 | 계정 메뉴에 `사용자 모드` 뱃지가 있으면 관리자 |
| 소속 회사 수 | `/workspaces` 목록 행 수 |
| 모드 쿠키 | DevTools → Application → Cookies → `mw_mode` (`v1.platform.…` / `v1.user.…`) · HttpOnly |
| 선택 회사 | 쿠키 `mw_org` |
| 리다이렉트 사슬 | DevTools → Network → **Preserve log 켜기** (안 켜면 2홉이 안 보임) |

---

## 5. §D belie 5분 체크리스트 (그대로 따라가기)

> 준비물: 크롬 시크릿 창 1개 · DevTools Network 탭에 **Preserve log 체크**.
> 소요 5분. 각 줄 끝에 결과만 적어 회신하면 판정은 CT10이 한다.

```
0) 시크릿 창 → https://www.moa-work.com/mode  로 시작 (로그인 화면으로 튕기는 게 정상)
   → Google 로그인 (플랫폼 관리자 계정)

1) [선택 화면] 로그인 끝나고 뜬 화면이 "어디에서 시작할까요?" 인가?          Y / N  ____
   · N 이면 어디로 갔는지 URL 적기 → ____________________

2) [BBE-5 본체] 카드 2장이 '버튼처럼' 보이는가?
   - 네모 테두리 있음                                                   Y / N  ____
   - 카드 위에 마우스 올리면 손가락 커서 + 살짝 떠오름                    Y / N  ____
   - Tab 키 누르면 카드에 파란 테두리(포커스 링)                          Y / N  ____
   ★ 이 화면 스크린샷 1장 (창 너비 1440px)                                첨부 ____

3) [클릭] "플랫폼 운영으로 이동" 클릭 → 최종 URL 이 /platform 인가?        Y / N  ____
   · 주소창이 잠깐 /mode 를 거치는 건 정상(2홉)

4) [복귀] 우상단 계정 메뉴 열기
   - 내 로그인 이메일이 그대로 보이는가?                                  Y / N  ____
   - '사용자 모드' 뱃지가 보이는가?                                       Y / N  ____
   → 메뉴에서 사용자 모드로 돌아가 회사 화면이 뜨는가?                     Y / N  ____

5) [차단] 주소창에 https://www.moa-work.com/platform 을 직접 입력
   · 관리자 계정이면 → /platform 정상            일반 계정이면 → 홈 + "권한이 없어요" 배너
   본 것: ______________________________

6) [로그아웃] 계정 메뉴 → 로그아웃 → /login 으로 갔는가?                  Y / N  ____
   → 뒤로가기 눌러도 회사 화면이 안 열리는가?                             Y / N  ____
```

**추가 1분(있으면 좋음) — 일반 계정으로 같은 창에서 반복**
```
7) 로그아웃 후 일반 멤버 계정으로 로그인 → 바로 회사 화면으로 갔는가?      Y / N  ____
8) 주소창에 /mode 직접 입력 → 선택 화면이 '안 뜨고' 회사로 가는가?         Y / N  ____ (이게 정상)
9) 주소창에 /platform 직접 입력 → "관리자 모드를 사용할 권한이 없어요"      Y / N  ____
```

**belie가 판단할 필요 없는 것**: 리다이렉트 횟수·쿠키 값·콘솔 로그. Y/N과 스크린샷만 회신하면 된다.

---

## 6. §E 관측 항목 (수정 아님 — 기록만)

**E-1 · `decideWorkspaceDestination`의 `isPlatformAdmin` 인자가 도달 불가**
`workspace-routing.ts:206-211`에 "소속 0 + 플랫폼 관리자 → `/platform`" 분기가 있고 주석도 달려
있으나, 비테스트 호출부는 `auth/callback/route.ts:74` 한 곳뿐이고 **3번째 인자를 넘기지 않는다**
(기본값 `false`). 게다가 callback은 그보다 앞선 `route.ts:55`에서 관리자를 이미 `/mode`로 보내
버린다. 즉 현재 산출물은 깨지지 않았고(B7이 `/mode`로 가는 게 맞다) **분기만 죽어 있다.**
→ 사용자 영향 없음. 별도 카드 후보(코드 정리), BBE-92 범위 밖.

**E-2 · 단일 세그먼트 경로가 전부 회사 별칭 후보로 해석됨**
A15: `/nonexistent-path-qa-bbe92` → `next=/w/nonexistent-path-qa-bbe92`. `proxy.ts:78-80`의
별칭 정규화 설계대로다. 로그인 후에는 `decideWorkspaceNamespace`가 deny → `/workspace-entry?error=routing`
으로 닫힌다(§B14와 동일 경로). **보안 영향 없음**, 다만 오타 URL의 에러 문구가 "회사 없음"으로
보일 수 있다. UX 관찰로만 기록.

**E-3 · `POST /mode/preference` 성공 응답이 307 (메서드 보존)**
`preference/route.ts:37`은 `NextResponse.redirect(url)` — Next 기본값 **307**
(`node_modules/next/dist/server/web/spec-extension/response.js:99`). 307은 메서드를 보존하므로
브라우저는 `/mode`로 **POST를 다시 보낸다**. 같은 파일의 `/auth/signout`은 303으로 응답한다(A13 실측).
· 실측으로 좁힌 범위: `POST /login` → **200** (App Router 페이지 라우트는 POST에도 페이지를 렌더).
  따라서 `POST /mode` 도 405가 아니라 정상 렌더일 가능성이 높다.
· **단정하지 않는다.** 인증 없이 `POST /mode`를 확인할 수 없어(307 → `/login`) **미검증**이다.
· 단위 테스트 `preference/route.test.ts:41-46`은 Location과 쿠키만 단정하고 **status를 단정하지 않아**
  이 경로를 잡아내지 못한다.
→ **§D-3(클릭 → /platform 도달)이 이 항목을 그대로 판정한다.** Y면 무해 확정, N이면 신규 결함 카드.

---

## 7. §F 완료 판정과 되돌리기

| 구간 | 상태 |
| --- | --- |
| §A 비인증 실측 15항목 | ✅ **PASS** (증거 §3) |
| ROUND-34 결함 코드 레벨 | ✅ **해소** (증거 §2, `#80`/`61e3c94`) |
| §B 시나리오 20항목 | ⏸ **NOT_RUN** — belie 로그인 대기 (파킹) |
| 프로덕션 SHA 바인딩 | ⏸ **미검증** (ROUND-34 §4 판정 유지) |
| E-3 | ⏸ **미검증** — §D-3으로 판정 |

되돌리기: 이 작업은 **읽기 + 문서 1개**뿐이다. 되돌릴 코드·DB·배포 변경이 없다.
문서를 취소하려면 이 파일 삭제로 끝난다.

BBE-92 Done 승격 조건: §D 회신으로 B1~B6·B11·B17~B19가 PASS **또는** 결함이 신규 카드로 발행될 것.
§B의 나머지 항목은 해당 계정이 없으면 `NOT_RUN`으로 남기고 **PASS로 승격하지 않는다**.
