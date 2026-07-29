# MWC R1 Wave A recovery checkpoint

- WORK-ID: `MWC-R1-A-SAFE-RECOVERY`
- role: `WORKER/WRITER`
- thread: `019faded-b627-7782-ad36-deec3c0b3313@local`
- return_to: `019fadea-5098-75a3-b77d-1bdd81815336@local`
- worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-mwc-r1-recovery-a`
- branch: `chore/mwc-r1-safe-recovery`
- base: `e1a3a052d121c2dbb527f9b79ed34b04e06ced72`
- internal helper: `NONE`
- lease carve-outs: `docs/evidence/mwc-r1-recovery/B-POSTHOG-CHECKPOINT.md`; `docs/design/prototypes/mwc-r1-platform-admin-4way/**`

## Canonical input verification

- `ABSOLUTE-COLLABORATION-STATE-MACHINE.md`: `4F5B876A616FF886199D1C791874F83A607DE3FA45CD5FF202E5E6E90F608422`
- `CODEX-T-SESSION-ROUTING.md`: `F1BCA2D0100E7703A67582BF8DF2316A3ABF409D865318E3A89E98ED053B055D`
- `COMMON-PRODUCT-DELIVERY-GATES.md`: `D9E6EE9D9B0850DD16E9D5DA0CD7F5D2D69385CF9C1D07650D7FC5B877EDC905`
- `01-MoaWork-Control-운영프롬프트.txt`: `8F4716B8C854580D0A5DC0261573AE790BC8800F4083EBF3E605F5EBE1188826`
- BLUEPRINT: `95C72A3A4380D39DF003FB0F8925DF3B306010508583B6EED35F2C1443F23A66` (`MATCH`)
- conflict resolution: the BLUEPRINT's historical base `d172875...` is superseded by verified current `origin/main@e1a3a052d121c2dbb527f9b79ed34b04e06ced72`.

## Source inventory

The inventory inspected file names, relative paths, and sizes under the non-canonical source. It did not read or copy any `.env*` file contents.

- total source files: `2,850`
- `.env*` names excluded: `2` (`.env.local`, `infra/.env.example`)
- leased recovery candidates: `87`
- candidates overlapping B/C carve-outs: `0` (`HOLD` rule applies if a later source appears)
- direct destinations: `43`
- archive-only destinations: `44`

| Source scope | Files | Destination rule |
| --- | ---: | --- |
| `docs/plans/**` | 5 | original relative path |
| `docs/design/**` | 15 | original relative path |
| `docs/evidence/**` | 4 | original relative path |
| `docs/direct-to-codex/**` | 2 | original relative path |
| `docs/decisions/**` | 4 | original relative path |
| `docs/playbooks/**` | 1 | original relative path |
| `docs/ssot/**` | 4 | original relative path |
| `dev-drop/**` | 8 | original relative path |
| `docs/coordination/**` | 29 | `docs/archive/mwc-r1-2026-07-27/docs/coordination/**` |
| `docs/track-prompts/**` | 5 | `docs/archive/mwc-r1-2026-07-27/docs/track-prompts/**` |
| `docs/incidents/**` | 2 | `docs/archive/mwc-r1-2026-07-27/docs/incidents/**` |
| `docs/worklog/**` | 6 | `docs/archive/mwc-r1-2026-07-27/docs/worklog/**` |
| `docs/worklog.md` | 1 | `docs/archive/mwc-r1-2026-07-27/docs/worklog.md` |
| `docs/PLAN-v0.2.md` | 1 | `docs/archive/mwc-r1-2026-07-27/docs/PLAN-v0.2.md` |

## Destination collision map

Existing destination files are preserved. The three colliding source files are routed to `_MWC` siblings.

| Source | Existing destination | Recovery destination |
| --- | --- | --- |
| `docs/decisions/ADR-0003-임의보드-MVP포함.md` | same relative path | `docs/decisions/ADR-0003-임의보드-MVP포함_MWC.md` |
| `docs/design/design-tokens.md` | same relative path | `docs/design/design-tokens_MWC.md` |
| `docs/design/먼데이-전체스키마-v1.md` | same relative path | `docs/design/먼데이-전체스키마-v1_MWC.md` |

## Safety state and next action

- existing destination overwrite: `0`
- product source changes: `0`
- current `docs/coordination/**` or current worklog changes: `0`
- `.env*` content reads/copies: `0`
- last successful stage: source inventory and destination collision map completed
- next safe action: copy only the 87 mapped files, verify source/destination byte and SHA-256 equality, then run bounded secret/static/dev-drop/diff checks

## Material recovery receipt

- copied mapped files: `87`
- source/destination byte and SHA-256 mismatches: `0`
- `.env*` copied: `0`
- B/C carve-out writes: `0`
- existing destination overwrites: `0`
- last successful stage: mapped copy and per-file byte/SHA-256 integrity comparison completed
- next safe action: run secret-pattern scan, static HTML/open checks, pure dev-drop tests, and repository diff/build-impact checks

## Privacy-safe recovery rewrite

- secret-pattern hits across the exact 88-file recovery set: `0`
- risky identity-format source text was not retained verbatim in the recovery copies
- de-identified in recovery copies only: email `37`, phone `11`, resident-number-shaped text `4`
- replacement policy: reserved `example.com` addresses, `010-0000-0000`, and non-valid `000000-0XXXXXX`
- exact post-rewrite scan: non-example email `0`, non-dummy phone `0`, resident-number pattern `0`
- non-canonical source changes: `0`
- reason: historical coordination, evidence, and mockup text must not carry identifiable source material into Git

One de-identification command initially included the tracked collision source `docs/design/먼데이-전체스키마-v1.md`. The scope error was detected immediately and that single tracked file was restored from exact `HEAD`; subsequent `git diff --name-only` for tracked files returned empty. All later scans used the explicit 88-file recovery list only.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| source/destination copy integrity | `PASS` before privacy rewrite | 87 files; bytes/SHA-256 mismatches `0` |
| secret scan | `PASS` | 88 exact recovery files; secret-pattern hits `0` |
| privacy scan | `PASS` after de-identification | unsafe email/phone/resident-number patterns `0` |
| HTML structure | `PASS` | 6/6 include required document tags; UTF-8 replacement chars `0` |
| static HTTP open/hash | `PASS` | 6/6 local HTTP opens; served/disk SHA-256 mismatches `0` |
| dev-drop initial bare Node harness | `FAIL` | Node 22.14 did not load `.ts`; 2 loader failures |
| bounded Node recovery | `PASS` | `--experimental-strip-types` ran attachment rules 13/13 |
| first Vitest collection attempt | `FAIL` | Node test API registered TAP subtests but Vitest reported no native suite; workspace CSS also requires the Vite transform path |
| dev-drop repository harness recovery | `PASS` | changed only both copied test runner imports from `node:test` to `vitest`; 2 files, 20/20 tests passed |
| initial full check PATH invocation | `NOT_RUN` | `bash` absent from PowerShell PATH; no repository gate executed |
| recovered full check | `PASS` | exact `C:\Program Files\Git\bin\bash.exe scripts/check.sh`; lint, app/worker typecheck, app 782 passed + 5 skipped, worker 14 passed; final `check 통과` |
| production build | `PASS` | Next.js compiled, TypeScript and 34 static pages completed; worker TypeScript build completed |
| tracked/product diff | `PASS` | tracked diff empty before staging; no `app/`, `worker/`, `supabase/`, `scripts/`, root config, current coordination, or current worklog changes |

## Candidate freeze state

- candidate contents: 87 mapped recovery files plus this A-only checkpoint
- overwritten existing destination files: `0`
- B/C carve-out writes: `0`
- staged candidate: `88` added files, `10,374` insertions, `0` deletions; every path is inside the corrected A lease
- staged product/current coordination/current worklog changes: `0`
- next safe action: create the candidate commit and return commit/hash to FOREMAN for independent review before push
