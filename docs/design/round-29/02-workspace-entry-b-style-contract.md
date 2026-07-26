# Workspace Entry B Family — Style Contract

> WORK-ID: `WORKSPACE-ENTRY-B-STYLE-CONTRACT-01`
> 역할: T02 style-contract worker
> 상태: **STYLE CONTRACT FROZEN / HTML WRITER NOT STARTED / PRODUCT·GIT·DB HOLD**
> Primary visual SSOT: `MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html`의 **B · 대화로 안내**
> Supporting behavior reference: `MoaWork_First_Value_Onboarding_B_Migration_v0.2.html`
> Business/state contract: round-25 corrected Workspace Entry 계약과 exact-current HTML
> 소비: T05 → T01 HTML writer → T07 independent visual reviewer
> NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-HTML-01`

## 1. 결론

사용자의 최신 명시 결정에 따라 Workspace Entry의 시각 DNA는 **Primary B · 대화로 안내**다. 이전 Workspace Entry A/C/D의 화면 문법과 Supporting B migration의 rail/stage 문법은 스타일 정본이 아니다.

T01은 B의 대화 구조를 보존하면서 네 가지 밀도와 분기 방식만 비교한다.

- B-1 `Guided Fork`: 한 질문과 두 답변으로 신규 회사/기존 회사 합류를 나눈다.
- B-2 `Guided Split`: 하나의 가이드 안에서 두 경로의 차이를 나란히 설명한다.
- B-3 `One Question at a Time`: 모바일 우선, 매 화면 한 질문·한 결정만 보여준다.
- B-4 `Compact Guided Hub`: pending/복수 소속/재개 상태를 짧은 대화와 요약으로 모은다.

네 안 모두 같은 팔레트, 타이포그래피, 비대칭 말풍선, 가이드 아바타, 안전한 요약 카드, 한글 대화 톤을 사용한다. 달라지는 것은 **정보가 한 번에 보이는 양과 분기 배치**뿐이다.

## 2. Frozen source identity와 provenance

### 2.1 Primary — 반드시 이 파일과 이 B를 사용

| 항목 | 값 |
|---|---|
| path | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html` |
| bytes | `47,563` |
| physical lines | `182` |
| SHA-256 | `1672B6E00CBF3C2ABAFEF660C9B5C511B5CCF44F707BA93042B166C4733D3B02` |
| selected section | `section#b.concept.shell[aria-labelledby="b-title"]` |
| selected title | `#b-title` = `대화로 안내` |

Byte 범위는 UTF-8 파일의 첫 byte를 1로 세고, 표의 마지막 physical line newline까지 포함한 1-based inclusive 값이다.

| Primary 근거 | physical lines | byte range | 역할 |
|---|---:|---:|---|
| light tokens | 10–20 | 375–1,005 | palette, radii, shadow, motion token |
| dark tokens | 21–28 | 1,006–1,459 | dark palette와 shadow |
| global type/header/components | 29–44 | 1,460–8,605 | font, shell, topbar, prototype, form, status |
| B-specific CSS | 49–50 | 10,566–12,571 | conversation layout와 모든 B primitive |
| responsive/reduced motion | 61–64 | 18,465–20,709 | 980/700/390과 motion reduction |
| B DOM | 113–127 | 27,814–30,519 | exact selected section |
| theme/navigation JS | 161–169 | 42,126–43,510 | theme, reduced-motion-aware scroll |
| chat/state JS | 177–179 | 45,628–47,535 | reply append, state wording, ARIA update |

### 2.2 Primary exact selector map

아래 selector는 reference provenance다. HTML writer는 core primitive 이름을 유지해 computed-style 비교가 가능하게 한다.

| 영역 | exact selector |
|---|---|
| B root | `#b`, `#b-title`, `#b > .concept-head`, `#b > .prototype` |
| prototype header | `#b .proto-top`, `#b .mini-brand`, `#b .mini-mark`, `#b .user-chip`, `#b .avatar` |
| layout | `#b .b-wrap`, `#b .b-chat`, `#b .b-summary` |
| guide identity | `#b .b-chat-head`, `#b .guide-avatar` |
| conversation | `#b .messages[aria-live="polite"]`, `#b .bubble`, `#b .bubble.answer` |
| response controls | `#b .quick`, `#b .quick [data-chat]`, `#b .compose`, `#b .compose input`, `#b .compose [data-chat="send"]` |
| summary | `#b .summary-steps`, `#b .summary-step`, `#b .summary-step.done`, `#b .summary-step.current` |
| safety | `#b .callout` |
| chat behavior | `document.querySelectorAll('[data-chat]')` at Primary line 177 |

