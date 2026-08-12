# BBE-148 — 발송 안전장치 · 화면 확인 증거

**세션 [모아워크 NC 04] · 2026-08-12 · 브랜치 `feat/bbe-148-send-guard`**

> 서명 정정 — 이 문서를 만든 세션은 **NC**(노트북 클로드) 04 다. 초판에 «DC 04» 로 적은 것은 오기다.
> 카드에 붙은 라벨 `DC-04` 는 손대지 않았다(배정 변경은 총괄 소유 — §4·§6.2).

---

## 무엇을 찍었나

`app/src/components/send-guard/SendConfirmDialog.tsx` 를 **제품의 실제 스타일시트**
(`app/src/app/globals.css`)로 렌더한 그림이다. 스크린샷용 별도 css 를 만들지 않았다 —
미리보기에서만 예쁜 그림은 증거가 아니다.

| 파일 | 뷰포트 |
| --- | --- |
| `evidence-1440.png` | 1440px (기준 뷰포트) |
| `evidence-375.png` | 375px (AGENTS.md §9.3 — 면제 폐기) |

세 가지 상황을 한 장에 담았다.

1. **셀 하나** — 값을 바꾸면 즉시 안 나가고 확인 화면을 지난다. 건수 입력은 요구하지 않는다.
2. **대량(3건 · 제외 2건)** — 건수를 직접 입력해야 보내기가 눌린다. 제외는 사유별로 따로 셈한다.
3. **보낼 건 0** — 보내기 버튼이 죽어 있고, 나가지 않을 문장을 «실제로 나갈 문장» 이라고 띄우지 않는다.

## 다시 만드는 법 (검수자용)

```bash
git fetch origin && git checkout <PR head SHA>
npm install
node docs/design/preview-send-guard.mjs
# → docs/design/round-BBE-148/send-guard-preview.html      (1440px 확인용)
# → docs/design/round-BBE-148/send-guard-preview-375.html  (375px 촬영용 iframe 껍데기)
```

생성물(HTML)은 커밋하지 않는다 — 명령 한 줄로 다시 만들어진다. 그림(PNG)만 남긴다.
브라우저가 없는 검수 세션은 PNG 를 그대로 보면 된다.

## 왜 라우트가 아니라 하네스인가

- 이 카드가 만든 것은 **부품**이다. 자기 주소가 없다. 탭 화면은 DC-03 소유라 여기서 만들지 않는다.
- 로컬 `(app)` 셸은 `.env` 의 `NEXT_PUBLIC_SUPABASE_URL`·`ANON_KEY` 가 **빈 값**이라
  어느 주소로 가도 500 이다 (2026-08-11 부터 알려진 갭 · belie 가 채워야 풀린다).
  이 카드의 변경 때문이 아니다.
- 그래서 «제품 컴포넌트 + 제품 스타일시트» 를 그대로 렌더하는 하네스를 만들었다.
  검수자가 같은 명령으로 같은 그림을 다시 만들 수 있다 (AGENTS.md §5 — 원격에서 받아서 본다).

## 촬영 방법 메모

윈도우 크롬은 창 폭을 약 500px 아래로 줄이지 않는다. `--window-size=375` 로 찍으면
**레이아웃은 더 넓게 잡히고 그림만 375 로 잘린다.** 처음 찍은 375 그림이 실제로 잘려 있었다.
그래서 `send-guard-preview-375.html` 이 본문을 폭 375px 짜리 `iframe` 에 넣는다 —
iframe 은 CSS 폭이 곧 내부 뷰포트라 375 가 정확히 만들어진다.

```powershell
chrome --headless=new --hide-scrollbars --window-size=1440,2700 `
  --screenshot=evidence-1440.png  file:///.../send-guard-preview.html
chrome --headless=new --hide-scrollbars --window-size=375,2900 `
  --screenshot=evidence-375.png   file:///.../send-guard-preview-375.html
```

## 이 그림에 나오는 값에 대하여

업체명·대표자명·전화번호는 **전부 예시**다. 제품 코드·프리셋·시드에 들어가지 않는다
(D71~D75). 문구 템플릿도 특정 회사 이름을 담지 않는다 — 보내는 회사 이름은
`{보내는회사}` 변수로 워크스페이스에서 온다.

**이 하네스는 아무것도 발송하지 않는다. 네트워크를 열지 않는다.**
발송 통로는 «보존하되 활성화 금지» 다 (BBE-30) — `assertDispatchAllowed()` 가 항상 던진다.
