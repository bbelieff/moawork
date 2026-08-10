# Workspace Entry B Family — Routing Contract

> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-ROUTE-CONTRACT-01`
> 역할: T02 spec/route-contract worker
> 상태: **ROUTING CONTRACT / IMPLEMENTATION HOLD / HTML·CODE·DB UNCHANGED**
> 소비자: T01 prototype writer, T07 independent reviewer, T05 foreman
> NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-HTML-01`

## 1. 결론

Workspace Entry의 목적은 “로그인 뒤 한 번 더 선택하게 하는 화면”이 아니다. 서버가 이미 안전하게 결정할 수 있는 경우에는 클릭을 요구하지 않고, 결정할 수 없는 경우에만 B family 안내를 보여 준다.

LOCKED routing 원칙은 다음과 같다.

1. 일반 로그인에서 active membership이 정확히 1개면 서버가 membership과 Workspace를 재검증하고 `/w/{slug}`로 0-click 이동한다.
2. create/join 승인 event와 그 event가 가리키는 active membership이 함께 검증되면, 해당 계정의 active membership이 2개 이상이어도 event target으로 0-click 이동한다.
3. 승인 event 직접 진입 뒤에는 별도 성공 관문을 만들지 않고 Workspace 내부 notice만 한 번 보여 준다.
4. 승인 event가 없는 일반 로그인에서 active membership이 2개 이상이면 chooser를 보여 준다. last-used는 강조 hint일 뿐 자동 진입이나 권한 근거가 아니다.
5. active membership이 0이고 pending request가 있으면 pending 화면에서 자기 요청 수정·취소만 허용한다.
6. active membership과 pending request가 모두 0이면 create/join B family를 보여 준다.
7. active membership이 정확히 1개이고 다른 pending request가 있어도 active Workspace로 0-click 진입한다. pending은 nonblocking notice다.
8. Platform operator가 tenant membership을 갖지 않으면 tenant access는 0이다.
9. inactive membership, inactive Workspace, expired/rejected/cancelled request는 active count에서 제외한다.
10. slug, cookie, query, `last_workspace`는 후보 hint일 뿐이다. 권한은 매번 server-side membership과 session으로 다시 판단한다.

## 2. Frozen inputs

### 2.1 ROUND-29

| 항목 | 값 |
|---|---|
| path | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-login-handoff\docs\coordination\sync\ROUND-29.md` |
| bytes / physical lines | `9,021 / 165` |
| SHA-256 | `D8734E1EFF4795CCE25FC22B8A01F839B59C6EF45DCADF7A6C0EAF412504B973` |
| verdict | `PASS_EXACT_CURRENT_HASH / USER_VARIANT_SELECTION_PENDING / PRODUCT_HOLD` |

### 2.2 B style contract

| 항목 | 값 |
|---|---|
| path | `docs/design/round-29/02-workspace-entry-b-style-contract.md` |
| bytes / physical lines | `29,672 / 554` |
| SHA-256 | `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D` |

이 계약은 conversation DNA, B-1~B-4 sibling 경계, A/C/D leakage 금지, 8-state 보안 경계를 그대로 유지한다.

### 2.3 Exact v0.2 prototype

| 항목 | 값 |
|---|---|
| path | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html` |
| bytes / physical lines | `53,996 / 713` |
| SHA-256 | `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300` |
| independent verdict | R2 exact PASS, 이후 byte drift 시 STALE |

v0.2는 B family visual/state fixture로 유지한다. 다만 현재 `one`과 `joiner` 상태에 tenant-entry 버튼이 있고, 새 blueprint는 server-verified target에서 0-click을 요구한다. 본 문서는 그 routing 의미를 교정하며 v0.2 HTML을 직접 수정하지 않는다.

## 3. 용어와 count contract

### 3.1 Account와 plane