Reference JS의 unscoped `.messages` query는 여러 B variant가 한 문서에 함께 있을 때 오작동할 수 있다. T01은 클릭한 `[data-b-variant]` root 안의 `.messages`만 갱신해야 한다. 이 scoping 보정은 시각 DNA 변경이 아니라 다중 variant 안전성 보강이다.

### 2.3 Supporting reference — behavior only

| 항목 | 값 |
|---|---|
| path | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_First_Value_Onboarding_B_Migration_v0.2.html` |
| bytes | `45,465` |
| physical lines | `539` |
| SHA-256 | `62F4BF4EE5E276FA2C9086DC6B397BF8A58728B40DE3E26081B0168A4A016621` |

| Supporting 근거 | lines | byte range | 허용되는 소비 |
|---|---:|---:|---|
| tokens | 10–52 | 378–1,588 | Primary와 공통인 브랜드 색의 교차 확인 |
| header/buttons/stage type | 74–140 | 2,415–8,670 | 접근성, 버튼 최소높이, 상태 tone 참고 |
| responsive | 193–233 | 13,778–15,753 | table stacking과 reduced motion 참고 |
| onboarding/import DOM | 235–360 | 15,762–32,040 | 회사→팀원→CSV, dry-run, 저장 0건 의미 |
| interaction JS | 360–527 | 32,030–44,887 | loading/error/cancel/resume/dry-run 상태 참고 |

### 2.4 Binding business/state source

| 항목 | 값 |
|---|---|
| file | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_4Concepts_v0.1.html` |
| bytes / lines | `41,687 / 425` |
| SHA-256 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` |
| round-25 verdict | `PASS — EXACT CURRENT HASH`, product merge/deploy HOLD |

이 파일은 **상태·권한·문구 분기 fixture**이며 새 시각 DNA가 아니다.

| Business 근거 | lines | byte range | 계약 |
|---|---:|---:|---|
| Owner/lookup | 294–301 | 21,683–23,629 | exact-one 안내, exact/generic enumeration 방지 |
| pending | 302–307 | 23,630–24,770 | pending은 membership 아님, 수정/취소 |
| Owner onboarding/joiner/operator | 315–327 | 26,195–29,870 | 신규 Owner와 joiner 분리, operator tenant 0 |
| create/join + 0/1/2+ branches + old B renderer | 329–352 | 29,879–32,639 | 8-state routing과 branch contract |

Current HTML의 `guideRail()`과 `.guide-layout`은 이전 B 구현이다. branch logic은 보존하지만, 최신 사용자 결정에 따라 rail은 Primary conversation layout으로 교체한다.

## 3. Source conflict resolution

충돌 시 순서는 **Primary B visual → current D3A43 business/state → Supporting behavior**다.

| 충돌 항목 | Primary B | Supporting/current | 확정 |
|---|---|---|---|
| 기본 구조 | conversation + summary | sticky step rail + stage 또는 guide rail | Primary conversation |
| container | `1,240px`, 좌우 20px | `1,220px` | Primary `1,240px` |
| outer radius | 34px | 32px 또는 22px | Primary 34px |
| secondary radii | 24px / 16px | 22px / 14px | Primary 24px / 16px |
| dark nav alpha | `.87` | `.86` | Primary `.87` |
| brand small | 11px | 12px | Primary 11px |
| mobile breakpoint | 700px | 720px | Primary 700px |
| mobile shell | viewport minus 24px; 390에서 minus 20px | 390에서 minus 16px | Primary 24/20px |
| motion | `.2s`, `--ease` token | `.16s` controls, `.25s` theme | Primary `.2s`; curve는 공통 `--ease` |
| core status view | dialogue bubbles + quick replies | operational form/cards/table | dialogue, 필요한 안전 상태만 bubble/callout 안에 투영 |
| CSV | 3번째 준비 요약 | full migration wizard | entry에서는 요약/진입만; 상세 dry-run은 다음 화면 |
| top z-index | 80 | 40 | Primary 80 |

Supporting의 dry-run, 실제 저장 0건, 오류·취소·재개, 대표 최종 적용 의미는 보존한다. Supporting의 `.rail`, `.steps`, `.step-link`, `.stage`, `.screen`, `.method-card`, dense mapping table은 B family의 외형으로 복사하지 않는다.

## 4. LOCKED visual DNA

### 4.1 Palette tokens

#### Light

| token | exact value | 역할 |
|---|---|---|
| `--blue` | `#3478F6` | record/info, brand bar 1 |
| `--teal` | `#18A999` | done/safe flow, brand bar 2 |
| `--violet` | `#6B5CFF` | primary, current, guide avatar, focus |
| `--coral` | `#F26B5E` | people/error accent only |
| `--ink` | `#191A1E` | primary text, user answer bubble |
| `--muted` | `#666B78` | explanation/helper text |
| `--paper` | `#F4F6F9` | page and summary background |
| `--surface` | `#FFFFFF` | cards/bubbles |
| `--surface-2` | `#ECEFF4` | quiet chip/step number |
| `--line` | `rgba(25,26,30,.12)` | standard 1px border |
| `--soft-line` | `rgba(25,26,30,.07)` | separators |
| `--nav` | `rgba(244,246,249,.88)` | sticky topbar |
| `--shadow` | `0 22px 70px rgba(29,39,64,.10)` | outer prototype only |
| `--success` | `#0C8B73` | verified success text |
| `--warning` | `#B46A00` | pending |
| `--danger` | `#D4483B` | error/cancel |
| `--on-accent` | `#FFFFFF` | violet foreground |

