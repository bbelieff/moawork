# MoaWork — 디자인 토큰 SSOT (앱 적용 정본)

> 유래: `서울리드프로젝트/brand/MoaWork_FINAL_IDENTITY_v1.0.md` + `brand/assets/MoaWork-Nplus-O-logo-pack-v1.1/moawork-color-tokens.{css,json}`.
> 작성: 기획-Cowork 2026-07-21 · 대체: `브랜드-아이덴티티_v0.1`(그린 탐색)은 이력. **제품명 = `MoaWork`(카멜케이스 고정) → O1/DI-2 확정.**
> 원칙(플레이북 UI §2): **arbitrary hex 금지. 아래 `--mw-*` 변수만 참조.** 값 변경은 이 파일(기획2)에서만.

## 1. 색 토큰 (app/globals.css에 그대로 투입)
```css
:root {
  /* 브랜드(로고 팔레트) — moawork-color-tokens와 동일 */
  --mw-work-blue:#3478F6; --mw-flow-teal:#18A999; --mw-moa-violet:#6B5CFF;
  --mw-people-coral:#F26B5E; --mw-fg:#191A1E; --mw-surface:#FFFFFF;
  /* 역할 별칭(의미로 참조) */
  --mw-primary:var(--mw-moa-violet);   /* Primary CTA·브랜드·설정 */
  --mw-record:var(--mw-work-blue);     /* 딜·기록·프로젝트(파이프라인) */
  --mw-automation:var(--mw-flow-teal); /* 자동화·연결·흐름 */
  --mw-people:var(--mw-people-coral);  /* 담당자·댓글·멘션 — UI 전용 */
  /* UI 상태색(브랜드·코랄과 분리, WCAG AA) */
  --mw-success:#16A34A; --mw-warning:#D97706; --mw-error:#DC2626; --mw-info:var(--mw-work-blue);
}
[data-theme="dark"]{
  --mw-work-blue:#6EA0FF; --mw-flow-teal:#47CFBC; --mw-moa-violet:#8A7CFF;
  --mw-people-coral:#FF8A80; --mw-fg:#F7F8FA; --mw-surface:#111216;
  --mw-success:#4ADE80; --mw-warning:#FBBF24; --mw-error:#F87171;
}
```

## 2. shadcn/ui 매핑
`--background`→`--mw-surface` · `--foreground`→`--mw-fg` · `--primary`→`--mw-primary`(전경 #FFF) · `--ring`→`--mw-primary` · `--destructive`→`--mw-error`. 나머지 중립(그레이 스케일)은 표준 shadcn 값 유지.

## 3. 색 경계 규칙 (3층 분리 — 절대 섞지 말 것)
1. **브랜드색**(violet/blue/teal): 로고·Primary CTA·역할 강조. **People Coral은 UI 전용**(담당자·멘션·협업 알림) — **로고 내부·주 CTA·오류 상태 사용 금지**.
2. **UI 상태색**(success/warning/error/info): 시스템 피드백 전용. 오류=빨강(코랄 아님).
3. **보드 상태칩 색**(먼데이 패리티): 상담상황 16종·계약상황 등 `002 board_columns` 선택지 = **먼데이식 고정 6~8색 팔레트(별도)**. **브랜드색·상태색을 상태칩에 쓰지 말 것**(혼동 방지).

## 4. 로고·에셋 배치 (트랙이 앱에 복사)
소스: `서울리드프로젝트/brand/assets/MoaWork-Nplus-O-logo-pack-v1.1/`

| 소스 파일 | 앱 위치 | 용도 |
|---|---|---|
| `moawork-favicon.ico` | `app/favicon.ico` | 파비콘 |
| `moawork-icon-light-transparent-192.png` / `-darkmode-192` | `public/icons/` + manifest | PWA 아이콘 |
| `moawork-app-icon-*-512.png` | `public/icons/` | 앱아이콘·아바타 폴백 |
| `moawork-lockup-light.svg` / `-dark.svg` | `components/brand/` | 헤더·로그인 로고(락업) |
| `moawork-symbol-light.svg` / `-dark.svg` | `components/brand/` | 좁은 UI·사이드바 접힘 |
| `moawork-color-tokens.css` | `app/`(참조) | §1과 동기화 |

- `Logo`·`Symbol` 컴포넌트로 감싸 **테마별 자동 전환**(light/dark). 밝은 배경=light, 어두운 배경=dark.

## 5. 사용 규칙(로고)
락업 최소 너비 **120px** · 심볼 최소 **16px** · 보호공간 **심볼 25%** · 모듈 순서·각도·간격 변경 금지 · 그라데이션·그림자·외곽선·회전 금지 · 컬러 불가 시에만 mono. 표기 **`MoaWork`**(MOAWORK·Moawork 금지). 코드 제품명 = 단일 상수 `PRODUCT_NAME="MoaWork"`.

## 6. 디스패치
- **T03(공용 테마/파운데이션)**: §1 토큰 → `app/globals.css`, `PRODUCT_NAME` 상수, `Logo`/`Symbol` 컴포넌트, 파비콘·manifest 연결. (공용부 단독 선행)
- **전 UI 트랙(T02·T04·T05)**: `--mw-*` 변수만 사용(하드코딩 hex 금지). 보드 상태칩은 §3-③ 팔레트.
- 에셋 실제 복사·커밋은 트랙 클론에서(오케스트레이터는 git 미실행). 브랜드 원본은 `brand/`에 그대로 보존.
