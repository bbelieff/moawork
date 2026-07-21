# decision-inbox (📥 결정함) — 앱 레포

> 사람(belie)만 할 수 있는 작업을 쌓아두는 곳. 트랙은 멈추지 않고 다른 일을 계속한다.
> 화이트리스트: **실데이터 비가역 / 돈·보안 / 외부 계정·콘솔 / 사용자 정책 전환.**
>
> ⚠ 기획 워크스페이스(`서울리드프로젝트/모아워크/docs/coordination/decision-inbox.md`)에도
> 별도 결정함이 있다. 이 파일은 **앱 레포(github.com/bbelieff/moawork)에서 코드가 막히는 항목**만 다룬다.

## 대기 중 — belie 액션 필요

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

## 처리 완료 ✅

| 항목 | 결정 | 반영 |
|---|---|---|
| 제품명 표기 | **`MoaWork`** 카멜케이스 고정 (design-tokens §5 / O1·DI-2) | `lib/product.ts` `PRODUCT_NAME` |
| 디자인 토큰 정본 | `--mw-*` (design-tokens.md §1) — 컴포넌트 hex 금지 | `app/src/app/globals.css` |