#### Dark

| token | exact value |
|---|---|
| `--blue` | `#6EA0FF` |
| `--teal` | `#47CFBC` |
| `--violet` | `#8A7CFF` |
| `--coral` | `#FF8A80` |
| `--ink` | `#F7F8FA` |
| `--muted` | `#A7ACB8` |
| `--paper` | `#0C0D10` |
| `--surface` | `#111216` |
| `--surface-2` | `#191B21` |
| `--line` | `rgba(247,248,250,.14)` |
| `--soft-line` | `rgba(247,248,250,.08)` |
| `--nav` | `rgba(12,13,16,.87)` |
| `--shadow` | `0 24px 80px rgba(0,0,0,.34)` |
| `--success` | `#47CFBC` |
| `--warning` | `#FFB54A` |
| `--danger` | `#FF8A80` |
| `--on-accent` | `#10131A` |

Semantic color를 서로 바꾸지 않는다. Violet은 행동/current, teal은 완료, blue는 정보/record, coral은 사람 관련 주의·실패다. 배경 장식에 네 색을 동시에 크게 쓰지 않는다.

### 4.2 Typography

| 요소 | exact contract |
|---|---|
| family | `Pretendard, Inter, "Noto Sans KR", "Apple SD Gothic Neo", "Segoe UI", sans-serif` |
| body | 16px browser base, line-height `1.55`, normal weight |
| page hero | `clamp(38px,6vw,70px)`, line-height `1.04`, letter-spacing `-.058em` |
| concept/family title | `clamp(28px,4vw,44px)`, line-height `1.1`, letter-spacing `-.045em` |
| B guide title | 17px, weight 800–900 |
| B summary title | 19px, weight 800–900 |
| bubble body | 16px, line-height inherited |
| helper/summary copy | 12px, muted |
| eyebrow | 13px, weight 900, letter-spacing `.07em` |
| tag/status | 11px, weight 850–900 |
| button | 16px inherited, weight 800 |
| brand | 19px, letter-spacing `-.03em`; subline 11px |

질문은 한 문장, 이유는 바로 아래 한두 문장으로 제한한다. 긴 설명을 별도 설명서처럼 붙이지 않는다.

### 4.3 Radii, border, shadow

