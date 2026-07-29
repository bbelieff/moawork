# MWC R1 Wave B — PostHog verification checkpoint

- WORK-ID: `MWC-R1-B-POSTHOG-VERIFY-FORWARD-FIX`
- role: `WORKER/WRITER`
- thread: `019faded-e320-70c3-9bd4-0f323500b3bf@local`
- return_to: `019fadea-5098-75a3-b77d-1bdd81815336@local`
- worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-mwc-r1-posthog-b`
- branch: `verify/mwc-r1-posthog`
- base/head at checkpoint start: `e1a3a052d121c2dbb527f9b79ed34b04e06ced72`
- PR #27: merged as the same `main` SHA
- BLUEPRINT SHA-256: `95C72A3A4380D39DF003FB0F8925DF3B306010508583B6EED35F2C1443F23A66`
- INTERNAL_SUBAGENT_ONLY: `NONE`

## Lease and safety boundary

The B writer exclusively owns this checkpoint and the minimum PostHog-related app/tests/docs needed for a forward-fix. It does not write A/C recovery destinations. No `.env*` contents were read or copied; only tracked example/config filenames and variable names may be inspected. No customer data, credentials, project-key values, raw email, customer name, search term, or raw URL query value may enter evidence, tests, events, logs, or commits.

## PR #27 vs Wave B — observed state

| Wave B requirement | PR #27 observed state | checkpoint verdict |
| --- | --- | --- |
| US region only | Default is `https://us.i.posthog.com`, but `NEXT_PUBLIC_POSTHOG_HOST` accepts EU or any HTTPS origin in both runtime config and rewrites. | `GAP` |
| same-origin `/ingest` | SDK `api_host=/ingest`; static and catch-all rewrites exist; auth proxy matcher excludes only the exact `/ingest` boundary. | `CODE_PRESENT`, build/runtime recheck pending |
| analytics must fail open | Missing/invalid key leaves analytics disabled and SDK load/capture errors do not stop product code. | `CODE_PRESENT`, tests/build pending |
| no PII/raw email/customer/search/query | Key/value scrubber and full replay masking exist, but pageviews construct the full query string and the URL scrubber preserves allowlisted query values. Wave B forbids raw URL query values, so route telemetry must not include any query value. | `GAP` |
| minimum product events | Current custom events are `deal_created`, `deal_moved`, `meeting_logged`; no app call sites use them. Login result, workspace-entry state, company create/join request, and first workspace entry are not wired. `$pageview` exists but currently includes query material before scrubbing. | `GAP` |
| replay masking | Inputs and all text are masked; sensitive selectors are blocked; account/hometax/settlements route prefixes stop recording. | `CODE_PRESENT`, tests/browser pending |
| no duplicate implementation | PR #27 is already merged and is the base. | `PASS` |

## Minimum forward-fix

1. Freeze the PostHog upstream and asset rewrites to the US endpoints; remove the public host override from runtime behavior and docs.
2. Emit route telemetry from a normalized route key only, never from `location.search`, raw slug, customer name, or search term.
3. Replace the unused deal/meeting event contract with the Wave B categorical event contract and wire:
   - login attempt result (`success` or safe failure category),
   - workspace-entry state,
   - company create or join request result,
   - first workspace entry,
   - normalized core-route transition.
4. Keep analytics no-op/fail-open when configuration or the SDK is unavailable.
5. Extend unit tests for the US lock, raw-query prohibition, event whitelist/payload keys, replay masking, and no-op behavior; then run lint, typecheck, unit, full check, and production build.
6. Freeze the candidate hash for independent review. Only create a PR if this forward-fix remains necessary after tests.

## Verification state at FIRST_WRITE

- canonical documents and BLUEPRINT: `PASS` (UTF-8 full read; expected BLUEPRINT hash matched)
- exact remote main / PR #27 merge: `PASS`
- implementation tests: `NOT_RUN` at FIRST_WRITE
- independent review: `NOT_RUN`
- Production deployment and public console/network: `NOT_RUN`
- actual PostHog receipt: `NOT_RUN`; may become `LIVE_DATA_VERIFIED` only if a project key is already injected safely and a real receipt can be observed without exposing it

## Next safe action

Read the installed Next.js 16 client-component/navigation guidance, implement the bounded forward-fix above, and keep this file updated with exact hashes and verification receipts.

## Forward-fix candidate

The three blocking gaps are closed in the candidate:

- US lock: `NEXT_PUBLIC_POSTHOG_HOST` was removed from runtime config and the tracked example. `/ingest/static/*` is fixed to `https://us-assets.i.posthog.com`; `/ingest/*` is fixed to `https://us.i.posthog.com`.
- minimum collection: autocapture and pageleave are disabled. The allowlist contains only four categorical product events plus `$pageview` and masked replay `$snapshot`.
- query/path privacy: all URL query and hash material is removed. Dynamic paths and automatic PostHog URL/path properties are reduced to a finite pathname template such as `/w/:workspace`, `/boards/:board`, or `/other`.
- call sites: login result, Workspace entry state, create/join request result, and first successful canonical Workspace entry send safe enums only. The login attempt marker and first-entry marker use bounded session storage and never contain identity or customer data.
- fail-open: missing/invalid key keeps analytics disabled; SDK/storage/capture unavailability does not interrupt authentication, Workspace entry, or product rendering. A bounded in-memory queue preserves initial categorical events until the configured SDK instance is ready.

## Candidate verification receipts

| check | result |
| --- | --- |
| focused analytics tests | `PASS` — 5 files, 92 tests. An earlier run had 90 PASS / 2 FAIL because old URL expectations still expected pre-template paths; expectations were corrected to the approved finite templates and the rerun passed. |
| `scripts/check.sh` | `PASS` via `C:\Program Files\Git\bin\bash.exe` after bare `bash` was unavailable in PowerShell — app 738 PASS / 5 credential-gated RLS skips; worker 14 PASS; lint and both typechecks PASS. |
| production build | `PASS` — Next.js 16.2.10 compiled, typechecked, generated 34/34 static pages, and collected all routes. |
| built rewrite manifest | `PASS` — `/ingest/static/:path*` targets `https://us-assets.i.posthog.com/static/:path*`; `/ingest/:path*` targets `https://us.i.posthog.com/:path*`. |
| host override/static scans | `PASS` — no runtime `NEXT_PUBLIC_POSTHOG_HOST` or EU destination remains; call-site payloads contain only reviewed enums/templates. |
| secret/PII material | `PASS` for changed code/diff review — no credential value or customer payload was added; test email data uses reserved synthetic domains only. |
| independent review | `NOT_RUN` until exact candidate tree is frozen below and dispatched by FOREMAN. |
| Production/public browser | `NOT_RUN` for this uncommitted candidate. |
| actual PostHog receipt | `NOT_RUN`; no project key value was read or exposed. |

## Release boundary

Do not commit or publish until the independent reviewer approves the exact frozen candidate. After review PASS, this writer owns commit, push, PR, CI, merge, Production deployment, public console/network verification, and any minimum forward-fix required by those gates.