- `account`: 인증 provider가 확인한 사용자 identity.
- `workspace plane`: `(account_id, workspace_id)` active membership으로만 들어가는 tenant 영역.
- `platform plane`: 별도 Platform operator capability로 들어가는 운영 영역. tenant membership이 아니다.
- Platform capability가 Workspace role, Owner, scope, active count를 만들거나 덮어쓰지 않는다.

### 3.2 Active membership

Routing count에 포함하려면 아래 조건이 모두 참이어야 한다.

- authenticated account와 membership account가 일치한다.
- membership status가 active다.
- Workspace lifecycle이 active다.
- Workspace id와 membership key가 유효하고 중복·anomaly가 없다.
- 현재 account session이 유효하고 account/Workspace cutoff 뒤에 발급됐다.
- target Workspace의 canonical slug가 유효하다.

owner/admin/member role은 active count에 영향을 주지 않는다. Owner를 먼저 찾거나 높은 role을 먼저 고르는 정렬은 금지한다.

### 3.3 Excluded state

다음은 active count에 포함하지 않는다.

- invited, pending, suspended, removed, leave, expired 상태 membership
- provisioning, suspended, pending_delete, deleted 상태 Workspace
- draft, pending, rejected, cancelled, expired create/join request
- Platform operator record
- cookie/query에만 존재하는 Workspace id 또는 slug

Pending request는 별도 `pending_count`로만 센다. rejected/cancelled/expired는 history이며 pending count가 아니다.

## 4. Server decision inputs

Routing은 client JS가 아니라 server callback/loader가 다음 입력을 같은 판단 cycle에서 읽어 결정한다.

| Input | source | 보안 의미 |
|---|---|---|
| `account_id` | verified Auth session | client 입력 금지 |
| `session_id/issued_at` | verified session claims + app session registry | cutoff·revoke 검사 |
| `active_memberships[]` | server DB query | account/workspace/status/lifecycle join 결과 |
| `pending_requests[]` | self-owned create/join projection | tenant access가 아닌 상태 표시용 |
| `accepted_event` | server-issued event receipt 또는 server event inbox | event override 후보 |
| `platform_operator` | separate platform projection | tenant count에 미포함 |
| `last_workspace_id` | account preference | chooser highlight only |
| `requested_slug` | protected deep-link/path | 후보 target, 재검증 필수 |
| cookie/query hint | browser | authorization value 0 |
| `canonical_slug` | verified Workspace row | 최종 `/w/{slug}` 생성에만 사용 |

DB query timeout, partial response, duplicate row, unknown enum, malformed slug 중 하나라도 있으면 빈 membership으로 낙관하지 않고 `ROUTE_GENERIC_FAIL_CLOSED`로 간다.

## 5. Decision precedence

Server는 다음 순서를 바꾸지 않는다.

```text
1. authenticate account + validate app session
2. if explicit protected deep-link: verify exact target membership and lifecycle
3. verify accepted request event, target membership, target Workspace, session
4. build active membership set and pending self-projection
5. accepted event target override, if and only if step 3 passed
6. otherwise route by active count: 1 / 2+ / 0
7. for active 0, route by pending count: pending / B create-join
8. route Platform-only account to control plane or generic account-safe page, never tenant
9. persist convenience preference only after successful server-verified entry
```

Protected deep-link와 accepted event는 사용자의 명시적 target provenance가 있으므로 ordinary-login count보다 먼저 평가한다. 단, URL slug나 query만으로 provenance를 만들 수 없다.

## 6. LOCKED decision table

