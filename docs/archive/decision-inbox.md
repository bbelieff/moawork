# decision-inbox (📥 결정함) — 앱 레포

> ❄️ **2026-08-05 동결. 신규 기록은 Linear 코멘트로. 과거 기록 보존용.**
> 새 결정 요청은 해당 Linear 이슈의 코멘트로 올린다.
> 근거: `docs/plans/system-audit-2026-08-05.md`

> 사람(belie)만 할 수 있는 작업을 쌓아두는 곳. 트랙은 멈추지 않고 다른 일을 계속한다.
> 화이트리스트: **실데이터 비가역 / 돈·보안 / 외부 계정·콘솔 / 사용자 정책 전환.**
>
> ⚠ 기획 워크스페이스(`서울리드프로젝트/모아워크/docs/coordination/decision-inbox.md`)에도
> 별도 결정함이 있다. 이 파일은 **앱 레포(github.com/bbelieff/moawork)에서 코드가 막히는 항목**만 다룬다.

## 🔴 크로스트랙 블로커 — 판정 필요 (T04 ↔ T07)

### DI-A6 · `platform_metrics_daily` **이중 정의** — 실DB 적용 시 한쪽이 조용히 깨진다

**발견**: T04(main 머지됨)와 T07(PR #56)이 **같은 이름의 테이블을 서로 다르게** 정의한다.
둘 다 `create table if not exists` 라 **먼저 적용된 쪽이 이기고 나중 것은 무음 무시**된다.

| 항목 | T04 — `014_platform_metrics_daily.sql` (**main 적용됨**) | T07 — `014_platform_console.sql` (PR #56) |
|---|---|---|
| PK | `(day, org_id)` | `(date, org_id)` |
| 날짜 컬럼 | **`day`** | **`date`** |
| 지표 컬럼 | `dau` · `mau` · `stickiness` · `active_users` · `dormant_users` · `new_deals` | `active_users` · `writes` · `errors` · `member_count` · `last_activity_at` |
| RLS | 정책 있음(플랫폼 관리자 SELECT) | **정책 없음** = 직접 차단, RPC 전용 |
| 적재 | `upsert_platform_metrics_daily` (앱 배치가 호출) | `rollup_platform_metrics_daily(p_date)` (SQL 내부 집계) |
| 배치 주체 | Next.js cron route `/api/cron/platform-metrics` | RPC |

**파급 (실측 근거)**: 마이그레이션은 **문자열 정렬**로 적용된다.
`014_platform_console.sql` < `014_platform_metrics_daily.sql` (`c` < `m`) →
**T07 이 먼저 적용되고 T04 의 CREATE TABLE 은 무시**된다.
그 뒤 T04 배치가 `upsert_platform_metrics_daily` 로 `dau`/`mau`/`stickiness` 에 INSERT 하면
**존재하지 않는 컬럼** 이라 런타임 실패한다. 역순이면 대칭적으로 T07 이 깨진다.

> ⚠ **BUG-0004 와 같은 유형이다** — 정적 게이트(check·build)는 초록이고,
> `.env.local` 을 넣어 실DB 에 적용하는 순간 처음 드러난다. 두 트랙 모두 CI 초록이었다.

**해소안 (판정 요망)**

- **A) T07 정의를 정본** — 콘솔 전체 소유자에게 맞춘다. T04 배치를 T07 스키마·RPC 로 이관.
  대가: `dau`/`mau`/`stickiness`/`dormant_users`/`new_deals` 를 T07 표에 additive 로 추가해야 한다.
- **B) T04 정의를 정본**(← T04 제안) — 이미 main 에 적용된 쪽을 유지하고,
  T07 이 필요한 `writes`/`errors`/`member_count`/`last_activity_at` 를 **additive 로 추가**한다.
  기존 파일 무수정 원칙에 맞고(새 번호 마이그레이션), 이미 머지된 것을 되돌리지 않는다.
  대가: T07 코드의 `date` → `day`, `MetricsDailyRow` 필드명 정합 필요.
