# Workspace Entry B Family — Routing Independent Review Recovery

> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-INDEPENDENT-REVIEW-RECOVERY-01`
> actual reviewer: T08 replacement independent reviewer / non-author
> controller and foreman: actual T05
> sole write lease: this review artifact only
> candidate: **52,654 bytes / 508 text lines / SHA-256 `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`**
> routing contract: **30,418 bytes / 553 text lines / SHA-256 `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB`**
> final verdict: **`PASS_EXACT_CURRENT_HASH / PROTOTYPE_BROWSER_RECOVERY_COMPLETE`**
> product state: `PROTOTYPE_ONLY / PRODUCT_GIT_DB_DEPLOY_HOLD`

## 1. Scope and independence

T08 did not author the v0.3 candidate, T02 routing contract, or T07 review. Only this recovery
artifact may be written. Candidate, T07 artifact, contracts, coordination, ROUND, worklog,
product, Git, DB, and deployment remain read-only. Any candidate byte drift makes the result
`STALE/FAIL`. Prototype evidence cannot be promoted to server routing, session, RLS, DB, product,
merge, deployment, or live-production evidence.

## 2. Frozen inputs

| input | bytes / text lines | SHA-256 | T08 disposition |
|---|---:|---|---|
| `brand/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html` | 52,654 / 508 | `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` | exact candidate; MATCH |
| `docs/design/round-30/02-workspace-entry-b-routing-contract.md` | 30,418 / 553 | `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB` | exact T02 contract; MATCH |
| `docs/design/round-30/07-workspace-entry-b-routing-review.md` | 13,116 / 222 | `113981AF83425F40C5FED5BB3F74E071AF7779B46A2201B5016BD5B4EA5BD4F5` | dispatch-time T07 checkpoint, read-only; MATCH at T08 start |

The candidate freeze was independently recomputed before this file was created. The T02 locked
decision table requires zero selection CTA for verified one/one-pending/accepted target, chooser
and one selection for multiple, generic fail-closed slug/anomaly behavior, Platform/tenant
separation, and no product success claim.

## 3. T07 provenance and recovery boundary

At T08 recovery start, T07's file ended at `NON_BROWSER_PASS / BROWSER_NOT_STARTED` and did not
contain a finished browser verdict. T07 later entered `waitingOnApproval` during a final browser
call while holding no writer lease. That is an execution-environment incident, not a product
finding, and T08 did not edit, complete, or impersonate T07's artifact or unfinished turn.

The controller supplied these subsequent T07-reported browser counts for provenance only:

| T07-reported item | reported result | ownership label |
|---|---:|---|
| viewport/theme/variant/state rows | 264/264 | `T07_REPORTED / NOT_T08_RERUN` |
| horizontal overflow | 0 | `T07_REPORTED / NOT_T08_RERUN` |
| controls below 44 px | 0 | `T07_REPORTED / NOT_T08_RERUN` |
| B-3 desktop disclosure | 22/22 | `T07_REPORTED / NOT_T08_RERUN` |
| mobile collapse | 44/44 | `T07_REPORTED / NOT_T08_RERUN` |
| slug samples | 4/4 | `T07_REPORTED / NOT_T08_RERUN` |
| Owner samples | 4/4 | `T07_REPORTED / NOT_T08_RERUN` |

These counts are not inherited PASS evidence. T08 will record its bounded browser sample with a
separate denominator and leave any blocked checks as honest `NOT_RUN`.

During T08's final receipt validation, the read-only T07 artifact had independently grown to
20,494 bytes / 359 text lines / SHA-256
`7FE3658305C98C1C621C2EEEBFA25844772EA884AEEF9C92547B41EA3CF174EE`. Its new sections report
T07's own completed browser evidence and exact-hash PASS. This is a foreign-artifact chronology
change, not candidate drift: T08 neither wrote it nor uses its later PASS to fill any T08
denominator. The dispatch-time receipt above remains the proven recovery provenance, while the
later receipt is recorded to avoid falsely claiming the T07 file stayed unchanged.

## 4. T08 static read-back

- Candidate embeds the exact T02 contract hash and labels itself
  `ROUTING_CANDIDATE_FROZEN`, `BROWSER_NOT_RUN`, and prototype-only with zero requests/writes.
- B-1 through B-4 each expose the 11 declared states through renderer maps.
- `one`, `one-pending`, `accepted-target`, and `joiner` render server-decision preview evidence
  for `/w/{slug}` with click evidence 0 and no tenant action button.
- `multiple` initially renders two chooser actions and, only after one choice, click evidence 1.
- `operator` renders a support-only action and no tenant action; `inactive-anomaly` renders a
  generic retry with no target identity.
- `normalizeSlug` uses NFKC, lowercase, trim, space/underscore-to-hyphen, illegal character
  removal, hyphen collapse/trim, and 40-character cap. Preview remains non-reservation.
- Responsive rules exist for 980, 700, 390, and 340 px; all common interactive control classes
  have minimum height 44 px; a reduced-motion media query reduces transition and animation
  duration and disables smooth scrolling.
- Variant tabs implement Arrow keys and Home/End; focus-visible and skip-link styles exist.

This is source-level contract evidence only. It does not replace browser layout, focus, console,
or media-emulation evidence.

## 5. CHECKPOINT R0 — complete non-browser recovery start

- timestamp: `2026-07-25 22:24:15 +09:00`
- candidate bytes/hash: exact MATCH, frozen before write
- T02 contract and T07 checkpoint: exact MATCH
- provenance boundary: T07 artifact and later reported counts separated
- checkpoint verdict at R0: `NON_BROWSER_PASS / BROWSER_RECOVERY_PENDING`
- last successful step: exact input freeze and static contract read-back
- next safe step: start a read-only static server, bind HTTP 200 body bytes/hash, then run the
  bounded 1280/390/320 browser sample, reduced motion, keyboard/focus, and console checks
- approval rule: if browser is approval-gated, record `NOT_RUN`, finalize the non-browser verdict,
  release this lease, and do not wait silently
- INTERNAL_SUBAGENT_ONLY: `NONE`

## 6. Static server and exact HTTP binding

The pre-existing listeners on ports 4323 and 4324 were not owned or stopped by T08. T08 started
a separate read-only Node static server from the `brand` directory:

```text
http://127.0.0.1:48731/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html
```

| check | result |
|---|---|
| HTTP status | `200` |
| response content type | `text/html; charset=utf-8` |
| response `Content-Length` | `52654` |
| response body bytes | `52,654` |
| response body SHA-256 | `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` |
| disk candidate after browser work | same 52,654 bytes / same SHA |

The HTTP body is byte-identical to the frozen candidate. No temporary HTML copy was created.

## 7. T08 bounded browser sample

### 7.1 Coverage and layout gates

T08 ran one exact browser row for every B variant × required critical state pair: four variants ×
seven states = **28 rows**. Viewport/theme profiles were distributed across those pairs rather
than claiming the T07-reported exhaustive 264-row cross product.

| dimension | T08 coverage |
|---|---|
| viewport | 1280×900, 390×844, 320×720 |
| theme | light and dark at every viewport width |
| variant | B-1, B-2, B-3, B-4 |
| state | `zero`, `one`, `one-pending`, `accepted-target`, `multiple`, `operator`, `inactive-anomaly` |
| layout | document/body horizontal overflow ≤ 0; active panel left/right escape 0 |
| controls | visible button height below 44 px: 0 |
| focus after state render | active focus remained inside active panel: 28/28 |

Initial automated evaluation returned **27/28** because its inactive assertion searched for the
literal hidden-summary phrase `target identity를 공개하지 않고`. B-3 intentionally collapses
that summary at 390 px. T08 did not convert this silently to PASS: a targeted visible-DOM
read-back confirmed all of the actual contract signals — generic recovery question, explicit
inactive/unknown non-optimistic helper, retry-only action, tenant action 0, server route 0,
`/w/{slug}` route 0, and actual-effects-zero prototype copy. The row is therefore an assertion
false-negative, not a candidate failure. **Adjudicated browser result: 28/28 PASS.**

### 7.2 Routing semantics

| state | expected | T08 browser result |
|---|---|---:|
| `zero` | create/join choices 2; pre-choice route 0 | 4/4 PASS |
| `one` | tenant CTA 0; `/w/{slug}` evidence; click 0 | 4/4 PASS |
| `one-pending` | same zero-click target; pending nonblocking | 4/4 PASS |
| `accepted-target` | target evidence; extra selection 0 | 4/4 PASS |
| `multiple` before choice | chooser tenant actions 2; auto-route 0; click count 0 | 4/4 PASS |
| `operator` | tenant actions 0; tenant route 0; support-only | 4/4 PASS |
| `inactive-anomaly` | generic retry; target/route/tenant action 0 | 4/4 PASS after the documented false-negative adjudication |

The multiple state was then exercised separately in all four variants. One unique chooser row was
clicked in each path. Each result changed to click evidence 1, tenant action 0, one
server-revalidation route for `/w/{slug}`, and focus inside the active panel: **4/4 PASS**.

### 7.3 Zero-create slug normalization

Each B variant was returned to `zero`, the create path was chosen once, and the visible slug input
was filled through the browser:

| variant | input class | visible preview | result |
|---|---|---|---:|
| B-1 | trim + uppercase + double underscore | `/w/my-company` | PASS |
| B-2 | full-width NFKC letters/numbers | `/w/abc-123` | PASS |
| B-3 | Korean-only candidate | `/w/{slug}` + explicit 3-character/non-reservation guidance | PASS |
| B-4 | leading/repeated hyphen and underscore | `/w/a-b` | PASS |

All four kept focus in the input, had no horizontal overflow, and used generic unavailable or
non-reservation wording. Result: **4/4 PASS**.

## 8. Accessibility, motion, console, and visual read-back

### 8.1 Keyboard and focus

The tablist was exercised with `Home`, `ArrowRight`, `End`, and `ArrowLeft`. Each key selected the
expected B tab, made exactly one tabpanel visible, moved focus to the selected tab, and retained a
visible solid focus outline: **4/4 sequences PASS**. The 28 state changes independently placed
focus in the active panel's programmatic focus target.

### 8.2 Reduced motion

The browser emulated `prefers-reduced-motion: reduce`; `matchMedia` returned true. Computed
evidence was:

```text
html scroll-behavior: auto
body/button transition-duration: 0.000001s
body/button animation-duration: 0.000001s
```

Result: **PASS**. The emulation was reset after inspection and `matchMedia` returned false.

### 8.3 Console

After all routing, chooser, slug, theme, viewport, keyboard, and reduced-motion interactions:

```text
console errors/warnings: 0
all captured console entries: 0
```

Result: **PASS**.

### 8.4 Visual sample

T08 visually inspected three live viewport captures without writing image files:

1. 1280 light, B-1 `one`: zero-click evidence, two-column content, and summary visible without
   clipping.
2. 390 dark, B-3 `multiple`: single-column controls and dark tokens readable; chooser state and
   collapsible-summary composition remained within the viewport.
3. 320 light, B-4 `inactive-anomaly`: generic recovery card, retry action, prototype-zero copy,
   and compact single-column layout visible without horizontal escape.

The first capture initially reflected the focus-induced document scroll position; T08 explicitly
returned toward the top and recaptured the B-1 route content. This was viewport state, not missing
content.

## 9. Honest NOT_RUN and non-promotion boundaries

| item | T08 status | reason |
|---|---|---|
| full 264-row viewport × theme × variant × all-state matrix | `NOT_RUN` | T08 was assigned a bounded critical sample; T07's later artifact reports 264/264 but remains separate provenance |
| real server redirect and first response | `NOT_RUN` | static prototype intentionally performs no route |
| session/callback/RLS/DB/cross-tenant enforcement | `NOT_RUN` | no product or DB implementation in scope |
| public deployment/live production | `NOT_RUN` | local static server only |
| user variant selection and product merge approval | `NOT_RUN / HOLD` | independent prototype review does not replace user decision |

No `NOT_RUN` item is counted as PASS.

## 10. Final exact-hash verdict and disposition

- final timestamp: `2026-07-26 12:06:16 +09:00`
- candidate after all browser work: 52,654 bytes / 508 text lines /
  `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`
- contract after all browser work: 30,418 bytes / 553 text lines /
  `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB`
- T07 artifact at T08 recovery start: 13,116 bytes / 222 text lines /
  `113981AF83425F40C5FED5BB3F74E071AF7779B46A2201B5016BD5B4EA5BD4F5`
- T07 artifact at T08 final validation: 20,494 bytes / 359 text lines /
  `7FE3658305C98C1C621C2EEEBFA25844772EA884AEEF9C92547B41EA3CF174EE`
- T07 artifact drift disposition: foreign read-only chronology update; candidate and contract
  remained exact; T08 PASS denominators remain independently produced and unchanged
- browser sample: 28/28 adjudicated PASS; multiple after-click 4/4 PASS; slug 4/4 PASS;
  keyboard 4/4 PASS; reduced motion PASS; console errors/warnings 0
- verdict: **`PASS_EXACT_CURRENT_HASH / PROTOTYPE_BROWSER_RECOVERY_COMPLETE`**
- T07 turn was unfinished at recovery dispatch; its later on-disk finalization is recorded but
  **not claimed, edited, or inherited by T08**
- candidate/T07/coordination/worklog/ROUND/product/Git/DB writes: **0**
- sole file written: this T08 recovery review artifact
- implementation state: `PRODUCT_GIT_DB_DEPLOY_HOLD`
- consumers: T05 / T09
- NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-FOREMAN-ACCEPTANCE-01` — T05 performs
  independent artifact/hash read-back and decides release; no candidate writer is implied
- INTERNAL_SUBAGENT_ONLY: `NONE`
