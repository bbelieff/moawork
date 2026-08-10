# Multi-Workspace DB Lab — actual execution receipt

> WORK-ID: `MULTI-WORKSPACE-DB-LAB-01`
> Parent: `MULTI-WORKSPACE-ENTRY-LAB-01`
> Lab ID: `MW-DB-LAB-PGLITE-20260725-V1`
> Executed: `2026-07-25 KST`
> Verdict: `PASS — LOCAL POSTGRESQL/RLS LAB`
> Hosted Supabase: `NOT_CREATED / COST 0 / DECISION_GATE`
> Production write: `0`
> Next: `MULTI-WORKSPACE-RLS-EXECUTION-01`

## 1. Outcome

A disposable, cost-zero PostgreSQL-compatible lab was materialized outside the
production repository. It executes real PostgreSQL roles, grants, `ENABLE ROW
LEVEL SECURITY`, policies, PL/pgSQL security-definer RPCs, deferred constraint
triggers, transactions, enum/unique constraints, fixtures, and attack tests in
PGlite `0.5.4`.

Final command result:

```text
npm.cmd test
tests 27
pass 27
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 7895.4053
```

This is a lab-contract PASS. It is not a production migration, hosted Supabase
PASS, PostgREST/JWT integration PASS, multi-connection race PASS, merge approval,
or deploy approval.

## 2. Isolation and cost gate

### Read-only availability check

- callable Supabase MCP/API: absent
- local `supabase` CLI: absent
- local Docker/Podman: absent
- local `psql`/`pg_ctl`/`initdb`: absent
- Supabase/Postgres credential environment-variable names: absent
- pre-authorized disposable project: absent

Creating a hosted Supabase project could require account authentication,
organization selection, free-project quota choice, or paid-plan/cost approval.
Per T05 checkpoint, no credentials were requested and no external resource was
created. This is the only external-resource `DECISION_GATE`; execution continued
locally instead of blocking.

### Cost and data handling

| Item | Actual |
|---|---|
| hosted project | none |
| cloud cost | `0` |
| production DB/network connection | none |
| production migration/policy copy | none |
| secret/token/connection string | none |
| real identity/customer data | none |
| fixtures | deterministic synthetic UUIDs, labels, and 64-hex digests |
| persistence | ephemeral in-memory DB, destroyed at process exit |

## 3. Materialized files

