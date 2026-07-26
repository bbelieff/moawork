# Workspace Entry B Family Routing — Independent Exact-Hash Review

> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-INDEPENDENT-REVIEW-01`
> actual reviewer: T07, independent / non-author
> foreman: actual T05
> sole write lease: this review artifact only
> exact candidate: **52,654 bytes / 509 LF-split physical entries (508 text lines) / SHA-256 `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`**
> exact routing contract: **30,418 bytes / SHA-256 `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB`**
> final verdict: **`PASS — EXACT CURRENT HASH ONLY`**
> implementation state: `PROTOTYPE_ONLY / PRODUCT_GIT_DB_DEPLOY_HOLD`

## 1. Scope, independence, and stop rule

T07 did not author v0.3 or the routing contract. This review writes only this file. Candidate
HTML, contracts, R1/R2 history, ROUND, coordination, product, Git, DB, and deployment remain
read-only.

Every finding is valid only for candidate SHA-256 `DE2418DC...E68D9`. Any byte drift before,
during, or after browser review makes the verdict `STALE/FAIL`. The complete non-browser result is
materialized below before any browser or approval-gated call. If browser access requires approval,
the lease is not retained while waiting and browser status becomes explicit `NOT_RUN`.

## 2. Frozen inputs and chronology

| input | bytes / line receipt | SHA-256 | role / status |
|---|---:|---|---|
| v0.3 routing candidate | 52,654 / LF split 509, text 508 | `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` | exact review subject |
| round-30 routing contract | 30,418 / text 553 | `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB` | routing SSOT |
| round-29 B style contract | 29,672 / text 552 | `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D` | visual DNA SSOT |
| v0.2 exact PASS candidate | 53,996 / text 713 | `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300` | predecessor, not inherited |
| immutable R1 FAIL review | 21,391 / text 336 | `1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E` | defect history preserved |
| immutable R2 PASS review | 17,429 / text 296 | `DD436E2F47C060F62A9E360336F35B72E6B6D3009B3C53C520EE50A9ABB6A714` | v0.2-only history |
| ROUND-29 | 9,021 / text 165 | `D8734E1EFF4795CCE25FC22B8A01F839B59C6EF45DCADF7A6C0EAF412504B973` | prior product HOLD |

Line totals use both raw LF splitting and text-line enumeration because the candidate ends with a
newline: raw `Split("\n")` produces 509 entries, while text enumeration reports 508 lines. Bytes
and SHA-256 are authoritative.

The v0.2 R2 PASS is not promoted to v0.3. v0.3 adds the round-30 routing semantics and therefore
receives this new exact-hash review. R1 and R2 remain immutable.

## 3. Non-browser execution method and aggregate result

The inline script was extracted in memory. JavaScript syntax compiled successfully. The IIFE's
actual `renderers[variant][scenario]`, `modelFor`, and `normalizeSlug` were exposed only inside a
read-only process harness with a minimal inert DOM; no source or temporary file was written.

| gate | result |
|---|---:|
| inline JavaScript syntax | PASS |
| B-1~B-4 × 11 declared states | **44/44 PASS** |
| state outputs distinct across four variants | **11/11 states have cardinality 4/4** |
| multiple chooser after-click state | **4/4 PASS** |
| unknown/cross-tenant default branch | PASS generic fail-closed |
| slug normalization samples | **7/7 PASS** |
| Owner onboarding step 2/3 contracts | PASS |
| A/C/D/old rail/canvas/dashboard leakage | **0** |

The first direct Windows `node -e` attempt lost quotes while transporting the in-memory harness
and stopped at harness parse time. The retry transported the same harness as UTF-8 base64 and
produced the results above. This is infrastructure provenance, not a candidate defect.

## 4. Full 4×11 routing/state matrix

Every cell below is an actual renderer result. Parentheses show visible tenant-selection action
count before any state-specific interaction.

| state | B-1 | B-2 | B-3 | B-4 | required routing truth |
|---|---|---|---|---|---|
| `zero` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | active=0, pending=0; create/join only |
| `one` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | server-verified `/w/{slug}`, extra selection 0 |
| `one-pending` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | direct active target; other request nonblocking |
| `multiple` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | chooser; last-used highlight only |
| `pending-create` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | modify 1 + cancel 1; access 0 |
| `pending-join` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | modify 1 + cancel 1; access 0 |
| `accepted-target` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | verified event target direct; notice scoped to target result |
| `new-owner` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | create event direct, then Owner B sequence |
| `joiner` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | direct active target; Owner B skipped |
| `operator` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | support action only; tenant path/action 0 |
| `inactive-anomaly` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | target identity 0; account-safe retry only |

All 44 outputs contain the common B shell, guide avatar, summary, and explicit prototype truth:
actual movement, request, approval, company access, and writes are all 0.

## 5. Click-count and destination contract

| case | static evidence | result |
|---|---|---|
| ordinary active=1 | `data-route-mode=server-verified`, `data-click-evidence=0`, `/w/{slug}`, tenant CTA 0 | 4/4 PASS |
| active=1 + other pending | same direct route; generic nonblocking notice; pending target identity absent | 4/4 PASS |
| accepted target | current target membership wording, `/w/{slug}`, click 0, no continue/enter/confirmation CTA | 4/4 PASS |
| accepted target may be second membership | exact copy says second membership does not trigger reselection | 4/4 PASS |
| ordinary active≥2 | two chooser rows, no pre-choice route evidence, last-used is highlight only | 4/4 PASS |
| chooser after one click | click evidence 1, tenant action 0, server revalidation wording | 4/4 PASS |
| joiner | verified active target, click 0, Owner/import action 0 | 4/4 PASS |
| new Owner | create accepted target click 0; then separate onboarding action | 4/4 PASS |

The candidate is a server-decision preview and performs no route. It does not claim that a client
redirect, hidden auto-click, or product callback executed. The accepted notice exists only in
`accepted-target` or approved-new-Owner result content; ordinary `one` has no acceptance notice.

## 6. Pending, operator, inactive, and generic failure

| boundary | evidence | result |
|---|---|---|
| pending is not membership/access | both pending states say access 0; tenant CTA 0 | PASS |
| self-request recovery | modify 1 + cancel 1 per pending renderer | PASS |
| one+pending is nonblocking | direct route precedes no chooser/modal; notice hides target details | PASS |
| Platform plane separation | operator has support action only; `/w/{slug}` and tenant action 0 | PASS |
| inactive not optimistic zero | inactive/suspended/unknown copy routes to generic retry | PASS |
| stale slug/cookie/query/last_workspace | explicit no-fallback safety copy | PASS |
| unknown/cross-tenant default | generic title/copy, retry only, fallback Workspace denied | PASS |
| fake success/data/write | four prototype markers; all renderers state actual effects 0 | PASS |

No ordinary path uses role priority, Owner-first, first-row, last-used, slug, cookie, or query as
authorization. The prototype cannot prove server/RLS behavior; those remain later product gates.

## 7. Display name and canonical slug

| contract | source/runtime evidence | result |
|---|---|---|
| display name separated from slug | distinct fields and explanatory copy | PASS |
| display-name normalization | Unicode NFC, trim, collapsed spaces stated | PASS prototype contract |
| slug grammar | lowercase ASCII/digit/hyphen pattern; minlength 3, maxlength 40 | PASS |
| normalization | NFKC, lowercase, trim, space/underscore→hyphen, illegal removal, hyphen collapse/trim, 40 cap | PASS |
| preview not reservation | preview/status explicitly says server-unconfirmed, save/reserve/success 0 | PASS |
| reserved/duplicate/concurrent safety | same unavailable message; reason and Workspace identity hidden | PASS |
| stable canonical slug | fixed-after-create copy; display name/Owner/membership do not auto-change it | PASS |
| Korean-only display name | retained separately; empty ASCII result asks for explicit slug | PASS |

Runtime normalization samples:

| input class | output |
|---|---|
| trim + uppercase + underscores | `my-company` |
| full-width NFKC | `abc-123` |
| Korean-only slug candidate | empty |
| repeated hyphen | `a-b` |
| leading/trailing hyphen | `abc` |
| 50 ASCII chars | exactly 40 characters |
| 2 ASCII chars | remains `ab`; UI requires at least 3 before valid-format preview |

The prototype does not perform final availability, route-manifest reserved-set, or unique
allocation. Those are correctly not represented as successful.

## 8. Owner B and joiner sequencing

| stage | rendered contract | result |
|---|---|---|
| accepted create target | server-verified `/w/{slug}`, click 0 | PASS |
| 1. name + address | server-confirmed display name and fixed slug; editable slug input 0 | PASS |
| 2. invite | two choices, default employee/minimal scope, skip allowed | PASS |
| 3. CSV | preview 1 + resume 1; dry-run, error/duplicate review, Owner final apply, rollback | PASS |
| joiner | employee/minimal home; name/address/Owner protection questions and import actions 0 | PASS |

Actual step render checks found two `owner-next` choices at step 2 and exactly one import preview
plus one resume action at step 3. No first customer or first work is fabricated.

## 9. B visual-family static review

| dimension | B-1 | B-2 | B-3 | B-4 | decision |
|---|---|---|---|---|---|
| palette/type/radii | shared locked tokens | same | same | same | family consistent |
| guide identity | violet 44×44 M avatar | same | same | same | family consistent |
| bubble language | common guided conversation | same | same | same | family consistent |
| routing composition | guided fork | evidence/action split | one-question progress | compact guided hub | allowed distinctness |
| summary/header/footer | common summary + sticky header, no product footer | same | responsive collapse | same | family consistent |

Every state produced four distinct renderer hashes, so the variants are not identical copies.
Prohibited A/C/D/old rail/canvas/dashboard selector leakage is 0. The source preserves the
round-29 prototype-first layout and responsive B summary rules.

## 10. Source hygiene and privacy scan

| scan | result |
|---|---:|
| external scripts | 0 |
| email-like values | 0 |
| secret/token/cookie-value patterns | 0 |
| NUL / Unicode replacement character | 0 / 0 |
| trailing-whitespace lines | 0 |
| `SERVER DECISION PREVIEW` markers | 4 |
| A/C/D/old selector leakage | 0 |

## 11. Browser plan — not started at checkpoint

Exact intended URL:
`http://127.0.0.1:4323/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html`