- **C) 표를 분리** — 이름을 달리한다(예: T04 를 `product_metrics_daily` 로).
  대가: 같은 원본을 두 번 훑는 중복 집계. **비권장**.

**T04 의견**: **B**. 이미 main 에 있는 정의를 additive 로 넓히는 쪽이 되돌림이 없고
"기존 마이그레이션 무수정" 규칙과도 맞는다. 다만 **콘솔 화면 소유는 T07** 이므로
아래 화면 중복도 함께 정리해야 한다.

### DI-A7 · 지표 화면 중복 — `/platform/metrics`(T04) vs `/platform/analytics`(T07)

T04 가 PR #54 로 `/platform/metrics` 를 머지했고, T07 PR #56 이 `/platform` 콘솔 셸 전체
(9개 페이지, `PlatformShell`·`nav.ts` 포함)와 `/platform/analytics` 를 만든다.
→ 사용자에게 **지표 화면이 2개** 생긴다.

**T04 제안**: 콘솔 셸 소유자는 **T07** 이므로 T07 #56 머지 후 T04 가
`/platform/metrics` 를 제거하거나 `/platform/analytics` 로 리다이렉트한다.
지금 먼저 지우면 #56 머지 전까지 지표 화면이 없어지므로 **순서는 T07 머지 후**.

---

## 대기 중 — belie 액션 필요

### DI-A4 · 야간 배치 환경변수 2종 (T04/C4)

**왜 사람인가**: 시크릿 발급 + 외부 콘솔(Vercel) 설정. 에이전트가 대신 넣을 수 없다.

`/api/cron/platform-metrics` 가 동작하려면 **Vercel 환경변수** 2개가 필요하다.

| 변수 | 값 | 비고 |
|---|---|---|
| `CRON_SECRET` | 임의 난수 문자열 | Vercel Cron 이 `Authorization: Bearer <값>` 으로 보낸다 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 프로젝트 Settings → API → `service_role` | ⚠ **서버 전용**. `NEXT_PUBLIC_` 접두사 금지 |

미설정 시 엔드포인트는 **503/501 로 명시적 실패**한다(조용히 성공한 척하지 않는다).
cron 자체는 `app/vercel.json` 에 등록돼 있다(`0 19 * * *` UTC = KST 04:00).

> 순서 주의: 아래 DI-A5(BUG-0004)가 먼저 풀려야 실DB 검증이 의미를 갖는다.
> 다만 이 두 변수는 배치 전용(service_role)이라 BUG-0004 와 **독립적으로** 넣어도 무방하다.

---

## 트랙 회신 — T04 → T10 (BUG-0004 영향 범위)

### DI-A5 회신 · `014_platform_metrics_daily` 는 BUG-0004 영향권 **밖**

T10 검수(§11)의 배포차단 판정에 대해 T04 산출물 영향 범위를 실측 회신한다.

**결론: 영향 없음.** 근거 2가지.

1. **`is_org_member()` 미의존** — 014 의 RLS 정책은 그 헬퍼를 쓰지 않는다(grep 0건).
   집계 표는 tenant 업무데이터가 아니라 **개인정보 없는 수치**라 org 멤버십이 아니라
   플랫폼 관리자 여부로 게이트한다. 따라서 헬퍼가 상시 false 여도 이 표는 정상 판정된다.

2. **실패 메커니즘이 다르다** — BUG-0004 의 원인은 `current_setting('request.jwt.claim.session_id', true)`,
   즉 **개별 클레임 GUC**(`request.jwt.claim.<X>`, 단수)를 읽은 것이다. PostgREST v9+ 는
   `request.jwt.claims`(복수, JSON 전체)만 설정하고 단수 형태는 더 이상 채우지 않는다 → 상시 빈 값.
   014 는 `auth.jwt() ->> 'email'` 을 쓰는데, `auth.jwt()` 는 Supabase 표준 함수로
   **복수 형태를 파싱**한다. 같은 유형의 실패가 아니다.

