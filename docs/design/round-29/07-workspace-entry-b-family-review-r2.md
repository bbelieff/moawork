# Workspace Entry B Family — Independent Exact-Hash Review R2

> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-INDEPENDENT-REVIEW-02`
> actual reviewer: T07, independent / non-author
> foreman: actual T05
> sole write lease: this file only
> candidate: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`
> exact candidate: **53,996 bytes / 713 physical lines / SHA-256 `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300`**
> R1 preserved immutable: **21,391 bytes / SHA-256 `1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E`**
> non-browser verdict: `PASS — EXACT CURRENT HASH`
> browser verdict: `PASS — EXACT CURRENT HASH`
> overall verdict: **`PASS — EXACT CURRENT HASH CCF67019...F300`**
> product state: **`USER_VARIANT_SELECTION_PENDING / PRODUCT_HOLD`**

## 1. Scope, independence, and stop rule

T07 did not author the style contract, process-rule patch, or candidate HTML. This review writes
only this R2 artifact. HTML, product, Git, DB, coordination, worklog, ROUND, and R1 are read-only.

Every finding is bound only to candidate SHA-256 `CCF67019...F300`. Any byte drift before or after
browser inspection makes the review `STALE/FAIL` and stops further judgment. A browser approval
request would be recorded as `NOT_RUN` without waiting or retaining the lease.

## 2. Exact source identity and R2 repair provenance

| source | bytes / physical lines | SHA-256 | role | identity |
|---|---:|---|---|---|
| Style SSOT `02-workspace-entry-b-style-contract.md` | 29,672 / 552 | `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D` | frozen visual acceptance contract | exact |
| Corrected R2 candidate | 53,996 / 713 | `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300` | B-1~B-4 comparison | exact |
| Immutable R1 FAIL review | 21,391 / 336 logical lines | `1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E` | defect provenance only | exact, not modified |

R1 FAIL provenance is preserved: FAIL-01 was B identity below the first acceptance viewport
(0/12 variant-viewport checks); FAIL-02 was B-3 desktop summary hidden in all eight states. The
corrected source makes the prototype precede the concept explanation in layout and removes the
unconditional B-3 summary `hidden` attribute. Its responsive CSS keeps collapsed disclosure under
`max-width: 980px`; desktop is expected to retain a visible right summary. These are source facts,
not yet browser acceptance claims.

## 3. Style-DNA consistency matrix

| contract dimension | B-1 Guided Fork | B-2 Guided Split | B-3 One Question | B-4 Compact Hub | non-browser decision |
|---|---|---|---|---|---|
| semantic palette | shared exact tokens | same | same | same | light 18/18, dark 17/17 |
| typography | shared locked stack/scale | same | same | same | PASS |
| outer prototype | 34px radius, line, shadow | same | same | same | PASS |
| guide identity | violet 44×44 `M` avatar | same | same | same | PASS |
| bubbles/icons | asymmetric assistant/user bubbles and common icon language | same | same | same | PASS |
| composition | two reply forks | two dialogue lanes | progressive question + responsive summary | compact hub rows | allowed differences |
| copy tone | short honorific + immediate reason | same | one-question focus | short revisit copy | PASS |
| motion | `.2s var(--ease)` | same | same | same | shared curve PASS |
| density | low | medium | progressive/low | compact medium | allowed band |
| header/footer | shared sticky header / no product footer | same | same | same | PASS |

The four zero-state renderer outputs are distinct (4/4), so the variants are not identical copies.
They reuse the same B primitives and visual grammar, so they do not reset into unrelated brands.
Static prohibited-language scan found A/C/D/old rail/canvas/dashboard selector or structural
leakage **0**.

## 4. Non-browser runtime harness

The candidate inline script was extracted in memory and executed against a minimal read-only DOM
stub. The actual `renderers[variant][scenario]` functions generated every branch; no product or
temporary file was written.

| gate | result |
|---|---:|
| inline JavaScript syntax | PASS |
| B-1~B-4 × 8 explicit renderer calls | **32/32 PASS** |
| generic lookup renderer, one per variant | **4/4 PASS** |
| distinct zero-state outputs | **4/4 distinct PASS** |
| aggregate harness assertions | **38/38 PASS, fail 0** |

## 5. Full 4×8 state/security matrix

Parentheses show actual tenant-transition/action count in each rendered branch.