| ID | verified state | accepted event | destination | routing clicks | tenant data before destination | notice |
|---|---|---|---|---:|---:|---|
| R-01 | ordinary login, active=1 | 없음 | server 0-click `/w/{canonical_slug}` | 0 | 0 | 필요 시 일반 welcome |
| R-02 | ordinary login, active≥2 | 없음 | `/workspaces` chooser | 1 | 0 | last-used는 `최근 사용` 강조만 |
| R-03 | active=0, pending>0 | 없음 | `/workspace-entry` pending view | 0 | 0 | 수정·취소 가능, 접근 0 |
| R-04 | active=0, pending=0, anomaly=0 | 없음 | `/workspace-entry` B create/join | 0 | 0 | 두 경로 안내 |
| R-05 | active=1, other pending>0 | 없음 | active target 0-click | 0 | target only after verify | Workspace 안 nonblocking pending notice |
| R-06 | active≥2 | verified create/join acceptance | event target 0-click | 0 | target only after verify | target 내부 one-time notice |
| R-07 | active=1 | verified acceptance for same target | target 0-click | 0 | target only | one-time notice, 중복 관문 없음 |
| R-08 | accepted event target membership inactive/missing | invalid | ordinary current-state decision 또는 generic fail-closed | 0 또는 chooser 1 | 0 until redecision | 성공 notice 금지 |
| R-09 | Platform operator, active=0 | 없음 | Platform control-plane entry 또는 account-safe route | 0 | tenant 0 | `고객 회사 자동 접근 없음` |
| R-10 | Platform operator, active=1 | 없음, workspace intent | ordinary active=1 규칙 | 0 | verified target only | Platform role을 tenant role로 표시 금지 |
| R-11 | active≥2 + last-used hint | 없음 | chooser | 1 | 0 | 한 행에 `최근 사용` label |
| R-12 | inactive-only or unknown anomaly | 없음 | generic account-safe failure/recovery | 0 | 0 | 회사 identity·상태 상세 비노출 |
| R-13 | explicit bookmarked `/w/{slug}` | 없음 | target membership verify 후 direct target, 실패 시 generic | 0 | target only after verify | ordinary login auto-selection과 구분 |

### 6.1 Ordinary login 정의

`ordinary login`은 accepted event나 사용자가 요청한 protected deep-link 없이, 인증 callback이 account의 기본 landing을 결정하는 경우다. 이 경우 active≥2면 query/cookie/last-used가 특정 Workspace를 가리켜도 chooser를 우회하지 않는다.

### 6.2 0-click 정의

Click count는 Auth provider 인증이 끝나고 MoaWork server가 verified session을 가진 시점부터 `/w/{slug}` first response까지의 **추가 tenant-selection click**을 센다.

- OAuth provider의 로그인 click은 제외한다.
- server redirect는 0 click이다.
- 중간 “계속”, “들어가기”, “승인됨 확인” CTA가 있으면 0-click FAIL이다.
- 화면을 잠깐 렌더한 뒤 client JS가 redirect하는 방식은 0-click PASS가 아니다.
- chooser row를 사용자가 고르는 것은 1 click이다.

## 7. Accepted request event contract

### 7.1 Provenance

0-click override에 사용할 event는 create/join 승인 transaction이 성공한 뒤 server가 생성한 사실이어야 한다.

최소 binding:

- immutable `event_id`
- source `request_id`
- event kind: create accepted 또는 join accepted
- beneficiary `account_id`
- target `workspace_id`
- target membership id 또는 `(workspace_id, account_id)`와 version
- approval transaction commit time
- target Workspace lifecycle/version
- issued/expiry time
- producer identity plane와 audit reference

Event URL에 위 값을 평문으로 넣지 않는다. browser가 전달하는 값은 opaque receipt 또는 event id hint일 뿐이며, server-side row와 current membership을 다시 읽는다.

### 7.2 Idempotency

- `(event_id, beneficiary_account_id)`는 unique다.
- 같은 event 재처리는 같은 target route를 반환하거나 이미 target에 있음을 확인한다.
- 재처리로 membership, Owner, audit, notice를 다시 만들지 않는다.
- one-time notice는 별도 flash/read marker로 최대 한 번 보인다.
- network retry 중 first response가 유실돼도 event result는 target이 바뀌지 않는다.
- event와 현재 membership payload가 다르면 event를 폐기하고 fail closed한다.

