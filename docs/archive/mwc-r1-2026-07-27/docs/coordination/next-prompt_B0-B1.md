# 디스패치 프롬프트 — B0(공용/T01) · B1(T03)  [post-004]

> 작성: 기획-Cowork 2026-07-21. 디스패치 세션이 해당 트랙에 붙여넣어 배분.
> 공통: coordination README §다중 세션 규칙 준수. 착수 전 session-registry 자기행 갱신. 커밋은 자기 브랜치 feat/*, T10 검수 통과분만 main. 실DB=Supabase(ref srtvmpcosekduvsscsyz, 001~004 적용됨). 색·로고=`brand/assets/MoaWork-Nplus-O-logo-pack-v1.1/moawork-color-tokens.css`.

## B0 — Vercel 워크어라운드 회수 (공용/T01, 최우선·간단)
```
목표: Vercel 빌드에서 임시로 넣은 Install Command 오버라이드(`npm install --prefix=.. && npm install --no-save -D vitest`)를 제거하고 정식화한다.
원인: app 워크스페이스 typecheck가 vitest.config.ts를 타입체크하는데 vitest가 app devDeps에 없어 빌드 실패했음.
할 일(둘 중 하나):
 (A) app/package.json devDependencies에 "vitest":"^2" 추가(루트 버전과 일치) → 커밋.
 (B) 또는 app/tsconfig.json에서 vitest.config.ts를 exclude.
그 후: Vercel Project Settings→Build→Install Command 오버라이드를 지우고 기본값 복귀(디스패치/Cowork가 대시보드에서). main 머지 후 기본설정으로 빌드 성공 확인.
수용기준: Vercel 오버라이드 없이 빌드 green, www.moa-work.com 정상.
금지: 다른 워크스페이스 손대기.
```

## B1 — 앱 셸 v0.3 + 인증 + RLS 침투테스트 (T03)
```
목표: docs/design/UI목업_모아워크셸_v0.3.html 을 실제 앱 셸로 구현하고, Supabase 인증·조직격리를 실DB로 확정한다.
읽기: UI목업_모아워크셸_v0.3.html(1단 사이드바 10메뉴·다크/라이트), brand v1.0 토큰css, 001·003·004 스키마(orgs·org_members·RLS 헬퍼 is_org_member/org_role/org_scope).
구현:
 1) 앱 셸: app/(app)/layout.tsx 1단 사이드바(대시보드/신규업체/컨택업체/업무관리/업체관리/공지사항/멤버관리/거래처등록/이달의계약회사/회계/추가서비스), 상단바(검색·알림·다크토글). 색은 moawork-color-tokens.css import(하드코딩 금지). 로고 SVG는 brand 팩에서.
 2) 다크/라이트: data-theme 토글 + prefers-color-scheme, 브랜드 Dark 토큰.
 3) 인증: 구글 OAuth(Supabase Auth). Google Cloud OAuth 클라이언트·redirect(https://www.moa-work.com, http://localhost:3000) 등록은 belie 액션으로 decision-inbox에 남기고, 코드는 dev-session 폴백 유지.
 4) 조직/권한: org_members 기반 세션 컨텍스트(role·scope), <FeatureGate>·서버 entitlement 검사.
 4b) **관리자 자동부여(005)**: 구글 로그인 성공 시 서버에서 `select public.app_admin_role(<user.email>)` 호출 → non-null이면 그 사용자를 owner + 플랫폼 관리자로 자동 승격(조직 생성/합류 시 owner, is_platform이면 관리자 UI 노출). user1@example.com 예약됨. dev-session 폴백에도 이 이메일이면 관리자로.
 5) **RLS 침투테스트(T10과 공동)**: 조직 A 세션으로 조직 B의 companies/deals SELECT=0건, member+assigned=본인 담당만 — 실 Supabase에 대해 자동테스트.
수용기준: 로그인→온보딩→홈. 다른 조직 데이터 절대 안 보임(실DB RLS). 다크모드 토큰 일치. Vercel 배포 반영.
금지: 보드 내부화면(T02)·커스텀필드(T05)·정산(T09) 침범. 색 하드코딩. 001~004 스키마 수정.
```
