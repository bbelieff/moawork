# Workspace Entry B Family — Independent Exact-Hash Review

> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-INDEPENDENT-REVIEW-01`
> actual reviewer: T07, independent / non-author
> foreman: actual T05
> sole write lease: this file only
> candidate: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`
> exact candidate: **53,712 bytes / 710 physical lines / SHA-256 `0E90970E416D03213C3DB153D81C2CAAD316D168DFAE4DEFD15B9AAF7167F68B`**
> non-browser verdict: `PASS — EXACT CURRENT HASH`
> browser verdict: **`FAIL — STYLE SSOT VISUAL ACCEPTANCE`**
> overall verdict: **`FAIL — EXACT CURRENT HASH 0E9097...F68B`**
> product state: `HOLD — 사용자 B-family variant 선택 전 제품·Git·DB·PR·merge·deploy 금지`

## 1. Scope and stop rule

T07은 style contract, process-rule patch, HTML을 작성하지 않았다. HTML·제품·Git·DB·
coordination·worklog·ROUND는 read-only이며 이 review artifact 하나만 쓴다.

판정은 `0E9097...F68B` bytes에만 유효하다. 시작·브라우저 전·브라우저 후 해시 중 하나라도
다르면 즉시 `STALE/FAIL`로 닫고 브라우저 또는 추가 검증을 중단한다. 별도 브라우저 승인이
필요하면 기다리거나 writer lease를 잡아두지 않고 `browser=NOT_RUN`으로 완료한다.

## 2. Exact source identity and selection chronology