### 7.3 Multiple events

- 사용자가 방금 완료한 request response에 bind된 event가 있으면 그 event만 평가한다.
- account inbox에 unconsumed acceptance가 두 개 이상이고 명시적 provenance가 없으면 최신 event를 임의 선택하지 않는다.
- 이 경우 active count 규칙으로 돌아가고 chooser/Workspace 안 notice center에서 각 승인 사실을 보여 준다.

### 7.4 Notice

승인 직후 별도 success screen, membership 선택 screen, “회사로 들어가기” button을 만들지 않는다.

Target 내부 notice 예시:

- create: `회사 만들기가 승인되어 이 회사의 시작 안내를 열었어요.`
- join: `회사 합류가 승인되어 이 회사로 왔어요. 사원·최소 범위로 시작해요.`

Notice는 event kind와 current membership을 server가 다시 확인한 뒤에만 보인다. URL query 문구만으로 success notice를 만들지 않는다.

## 8. One active + other pending

Pending request는 active membership의 사용을 가로막지 않는다.

- active=1이면 즉시 active Workspace로 0-click 이동한다.
- pending create/join은 modal, blocking interstitial, chooser row로 만들지 않는다.
- Workspace 안 account/menu notice에 `다른 회사 요청 1건이 검토 중이에요`처럼 nonblocking 표시할 수 있다.
- notice에서 pending detail로 이동해 자기 요청 수정·취소가 가능하다.
- pending target의 이름·Owner·구성원·내부 상태를 active Workspace 화면에 노출하지 않는다.

Pending approval이 같은 순간 commit되면 accepted event provenance가 있는 요청 cycle은 R-06을 적용한다. provenance가 없는 ordinary login은 fresh active set을 다시 읽고 1/2+ 규칙을 적용한다.

## 9. Display name와 canonical slug

### 9.1 Display name

- 회사 표시명은 한글과 Unicode free text를 허용한다.
- server는 Unicode NFC 정규화, 양끝 공백 제거, 연속 공백 축약을 수행한다.
- 표시명은 UI, 초대, chooser에 쓰고 authorization key로 사용하지 않는다.
- 빈 문자열, control character, bidi override, 위험한 markup은 거부한다.
- 길이 상한은 grapheme 기준으로 구현 gate에서 확정한다. 권장값은 1–80이다.
- 표시명 변경은 canonical slug를 자동 변경하지 않는다.

### 9.2 Slug grammar

LOCKED grammar:

```text
lower ASCII letters + digits + hyphen only
length 3..40
must start and end with letter or digit
no consecutive hyphen
```

Equivalent validation intent: `^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}[a-z0-9]$`와 별도 consecutive-hyphen 거부.

### 9.3 Normalization and preview

사용자가 주소 후보를 입력하면 server와 같은 순수 normalization을 preview에 사용한다.

1. Unicode NFKC.
2. lowercase.
3. trim.
4. spaces/underscore를 single hyphen으로 변환.
5. 허용되지 않은 문자를 제거하거나 transliteration 후보를 제안.
6. repeated/leading/trailing hyphen 제거.
7. 3–40 길이와 reserved set 검사.

한글 표시명만으로 ASCII slug가 비면 사용자가 영문/숫자 주소를 입력하게 하거나 server가 중립적인 제안을 제공한다. 한글을 불안정한 임의 romanization으로 확정하지 않는다.

Preview label:

```text
회사 주소 미리보기
moa-work.com/w/{candidate}
회사가 만들어지면 이 주소는 고정돼요.
```

Preview는 reservation이나 생성 성공이 아니다.

### 9.4 Reserved and duplicate

Reserved set은 최소한 current top-level product/system routes를 포함한다.

`account`, `admin`, `api`, `auth`, `login`, `logout`, `platform`, `settings`, `support`, `workspace-entry`, `workspaces`, `www`