| browser gate | denominator | checkpoint state |
|---|---:|---|
| exact HTTP status/body bytes/SHA | 200 / 52,654 / exact SHA | PENDING |
| 3 viewports × 4 variants × 11 states × light/dark | **264 rows** | PENDING |
| horizontal overflow / core escape / 44px | 264 | PENDING |
| route/click/security semantics | 264 | PENDING |
| chooser before/after one click | 12 variant-viewport paths | PENDING |
| slug input/preview boundaries | targeted runtime | PENDING |
| Owner sequence / B-3 disclosure | targeted runtime | PENDING |
| keyboard/arrow/focus / reduced motion / console | targeted runtime | PENDING |

## 12. CHECKPOINT — COMPLETE NON-BROWSER VERDICT

- checkpoint date: `2026-07-25 Asia/Seoul`
- candidate: 52,654 bytes / raw LF split 509 / text 508 /
  `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`
- routing contract: 30,418 bytes /
  `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB`
- runtime matrix: 44/44 PASS; chooser after-click 4/4; 11 state distinct sets 4/4
- routing/security/slug/Owner/style/privacy static gates: PASS
- browser: `NOT_STARTED`
- provisional verdict: `NON_BROWSER_PASS — exact current hash`
- last successful step: complete non-browser checkpoint written to sole review lease
- next: disk re-hash, exact HTTP verification, approval-free browser regression if available