| primitive | exact value |
|---|---|
| outer prototype | radius `34px`, border `1px solid var(--line)`, `var(--shadow)`, overflow hidden |
| tablet/mobile outer | 390px 이하 radius `24px` |
| assistant bubble | `8px 18px 18px 18px` |
| user answer bubble | `18px 8px 18px 18px` |
| guide avatar | `44×44px`, radius `15px` |
| quick reply | radius `999px`, min-height `38px`, 1px line |
| standard controls | radius `13–14px`, min-height `44–46px` |
| summary card | radius `15px`, 1px line |
| summary number | `34×34px`, radius `11px` |
| topbar icon | `44×44px`, circular |

Shadow는 outer prototype에만 강하게 쓴다. 말풍선·summary card에 별도 큰 shadow를 추가하지 않는다. 현재 항목은 violet border, 완료 항목은 teal fill로 구분한다.

### 4.4 Spacing rhythm

Primary B에 실제 사용된 간격을 그대로 기준으로 한다.

| area | exact spacing |
|---|---|
| desktop shell | viewport 양쪽 최소 20px, max 1,240px |
| B layout | left `1.2fr`, right `.8fr`, right min `290px`, min-height `650px` |
| chat | padding `34px 28px 38px` |
| chat head | gap `12px`, bottom `25px` |
| messages | gap `13px` |
| bubble | padding `15px 17px`, max-width `680px` |
| bubble helper | top `5px` |
| quick replies | gap `8px`, padding `7px 12px` |
| composer | gap `8px`, top margin/padding `18px`, 1px soft separator |
| summary | padding `30px 24px` |
| summary intro | bottom `20px` |
| summary steps | gap `10px` |
| summary card | padding `12px`, inner gap `10px` |
| summary safety callout | top `14px` |
| proto top | min-height `64px`, padding `12px 18px` |

새 값이 필요하면 4px 계열을 우선하고, locked primitive는 허용오차 밖으로 바꾸지 않는다.

### 4.5 Card anatomy와 density

Desktop B는 다음 순서를 유지한다.

1. 64px prototype header.
2. faint violet diagonal wash가 있는 `.b-wrap`.
3. 왼쪽 guide identity.
4. assistant question → user answer → assistant acknowledgement.
5. quick reply 또는 composer.
6. 오른쪽 `준비한 내용` summary.
7. 자동 생성·권한·저장에 대한 safety callout.

기본 density는 **낮음~중간**이다. 한 viewport에 질문 2–3개, reply group 1개, summary 3개 이하를 권장한다. 관리 지표, 표, 여러 navigation group을 동시에 보여주지 않는다.

### 4.6 Illustration와 icon language

- Guide identity는 violet square avatar의 단일 문자 `M`이다.
- MoaWork mark는 blue/teal/violet의 세 막대다. 임의 gradient logo로 대체하지 않는다.
- User avatar는 blue→violet gradient circle과 짧은 글자다.
- 완료는 `✓`, pending은 숫자 또는 `…`, error는 제한된 단순 glyph를 사용한다.
- 사람 일러스트, 3D 캐릭터, 대형 사진, dashboard 아이콘 세트는 사용하지 않는다.
- 장식보다 대화와 상태 의미를 우선한다.

### 4.7 Header와 footer

#### Header LOCKED

- `.topbar`: sticky, top 0, z-index 80, 1px soft bottom line, translucent `--nav`, blur 18px/saturate 140%.
- `.topbar-in`: min-height 72px; 700px 이하 64px.
- brand와 theme control은 유지한다.
- comparison artifact의 `.compare-nav`와 A/B/C/D jump buttons는 product B-family HTML에 복사하지 않는다.
- B prototype 내부에는 `.proto-top` 64px을 유지한다.

#### Footer LOCKED

Primary B에는 전역 footer나 고정 bottom CTA가 없다. 새 marketing footer, persistent save bar, 다중 CTA footer를 만들지 않는다. 완료/다음 행동은 마지막 assistant bubble 또는 composer 인접 button row에서 제공한다.

### 4.8 Copy tone

LOCKED tone은 `짧은 존댓말 + 한 번에 한 질문 + 이유 즉시 설명 + 되돌릴 수 있음`이다.