실제 구현은 route inventory에서 central `RESERVED_WORKSPACE_SLUGS`를 생성하고 tests로 동결한다.

Invalid, reserved, duplicate, concurrent claim은 외부에 같은 generic 결과를 사용한다.

```text
이 회사 주소는 사용할 수 없어요. 다른 주소를 선택해 주세요.
```

어떤 Workspace가 이미 쓰는지, reserved인지, 누가 소유하는지 공개하지 않는다. “사용 가능” preview도 최종 승인 transaction의 unique allocation을 대체하지 않는다.

### 9.5 Stability

- create approval transaction에서 canonical slug가 unique하게 배정된 뒤 안정적으로 유지된다.
- display name 변경, Owner 변경, membership 변화로 slug를 자동 변경하지 않는다.
- slug 변경/alias/redirect는 별도 migration·audit·collision 계약 전 기능 밖이다.
- `/w/{slug}` loader는 slug를 Workspace id로 해석한 뒤 membership을 검증한다. slug 자체가 권한이 아니다.

## 10. Owner onboarding route

승인된 신규 Owner의 순서는 다음과 같이 LOCKED한다.

```text
1. 회사 이름 + 회사 주소 확인
2. 팀원 초대
3. CSV 가져오기
```

### Step 1 — 이름 + 주소

- 승인 전 pending request에서 display name과 slug 후보를 수정할 수 있다.
- create approval transaction이 canonical slug를 고정한다.
- accepted event로 Workspace에 0-click 진입한 뒤 Step 1은 표시명과 고정된 주소를 **확인**한다.
- display name은 이후 별도 권한 경로로 변경할 수 있지만 slug는 자동 변경하지 않는다.
- 이미 생성된 slug를 onboarding field에서 editable 성공처럼 보이지 않는다.

### Step 2 — Invite

- invite 전 단계 완료를 전제로 한다.
- default는 사원·최소 범위다.
- invite pending은 membership이 아니다.
- skip 가능하며 onboarding 완료를 막지 않는다.
- 실제 초대 전송·수락은 별도 server/RPC evidence가 있어야 성공으로 표시한다.

### Step 3 — CSV

- source 선택 → dry-run → 오류·중복 검토 → Owner 최종 적용.
- dry-run 전후 실제 저장 0건.
- cancel/error/resume 경로 제공.
- first customer/first work를 임의 자동 생성하지 않는다.

Joiner는 이 3단계를 모두 건너뛰고 accepted target Workspace 내부 notice와 자신에게 허용된 home으로 바로 간다.

## 11. Prototype label contract

v0.2를 후속 HTML에서 수정할 때 route semantics를 다음 문구로 드러낸다.

| state | required label | CTA rule |
|---|---|---|
| ordinary active=1 | `확인된 회사로 바로 이동해요.` | `들어가기` CTA 0 |
| accepted create | target 내부 `회사 만들기가 승인되어 시작 안내를 열었어요.` | 중간 CTA 0 |
| accepted join | target 내부 `합류가 승인되어 사원·최소 범위로 시작해요.` | 중간 CTA 0 |
| active≥2 | `들어갈 회사를 골라 주세요.` | Workspace row 선택 1회 |
| last-used | `최근 사용` | selected/authorized 의미 금지 |
| active=0 pending | `승인 대기 · 회사 접근 0곳` | 수정 1, 취소 1 |
| active=0 no pending | `새 회사를 시작하거나 기존 회사에 합류해요.` | B create/join replies |
| one + pending | Workspace 내부 `다른 회사 요청이 검토 중이에요.` | blocking CTA 0 |
| operator no membership | `고객 회사 자동 접근 없음` | tenant CTA 0 |
| inactive/anomaly | `회사 접근을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.` | target identity 0 |
| slug preview | `회사가 만들어지면 이 주소는 고정돼요.` | preview=reservation 표현 금지 |
| slug unavailable | `이 회사 주소는 사용할 수 없어요.` | reserved/duplicate 구분 금지 |