| 순서 | source | bytes / physical lines | SHA-256 | 허용된 역할 | 독립 판정 |
|---:|---|---|---|---|---|
| 1 | Primary `MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html` | 47,563 / 182 | `1672B6E00CBF3C2ABAFEF660C9B5C511B5CCF44F707BA93042B166C4733D3B02` | `section#b`, `대화로 안내` visual DNA | exact file/hash 확인 |
| 2 | Supporting `MoaWork_First_Value_Onboarding_B_Migration_v0.2.html` | 45,465 / 539 | `62F4BF4EE5E276FA2C9086DC6B397BF8A58728B40DE3E26081B0168A4A016621` | behavior only: dry-run, 오류·취소·재개 | exact file/hash 확인 |
| 3 | Business/state `MoaWork_Workspace_Entry_4Concepts_v0.1.html` | 41,687 / 425 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` | 8-state·권한·문구 fixture | exact file/hash 확인; visual source 아님 |
| 4 | Style contract `02-workspace-entry-b-style-contract.md` | 29,672 / 552 | `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D` | conflict resolution과 measurable gate | exact file/hash 확인 |
| 5 | Review candidate | 53,712 / 710 | `0E90970E416D03213C3DB153D81C2CAAD316D168DFAE4DEFD15B9AAF7167F68B` | B-1~B-4 comparison HTML | 이번 판정 대상 |

Candidate lines 9–18 CHECKPOINT가 같은 style/Primary/Supporting/business hashes와
`PRIMARY_B_STYLE_DNA_LOCKED`, `PRODUCT_GIT_DB_PR_MERGE_DEPLOY_HOLD`, request/write/import
apply 0을 선언한다.

Selection chronology는 **Primary B visual → corrected D3A43 business/state → Supporting
behavior**다. Candidate는 Primary의 B `대화로 안내` primitive를 사용하고, Primary의 다른
A/C/D section이나 current D3A43의 old B guide rail을 visual skeleton으로 대체하지 않았다.

## 3. Style-DNA consistency matrix

### 3.1 Cross-family locked DNA

| 항목 | B-1 Guided Fork | B-2 Guided Split | B-3 One Question | B-4 Compact Hub | 판정 |
|---|---|---|---|---|---|
| palette tokens | Primary exact | Primary exact | Primary exact | Primary exact | light 18/18, dark 17/17 PASS |
| typography | shared exact family/scale | same | same | same | PASS |
| outer prototype | 34px/line/shadow | same | same | same | `--radius-xl:34px`, exact line/shadow PASS |
| assistant/user bubble | asymmetric Primary radii | same | same | same | exact 8/18 and 18/8 radii PASS |
| guide identity | violet 44×44 `M` | same | same | same | PASS |
| MoaWork/user icon | 3 bars + gradient circle | same | same | same | PASS |
| summary language | right summary | right summary | collapsible summary | right compact summary | allowed composition difference |
| copy tone | short honorific, reason immediately | same | one question focus | short revisit copy | PASS |
| motion | `.2s var(--ease)` | same | same | same | `cubic-bezier(.2,.75,.25,1)` PASS |
| density | low | medium | progressive/low | compact medium | allowed band difference |
| header | sticky brand+theme, z80 | same | same | same | PASS |
| footer | none | none | none | none | global/fixed bottom CTA 0 PASS |

Token parser matched all contract light/dark semantic tokens. Font family order is exactly
`Pretendard, Inter, "Noto Sans KR", "Apple SD Gothic Neo", "Segoe UI", sans-serif`.
Primary selector family `.b-wrap`, `.b-chat`, `.b-chat-head`, `.guide-avatar`, `.messages`,
`.bubble`, `.bubble.answer`, `.quick`, `.compose`, `.b-summary`, `.summary-step` and status
modifiers exists.

The only `position:fixed` is the accessibility skip link at top-left; it is not a bottom CTA.
Footer element count is 0.

### 3.2 Allowed composition differences versus reset

| variant | independent composition signature | distinct evidence | reset/leakage decision |
|---|---|---|---|
| B-1 | one assistant fork + two pill replies | zero render 1,605 UTF-8 bytes | not A portal cards |
| B-2 | shared chat + two compact `split-reply` lanes | 1,913 bytes | lanes stay inside dialogue; not dashboard |
| B-3 | `progress-line`, current question, collapsible summary | 1,748 bytes | no numbered left rail; mobile-first |
| B-4 | guide bubble + max state-specific compact rows | 1,861 bytes | no C sidebar/metric grid |

Zero-state render SHA set cardinality is 4/4, so four variants are not identical copies. They
share visual language while sequence, disclosure, and density differ.

Prohibited selector/structure scan found **0** across A (`.a-wrap/.a-rail/.a-step/portal`), C
(`.c-wrap/.c-left/.checkcards/.hub-rail/.quickbar`), D (`.d-board/.d-card/.map-stage/.map-node`),
and old B/support rail (`.guide-rail`, rail/steps/stage/method-card). No radial canvas, dark
dashboard sidebar, mapping table, global footer, or persistent save bar is present.

## 4. Non-browser runtime harness

The inline script was extracted in memory and evaluated with a minimal read-only DOM stub. The
actual `renderers[variant][scenario]` functions generated every branch; no product file or temp
fixture was written.

| gate | result |
|---|---:|
| inline JavaScript syntax | PASS |
| B-1~B-4 × 8 explicit render | **32/32 PASS** |
| generic lookup renderer per variant | **4/4 PASS** |
| distinct zero-state outputs | **4/4 distinct PASS** |
| combined harness assertions | **38/38 PASS, fail 0** |

The first native `node -e` attempt stopped before product evaluation because Windows stripped
argument quotes. A second stdin run evaluated renderers but Korean literals in the harness were
transcoded, so only Korean-literal assertions were false while render bytes and tenant counts were
valid. The final harness used ASCII DOM/action contracts; Korean copy was verified separately by
UTF-8 file scan. These infrastructure attempts are not product FAILs.

## 5. Full 4×8 state matrix

Each cell is an actual renderer result with the shared B shell, guide, live messages, summary, and
prototype truth. Parentheses show tenant action count.

| scenario | B-1 | B-2 | B-3 | B-4 | required fact |
|---|---|---|---|---|---|
| `zero` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | create/join offered; request/write 0 |
| `one` | PASS (1) | PASS (1) | PASS (1) | PASS (1) | unique active membership then server recheck |
| `multiple` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | user chooses; owner/first/last auto-entry forbidden |
| `pending-create` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | not company/Owner/access; modify+cancel |
| `pending-join` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | not membership/access; modify+cancel |
| `new-owner` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | company → invite → CSV summary/progression |
| `joiner` | PASS (1) | PASS (1) | PASS (1) | PASS (1) | member/minimal; owner onboarding actions 0 |
| `operator` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | support-request only; tenant transition/action 0 |

Tenant action counts are deliberately 2/1/2/0/0/0/1/0 for each variant. Operator renders contain
no `choose-path`, `mock-tenant`, switch/create/join/enter action. Pending branches each contain one
modify and one cancel action. Joiner contains no `owner-next` or `mock-import`.

## 6. Security/business boundary review

| # | invariant | exact-current evidence | result |
|---:|---|---|---|
| 1 | post-login membership 0/1/2+ route | explicit zero/one/multiple branches | PASS; unauthenticated login route outside this post-login artifact |
| 2 | 2+ no Owner/first/last auto-entry | “최근 회사는 편의…권한 근거 아님”, explicit two choices | PASS |
| 3 | create/join separate dialogue | all zero variants expose two distinct paths | PASS |
| 4 | pending is not membership/access | both pending copies + modify/cancel, tenant action 0 | PASS |
| 5 | Owner B only after approval | new-owner copy says approved company Owner start | PASS prototype contract |
| 6 | joiner skips Owner B | member/minimal copy, owner onboarding actions 0 | PASS |
| 7 | join approval default member/minimal | “사원·최소 범위”, auto promotion denial | PASS |
| 8 | protected Owner exact-one/all | exact Korean owner callout; admin/operator cannot mutate | PASS copy contract; DB execution NOT_RUN |
| 9 | Platform operator tenant access/actions 0 | four operator renders tenant action 0 | PASS |
| 10 | exact/generic enumeration safety | exact access 0; generic six-field disclosure denial | PASS |
| 11 | generic cooldown same wording | same envelope and retry wording | PASS |
| 12 | identity/platform/membership separated | operator copy explicitly separates account role and membership | PASS |
| 13 | no raw code/session/token/email/customer record | scans all 0 | PASS |
| 14 | no user input via `innerHTML` | `innerHTML` receives fixed renderer templates; no input `.value` interpolation | PASS static |
| 15 | mock actions claim no success/data | global truth and action announcements preserve request/write/access 0 | PASS |
| 16 | create atomic company+Owner+profile+audit | pending safety copy requires joint confirmation | PASS copy contract; transaction execution NOT_RUN |
| 17 | CSV source→dry-run→error/duplicate→Owner apply | new-owner safety copy exact sequence | PASS |
| 18 | dry-run writes 0; cancel/error/resume | explicit copy | PASS copy contract; import engine NOT_RUN |
| 19 | no first customer/work auto-create | joiner/resume copy denies it | PASS |
| 20 | theme/focus/reduced-motion/responsive | static CSS present | browser PENDING |

HTML does not implement authentication, tenant RLS, approval transaction, DB persistence, hosted
Supabase, import engine, production routing, merge, or deploy. Those items remain `NOT_RUN`; a
prototype PASS cannot be promoted to them.

## 7. Generic/exact lookup and fake-success scan

- Generic safe copy occurs once in the renderer and is consumed by all four variants. It denies
  existence, count, name, Owner, members, and join status; cooldown wording is uniform.
- Exact lookup states that verification alone creates neither membership nor company access.
- All four renderer paths expose `generic-search` only inside the scoped variant root.
- Click handling resolves `button.closest('[data-b-variant]')` before state or DOM mutation.
- The prototype truth says actual request, approval, company access, and writes are all 0.
- External script 0, raw invite-code-shaped literal 0, email-like literal 0, secret assignment 0,
  NUL 0, Unicode replacement character 0.
- Candidate trailing whitespace: 0 lines.

## 8. Browser matrix — completed

Target URL:
`http://127.0.0.1:4323/MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`