## 13. Recurrence and disposition

1. Candidate byte drift makes this checkpoint and later verdict immediately `STALE/FAIL`.
2. PASS cannot promote prototype evidence to product server routing, RLS, DB, callback, or deploy.
3. FAIL returns exact defects through T05 to T01; T07 does not take candidate writer ownership.
4. Consumer: T05 / T09.
5. NEXT_WORK is set by the exact-hash browser verdict below.

## 14. Browser runtime recovery and exact HTTP freeze

The planned port 4323 was intermittent: an early PowerShell text-body reconstruction changed
the decoded byte stream, and the listener then disappeared. This was an environment/harness
failure, not a candidate result. Per controller authorization, T07 stopped using background
process/file workarounds and started a long-lived foreground Node static server with no writes,
bound to `127.0.0.1` on the free port 4324.

Exact reviewed URL:
`http://127.0.0.1:4324/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html`

| HTTP gate | observed | result |
|---|---|---|
| status | `200` | PASS |
| `Content-Length` | `52,654` | PASS |
| raw response bytes | `52,654` | PASS |
| raw response SHA-256 | `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` | PASS |
| content type | `text/html; charset=utf-8` | PASS |

The first monolithic browser pass exceeded the browser-kernel time window before returning a
result. T07 recovered without changing the candidate by using the same exact-hash page and six
bounded 44-row chunks. No approval was requested or awaited. The final browser tab was released,
the viewport and reduced-motion override were reset, and the foreground server had no remaining
listener after cleanup.

## 15. Full exact-hash browser matrix

| theme | viewport | rows | overflow failures | controls below 44px | routing/state failures |
|---|---:|---:|---:|---:|---:|
| light | 1280×720 | 44/44 | 0 | 0 | 0 |
| light | 390×844 | 44/44 | 0 | 0 | 0 |
| light | 320×800 | 44/44 | 0 | 0 | 0 |
| dark | 1280×720 | 44/44 | 0 | 0 | 0 |
| dark | 390×844 | 44/44 | 0 | 0 | 0 |
| dark | 320×800 | 44/44 | 0 | 0 | 0 |
| **total** | 3 viewports × 2 themes | **264/264 PASS** | **0** | **0** | **0** |

Each row independently rechecked the selected variant/state, membership/pending counts,
permission-safe action set, click evidence, route evidence, and fail-closed copy. The browser
matrix covers all four variants and all 11 states listed in section 4. Specifically:

- `one` and `accepted-target` expose `/w/{slug}` with server-verified click evidence 0 and no
  redundant selection/confirmation action.
- `accepted-target` remains valid as a second membership and scopes its notice to the target
  result.