Prototype은 server redirect를 실제로 수행했다고 주장하지 않는다. 상태 selector로 0-click 결과를 시각화할 때 `SERVER DECISION PREVIEW / 실제 routing 없음` marker를 보인다.

## 12. Click-count acceptance

| case | expected additional clicks | PASS evidence |
|---|---:|---|
| ordinary active=1 | 0 | server decision → target route, entry CTA 0 |
| accepted event + verified target | 0 | event decision → target, success interstitial 0 |
| ordinary active≥2 | 1 | chooser row click 1, server revalidation |
| active=0 pending | 0 to pending | pending view first response, access CTA 0 |
| active=0 no pending | 0 to B entry | create/join 선택은 이후 product decision click |
| one + pending | 0 | active target first response, nonblocking notice |
| operator no membership | 0 tenant clicks possible | tenant target/CTA count 0 |
| protected deep-link valid | 0 | exact target revalidated |
| protected deep-link invalid | 0 success clicks | generic fail closed, target leak 0 |

Client-side auto-click, hidden link activation, timed redirect, first-row script selection은 0-click으로 인정하지 않는다.

## 13. Race and failure matrix

| race/failure | locked result |
|---|---|
| approval vs cancel | request row lock에서 먼저 commit한 terminal state만 유효. cancel이 이기면 event/membership 0 |
| approval commit vs membership revoke | route 시 current membership 재검증. revoke가 보이면 event 성공 폐기 |
| approval creates second active membership | bound event가 있으면 target direct; event 없으면 fresh count=2 chooser |
| two acceptance events | bound event가 있으면 그것만; unbound multiple이면 chooser/notice center |
| duplicate event delivery | same target, no duplicate membership/audit/notice |
| event target mismatch | generic fail closed, target identity 0 |
| session revoked after approval | event route 거부, reauthentication/account-safe path |
| Workspace suspended after approval | target 진입 0, generic recovery |
| membership query timeout | cookie/last-used fallback 금지, generic failure |
| active row duplicate/anomaly | fail closed, first row 선택 금지 |
| slug preview vs concurrent claim | approval unique allocation 실패, partial Workspace/Owner 0, generic unavailable |
| reserved list changes before approval | final approval validation 우선, generic unavailable |
| stale cookie/query slug | ignore as grant, current active set으로 재판단 |
| canonical slug malformed | target 진입 0, anomaly alert to internal ops only |
| pending count stale | same decision cycle에서 재query하거나 version 확인, tenant grant에는 사용하지 않음 |
| notice replay | route 권한 변화 0, one-time read marker로 중복 억제 |
| back button to success interstitial | interstitial 자체가 없어야 함 |

## 14. Inactive-state ambiguity resolution

Inactive row는 access를 주지 않지만 모두 같은 UX로 다루지는 않는다.

| inactive cause | route behavior |
|---|---|
| removed/expired historical membership | active count 제외. 다른 anomaly가 없으면 0/pending 규칙 사용 |
| rejected/cancelled/expired request | pending count 제외. history에서만 확인 |
| suspended membership | target identity를 일반 entry에 노출하지 않고 generic recovery; 재활성 절차는 별도 |
| suspended/pending-delete Workspace | direct route 거부, generic recovery; Owner row가 있어도 active route 아님 |
| unknown enum/version/inconsistent owner | generic fail closed + internal anomaly evidence |

Removed history가 있다는 이유만으로 B create/join을 영구 차단하지 않는다. Suspended 상태는 단순 “소속 0”으로 숨겨 새 Workspace 생성을 유도하지 않고 account-safe recovery를 우선한다.

## 15. Security and privacy invariants