| gate | 1280×720 | 390×844 | 320×800 | status |
|---|---|---|---|---|
| 4 variants × 8 states | 32/32 | 32/32 | 32/32 | **96/96 PASS** |
| horizontal overflow/core rect | 32/32 | 32/32 | 32/32 | **96/96 PASS** |
| controls under 44px | 0 | 0 | 0 | PASS |
| operator tenant action/transition | 4/4 zero | 4/4 zero | 4/4 zero | 12/12 PASS |
| pending modify+cancel | 8/8 | 8/8 | 8/8 | 24/24 PASS |
| light runtime | PASS | PASS | PASS | 12 variant-viewport checks PASS |
| dark runtime | 4/4 | 4/4 | 4/4 | 12/12 PASS |
| first viewport B identity | **0/4** | **0/4** | **0/4** | **FAIL 0/12** |
| B-3 desktop summary | **hidden 8/8** | mobile disclosure PASS | mobile disclosure PASS | **FAIL desktop** |
| B variant arrow/focus | PASS | PASS | PASS | ArrowRight/wrap + 3px/3px PASS |
| B-3 forward/back/summary | N/A | 1→2→3→2 + disclosure PASS | CSS/runtime shared | PASS |
| new Owner company→invite→CSV | N/A | 1→2→3 PASS | CSS/runtime shared | PASS |
| generic lookup each variant | N/A | 4/4 PASS | N/A | PASS |
| reduced motion | emulated | 0.001ms | shared | PASS |
| console warning/error | 0 | 0 | 0 | PASS |

### 8.1 Responsive/state runtime counts

