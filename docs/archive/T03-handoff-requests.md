# T03 → 디스패치 회수용 요청 묶음

> ❄️ **2026-08-05 동결. 신규 기록은 Linear 코멘트로. 과거 기록 보존용.**
> 근거: `docs/plans/system-audit-2026-08-05.md`

> 작성 T03 · 2026-07-30 · 근거 브랜치 `feat/t03-r1-entry-ux`(PR #57)
> 디스패치가 이 파일을 회수해 해당 트랙/사람에게 배분한다. 각 항목은 **그대로 붙여넣을 수 있는 프롬프트**다.
> ⚠️ `docs/coordination/**` 은 원칙상 디스패치 단독 writer다. 이 파일은 **회수 전용 인박스**로 T03이 한 번 쓰고,
> 이후 갱신은 디스패치가 판단한다(내용 이관 후 삭제해도 무방).

---

## HO-1 · belie 액션 (사람만 가능, 코드 아님) — **최우선**

```
[belie 액션 요청 — T03]

■ A. 마이그레이션 3개 실DB 적용 (ref srtvmpcosekduvsscsyz)
   PR #57 머지 후, Supabase SQL Editor 또는 CLI 로 순서대로 적용:
     016_entry_request_dedup.sql
     017_fix_is_platform_admin_role_axis.sql
     018_platform_admin_direct_create.sql

   ⚠️ 016 은 실데이터를 건드립니다. 사용자당 pending 'create' 요청이 여러 건이면
      최신 1건만 남기고 나머지를 status='cancelled' 로 내립니다(삭제 아님, 이력 보존).
      적용 전 확인용 쿼리:
        select requester_user_id, count(*)
        from workspace_entry_requests
        where kind='create' and status='pending'
        group by 1 having count(*) > 1;
      결과가 0행이면 정리 대상이 없습니다.

   ※ 017 미적용 상태로도 belie 로그인은 풀립니다(앱 폴백 배선 완료).
     다만 017 을 적용해야 DB 함수가 정상화되고 폴백이 no-op 이 됩니다.

■ B. Supabase 접속정보 주입 (RLS 침투테스트 판정용)
   app/.env.local 에 직접 입력(채팅·커밋에 붙여넣지 마세요):
     NEXT_PUBLIC_SUPABASE_URL=https://srtvmpcosekduvsscsyz.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=<Dashboard → Settings → API → anon public>
   교차검증 테스트 계정(있으면 판정까지 자동 실행):
     RLS_TEST_ORG_A_EMAIL / RLS_TEST_ORG_A_PASSWORD / RLS_TEST_ORG_B_ID
     RLS_TEST_MEMBER_EMAIL / RLS_TEST_MEMBER_PASSWORD  (선택, scope=assigned 사용자)
   현재 이 값들이 없어 침투테스트 5건이 skip 중입니다
   → 수용기준 "다른 조직 데이터 절대 안 보임"은 아직 미검증입니다.

■ C. Vercel Deployment Protection (선택)
   프리뷰가 Vercel SSO 로 잠겨 있어 에이전트가 브라우저 검증을 못 합니다.
   프리뷰만 공개(또는 bypass token)로 열어주시면 이후 PR 은 제가 직접 클릭스루 검증합니다.

■ D. Google OAuth 클라이언트 (이미 완료됐다면 무시)
   승인된 리디렉션 URI: https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback
   승인된 원본: https://www.moa-work.com , http://localhost:3000
   Supabase → Authentication → URL Configuration 의 Site URL / Redirect URLs 도 동일하게.
```

---

## HO-2 · T10(게이트키퍼) — 배포 후 수용기준 판정

```
[T10 검수 요청 — T03/PR #57]

PR #57 이 main 에 들어가고 위 마이그레이션이 적용된 뒤, 아래를 실측 판정해 주세요.
저(T03)는 실DB 크리덴셜이 없어 정적 검증(check.sh 초록)까지만 했습니다.

■ 판정 항목 (전부 프로덕션 www.moa-work.com 기준)
 [ ] 1. beliefkimkim@gmail.com 로그인 → 소속 0이면 /platform 도달
 [ ] 2. 진입 화면에서 [⚙ 플랫폼 관리로 가기] 로 탈출 가능
 [ ] 3. 플랫폼 관리자가 만든 회사는 pending 없이 즉시 생성 + 바로 입장
        → DB 확인: workspace_entry_requests.decision_code = 'platform_admin_direct_create'
        → 감사: workspace_entry_events.metadata 에 platform_admin_direct_create=true, self_approved=true
 [ ] 4. 일반 사용자 흐름·문구 변화 없음 (회귀)
        → 소속 0 일반 사용자는 여전히 /workspace-entry, pending 문구 동일
 [ ] 5. 비관리자 화면에 플랫폼 버튼 **마크업 부재**(숨김이 아니라 없음)
        → 페이지 소스에 href="/platform" 이 없어야 함
 [ ] 6. 오너 권한 고착 해소: belie 가 자기 회사에서 역할이 "대표"로 보이고 관리 가능
 [ ] 7. 사이드바 메뉴 잠금 풀림 (MVP 기능 전부 열림)

■ 017 적용 전/후 비교 요청 (폴백이 실제로 작동하는지)
  017 적용 **전**에도 1·2 가 통과해야 합니다(앱 폴백 배선).
  적용 **후**에는 DB 함수가 직접 true 를 주고 폴백은 호출되지 않습니다.
  가능하면 두 시점 모두 확인해 주세요 — 폴백이 죽어 있으면 017 의존이 남습니다.

■ 참고: 제 진단은 스키마·코드 경로 추적 기반이며 실환경 실행 검증은 없습니다.
        1·6·7 이 실패하면 원인이 제 진단과 다른 것이므로 즉시 알려주세요.
```

---

## HO-3 · 기획2 — 미회신 결정 2건

```
[기획2 결정 요청 — T03]

■ DI-A4 (재요청) 디자인 토큰 hex 정본 확정
  구두 지시 hex 와 브랜드 팩/로고 SVG 실측값이 다릅니다. 코드는 브랜드 팩 값을 씁니다.
    violet #7c3aed vs **#6B5CFF** / blue #3b82f6 vs **#3478F6**
    teal #14b8a6 vs **#18A999** / coral #f97316 vs **#F26B5E**
  근거: moawork-lockup-light.svg 의 fill 실측 = #3478F6, #18A999, #6B5CFF.
        구두값을 쓰면 UI 색과 로고 색이 한 화면에서 어긋납니다.
        또 구두값 7개는 전부 Tailwind 기본 팔레트(violet-600·blue-500…)와 일치합니다.
  → 브랜드 팩이 정본이면 "현행 유지"로 회신만 주세요(코드 변경 0).
    팔레트를 실제로 교체하려면 **로고 SVG 재발행이 함께** 필요합니다.

■ DI-A5 (신규) app_admins.role 의미 확정
  005 는 role 을 "가입 시 부여할 tenant 역할"(default 'owner')로 정의하고,
  006 의 is_platform_admin() 은 그 값을 "플랫폼 등급"으로 읽어 role='admin' 을 요구했습니다.
  → 이 불일치가 belie 가 어드민에 못 가던 근본원인입니다.
  017 에서 **플랫폼 축 = is_platform 컬럼** 으로 확정했습니다.
  향후 플랫폼 등급을 여러 단계로 나눌 계획이 있으면(예: super/ops/readonly)
  role 을 재사용하지 말고 **별도 컬럼**을 추가해 주세요. 확인 회신 부탁드립니다.
```

---

## HO-4 · 스키마 오너/T10 — 마이그레이션 번호 충돌 방지

```
[프로세스 개선 제안 — T03]

■ 사실: 마이그레이션 번호 충돌이 반복 발생합니다.
  이번에도 제 014_entry_request_dedup 이 main 의 014_platform_metrics_daily 와 충돌해
  016 으로 리넘버링했습니다(커밋 직전 재실측으로 잡음). 놓쳤으면 적용 순서가 깨집니다.

■ 원인: 트랙들이 origin/main 을 분기한 뒤 각자 "다음 번호"를 계산하므로,
        동시 작업 시 같은 번호를 두 트랙이 집습니다. 3자리/4자리 혼재(001_ vs 0001_)도 남아 있습니다.

■ 제안 (택 1, 디스패치/스키마 오너 판단):
  (A) 번호 예약제 — 디스패치가 트랙에 번호 블록을 선할당(T03=017~019 등).
  (B) 타임스탬프 프리픽스 — 20260730_1130_xxx.sql 로 전환해 충돌 자체를 제거.
  (C) 현행 유지 + 규칙 명문화 — "커밋 직전 origin/main 재실측 후 확정" 을 CLAUDE.md 에 등재.

  저는 (C)를 최소 조치로, (B)를 근본 해결로 봅니다. 결정해 주시면 T03 이 문서화까지 하겠습니다.
```

---

## 참고 — T03 이 요청 없이 자체 해소한 것 (타 트랙 액션 불요)

| 항목 | 처리 |
|---|---|
| 오너 권한 고착 | `presentation.ts` 의 잔재 가림막 제거 + 회귀테스트 |
| 사이드바 전 메뉴 잠김 | `lib/entitlements/{resolve,server}.ts` — MVP 기본 ON, 조회 실패도 기본값 수렴 |
| 플랫폼 라우팅 | `decideWorkspaceDestination` 3번째 인자 + callback RPC 판정 |
| 진입 탈출구 | operator 뷰에 `[⚙ 플랫폼 관리로 가기]`(비관리자 마크업 부재) |
| **017 의존 제거** | `readWorkspaceEntryContext` 폴백 — 마이그레이션 적용 전에도 관리자 인식 |
| create 중복 요청 | `016` 부분 유니크 인덱스 |
| 관리자 직접 생성 | `018` + 앱 `redirectTo` 배선 |