- `multiple` remains a two-choice chooser; the last-used marker is a hint, not authorization.
- pending create/join retain modify/cancel only and tenant access 0.
- operator and inactive anomaly retain tenant transition/action 0 and generic fail-closed recovery.
- unknown/cross-tenant fallback exposes no Workspace identity and no optimistic route.
- fake product data, write, route execution, or success evidence remains 0.

B-3's desktop summary was visible in 22/22 desktop state/theme rows at an observed width of
`489.203125px`. Its mobile summary was collapsed by default in 44/44 mobile state/theme rows.
The four B variants remained one visual family while preserving distinct compositions; none
collapsed into an identical copy or leaked A/C/D/old rail/canvas/dashboard language.

## 16. Targeted browser interaction receipts

### 16.1 Ordinary multiple chooser

Across 4 variants × 3 viewports, the chooser was exercised before and after one actual click:
**12/12 PASS**. Before selection there were two Workspace choices, route evidence 0, click evidence
0, and only a recent-use hint. Selecting the exact first Workspace produced one route evidence,
click evidence 1, `/w/{slug}`, tenant actions 0, and server-revalidation copy.

### 16.2 Slug and display-name boundary

All four variants were exercised through the visible “새 회사 시작” path and the real slug input:

| variant | input | visible preview/result | result |
|---|---|---|---|
| B-1 | spaces + `My__Company` | `/w/my-company` | PASS |
| B-2 | full-width `ＡＢＣ_１２３` | `/w/abc-123` | PASS |
| B-3 | Korean-only slug candidate | `/w/{slug}` + “3자 이상” | PASS fail-closed |
| B-4 | 50 ASCII characters | preview capped to 40 characters | PASS |

Every input exposed `minlength=3`, `maxlength=40`, and the lower-ASCII/digit/hyphen pattern. The
preview never claimed allocation or reservation; reserved/duplicate/concurrency failure wording
remained generic, and route evidence remained 0. Company display name and slug remained separate.

### 16.3 Owner B sequence

All four variants completed the actual three-step UI sequence: name + immutable address review,
team invitation, then CSV. Step 1 exposed exactly one next action, zero editable inputs, a fixed
`https://www.moa-work.com/w/{slug}`, and route execution 0. Step 2 exposed one exact “초대 화면
보기” action plus the skip path. Step 3 exposed exactly one CSV preview and one resume action.
The dry-run/error/duplicate/Owner-final-apply/rollback boundary remained present in the shared
Owner safety summary. No tenant write or fake success was produced.

### 16.4 B-3 disclosure, keyboard, focus, and motion

| gate | observation | result |
|---|---|---|
| 390×844 summary | default hidden; open width 353px; close restores hidden | PASS |
| 320×800 summary | default hidden; open width 290px; close restores hidden | PASS |
| disclosure focus | active element retained; outline 3px, offset 3px | PASS |
| variant ArrowRight | B-3→B-4 selected/visible/focused | PASS |
| wraparound ArrowRight | B-4→B-1 selected/visible/focused | PASS |
| tab focus | selected tab outline 3px, offset 3px | PASS |
| reduced motion | media match true; animation/transition duration `1e-06s`; reset confirmed | PASS |
| browser console | warnings/errors 0 | PASS |

B-3's progressive Owner sequence advanced through all three questions. No separate in-panel back
control is asserted by this round-30 routing contract; keyboard variant navigation and the mobile
summary open/close path were both exercised explicitly.

## 17. Post-browser mutation guard and honest boundaries

After browser completion, the candidate was re-read from disk:

- bytes: `52,654`
- raw LF split: `509` entries (`508` text lines)
- SHA-256: `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`
- trailing-whitespace lines: `0`
- PII/secret findings: `0`

Therefore browser evidence is bound to the same exact input and is not stale. This review does
**not** claim product server routing, authenticated callback handling, RLS/DB enforcement,
hosted deployment, multi-connection behavior, or production integration; those are `NOT_RUN` and
remain outside this frozen prototype review.

## 18. Final verdict and downstream disposition

**PASS — exact candidate SHA-256
`DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` only.**

- non-browser: 44/44 renderer states, 4/4 chooser transitions, 7/7 normalization samples PASS
- browser: 264/264 state/theme/viewport rows and 12/12 chooser interactions PASS
- targeted accessibility/responsive/security interactions: PASS; console warning/error 0
- P0 routing/security regressions found: 0
- product state: `PROTOTYPE_ONLY / USER_SELECTION_AND_PRODUCT_HOLD`
- consumer: actual T05 foreman / T09 / user
- NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-CHECKPOINT-01` under T05 foreman

Recurrence rule: any late receipt or edit that changes the candidate bytes makes this verdict
immediately `STALE` and requires a new independent exact-hash review. T07 does not take candidate
writer ownership after release.
