# 결함 리포트 — 구글 로그인 후 권한·잠금 (MWC 초안)

> 실측 2026-07-27 · MWC(코워크) 브라우저 검증 · 환경: 프로덕션 `https://www.moa-work.com`
> 계정: `user1@example.com` (005에서 owner·is_platform 예약된 계정)
> ※ MWC 초안 — canonical 반영은 코덱스가 판단. **코드·브랜치 미터치.**

---

## ✅ 정상 확인된 것

1. **구글 OAuth 왕복 성공** — `/login` → 계정 선택(`계정을 선택하세요`) → `/auth/callback` → `/` 진입.
   - 인가 URL 실측: `client_id=81243211765-aotr01j6…`, `redirect_uri=…supabase.co/auth/v1/callback`, `redirect_to=https://www.moa-work.com/auth/callback?next=%2F`, `scope=email profile`.
2. **세션 유지** — 새로고침 후에도 로그인 상태 유지.
3. **앱 셸 렌더** — 사이드바 10메뉴·상단바·조직 표기(`MoaWork 데모 조직 · 워크스페이스`)·브랜드 적용.
4. **콘솔 에러 0** — JS 크래시 아님. 서버·데이터 상태 문제.

---

## ❌ 결함 1 (P0) — 로그인 후 역할이 해소되지 않음

**증상**: 좌하단 사용자 영역에 **`회사 역할 확인 중 · 회사 소속 범위를 확인 중이에요`** 가 **영구 표시**(새로고침·재진입에도 동일). 로딩 스피너가 아니라 고착 상태.

**영향**: 역할 미해소 → **사이드바 전 메뉴 잠금(🔒)** → 로그인해도 아무것도 못 함. 실질 **사용 불가**.

**기대**: `005_app_admins.sql` 배선대로, 로그인 시 서버가 `select public.app_admin_role(user.email)` 호출 → non-null(`owner`)이면 **owner + 플랫폼 관리자 자동 부여**.
- DB 검증 완료(2026-07-21): `user1@example.com | owner | is_platform=true`, 대소문자 무관 조회 OK.
- 즉 **DB는 정상, 앱 배선(B1 §4b)이 미작동 또는 미구현**으로 추정.

**의심 지점**(코덱스 확인 요망)
- 콜백/세션 초기화에서 `app_admin_role` RPC 미호출
- 호출하나 실패를 삼킴(에러 무시 → "확인 중"에 고착)
- `org_members` upsert 누락 → 역할·scope 조회 결과 없음
- RLS로 `app_admins` 직접조회 차단됨(의도된 설계) → **반드시 SECURITY DEFINER 함수 경유**해야 함. 테이블 직접 select 시 0건 → 이 증상과 일치.

---

## ❌ 결함 2 (P1) — MVP 기능이 "Phase 2 잠김"으로 오분류

**증상**: 홈 본문에 **`🔒 대시보드(core.dash) — 현재 플랜에서 잠긴 기능입니다 (Phase 2)`**.

**기대**: 기획 정본상 **`core.dash` = MVP ✅**(Phase 2 아님). 또한 **MVP 기간에는 전 조직 전 기능 `enabled`(무료 베타)** 가 원칙.

**추정 원인**: `org_entitlements` 시드 누락 또는 기본값이 "잠금"으로 동작. 결함 1(역할 미해소)의 부수 효과일 가능성도 있음 — 역할이 없어 entitlement 조회가 빈 결과 → 전부 잠금 처리.

**권고**: 원인이 하나(역할 미해소)인지, 별개(엔타이틀먼트 시드)인지 먼저 분리 확인.

---

## 재현 절차

1. `https://www.moa-work.com/login` 접속 → `Google로 계속하기`
2. `user1@example.com` 선택
3. `/` 진입 후 좌하단·본문 확인

## 수용기준 (수정 완료 판정)

- [ ] `user1@example.com` 로그인 시 좌하단에 **역할 = 오너**(플랫폼 관리자 표기 포함) 노출, "확인 중" 사라짐
- [ ] 사이드바 잠금(🔒) 해제 — 최소 MVP ✅ 메뉴(대시보드·신규업체·컨택업체·업무관리·업체관리·공지사항·멤버관리·거래처등록·이달의 계약회사·회계) 진입 가능
- [ ] 홈에서 `core.dash` 위젯 정상 렌더(“Phase 2 잠김” 문구 소거)
- [ ] 역할 해소 실패 시 **조용히 고착되지 않고** 오류 노출·재시도 경로 제공
- [ ] 375px 폭 무깨짐 유지

## 참고

- 관련 지시서: `next-prompt_B0-B1.md` §4b(관리자 자동부여), `next-prompt_B1b_구글로그인버튼.md` 4항
- 마이그레이션: `005_app_admins.sql` (`app_admins` + `app_admin_role(email)` SECURITY DEFINER)
- 검증자: MWC(외부 레인). 코드 수정은 코덱스 레인.
