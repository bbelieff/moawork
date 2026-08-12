# BBE-105 — 이중 잠금 게이트 · 화면 확인 증거

**세션 [모아워크 DC 04] · 2026-08-12 · 브랜치 `feat/bbe-105-doublelock`(PR #124 인수)**

---

## 무엇을 찍었나

`LockBlockedDialog`·`LockToggleSettingsRow` 를 **제품의 실제 스타일시트**
(`app/src/app/globals.css` + `lock.module.css`)로 렌더한 그림이다.

| 파일 | 뷰포트 |
| --- | --- |
| `evidence-1440.png` | 1440px (기준 뷰포트) |
| `evidence-375.png` | 375px (AGENTS.md §9.3 — 면제 폐기) |

세 가지 상태를 한 장에 담았다.

1. **차단** — 직인 미승인 상태에서 이관 시도. 사유 + «채우러 가기» + «요청 보내기».
2. **설정(켜짐)** — 회사 설정에서 이중 잠금이 켜져 있는 기본 상태.
3. **설정(꺼짐 + 이력)** — D66. 끈 사유가 감사 기록에 남아 행 안에 표시된다.

## 375px 에서 실제로 잡은 결함 1건

첫 촬영에서 켜짐/꺼짐 배지(`토글Switch`)가 좁은 화면에서 **"켜\n짐" 두 줄로 쪼개졌다.**
`.toggleRow` 가 flex 인데 `.toggleCopy`(설명 텍스트)에 `min-width: 0` 이 없어 배지 쪽이
대신 눌렸던 것 — `lock.module.css` 에 `min-width: 0`(설명 칸) · `flex-shrink: 0`
· `white-space: nowrap`(배지)을 추가해 고쳤다. 재촬영으로 확인.

## 다시 만드는 법 (검수자용)

```bash
git fetch origin && git checkout <PR head SHA>
npm install
node docs/design/preview-lock.mjs
# → docs/design/round-BBE-105/lock-preview.html      (1440px 확인용)
# → docs/design/round-BBE-105/lock-preview-375.html  (375px 촬영용 iframe 껍데기)
```

생성물(HTML)은 커밋하지 않는다. 그림(PNG)만 남긴다.

## 왜 라우트가 아니라 하네스인가

- **부품 납품**이다(§3) — `LockBlockedDialog`·`LockToggleSettingsRow` 는 아직 어떤 보드에도
  마운트되지 않았다. 목업의 "리드컨택 → 업무이동" 화면이 `app/src` 에 아직 없다
  (컨택 파이프라인 미머지) — README(`lib/automation/lock/README.md`) 참고.
- 로컬 `(app)` 셸도 `.env` 의 Supabase 값이 빈 값이라 500 이다(기존 갭, 이 카드 탓 아님).

## CSS Modules 렌더 방식

이 컴포넌트는 Tailwind 유틸이 아니라 `lock.module.css`(CSS Modules)를 쓴다. esbuild 는
CSS Modules 클래스명 해싱을 하지 않으므로, `*.module.css` import 를 **각 클래스명을
자기 자신으로 매핑하는 객체**로 치환하는 얕은 플러그인을 썼다(이 페이지 하나에서만
쓰이므로 충돌 걱정이 없다 — 실제 프로덕션 빌드는 Next.js 가 정식으로 해싱한다). 원본 CSS
텍스트를 그대로 페이지에 박아 클래스 선택자가 실제로 맞물리게 했다.

## 렌더 하네스 자체에서 잡은 버그 1건

컴포넌트를 `LockToggleSettingsRow(props)` 처럼 **일반 함수로 직접 호출**하면
`useState` 가 React 렌더 컨텍스트 밖에서 실행돼 dispatcher 가 null 이라 즉시 죽는다
("Cannot read properties of null (reading 'useState')"). 반드시 JSX(`<LockToggleSettingsRow {...props} />`,
즉 `React.createElement`)로 만들어야 훅이 살아 있다 — 스크립트에 그렇게 고쳐서 남겼다.

## 이 그림에 나오는 값에 대하여

담당자 이름(박정화 실장)은 목업에 실제로 등장하는 예시다. 제품 코드·프리셋·시드에는
들어가지 않는다(D71~D75) — 이 하네스는 화면 확인용 스크립트일 뿐 제품 코드가 아니다.