Browser runtime exercised **4 variants × 8 states × 3 viewports = 96/96**. All had exactly one
visible variant, correct `data-scenario`, `scrollWidth - clientWidth ≤ 1px`, no horizontal core
rect escape, and no visible button below 44px. Tenant action counts matched the non-browser
contract in all 96 rows. Operator forbidden action counts were 0/12; pending modify+cancel was
24/24.

Dark mode ran 4 variants × 3 viewports = 12/12 with overflow 0. Computed dark tokens included
paper `#0C0D10`, surface `#111216`, nav `rgba(12,13,16,.87)`, guide violet
`rgb(138,124,255)`. Core contrast ratios were light text 17.39:1, dark text 17.61:1, light
primary 4.57:1, dark primary 5.67:1.

### 8.2 Computed-style evidence

At 1280 light, B-1/B-2/B-4 computed values matched Primary contract:

- prototype: width 1,225px, radius 34px, border 1px, shadow
  `rgba(29,39,64,.1) 0 22px 70px`, surface white;
- layout: 733.797px / 489.203px, ratio 1.500, min-height 650px, summary ≥290px;
- guide avatar: 44×44px, radius 15px, violet;
- assistant bubble: padding 15px 17px, radius `8px 18px 18px`, font 16px;
- answer bubble: radius `18px 8px 18px 18px`, no border/shadow;
- summary step: padding 12px, radius 15px, no shadow;
- topbar: sticky, z-index 80, 72px.

B-3 uses the same primitive styles when visible, but fails the desktop summary composition gate
described below.

### 8.3 FAIL-01 — B identity absent from first viewport

Style SSOT §8.3 requires at least three of guide avatar, assistant bubble, reply, summary/progress
to identify B in the first viewport. Actual absolute positions show the prototype itself starts
below every acceptance viewport:

| viewport | prototype absolute top | guide absolute top range | viewport height | result |
|---|---:|---:|---:|---|
| 1280×720 | 755px | 855px | 720px | FAIL 0/4 variants |
| 390×844 | 1,015px | 1,103–1,562px | 844px | FAIL 0/4 |
| 320×800 | 1,096–1,128px | 1,184–1,675px | 800px | FAIL 0/4 |

Therefore prototype-in-first-viewport = **0/12** and guide-in-first-viewport = **0/12**. The
first screen shows brand/hero/common principles/variant controls; at 320 it reaches only the B-1
concept heading before the prototype. This is not horizontal overflow, but it fails the explicit
B-identity first-fold gate.

### 8.4 FAIL-02 — B-3 desktop summary and disclosure both hidden

Style SSOT permits B-3 summary collapse **only at ≤980px**. At 1280×720, all eight B-3 states
render with:

- `.b-summary`: `hidden=true`, computed display `none`, width 0;
- `.compact-summary`: computed display `none`, width 0.

Thus desktop B-3 has neither the required right summary nor a disclosure control: **8/8 states
FAIL**. This also breaks the otherwise exact 1.2fr/.8fr visual composition because the second grid
track remains allocated but carries no visible summary.

At 390, the intended mobile behavior works: disclosure changes `aria-expanded=false→true`, the
summary becomes visible with three steps, and focus stays on the toggle with exact 3px outline and
3px offset.

### 8.5 Interaction/accessibility evidence

- Variant ArrowRight moved B-3→B-4 with selected/visible/focused IDs all `b-4`, then wrapped
  B-4→B-1. Focus outline was 3px with 3px offset.
- B-3 zero progressed 1→2→3 and back to 2; questions and live status changed without writes.
- B-3 new Owner progressed company name → invite choice → CSV; step 3 exposed one preview and one
  resume action, not an import success.
- B-3 mobile disclosure passed as described above.
- Reply isolation passed after explicit state reset: B-1 selection produced one answer and two
  disabled replies while B-2 remained answer 0 / disabled 0.
- Generic lookup runtime passed 4/4. B-1/B-2/B-4 retained identical non-enumerating envelope;
  B-3 advanced to the last confirmation while announcing that no company information was shown.
- Reduced motion matched `reduce=true`, scroll `auto`, transition/animation `0.000001s`, then was
  reset to no-preference.
- Theme click switched exact light/dark tokens and was restored to light. Native Enter/Space
  activation was not observable through this browser automation surface even with the native
  button focused; source semantics are a native `<button>`. Record as `NOT_RUN — TOOL LIMIT`, not
  a candidate FAIL.
- Console warning/error: 0 after the full interaction suite.

### 8.6 Screenshot and measurement receipts

