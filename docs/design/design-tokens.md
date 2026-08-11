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

---

# v2 확장 — 밀도 · 타이포 · 간격 (2026-08-10 · 총괄)

> §1~§6(색·로고)은 그대로 유효하다. 여기서 **없어서 문제가 됐던 것**을 채운다.
> 배포판 피드백(belie 2026-08-10): *"여백이 너무 많고 글씨도 커서 둔해 보인다. 목업 정도의 간격이 좋다."*
> 원인: 색 토큰만 있고 **타이포·간격·밀도 토큰이 없어** 트랙마다 임의값을 썼다.

## 7. 밀도 원칙

모아워크는 **업무용 표 도구**다. 마케팅 페이지가 아니다.
같은 화면에서 **한 눈에 더 많은 행**을 보는 것이 편안한 여백보다 중요하다.

| | 값 | 왜 |
| --- | --- | --- |
| 기준 뷰포트 | 1440px | PC 우선. 375/390 검증 면제 |
| 표 행 높이 | **32px** (기본) / 36px (여유) | 화면당 20행 이상 |
| 표 머리글 | 28px | 행보다 낮게 |
| 본문 글자 | **13px** | 14px는 표에서 크다 |
| 표 셀 글자 | 12.5px | |
| 아이콘 | 16px · 굵기 1.5 | 이모지 금지(§10) |
| 최소 클릭 영역 | 28px | 표 안. 표 밖 버튼은 30px |

## 8. 간격 스케일 — 4px 배수만

```css
--sp-1:4px;  --sp-2:8px;  --sp-3:12px; --sp-4:16px;
--sp-5:20px; --sp-6:24px; --sp-8:32px; --sp-10:40px;
```

**중간값 금지**(10px·14px·18px 등). 애매한 값이 화면마다 다른 리듬을 만든다.

| 자리 | 값 |
| --- | --- |
| 셀 좌우 여백 | `--sp-3` (12px) |
| 카드 안쪽 | `--sp-3` `--sp-4` |
| 화면 좌우 | `--sp-5` (20px) |
| 카드 사이 | `--sp-3` |
| 아이콘–글자 | `--sp-2` |

## 9. 타이포 스케일

```css
--fs-11:11px; --fs-12:12px; --fs-13:13px; --fs-14:14px;
--fs-16:16px; --fs-18:18px; --fs-22:22px;
--lh-ui:1.35;  --lh-prose:1.7;
--ls-tight:-0.01em;   /* 14px 이상에 적용 */
```

- 글꼴: **Pretendard** → `-apple-system` → `Malgun Gothic` 순. 한글 UI에서 가장 안정적.
- 굵기는 **400 / 600 두 단계만.** 500·700 섞지 않는다.
- 숫자는 `font-variant-numeric: tabular-nums` — 금액 열이 흔들리지 않게.
- 제목에만 `--ls-tight`. 12px 이하에는 자간 조정 금지.

| 역할 | 크기 / 굵기 |
| --- | --- |
| 화면 제목 | 18 / 600 |
| 섹션·카드 제목 | 13 / 600 |
| 본문 | 13 / 400 |
| 표 셀 | 12.5 / 400 |
| 표 머리글 · 라벨 | 11 / 600 · 색 `--t-3` |
| 배지·칩 | 11 / 600 |

## 10. 아이콘 — 이모지 금지

**이모지를 UI 아이콘으로 쓰지 않는다.** 기기·OS마다 모양이 달라지고, 제품이 급조된 인상을 준다.

- 16px · 선 굵기 1.5 · `currentColor` · 채우기 없음(monoline)
- SVG 심볼 시트 1벌을 두고 `<use href="#i-…">` 로 참조
- **예외**: 먼데이에서 가져온 아이템 이름 안의 이모지(`💡신규고객`)는 **데이터**다. 지우지 않는다.

## 11. 테두리 · 모서리 · 그림자

```css
--bd:#E7E5E0;        /* 기본 실선 1px — 유일한 테두리색 */
--bd-2:#D8D5CE;      /* 강조·호버 */
--r-1:6px;   /* 칩·배지·작은 버튼 */
--r-2:8px;   /* 버튼·입력 */
--r-3:10px;  /* 카드·패널 */
--sh-pop:0 8px 24px rgba(28,25,20,.10), 0 2px 6px rgba(28,25,20,.06);
```

- 그림자는 **떠 있는 것에만**(팝오버·서랍·토스트). 카드·표에는 쓰지 않는다.
- 알약형(999px) 모서리는 **상태 배지에도 쓰지 않는다.** `--r-1` 로 통일 — 과하게 둥글면 장난감처럼 보인다.
- 테두리색은 한 가지만. 회색을 여러 개 쓰면 화면이 지저분해진다.

## 12. 중립색 — 따뜻한 회색

```css
--s-0:#FAF9F7;  /* 페이지 바탕 */
--s-1:#F4F2EF;  /* 옅은 면 */
--s-2:#FFFFFF;  /* 카드·표 */
--t-1:#1C1A17;  /* 본문 */
--t-2:#5C574F;  /* 보조 */
--t-3:#8E877C;  /* 라벨·힌트 */
--t-4:#B5AEA3;  /* 비활성 */
```

기존의 푸른 회색(#f6f7fb 계열)에서 **따뜻한 회색**으로 바꾼다.
브랜드색(violet·blue·teal·coral)이 전부 채도가 높아, 차가운 회색과 만나면 화면이 싸늘해진다.

## 13. 상태 배지 팔레트 (§3-③ 확정본)

보드 상태칩은 **브랜드색과 완전히 분리**한다. 아래 6색만 쓴다.

| 의미 | 배경 | 글자 |
| --- | --- | --- |
| 중립·대기 | `#EFEDE8` | `#514C44` |
| 진행 | `#E4EFFB` | `#1B4F86` |
| 검토·심사 | `#EDEAFB` | `#463C96` |
| 완료·승인 | `#E6F1DF` | `#37600F` |
| 주의·부재 | `#FAEEDA` | `#7A4A0A` |
| 거절·불가 | `#FBE9E7` | `#8F2A22` |

## 14. 적용 순서

1. 이 파일을 정본으로 `app/src/styles/moawork-tokens.css` 생성 — §7~§13 값을 CSS 변수로.
2. `globals.css` 에서 import. 기존 `moawork-color-tokens.css` 는 유지(§1).
3. 각 화면의 하드코딩 px·hex를 변수로 교체. **새 임의값 추가 금지.**
4. 검수 항목에 추가: `grep` 으로 하드코딩 hex·중간값 px 0건 확인.

## 15. 참조 구현

`docs/design/UI목업_워크스페이스_최종_v6.html` 이 §7~§13을 적용한 상태다. 화면 밀도·글자 크기·간격의 판정 기준으로 쓴다.