| scenario | B-1 | B-2 | B-3 | B-4 | required boundary |
|---|---|---|---|---|---|
| `zero` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | create/join choices; real request/write 0 |
| `one` | PASS (1) | PASS (1) | PASS (1) | PASS (1) | unique active membership, then server recheck |
| `multiple` | PASS (2) | PASS (2) | PASS (2) | PASS (2) | user selection; no first/last/Owner auto-entry |
| `pending-create` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | not company/access/Owner; modify + cancel |
| `pending-join` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | not membership/access; modify + cancel |
| `new-owner` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | company → invite → CSV sequence only |
| `joiner` | PASS (1) | PASS (1) | PASS (1) | PASS (1) | member/minimal; skip Owner onboarding |
| `operator` | PASS (0) | PASS (0) | PASS (0) | PASS (0) | support request only; tenant action 0 |

Tenant counts are exactly `2/1/2/0/0/0/1/0` for every variant. Operator branches contain no
switch/create/join/enter transition. Pending branches each contain modify and cancel. Joiner has
no Owner-next or import action.

| invariant | evidence | result / boundary |
|---|---|---|
| owner exact-one/all protected | frozen copy separates protected Owner from admin/operator | PASS copy contract; DB NOT_RUN |
| multi-workspace account | explicit 2+ user selection, no automatic workspace inference | PASS |
| Platform operator has tenant membership/action 0 | four operator renderers, action count 0 | PASS |
| approval and pending safety | pending is not access; modify/cancel available | PASS |
| join default member/minimal | copy denies automatic promotion | PASS |
| joiner excludes Owner flow | owner onboarding actions 0 | PASS |
| new Owner order | company → invite → CSV | PASS prototype contract |
| exact/generic enumeration safety | exact access 0; generic six-field disclosure denial | PASS |
| fake success/data | prototype truth preserves request/write/access 0 | PASS |
| last workspace is not authorization | explicit static contract | PASS |

This HTML does not execute authentication, RLS, tenant access, approval transactions, DB writes,
imports, hosted Supabase, production routing, Git, merge, or deployment. Those remain
`NOT_RUN / OUT_OF_SCOPE`; prototype PASS cannot be promoted to any of them.

## 6. Privacy, source hygiene, and corrected-source scan

| scan | count/result |
|---|---:|
| external script | 0 |
| email-like literal / raw invite code / secret assignment | 0 / 0 / 0 |
| NUL / Unicode replacement character | 0 / 0 |
| trailing-whitespace lines | 0 |
| generic non-enumerating safe copy | 1 shared envelope |
| B-3 unconditional summary `hidden` attribute | 0 |
| responsive `data-summary-open` state hooks | 2 |
| prototype-first ordering rule | 1 |

## 7. Browser acceptance matrix — complete

Exact URL:
`http://127.0.0.1:4323/MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`

| gate | result | decision |
|---|---:|---|
| HTTP status / served body bytes / computed body SHA | 200 / 53,996 / `CCF67019...F300` | PASS |
| 1280×720, 390×844, 320×800 × 4 variants × 8 states | **96/96** | PASS |
| horizontal overflow / core escape | **0/96 / 0/96** | PASS |
| visible controls below 44px | **0/96** | PASS |
| operator forbidden tenant action/transition | **0/12** | PASS |
| pending modify + cancel | **24/24** | PASS |
| R1 FAIL-01: ≥3 first-viewport B primitives | **12/12** | PASS repaired |
| R1 FAIL-02: B-3 desktop summary width ≥290px | **8/8 at 489.203px** | PASS repaired |
| B-3 mobile collapse/disclosure | **2/2** | PASS |
| dark mode × variant × viewport | **12/12; overflow 0** | PASS |
| variant ArrowRight/wrap/focus | **2/2; 3px / 3px** | PASS |
| B-3 progression/back / Owner sequence | **PASS / PASS** | PASS |
| generic lookup per variant | **4/4** | PASS |
| reduced motion / console warning+error | **PASS / 0** | PASS |

### 7.1 HTTP and exact-current binding

The exact URL returned HTTP 200. UTF-8 response-body length was **53,996 bytes** and independently
computed response-body SHA-256 was
`CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300`.
Disk identity before browser matched the same bytes/hash. The lightweight local server did not
emit `Content-Length`, `ETag`, or `X-Content-SHA256`; therefore no server-declared header hash is
invented. The body itself is exact.