- 안내자: “필요한 것만 하나씩 여쭤볼게요.”
- 질문: “먼저 회사 이름을 알려 주세요.”
- acknowledgement: “좋아요.”로 시작하되, 서버 근거가 없는 완료를 단정하지 않는다.
- 이유: “나중에 바꿀 수 있어요.”처럼 즉시 설명한다.
- 선택: “팀원 초대할게요 / 나중에 할게요”처럼 사용자의 말투로 쓴다.
- 보안: `tenant`, `scope`, `DML`, `transaction` 대신 회사, 대표, 팀원, 사원, 검토, 미리보기로 쓴다.
- 실패: 입력을 유지하고 다음 시도를 말한다. 사용자 탓으로 쓰지 않는다.

화면이 prototype이면 “화면 예시”, “실제 요청은 보내지 않았어요”, “저장 0건”을 보인다. 실제 구현에서도 server/DB 증거 전에는 “만들었어요”, “합류했어요”, “적용했어요”를 사용하지 않는다.

### 4.9 Motion

- motion token: `cubic-bezier(.2,.75,.25,1)`.
- color/background/position feedback는 기본 `.2s`.
- hover 이동은 최대 `translateY(-1px)`.
- 대화 답변은 즉시 append한다. typing simulation, bounce, confetti, 자동 carousel을 쓰지 않는다.
- smooth scroll은 reduced-motion이 아닐 때만 허용한다.
- `prefers-reduced-motion: reduce`에서 animation/transition은 사실상 0으로 수렴한다.
- 상호작용 후 focus를 잃지 않고, 새 메시지는 `aria-live="polite"`로 전달한다.

## 5. Responsive behavior

| viewport | LOCKED behavior |
|---|---|
| >980px | `1.2fr / .8fr`, summary 오른쪽, min-height 650px |
| ≤980px | 한 column, summary가 conversation 앞에 옴, summary steps는 3 columns |
| ≤700px | shell은 viewport minus 24px, chat/summary padding `22px 16px`, compose 한 column, summary steps 한 column |
| ≤390px | shell은 viewport minus 20px, outer radius 24px, proto-top `10px 12px`, user-chip text 숨김 |
| reduced motion | scroll auto, transition/animation effectively off |

B-3만 980px 이하에서 full summary 대신 `현재 1/3` compact row로 접을 수 있다. 펼치면 동일 summary content와 상태가 보여야 한다.

Acceptance viewport는 1280×720, 390×844, 320×800이며 다음을 만족한다.

- `scrollWidth - clientWidth ≤ 1px`.
- 모든 core component rect가 viewport 안에 있다.
- control hit area 최소 44×44px. Primary quick reply의 38px 높이는 6px 이상 vertical padding/주변 공간을 포함해 실질 hit area 44px을 확보한다.
- focus outline 3px violet과 3px offset이 잘리지 않는다.
- 200% text zoom에서 horizontal scroll 0, CTA·composer 접근 가능.
- light/dark 모두 contrast와 상태 의미를 색 하나에만 의존하지 않는다.

## 6. B-1~B-4 LOCKED vs VARIABLE matrix

### 6.1 Cross-family matrix

| 항목 | LOCKED | VARIABLE |
|---|---|---|
| palette/type/radius | §4 exact tokens/scale | 없음 |
| guide identity | `M` avatar + `모아 가이드` | subtitle 한 줄 |
| conversation | assistant/user asymmetric bubbles | 보이는 message 수 |
| entry fork | create와 join을 모두 제공 | chip, split lane, sequential question, compact action |
| summary | 답변에서 파생된 준비 상태 | right/above/collapsed/compact |
| actions | 한 group에서 primary 최대 1 | secondary/skip 위치 |
| state set | 8 scenarios 전부 | 어떤 state를 initial preview로 둘지 |
| safety | pending≠membership, no fake success | 문장의 길이 |
| responsive | 980/700/390, overflow 0 | B-3 summary collapse |
| motion/accessibility | reduced motion, aria-live, focus-visible | none |

### 6.2 B-1 Guided Fork

| LOCKED | VARIABLE |
|---|---|
| assistant bubble이 “새 회사를 시작할까요, 기존 회사에 합류할까요?”라고 묻는다. | initial assistant 문구와 helper 한 줄 |
| 두 선택은 `.quick` pill replies다. A안의 큰 선택 card가 아니다. | create를 먼저 둘지 join을 먼저 둘지 |
| 선택 뒤 해당 answer bubble을 append하고 다른 선택을 disable한다. | answer acknowledgement copy |
| desktop summary는 오른쪽, mobile은 위쪽이다. | summary 2개 또는 3개 항목 |