Screenshots stayed in browser memory; the sole file lease prohibits separate image artifacts.
Hashes bind the observed frames.

| viewport | normal screenshot bytes / pixels / SHA-256 | full-page bytes / pixels / SHA-256 |
|---|---|---|
| 1280×720 | 63,131 / 1265×712 / `F0A69152389E590076C21C076EBE4AA6BE3BDC6A512BFF95A828C6981050268C` | 28,938 / 1265×1540 / `6A9ED4777D25F9DDB353DFFAD383A1B5462568EE314E8B3C1EFC90B4932B9724` |
| 390×844 | 38,124 / 375×812 / `8941FFC48302A89D7EFF5025A14E34521F1A22020638529B40897ACD158C818E` | 24,507 / 375×2017 / `6DFBDBCB058836B56939C536A653216588C774AF8639E47FE2C4360906BC7396` |
| 320×800 | 29,201 / 305×763 / `F1FFBCC8E879BF9644BBE55C6D08E4880576C559D15D35B13FD711D588B5B675` | 24,984 / 305×2098 / `93119F6A8479815CAB8142DB17C58BFC70FF169943A658FE1D368B0F5B47ECC6` |

The 320 B primitive crop after scrolling had 29,821 bytes / 320×800 / SHA-256
`368156C133EF322C29805AFD3806C89D08EC6688EB91FEF6ABF233901B3103F0`; it visually confirmed
the common Primary summary, `M` guide avatar, assistant bubble, and mobile stacking. This supports
that the failure is first-fold placement and B-3 desktop visibility, not a brand-language reset.

### 8.7 Honest NOT_RUN boundaries

- 200% browser text zoom and CTA reachability: `NOT_RUN — automation surface lacks reliable text
  zoom control`.
- SSIM ≥0.92 and screenshot ΔE00 ≤2: `NOT_RUN — no comparison-image harness in this lease`.
- second human reviewer 2/2 identification: `NOT_RUN — this packet is the appointed single T07
  independent review`.
- authentication, RLS, DB transactions, hosted Supabase, production, Git/PR/merge/deploy:
  `NOT_RUN / OUT OF SCOPE`.

## 9. CHECKPOINT — NON-BROWSER COMPLETE

- checkpoint date: `2026-07-25 Asia/Seoul`
- exact candidate: 53,712 bytes / 710 physical lines /
  `0E90970E416D03213C3DB153D81C2CAAD316D168DFAE4DEFD15B9AAF7167F68B`
- provenance: four input hashes exact; selected Primary `section#b` only
- style DNA: tokens exact, locked selectors present, prohibited leakage 0
- static/runtime: 38/38 PASS; actual render 32/32; generic 4/4; distinct 4/4
- operator: tenant transition/action 0 across 4 variants
- privacy/secret/trailing whitespace: PASS
- browser: `NOT_STARTED`
- last successful step: full non-browser checkpoint materialized in sole leased artifact
- next: re-hash candidate, verify HTTP-served bytes, then approval-free browser review if available

## 10. Recurrence and disposition rule

1. Any candidate-byte drift makes this checkpoint and later verdict immediately `STALE/FAIL`.
2. FAIL is returned through T05 with exact defect and T01 repair target; T07 does not take writer
   ownership.
3. PASS still leaves user B-1/B-2/B-3/B-4 selection and product work on HOLD.
4. Final PASS next work is `WORKSPACE-ENTRY-B-FAMILY-USER-DECISION-01`.
5. Consumer: T05 / T09 / user.

## 11. Final verdict and T01 repair return

**FAIL — exact candidate `0E90970E...F68B`.** Security/state render, B style primitives,
responsive overflow, dark mode, motion, interaction, generic enumeration, and console gates pass.
The candidate nevertheless cannot pass the frozen Style SSOT while FAIL-01 and FAIL-02 remain.

Required repair, routed **only through T05 to actual T01**:

1. Make B conversation identity visible in the first acceptance viewport at 1280×720, 390×844,
   and 320×800. Preserve the Primary B hero/header and do not solve this by importing A/C/D/rail
   language. Re-review must measure ≥3 B identity primitives in 12/12 variant-viewport rows.
2. At >980px, initialize B-3 with the right summary visible. Restrict compact collapse/disclosure
   to ≤980px, or provide an equivalent desktop-visible summary that keeps the frozen 1.2fr/.8fr
   composition. Re-review must show visible summary width ≥290px in B-3 desktop 8/8 states.

Repair target file: the same candidate HTML only under a new T05-issued T01 writer lease. T07 does
not modify it. User variant selection and all product work remain `HOLD`.