**자체 점검 결과**: 014 는 저장소에서 `auth.jwt() ->> 'email'` 을 쓰는 **유일한** 정책이라
선례가 없어 위 근거를 명시적으로 남긴다. `email` 이 없는 인증 수단(전화번호 가입 등)에서는
`is not null` 검사로 **fail-closed** 된다 — 안전한 방향이다.

**T10 의 규칙 8 보강 권고에 동의한다**: "헬퍼가 새 전제(JWT 클레임·세션)에 의존하게 만들면
그 전제를 채우는 배선을 같은 PR 에 포함". 014 는 새 전제를 만들지 않고 기존 `app_admin_role`(005)만
소비하므로 이 규칙을 이미 만족한다.

> BUG-0004 자체의 해소는 인증 레인(**T03**) 또는 위임 레인(**T08**) 담당이라 T04 는 손대지 않았다.
> 레인 경계를 침범하지 않는다.

---

### DI-A1 · 구글 Cloud OAuth 클라이언트 등록 (T03/B1 §3)
**왜 사람인가**: 외부 콘솔 계정 + 시크릿 발급. 에이전트가 대신 로그인/발급할 수 없다.

Google Cloud Console → APIs & Services → Credentials → **OAuth 2.0 클라이언트 ID(웹 애플리케이션)**

- **승인된 JavaScript 원본**
  - `https://www.moa-work.com`
  - `http://localhost:3000`
- **승인된 리디렉션 URI** — Supabase Auth 가 콜백을 받는다. 프로젝트 ref `srtvmpcosekduvsscsyz`:
  - `https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback`
- 발급된 **클라이언트 ID/시크릿**은 Supabase Dashboard → Authentication → Providers → Google 에 입력.
  **저장소에 붙여넣지 말 것** (CLAUDE.md 비밀값 금지).
- Supabase → Authentication → URL Configuration
  - Site URL: `https://www.moa-work.com`
  - Redirect URLs: `https://www.moa-work.com/auth/callback`, `http://localhost:3000/auth/callback`

**막고 있는 것**: 구글 OAuth 실동작. 현재 코드는 dev-session 폴백으로 동작하며 로그인 흐름 자체는 진행 가능.

---

### DI-A2 · Supabase 접속정보 주입 (T03/B1 §5 — RLS 침투테스트)
**왜 사람인가**: 비밀값. 에이전트가 만들거나 채팅에 옮겨서는 안 된다.

`app/.env.local` (gitignore 됨) 에 **직접** 넣어주세요. 채팅·이슈·커밋에 붙여넣지 마세요.

```
NEXT_PUBLIC_SUPABASE_URL=https://srtvmpcosekduvsscsyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase Dashboard → Settings → API → anon public>
```

RLS 침투테스트를 **실제로 판정**하려면 테스트 계정도 필요합니다(조직 A/B 교차 검증용):

```
RLS_TEST_ORG_A_EMAIL=<조직 A 소속 사용자>
RLS_TEST_ORG_A_PASSWORD=<비밀번호>
RLS_TEST_ORG_B_ID=<조직 B 의 uuid — A 가 못 봐야 하는 대상>
# (선택) scope='assigned' 사용자 — 본인 담당만 보이는지 검증
RLS_TEST_MEMBER_EMAIL=
RLS_TEST_MEMBER_PASSWORD=
```

**현재 상태**: `app/src/lib/auth/rls-penetration.test.ts` 가 이미 작성돼 있고, 위 값이 없으면
**skip** 된다(게이트를 빨갛게 만들지 않음). 값이 들어오면 그대로 실행돼 판정된다.
→ 즉 **테스트는 준비 완료, 판정만 미완**. 수용기준 "다른 조직 데이터 절대 안 보임"은
이 값이 주입되기 전까지 **미검증**이다.

