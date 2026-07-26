# MWC Historical Salvage

Source: MWC thread `019f7fcb-fe96-7720-89f0-a16aeba96ec6` and `ROUND-1.md` through `ROUND-22.md`. Compared with the actual round-21 hub. Past SHA, PR, provider and deployment reports are not current facts.

| ID | Source | Class | Recovered value and safety boundary | Insert target | Next consumer / WORK-ID | State |
|---|---|---|---|---|---|---|
| MWC-S01 | ROUND-15 member-entitlement wave | `RECOVER_NOW` | Current hub has no canonical Workspace/seat/plan contract for pending invite, inactive member, guest, dual role, or multi-Workspace counting. Security controls, tenant isolation and Owner protection must never be paywalled; no price or limit is inferred. | New entitlement SPEC linked from team growth and DAG | Product/Finance/Authz · `MEMBER-ENTITLEMENT-SPEC-01` | `DECISION_GATE`; HUB_WRITE allowed |
| MWC-S02 | ROUND-1 unresolved verification; ROUND-3~4 OAuth operations | `RECOVER_NOW` | Add live Google account-selection to callback, refresh and Workspace-context evidence beyond the profile-preservation contract. Use synthetic identity and record no cookie, OAuth code or real email. | T08 auth operational gate | T10 · `LIVE-OAUTH-E2E-VERIFY-01` | `REVIEW`; user login action required |
| MWC-S03 | ROUND-1 unresolved settlement parity | `RECOVER_NOW` | Produce parity evidence for settlement formulas and date bases against current seed/domain rules. Never infer VAT, revenue base, D+n origin, or use customer amounts. | Settlement acceptance addendum and T08 | T09/T10 · `SETTLEMENT-PARITY-VERIFY-01` | `REVIEW / NOT_RUN` |
| MWC-S04 | ROUND-1 unresolved Storage organization isolation | `RECOVER_NOW` | Core file/document storage requires explicit two-tenant positive and negative proof; import-storage coverage alone is insufficient. | T08 file security gate | T10 · `STORAGE-TENANT-VERIFY-01` | `REVIEW / NOT_RUN` |
| MWC-S05 | ROUND-1 RQ-0009 | `EXPERIMENT` | Status-to-group automation may still be valuable, but old 004/11-group assumptions may not match current schema. Rediscover current board state before design. | Board automation discovery | Board owner · `BOARD-AUTOMATION-CURRENT-REVALIDATE-01` | `REPO_READONLY / HUB_WRITE` |
| MWC-S06 | ROUND-11~13 visual gate | `DUPLICATE` | Local visual, hidden sequence, before/after, quiz and explicit approval are current in T08 and T04/T10. | None | None | `DUPLICATE` |
| MWC-S07 | ROUND-14~20 Owner/Platform/support/session decisions | `DUPLICATE` | Exact-one Owner, Platform/Workspace separation, support modes, profile split and session policy are current T03/T04 content. | None | None | `DUPLICATE` |
| MWC-S08 | ROUND-20~21 small-org sequence | `DUPLICATE` | Three-minute start to today home to team growth to safe import is materialized in 01/05/06/07/08. | None | None | `DUPLICATE` |
| MWC-S09 | ROUND-22 artifact rule | `DUPLICATE` | Chat final is not completion; path, validation and consumer are enforced by current hubs. | None | None | `DUPLICATE` |
| MWC-S10 | ROUND-1 retired YAML state | `REJECTED_KEEP` | Historical registry, queue and provider YAML must not become current coordination truth. | Rejection register | T10 · `SALVAGE-INTEGRITY-VERIFY-01` | `REJECTED_KEEP` |
| MWC-S11 | ROUND-14~18 unsafe alternatives | `REJECTED_KEEP` | Platform Admin automatic Owner, broad users directory, impersonation, permanent support membership, general-RPC Owner mutation and editable audit remain rejected. | Rejection register | T10 · `SALVAGE-INTEGRITY-VERIFY-01` | `REJECTED_KEEP` |
| MWC-S12 | ROUND-1~10 PR/SHA/deploy reports | `OBSOLETE` | Historical sequencing and defect provenance cannot establish current repository or production state. | None | None | `OBSOLETE` |
| MWC-S13 | ROUND-5~10 login visual iterations | `BACKLOG` | Reduced motion, mobile-first CTA, dark contrast and calm motion remain reusable regression dimensions. Old A-option and PR state are not current product. | Design-system regression checklist | T04/T10 · `LOGIN-VISUAL-REGRESSION-CATALOG-01` | `BACKLOG` |

Recover-now order: `MEMBER-ENTITLEMENT-SPEC-01`, `LIVE-OAUTH-E2E-VERIFY-01`, `SETTLEMENT-PARITY-VERIFY-01`, `STORAGE-TENANT-VERIFY-01`. Board automation remains an experiment pending current-state rediscovery.

Counts: RECOVER_NOW 4, EXPERIMENT 1, BACKLOG 1, REJECTED_KEEP 2, DUPLICATE 4, OBSOLETE 1.