Root: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\labs\multi-workspace-entry`

| File | Bytes | Lines | SHA-256 | Role |
|---|---:|---:|---|---|
| `README.md` | 2,882 | 61 | `AFBC3A5DB8255FBE452CB3B0F95D336D09DB4AA5E7375BD0B514B2548CC75AAD` | lab identity, command, scope and limits |
| `package.json` | 235 | 12 | `B995EA947AD7180CA1077F87B9E3065A9C20ACFA95CCF793DC04D70F8174E6F1` | isolated test command |
| `package-lock.json` | 604 | 21 | `254F742E50538FE981E03FC63B29398F287C37B3F0BE3D31D15B897C3355C05D` | exact PGlite dependency lock |
| `schema.sql` | 26,675 | 835 | `EB36EBEB3CE34B18ADDFDDAB2A4A916920013227DB18CA7AFAB5B8C8BC4707C7` | schema, RPC, RLS, triggers and grants |
| `tests/db-lab.test.mjs` | 22,250 | 658 | `D37FC6C4BD5A9A7F24C107F4803E42042588F737B0D58271A45A8E0AA47758B9` | fixtures and 27 non-skip tests |

`node_modules/**` is generated from the lockfile and is not an authored artifact
or hash manifest member.

## 4. Schema contract

| Domain | Table/constraint | Enforced behavior |
|---|---|---|
| identity | `users` | provider subject digest, session version/cutoff; no profile fields |
| account | `accounts` | one-to-one global profile separated from identity |
| control plane | `platform_operators` | can approve create requests; no tenant bypass policy |
| sessions | `sessions` | version, creation time and revocation checked by every tenant policy/RPC |
| workspace | `workspaces` | `draft/active/suspended/closed` lifecycle with closed timestamp invariant |
| membership | `workspace_members` | unique `(workspace_id,user_id)`; owner requires `all` scope |
| owner | deferred constraint triggers | every workspace commits with exactly one `owner/all` membership |
| owner mutation | before trigger + RPC checks | owner role/scope/identity/workspace immutable; no transfer RPC in this slice |
| create request | partial unique index | one pending create request per requester |
| join request | partial unique index | one pending join request per workspace/requester |
| invite | partial unique + digest check | pending digest unique per workspace; only 64-hex token digest stored |
| audit | `audit_log` | RPC-written, client-select by tenant owner, client DML denied |

## 5. RPC and state transitions

| RPC | Caller/gate | Atomic result |
|---|---|---|
| `request_workspace_create` | valid session | pending request; duplicate call returns the active request |
| `cancel_workspace_create` | requester | pending → cancelled |
| `decide_workspace_create` | Platform Operator control plane | reject or workspace + sole owner/all + request + audit in one transaction |
| `request_join` | valid non-member | pending request; duplicate call is idempotent |
| `cancel_join_request` | requester | pending → cancelled |
| `decide_join_request` | workspace owner | reject or approve as fixed `member/minimal`; replay idempotent |
| `create_invite` | workspace owner | digest-only pending invite + audit |
| `accept_invite` | valid token holder/session | fixed `member/minimal`, invite accepted + audit |
| `update_member_access` | owner | non-owner membership only; owner promotion/demotion rejected |
| `remove_member` | owner | non-owner only; owner removal rejected |
| `set_workspace_status` | owner | guarded active/suspended/closed lifecycle |
| `cutoff_my_sessions` | current valid session | version increment + cutoff + all sessions revoked + audit |

`lab.failpoint=after_create_audit` is a lab-only switch. The executed rollback test
raises after workspace, owner, request and audit mutations, proving all four roll
back together. It is not a production RPC parameter or proposed product feature.

## 6. RLS and privilege boundary

- All 10 lab tables have RLS enabled.
- `app_user` is `NOSUPERUSER`, `NOBYPASSRLS`, and has no INSERT/UPDATE/DELETE/
  TRUNCATE/REFERENCES/TRIGGER table grant.
- `users` and `accounts` are self-only.
- workspaces and memberships require actual membership.
- join requests are visible only to the requester or that workspace's owner.
- create requests are visible to the requester or control-plane operator.
- invites and tenant audit are owner-only.
- Platform Operator membership is not synthesized and no policy calls operator
  status as a tenant allow condition.
- helpers inspect sessions/memberships as security definer; write RPCs independently
  call the same session and owner/operator gates.

The actual engine returned zero tenant workspaces, memberships, invites and audit
rows to the Platform Operator fixture both before and after control-plane approvals.
Direct tenant writes were permission denied and tenant RPC writes required owner
membership.

## 7. Non-skip attack and boundary matrix

| # | Executed scenario | Layer | Result |
|---:|---|---|---|
| 1 | users/account separate; all tables RLS enabled | catalog/schema | PASS |
| 2 | app role non-superuser/non-BYPASSRLS/no tenant DML grants | role/grant | PASS |
| 3 | identity/account self-only select | RLS | PASS |
| 4 | baseline exact-one/all owner | constraint | PASS |
| 5 | owner 0 at deferred check | transaction/trigger | blocked, PASS |
| 6 | owner 2 at deferred check | transaction/trigger | blocked, PASS |
| 7 | direct owner update/delete | grant/direct DML | blocked, PASS |
| 8 | normal RPC owner demote/delete/promote | RPC | blocked, PASS |
| 9 | Platform Operator tenant read | RLS | zero rows, PASS |
| 10 | Platform Operator tenant direct/RPC write | grant/RPC | blocked, PASS |
| 11 | create duplicate, cancel, reject, reapply, approve | RPC/state | PASS |
| 12 | create approval sole owner/all atomic result | transaction | PASS |
| 13 | create approval replay | RPC/idempotency | one workspace/audit, PASS |
| 14 | fail after create audit | rollback | request pending; workspace/audit 0, PASS |
| 15 | two contention-shaped create approvals | unique/lock/idempotency | same workspace; one audit, PASS |
| 16 | join duplicate, cancel, reject, reapply | RPC/state | PASS |
| 17 | join approval/replay | RPC/idempotency | fixed member/minimal, PASS |
| 18 | owner A decides workspace B request | cross-tenant RPC | blocked, PASS |
| 19 | two contention-shaped join requests | partial unique/idempotency | one active row, PASS |
| 20 | invite digest create/accept | RPC/data minimization | digest only; member/minimal, PASS |
| 21 | raw/invalid digest and invalid enums | input/enum | blocked, PASS |
| 22 | member A/B workspace visibility | RLS/cross-tenant | own tenant only, PASS |
| 23 | duplicate workspace membership | unique constraint | blocked, PASS |
| 24 | lifecycle valid/invalid/non-owner transitions | enum/RPC | guarded, PASS |
| 25 | audit success, rollback absence, client forge/delete | audit/grant | PASS |
| 26 | session cutoff then tenant select/RPC | session/RLS/RPC | zero/blocked, PASS |
| 27 | final owner/duplicate/orphan sweep + Platform recheck | aggregate/RLS | anomaly 0, PASS |

Aggregate: `27 PASS / 0 FAIL / 0 SKIP / 0 CANCELLED / 0 TODO`.

## 8. Race and engine limitations

PGlite is PostgreSQL compiled to WASM, so the RLS, role, grant, trigger, PL/pgSQL,
transaction and constraint results above are executed PostgreSQL semantics, not a
mocked policy evaluator. However, PGlite explicitly has one connection.

The two Promise-based contention tests are non-skip and execute both calls. They
prove the partial unique indexes, request row lock/replay path and idempotent final
state under queued contention. They do **not** prove behavior under two independent
transactions or a pooler. Therefore:

- schema/RPC/RLS/rollback/session/unique/idempotency: `PASS — LOCAL POSTGRESQL`
- true multi-connection race: `NOT_RUN — ENGINE LIMITATION`
- Supabase Auth JWT → GUC/claim mapping: `NOT_RUN`
- PostgREST RPC exposure/grants: `NOT_RUN`
- hosted Supabase/pooler/migration compatibility: `NOT_RUN`
- production DB or real-user behavior: `NOT_RUN / OUT OF SCOPE`

No emulation-only item is labeled hosted RLS PASS.

## 9. Acceptance and downstream

### T05 integration packet

- consume the table/RPC/state contract as an experiment, not a production migration
- retain owner exact-one/all, Platform tenant bypass zero, digest-only invite,
  fixed member/minimal join approval, atomic create approval and session cutoff
- do not copy the lab failpoint or deterministic fixtures into product code
- keep hosted/project/cost decision separate from the cost-zero lab PASS

### T10 independent review

Re-run `npm.cmd test` from the lab root and require exactly:

```text
tests 27
pass 27
fail 0
skipped 0
```

Also verify file hashes, `app_user.rolbypassrls=false`, 10 RLS-enabled tables,
Platform tenant row count 0, and the final anomaly sweep 0. Do not convert the
single-connection contention tests into a multi-connection race PASS.

### Next work

`MULTI-WORKSPACE-RLS-EXECUTION-01` requires a disposable, explicitly authorized,
cost-approved hosted Supabase or multi-connection PostgreSQL target. It must execute
two-connection races, JWT/PostgREST mapping, schema application/rollback, and the
same attack matrix with production data and secrets still prohibited.