After the complete browser suite, disk identity remained **53,996 bytes / 713 physical lines /
the same SHA-256**. R1 also remained **21,391 bytes /
`1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E`**.

### 7.2 Full 96-row responsive/state regression

Every row had exactly one visible variant, the requested `data-scenario`, the expected tenant
action count (`2/1/2/0/0/0/1/0`), document overflow ≤1px, no root/prototype horizontal escape,
and no visible control shorter than 44px. Operator branches had forbidden create/join/switch/
Owner/import actions 0 in 12/12 rows. Both pending branches had one modify and one cancel action in
24/24 rows.

Dark mode passed 4 variants × 3 viewports = 12/12 with horizontal overflow 0. Runtime dark tokens
included paper `#0C0D10`, surface `#111216`, and ink `#F7F8FA`; the page was restored to light.

### 7.3 R1 FAIL-01 repaired — B identity in the first viewport

Identity categories were guide avatar, assistant bubble, reply/composition, and summary/progress.

| viewport | B-1 | B-2 | B-3 | B-4 | prototype absolute top |
|---|---:|---:|---:|---:|---:|
| 1280×720 | 4 | 4 | 4 | 4 | 83px |
| 390×844 | 4 | 4 | 4 | 4 | 75px |
| 320×800 | 3 | 3 | 4 | 3 | 75px |

All **12/12** variant-viewport rows expose at least three B identity primitives before the first
viewport ends. Guide top was 182.969px at desktop; at mobile it was 162.969px for B-3 and
622.836px for B-1/B-2/B-4. This directly reverses R1's immutable 0/12 defect without importing
A/C/D/old rail/canvas/dashboard language.

### 7.4 R1 FAIL-02 repaired — B-3 summary

At 1280×720, the B-3 `.b-summary` was `display:block`, width **489.203px**, height 650px in all
eight states. The compact disclosure was `display:none`. Result: **8/8 PASS** against the ≥290px
desktop gate.

At 390×844 and 320×800, the default summary was collapsed and the disclosure was visible with
`aria-expanded=false`. Opening it produced visible widths 353px and 290px respectively, three
summary steps, `aria-expanded=true`, retained focus, and exact 3px outline / 3px offset. Closing
worked. Result: **2/2 PASS**; desktop repair did not break mobile disclosure.

### 7.5 Computed style-DNA evidence

Across B-1~B-4 at 1280 light:

- prototype: width 1,225px, radius 34px, 1px border, shadow
  `rgba(29,39,64,.1) 0 22px 70px`;
- chat/summary: 733.797px / 489.203px, ratio 1.500, summary minimum 290px;
- guide avatar: 44×44px, radius 15px, violet `rgb(107,92,255)`;
- assistant bubble: padding 15px 17px, radius `8px 18px 18px`, font 16px;
- topbar: sticky, z-index 80, height 73px.

The exact shared values establish one B family, while renderer output cardinality 4/4 and the
fork/split/progressive/compact composition signatures establish four non-identical alternatives.
A/C/D/old rail/canvas/dashboard leakage remains 0.

### 7.6 Interaction, lookup, motion, and console

- ArrowRight moved selected/visible/focused B-3 → B-4 and wrapped B-4 → B-1. Focus ring was 3px
  with 3px offset.
- B-3 zero-state moved step 1 → 2 → 3 and back to 2 without a write or real request.
- B-3 new Owner sequence exposed company name at 1/3, invite choices at 2/3, and exactly one CSV
  preview plus one resume action at 3/3; tenant action count stayed 0.
- Generic lookup passed 4/4. Before submit, every variant used the same six-field
  non-enumerating envelope. After submit, B-1/B-2/B-4 returned the same existence-independent
  guidance and cooldown; B-3 advanced while explicitly announcing that no company information
  was disclosed. Candidate/customer data disclosure 0.
- One initial generic-test assertion expected the long pre-submit wording to remain verbatim
  after submit, so it reported 1/4. Inspection showed the three branches had intentionally changed
  to the shorter but still non-enumerating envelope; the corrected semantic assertion passed 4/4.
  This was a harness-expectation mismatch, not a product defect.
- Reduced-motion emulation matched `reduce=true`, scroll behavior `auto`, transition and animation
  `0.000001s`; it was reset to no-preference. A first measurement expression used an unavailable
  page helper and stopped before judgment; the equivalent numeric read passed and the emulation
  was reset. This is infrastructure provenance, not a candidate failure.
- Console warning/error count after the entire suite: **0**.

