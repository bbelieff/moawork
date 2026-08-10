# 디스패치 프롬프트 — B1b: 구글 로그인 버튼 배선 (T03, 최우선)

> 작성 2026-07-22 기획-Cowork. **인프라는 belie/Cowork가 전부 끝냈다. 남은 건 앱 코드뿐.**
> 착수 전 session-registry 자기행 갱신 + 기존물 검색(coordination README §다중 세션).

## 실측 근거 (2026-07-22 검증됨)

```
GET https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/authorize?provider=google
→ 302 accounts.google.com/v3/signin/identifier
   client_id=81243211765-aotr01j6lltqg59n90p9brv0ffm0pk3g.apps.googleusercontent.com
   redirect_uri=https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback
   scope=email profile
   response_type=code
```
→ **Supabase Google provider = 활성. Client ID/Secret 저장됨. 구글 클라이언트 정상.**
→ 현재 `https://www.moa-work.com/login` 은 여전히 dev-session 3버튼만 렌더하고,
   화면에 "구글 OAuth 는 Supabase 연결 후 활성화됩니다" 문구가 남아 있음 = **UI 미배선**.

## 목표

로그인 화면에 구글 로그인을 붙이고, 콜백에서 조직·역할·플랫폼관리자까지 세팅한다.

## 구현

1. **Supabase 클라이언트 (env)**
   - `NEXT_PUBLIC_SUPABASE_URL=https://srtvmpcosekduvsscsyz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<Project Settings→API>` — **Vercel 환경변수로 주입**(레포 커밋 금지)
   - `@supabase/ssr` 로 브라우저/서버 클라이언트 분리(App Router 규약)

2. **로그인 화면** `app/(auth)/login/page.tsx`
   - 최상단에 **「Google로 계속하기」 1차 CTA** (브랜드 v1.0 Work Blue `--mw-blue`, Coral 금지)
   - 호출: `supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: `${origin}/auth/callback` } })`
   - dev-session 3버튼은 **아래로 내리고 `개발용` 라벨 + `NODE_ENV!=='production'` 조건부 렌더**
     (프로덕션에서 데모계정 노출은 보안 이슈 — 지금 www.moa-work.com에 그대로 노출 중)
   - "Supabase 연결 후 활성화됩니다" 문구 제거

3. **콜백 라우트** `app/auth/callback/route.ts`
   - `exchangeCodeForSession(code)` → 세션 쿠키 설정 → `/` 리다이렉트
   - 실패 시 `/login?error=` 로 회수

4. **최초 로그인 프로비저닝** (서버, 005 배선 — B1 §4b)
   ```
   email = user.email
   role  = await supabase.rpc('app_admin_role', { p_email: email })   // SECURITY DEFINER
   if (role != null) → 플랫폼 관리자: 데모조직 owner 로 org_members upsert + is_platform 플래그
   else             → 기존 온보딩(조직 생성/초대 수락) 흐름
   ```
   - `user1@example.com` 이 owner + 관리자 UI 노출되면 성공
   - 대소문자 무관(함수가 `lower()` 처리) — 재검증 불필요

5. **세션 컨텍스트 통합**
   - 기존 dev-session `getSession()` 인터페이스를 **그대로 유지**하고 구현만 Supabase로 교체
   - 현재 대시보드의 `보기 역할(개발용) owner/admin/member` 토글은 **개발 전용으로 격리**(프로덕션 숨김)

## 수용기준

- [ ] `www.moa-work.com/login` 에 「Google로 계속하기」 노출, 클릭 시 구글 계정 선택 화면
- [ ] 로그인 후 `/` 대시보드 진입, 새로고침해도 세션 유지
- [ ] `user1@example.com` 로그인 시 **owner + 플랫폼 관리자** 자동 부여(005 실검증)
- [ ] 프로덕션 빌드에서 dev-session 버튼·역할토글 **미노출**
- [ ] 375px 폭 무깨짐(공통 반응형 요구)
- [ ] anon key가 레포에 커밋되지 않음

## 금지

- 스키마 수정(001~005). 색 하드코딩. Client Secret을 코드/로그/레포에 기록.
- 보드 내부화면(T02)·커스텀필드(T05)·정산(T09) 침범.

## 참고 — 인프라 정본

| 항목 | 값 |
|---|---|
| GCP 프로젝트 | `moa-work` (user1@example.com) |
| 동의화면 | 앱이름 `MoaWork` · 외부 · **프로덕션 게시** |
| Client ID | `81243211765-aotr01j6lltqg59n90p9brv0ffm0pk3g.apps.googleusercontent.com` |
| 리디렉션 | `https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback` |
| 요청 scope | `email profile` (민감범위 없음 → 구글 검증 불필요) |
| 서비스계정 | `user1@example.com` (Phase2용, 키 없음) |

## 알려진 이슈 (차단 아님 · 파킹)

구글 계정 선택 화면 문구가 **"계속하려면 srtvmpcosekduvsscsyz.supabase.co(으)로 이동"** 으로 뜬다.
Supabase 경유 OAuth의 구조적 특성(사용자에게 보이는 도메인 = Supabase 프로젝트 URL).
해소 방법은 **Supabase Custom Domain 애드온**(auth.moa-work.com) 뿐 — 유료·P2 판단 사항.
기능에는 영향 없음. `docs/plans/active/` 파킹랏에 기록하고 지금은 넘어간다.