적합: membership 0의 첫 진입. 2개 reply 외 추가 결정은 다음 대화 turn으로 넘긴다.

### 6.3 B-2 Guided Split

| LOCKED | VARIABLE |
|---|---|
| guide preface와 shared conversation column을 유지한다. | create/join 설명을 2개의 compact lane으로 나눔 |
| lane은 assistant reply group의 확장이다. 독립 dashboard card처럼 보이면 실패다. | lane width는 50/50 또는 55/45 |
| 각 lane에는 title 1, 설명 2줄 이하, reply button 1개만 둔다. | exact-code helper가 join lane에 inline 가능 |
| 선택 후 한 lane만 active dialogue로 확장한다. | 비선택 lane collapse 방식 |

적합: 두 경로의 차이를 선택 전에 비교해야 하는 사용자. A portal/card 문법을 사용하지 않는다.

### 6.4 B-3 One Question at a Time

| LOCKED | VARIABLE |
|---|---|
| viewport에는 active assistant question과 current answer control이 중심이다. | 이전 transcript 0–2개 표시 |
| primary action은 1개, skip은 text action 1개까지다. | composer 또는 quick reply |
| progress는 compact text/3 short bars다. numbered left rail 금지. | `1/3` 위치 |
| mobile에서 summary는 compact row로 접힌다. | 사용자가 summary를 펼칠 수 있음 |

적합: 390/320 mobile과 SaaS 초보. 질문 간 transition은 `.2s --ease`, reduced motion에서는 즉시 교체한다.

### 6.5 B-4 Compact Guided Hub

| LOCKED | VARIABLE |
|---|---|
| top에는 guide identity와 “지금 할 일” assistant bubble이 있다. | pending/one/multiple 중 initial state |
| 상태는 summary-step과 short bubble로만 표현한다. | 최대 3개 상태 row |
| 좌측 navigation rail, metric dashboard, relationship canvas가 없다. | 최근 answer를 접을 수 있음 |
| 각 row action은 state-specific 1개다. | pending 수정/취소를 overflow가 아닌 inline text action으로 배치 가능 |

적합: pending 재방문, membership 2+, 중단 후 재개. C hub가 아니라 대화에서 만들어진 compact summary다.

## 7. Prohibited leakage

### A language 금지

- numbered left wizard rail, tablist형 1/2/3 navigation
- 두 개의 큰 create/join portal cards
- full-width form stage를 먼저 보여주는 구조
- selector/semantic 계열 `.a-wrap`, `.a-rail`, `.a-step`, `.portal-actions`

### C language 금지

- dark left checklist/sidebar
- workspace admin navigation과 quickbar
- dashboard metric/card grid
- selector/semantic 계열 `.c-wrap`, `.c-left`, `.checkcards`, `.hub-rail`, `.quickbar`

### D language 금지

- 세 개의 큰 canvas cards 동시 노출
- radial map, node/edge 관계도
- absolute-positioned action footer
- selector/semantic 계열 `.d-board`, `.d-card`, `.map-stage`, `.map-node`

### Old B/support leakage 금지

- current D3A43의 `.guide-rail`과 Supporting의 `.rail/.steps/.stage`를 family skeleton으로 사용
- CSV mapping table을 Workspace Entry 첫 화면에 펼침
- `1 / 3`을 좌측 업무 navigation으로 고정
- operation console처럼 loading/error selector를 노출

Business state 함수와 안전 문구는 재사용할 수 있지만, 외형은 Primary conversation으로 번역한다.

## 8. Measurable visual-similarity acceptance

### 8.1 Static token gate

- Primary light/dark color token exact match: 100%.
- Primary core radii, border, shadow exact match: 100%.
- font family 순서 exact match: 100%.
- locked selector 존재: `.b-wrap`, `.b-chat`, `.b-chat-head`, `.guide-avatar`, `.messages`, `.bubble`, `.bubble.answer`, `.quick`, `.compose`, `.b-summary`, `.summary-step`, `.summary-step.done`, `.summary-step.current` 전부 존재.
- A/C/D/old rail prohibited selector 또는 동등 구조: 0.