1. Routing은 server-side이고 client state는 presentation only다.
2. RLS와 server loader는 verified account id와 active membership을 함께 확인한다.
3. Platform operator와 tenant membership은 분리한다.
4. Owner role은 ordinary routing priority가 아니다.
5. last-used, slug, cookie, query는 authorization이 아니다.
6. Pending request와 accepted event는 membership 자체가 아니다.
7. Accepted event는 current active target membership 없이는 진입을 만들지 않는다.
8. Generic failure는 Workspace 존재, slug owner, membership, request terminal 원인을 공개하지 않는다.
9. chooser는 active membership projection만 사용하고 다른 tenant row를 preload하지 않는다.
10. one + pending notice는 pending target identity를 노출하지 않는다.
11. URL에 raw invite code, session id, event payload, account id를 기록하지 않는다.
12. analytics에는 route outcome category와 latency만 기록하고 raw slug/query/request를 기본 수집하지 않는다.
13. 로그에 display name, 실제 이메일, 고객 data를 넣지 않는다.
14. create approval은 Workspace + exact-one Owner + profile + audit 원자성 전 성공으로 표시하지 않는다.
15. join acceptance는 사원·최소 범위 membership 전 성공으로 표시하지 않는다.

## 16. Unknowns and DECISION_GATE

다음은 구현 전에 T05/MWC가 확정해야 한다.

| Gate | unknown | 권장 기본값 |
|---|---|---|
| DG-R1 | Platform control-plane canonical route | `/platform`; tenant route와 loader 분리 |
| DG-R2 | accepted event transport | server event inbox + opaque one-time receipt |
| DG-R3 | event idempotency/notice TTL | route result durable, notice read-once, 짧은 expiry |
| DG-R4 | direct deep-link callback `next` 처리 | exact membership 재검증 후만 허용 |
| DG-R5 | suspended state recovery UX | generic account-safe recovery, create/join 유도 금지 |
| DG-R6 | display-name grapheme 상한 | 80 |
| DG-R7 | reserved slug inventory | route manifest에서 자동 생성 + explicit additions |
| DG-R8 | ASCII slug suggestion algorithm | user input 우선, opaque neutral suggestion; 임의 romanization 금지 |
| DG-R9 | multiple unconsumed acceptance notices | chooser + notice center, 최신 자동 선택 금지 |
| DG-R10 | Workspace 내부 pending notice 위치 | Account menu 또는 nonblocking banner |

이 gate는 prototype copy를 막지 않지만 제품 route, DB event schema, callback 구현을 막는다.

## 17. Test matrix

### 17.1 Pure server decision tests

- active=1 ordinary → direct target.
- active=2 ordinary → chooser even with valid last-used.
- active=0 pending=1 → pending.
- active=0 pending=0 → B entry.
- active=1 pending=1 → direct active + pending notice metadata.
- active=2 + verified accepted target → direct accepted target.
- accepted event target inactive → no direct target.
- operator active=0 → tenant target 0.
- Owner row ordering never changes route.
- stale cookie/query never creates direct target.
- valid protected deep-link revalidates and enters; invalid is generic.
- query timeout/anomaly never falls back to first row.

### 17.2 Event tests

- create/join event binding fields complete.
- wrong account, wrong target, wrong membership version rejected.
- duplicate delivery idempotent.
- approval/cancel and approval/revoke races.
- multiple events without bound provenance do not auto-select.
- notice appears at most once and never grants access.

### 17.3 Slug tests

- 3 and 40 character boundaries.
- uppercase normalized lowercase.
- spaces/underscore collapsed to hyphen.
- leading/trailing/consecutive hyphen rejected or normalized before final validation.
- Korean display name retained independently.
- empty ASCII slug requests explicit input or neutral suggestion.
- reserved/duplicate/race return same generic message.
- display-name rename leaves slug stable.
- slug query without active membership returns generic failure.

### 17.4 Prototype tests