### 7.7 Screenshot and measurement receipts

Screenshots remained in browser memory because the sole lease forbids sidecar image files. The
observed JPEG bytes and hashes bind representative light/B-1/zero frames:

| requested viewport | normal bytes / actual pixels / SHA-256 | full-page bytes / actual pixels / SHA-256 |
|---|---|---|
| 1280×720 | 62,641 / 1265×712 / `FD63D9903BCAAA5A932F6CD5A3363A83160E815665D42B85DFEB43123AA11DE6` | 125,544 / 1265×1540 / `CCE94DF85C251FE54C26AD79926A7F4F525A0F7ABC7B3AB203B2BC231FB001F8` |
| 390×844 | 30,252 / 375×812 / `EF43787265E1AF3FD69E0D53B1CD6A8F0A110A0004BDE1BB8ED13900BB591053` | 23,141 / 375×2017 / `FE206B012A269F1648F08C38E0E736CDEE14F62534886E127BCCE5010CC4A7B4` |
| 320×800 | 25,086 / 305×763 / `7B622CD655F81D7BCD5B154D9C0276E17B43BF001FF54D6FDED7518FE9F5702A` | 23,481 / 305×2098 / `BFBE00532852C49D7C7D4572A3D8764B2E413131A8AFD924BBAA508E6DDD2648` |

The viewport override was reset and the review tab was finalized after restoring light / B-1 /
zero state.

### 7.8 Honest NOT_RUN boundaries

- Native Enter/Space activation as a separate synthetic assertion: `NOT_RUN — browser automation
  surface did not provide stronger evidence than native button semantics`; Arrow navigation,
  selection, focus movement, and focus visibility are runtime PASS.
- 200% text zoom and visual-diff SSIM/DeltaE: `NOT_RUN — no frozen comparison-image harness in
  this lease`.
- Authentication, RLS, DB transactions, hosted Supabase, production routing, Git/PR/merge/deploy:
  `NOT_RUN / OUT_OF_SCOPE`.

## 8. CHECKPOINT — NON-BROWSER COMPLETE

- checkpoint date: `2026-07-25 Asia/Seoul`
- exact candidate: 53,996 bytes / 713 physical lines /
  `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300`
- exact Style SSOT: 29,672 bytes / 552 physical lines /
  `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D`
- immutable R1 review exact and unmodified: 21,391 bytes /
  `1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E`
- style DNA: shared tokens/primitives PASS; four compositions distinct; A/C/D leakage 0
- runtime: 38/38 PASS; actual render 32/32; generic 4/4; distinct 4/4
- operator: tenant transition/action 0 across four variants
- privacy/secret/trailing whitespace: PASS
- browser at checkpoint: `NOT_STARTED` (the required checkpoint was written before browser use)
- later result: HTTP exact-body PASS; browser 96/96 and focused gates PASS; post-browser hash exact
- last successful step at checkpoint: complete non-browser checkpoint materialized in sole R2 lease
- next step at checkpoint: re-hash disk, verify exact HTTP response, then approval-free browser regression

## 9. Recurrence and disposition rule

1. Any candidate-byte drift makes this checkpoint and any later verdict immediately `STALE/FAIL`.
2. Any late worker receipt that changes the candidate after independent review also makes the
   verdict stale until a new exact-hash review.
3. A FAIL returns the exact defect through T05; T07 does not take candidate writer ownership.
4. A PASS still leaves B-1/B-2/B-3/B-4 user selection and all product work on HOLD.
5. PASS next work is `WORKSPACE-ENTRY-B-FAMILY-USER-DECISION-01`.
6. Consumer: T05 / T09 / user.

## 10. Final verdict and downstream state

**PASS — exact corrected candidate `CCF67019...F300`.** The corrected candidate preserves the
frozen B visual DNA, keeps four meaningfully different B compositions, passes the full 96-row
state/responsive/security matrix, and repairs both immutable R1 defects: first-viewport identity is
12/12 and B-3 desktop summary is 8/8 at 489.203px while mobile disclosure remains 2/2.

This is not product selection or implementation approval. State is
**`USER_VARIANT_SELECTION_PENDING / PRODUCT_HOLD`**. No product, Git, DB, PR, merge, or deploy
action is authorized by this review.

- consumer: T05 / T09 / user
- next WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-USER-DECISION-01`
- recurrence: any later candidate-byte change makes this PASS immediately stale until a new
  independent exact-hash review