### 8.2 Computed-style gate

Reference primitive를 별도 fixture로 렌더해 다음 허용오차를 적용한다.

| 측정 | tolerance |
|---|---:|
| guide avatar size/radius | `±0px` |
| bubble radius | `±0px` |
| bubble padding/gaps | `±2px` |
| outer radius/shadow/border | exact |
| font size | `±1px` |
| line-height | `±0.05` |
| desktop column ratio | 각 column width `±3%` |
| summary min width | `≥290px` |
| color samples | exact CSS color; screenshot ΔE00 `≤2` |
| focus ring | 3px + 3px offset exact |

### 8.3 Screenshot gate

각 variant는 1280×720 light/dark, 390×844 light/dark, 320×800 light에서 캡처한다.

- reference primitive crop: header + guide avatar + assistant bubble + answer bubble + quick reply + summary step을 포함한다.
- locked primitive crop SSIM 목표 `≥0.92`. Variant content가 다른 영역은 mask한다.
- horizontal overflow 0.
- core component clipping 0.
- B identity가 첫 viewport에서 인지 가능: guide avatar, assistant bubble, reply, summary/progress 중 최소 3개가 보인다.
- reviewer 2인 중 2인이 A/C/D가 아니라 B conversation family로 식별한다.

### 8.4 Interaction/accessibility gate

- B-1~B-4 × 8 scenarios = 32/32 explicit render branch.
- quick reply는 한 번 선택 후 동일 group 중복 submit 0.
- reply는 클릭한 variant root의 message list만 변경한다.
- keyboard-only로 theme, reply, composer, summary disclosure, variant switch를 조작할 수 있다.
- new content는 `aria-live="polite"`; error는 필요한 경우 `role="alert"`.
- reduced-motion에서 animated transition 0에 수렴.
- console error/warning 0.

## 9. Business/security invariants for the HTML writer

시각 prototype이라도 다음을 위반하면 visual PASS를 받을 수 없다.

1. unauthenticated는 login, active membership 0은 Workspace Entry, 1은 유일 Workspace, 2+는 picker다.
2. 2+에서 Owner row, 첫 row, `last_workspace`만으로 자동 진입하지 않는다.
3. create와 join은 다른 dialogue branch다.
4. pending create/join은 membership이나 tenant access가 아니다. 수정·취소만 제공한다.
5. create 승인 후에만 신규 Owner onboarding B를 보여준다.
6. 기존 joiner는 회사 이름·Owner 보호·신규 Owner 3단계를 보지 않는다.
7. join 승인 기본은 `사원·최소 범위`다. Admin/Owner 자동승격을 표시하지 않는다.
8. active Workspace마다 protected Owner는 정확히 1명이고 scope는 all이다. 일반 관리자와 Platform operator는 Owner를 변경하지 못한다.
9. Platform operator state에는 고객 회사 switch/create/join/enter CTA가 0개다.
10. exact invite-code lookup은 code digest 의미만 사용한다. generic company lookup은 존재·개수·이름·Owner·구성원·가입 여부를 공개하지 않는다.
11. rate-limit/cooldown은 같은 generic wording으로 표현한다.
12. account identity, Platform capability, Workspace membership을 한 badge/role로 합치지 않는다.
13. invite code, session, token, 실제 이메일, 고객 record를 HTML에 넣지 않는다.
14. 사용자 입력을 `innerHTML`로 삽입하지 않는다. text node 또는 `textContent`를 사용한다.
15. mock action은 실제 request, approval, membership, email, DB write, import 성공을 주장하지 않는다.
16. company create 성공은 Workspace + protected Owner + profile + audit의 원자적 성공을 전제로 한다.
17. CSV는 source 선택 → dry-run → 오류/중복 검토 → 대표 최종 적용 순서다.
18. dry-run 전후 실제 저장은 0건이며, 취소·오류·재개 상태가 있다.
19. first customer/first work를 자동 생성하지 않는다.
20. light/dark, focus-visible, reduced-motion, 1280/390/320 overflow 0을 유지한다.

### 9.1 Required scenario copy