- B-1~B-4에 ordinary-one 0-click preview, accepted-event 0-click preview, multiple chooser를 추가한다.
- one-state `들어가기` CTA count 0.
- accepted-event interstitial CTA count 0.
- active≥2 chooser row action count ≥2, auto-selected tenant action 0.
- one+pending blocking modal/route count 0.
- operator tenant action 0.
- inactive/anomaly target identity 0.
- `SERVER DECISION PREVIEW / 실제 routing 없음` marker 존재.
- 기존 B style, responsive, accessibility, A/C/D leakage 0을 유지한다.

## 18. Entry, exit, STOP

### Entry for NEXT_WORK

- 이 routing contract T05 PASS.
- T01 exact HTML lease와 pre-write v0.2 hash 동결.
- prototype-only scope 확인.
- B variant selection이 아직 미결정이면 네 variant에 동일 routing semantics를 적용한다.

### Exit for prototype

- exact HTML bytes/lines/SHA freeze.
- route state matrix와 click count static/browser PASS.
- T07 exact-hash independent review.
- source v0.2 drift provenance.
- PII/secret/trailing whitespace 0.

### STOP

- product callback/session/DB schema를 prototype lease에서 수정
- one-state entry CTA를 남기고 0-click이라 주장
- accepted event query만으로 target 또는 success notice 생성
- active≥2 ordinary login에서 last-used 자동진입
- suspended/unknown을 active=0 정상상태로 낙관
- duplicate/reserved slug 원인·Workspace identity 노출
- Platform operator tenant auto-entry
- server evidence 없는 success tense
- R2 exact PASS를 변경 HTML에 승계

## 19. Implementation HOLD

이 문서는 다음을 승인하지 않는다.

- product callback/session/proxy/route 변경
- Workspace/member/request/event DB schema 또는 migration
- slug unique allocation 또는 reserved registry 배포
- Git branch/commit/push/PR/merge
- hosted/Production DB write
- Vercel deploy 또는 public read-back

Prototype PASS는 server routing PASS가 아니다. 제품 구현은 DG-R1~R10, sole writer lease, migration/app DAG, T10 security review, 실제 DB/session tests, 사용자 actual-screen approval을 별도로 통과해야 한다.

## 20. Consumer packet

### T01

- exact v0.2를 pre-write hash로 확인한다.
- one/accepted/one+pending/slug preview states를 B-1~B-4에 추가·교정한다.
- routing을 실제 수행하지 않고 preview label로 표현한다.
- 변경 후 exact artifact를 freeze하고 lease를 release한다.

### T07

- exact changed hash에서 click-count, state matrix, operator/inactive/generic leakage를 독립 검수한다.
- old R2 PASS를 새 hash에 자동 승계하지 않는다.
- visual B DNA와 routing semantics를 함께 본다.

### T05

- DG-R1~R10의 사용자/운영 결정을 수렴한다.
- T01 writer와 T07 reviewer를 직렬로 배정한다.
- prototype과 product implementation gate를 분리한다.

NEXT_WORK: `WORKSPACE-ENTRY-B-FAMILY-ROUTING-HTML-01`

## 21. Blindspot Pass

- 전체: 사용자가 선택할 필요가 없는 경우에는 클릭을 제거하고, 선택이 필요한 경우에만 chooser/B family를 보여 준다.
- 부분: ordinary login, accepted event, pending, one+pending, operator, inactive, slug, Owner onboarding을 각각 서버 evidence로 판정한다.
- 전체 재검증: 편의를 위해 last-used를 권한으로 쓰거나, 승인 notice를 query로 만들거나, active=1에서 불필요한 CTA를 남기거나, active≥2에서 자동 진입하면 “안전한 0-click”이 아니라 “추정 기반 우회”가 된다. 반대로 모든 상태에 chooser를 강제하면 안전하지만 사용자 blueprint의 first-value를 잃는다. 이 계약은 서버가 확실히 아는 경우만 0-click으로 좁힌다.