---

### DI-A3 · 005_app_admins.sql 실DB 적용 확인 (T03/B1 §4b)
**왜 사람인가**: 실DB 마이그레이션 적용은 되돌리기 어려운 작업.

- B1 지시서는 "001~004 적용됨"이라고 했으나 **4b 는 005(`app_admin_role`)를 요구**한다.
- 앱 레포에는 004·005 가 없어서 기획 워크스페이스에서 **무수정 복사**해 왔다(이 브랜치 포함).
- 확인 필요: 실DB(ref `srtvmpcosekduvsscsyz`)에 **005 가 적용돼 있는가?**
  - 적용됨 → 코드가 `app_admin_role()` RPC 를 쓰도록 배선(현재는 폴백 allowlist).
  - 미적용 → 005 적용 후 알려주세요.
- 현재 코드는 **양쪽 모두 대응**: RPC 가 있으면 그것을, 없으면 폴백 allowlist
  (`beliefkimkim@gmail.com` = owner + 플랫폼 관리자)를 쓴다. 두 목록은 테스트로 동기화 강제.

---

### DI-A4 · ⚠ 디자인 토큰 hex 값 불일치 — 어느 쪽이 정본인가
**왜 사람인가**: 브랜드 색 확정은 방향 결정. 트랙이 임의로 고를 수 없다.

디스패치 추가지시(구두)로 전달된 hex 와 **실제 `design-tokens.md`·브랜드 팩의 hex 가 다릅니다.**

| 역할 | 디스패치 구두 지시 | **design-tokens.md + 브랜드 팩(실측)** |
|---|---|---|
| violet (Primary) | `#7c3aed` | **`#6B5CFF`** |
| blue (기록) | `#3b82f6` | **`#3478F6`** |
| teal (자동화) | `#14b8a6` | **`#18A999`** |
| coral (담당자) | `#f97316` (주황) | **`#F26B5E`** (코랄) |
| success | `#22c55e` | **`#16A34A`** |
| warning | `#eab308` | **`#D97706`** |
| error | `#ef4444` | **`#DC2626`** |

**현재 코드는 오른쪽(브랜드 팩) 값을 씁니다.** 근거:
1. `design-tokens.md` 는 스스로를 "앱 적용 정본"이라 명시하고 "값 변경은 이 파일(기획2)에서만" 이라 규정.
2. 같은 값이 `moawork-color-tokens.css`(브랜드 v1.1 팩)에도 동일하게 존재.
3. **결정적 근거 — 로고 SVG 에 그 색이 물리적으로 박혀 있음**:
   `moawork-lockup-light.svg` 의 `fill` 실측 = `#3478F6`, `#18A999`, `#6B5CFF`, `#191A1E`.
   왼쪽 값을 쓰면 **UI 색과 로고 색이 어긋납니다**(같은 화면에서 다른 파랑/보라가 됨).

또한 왼쪽 7개 값은 전부 Tailwind 기본 팔레트 색(violet-600·blue-500·teal-500·orange-500·
green-500·yellow-500·red-500)과 일치 — 브랜드 팩이 아니라 일반 팔레트로 보입니다.

→ **기획2 확인 요청**: 브랜드 팩(`#6B5CFF` 계열)이 정본이 맞으면 현행 유지, 끝.
   만약 팔레트를 실제로 교체하려는 것이라면 **로고 SVG 재발행이 함께 필요**합니다.

## 처리 완료 ✅

| 항목 | 결정 | 반영 |
|---|---|---|
| 제품명 표기 | **`MoaWork`** 카멜케이스 고정 (design-tokens §5 / O1·DI-2) | `lib/product.ts` `PRODUCT_NAME` |
| 디자인 토큰 정본 | `--mw-*` (design-tokens.md §1) — 컴포넌트 hex 금지 | `app/src/app/globals.css` |