| scenario | B family가 말해야 하는 사실 | 금지 |
|---|---|---|
| `zero` | 새 회사 시작 또는 기존 회사 합류를 선택 | 회사가 이미 생김 |
| `one` | 유일 active 회사 확인 후 진입 | 다른 회사 데이터 혼합 |
| `multiple` | 들어갈 회사를 사용자가 선택 | 자동 Owner/첫 행 진입 |
| `pending-create` | 검토 중, 수정/취소 가능 | Owner 또는 회사 접근 성공 |
| `pending-join` | 답변 대기, 수정/취소 가능 | membership 성공 |
| `new-owner` | 회사 이름→팀원→CSV | joiner에게 노출 |
| `joiner` | 사원·최소 범위, Owner onboarding 생략 | 대표 자동승격 |
| `operator` | 승인된 지원 요청만, 회사 자동 접근 0 | tenant CTA 또는 role 합성 |

## 10. T01 writer file/DOM contract

다음 작업은 별도 lease에서 수행한다. 이 문서는 HTML을 수정하지 않는다.

### Required roots

- 각 안 root: `[data-b-variant="b-1"]` … `[data-b-variant="b-4"]`.
- 각 root 내부 core: `.b-wrap > .b-chat + .b-summary` 또는 B-3 compact summary.
- conversation: `.messages[aria-live="polite"]`.
- scenario: root에 `data-scenario`를 두고 8개 상태를 명시한다.
- current reply group: `.quick` 또는 `.compose` 하나.
- prototype truth: `[data-prototype-status]`에 실제 write 0/화면 예시를 표시한다.

### Event constraints

- 모든 query는 가장 가까운 `[data-b-variant]` root로 scope한다.
- fixed template 문자열 외 user-controlled 값을 HTML parser로 주입하지 않는다.
- variant/state switch는 이전 variant의 state를 몰래 공유하지 않는다.
- response 선택 후 focus는 새 assistant bubble heading 또는 다음 control로 예측 가능하게 이동한다.
- `Escape`가 필요한 modal/popover를 새로 만들지 않는다. 만들면 close/focus-return test를 추가한다.

## 11. T07 review packet

T07은 다음 receipt가 없으면 PASS하지 않는다.

1. writer exact path/bytes/physical lines/SHA-256.
2. Primary와 Supporting의 이 문서 기재 hash 재측정.
3. static token/selector/prohibited leakage 결과.
4. B-1~B-4 × 8 scenario = 32 branch 결과.
5. 1280/390/320 light/dark screenshots와 overflow 수치.
6. computed-style tolerance 표.
7. keyboard/focus/aria-live/reduced-motion/console 결과.
8. PII/secret/raw code/trailing whitespace scan.
9. business/security invariant 1–20 결과.
10. `NOT_RUN`인 항목의 명시적 분리.

Prototype PASS는 product code, PR, DB, merge, deploy PASS가 아니다. HTML bytes가 reviewer 이후 바뀌면 기존 verdict는 즉시 STALE다.

## 12. 상태와 handoff

| 주체 | 상태 |
|---|---|
| 사용자 decision | `PRIMARY B STYLE DNA LOCKED` |
| T02 style contract | `MATERIALIZED / FROZEN` |
| T01 HTML writer | `PENDING — WORKSPACE-ENTRY-B-FAMILY-HTML-01` |
| T07 reviewer | `PENDING — exact writer hash 이후` |
| product code/Git/DB/PR/merge/deploy | `HOLD / NOT AUTHORIZED` |

Consumer handoff: **T05 → T01 writer → T07 reviewer**.

NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-HTML-01`

## 13. Blindspot Pass

- 전체: 네 안은 모두 B conversation family여야 한다. 네 개의 서로 다른 디자인 언어를 다시 만드는 작업이 아니다.
- 부분: palette, bubble, summary, copy, motion, responsive, 8-state 권한 분기, import 안전성을 각각 측정한다.
- 전체 재검증: B-1의 fork가 A portal card가 되거나, B-4의 compact state가 C dashboard가 되거나, 관계를 시각화한다며 D canvas를 넣거나, Supporting의 rail/stage를 그대로 복사하면 최신 사용자 결정을 되돌리는 것이다. 반대로 B를 예쁘게 복제했더라도 pending을 membership처럼 보이거나 operator에게 tenant CTA를 주면 제품 계약을 위반한다.
