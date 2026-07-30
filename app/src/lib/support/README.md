# lib/support — 지원(1:1 문의) + 접근위임 (T08)

레인: `components/support/**` · `access_grants` · 위임.
저장 정본: `supabase/migrations/017_support_access_delegation.sql`.

## 확정 사항 (belie)

- 1:1 상담은 **자체 인앱 스레드**. 채널톡·인터콤 등 외부 벤더를 붙이지 않는다.
- 권한 위임에 **오너 승인 불필요** — 멤버도 직접 위임한다. **즉시 발효**.
- 위임 기본 기간 **2시간**. 기본 범위 **보기만**.
- **고객이 열어주는 것이 기본 접근 경로.** 운영자가 임의로 들어가는 방식은 다음 단계.

## 불변식 (7개) — 어디서 강제되는가

| # | 불변식 | 강제 지점 |
|---|---|---|
| 1 | 오너 승인 없이 즉시 발효 | `create_access_grant()` RPC |
| 2 | 멤버 개시 = **읽기 전용 고정** | `pin_member_grant_readonly()` 트리거 · `SupportService.createGrant` · UI disable (**3중**) |
| 3 | 회사당 활성 위임 **1건** | `access_grants(org_id) where revoked_at is null` 부분 유니크 인덱스 + 만료 자동마감 트리거 |
| 4 | `scope='assigned'` 상속 | `grant_sees_assignee()` — companies · deals · items |
| 5 | 위임 즉시 오너 알림 / 오너 강제종료 | `create_access_grant()` · `revoke_access_grant()` |
| 6 | 홈택스 **항상 차단** | `hometax_consents`/`hometax_docs` **RESTRICTIVE** 정책 + `isGrantReadable()` |
| 7 | 만료·중단·종료 기록 | `audit_logs` + 소식창 |

## RLS 원칙 — 절대 어기지 말 것

> **`is_org_member()` 를 수정하지 않는다.**

기존 `*_rw` 정책은 **그대로 두고**, `has_active_grant()` 계열을 쓰는 **permissive 정책을 OR 로 추가만** 한다.
RLS 정책은 OR 로 합성되므로 이 방식이 기존 조직 격리를 건드리지 않는 유일한 경로다.
(반대로 **좁히려면** 추가가 아니라 교체해야 한다 — T06 이 `audit_select` 에서 쓴 방법.)

수임자는 **반드시 플랫폼 관리자**여야 한다 — `has_active_grant()` 내부에서 `is_platform_admin()` AND.
이게 없으면 멤버가 임의의 외부 계정에 조직을 열어줄 수 있다.

홈택스 차단은 "정책을 안 만든 것"에 의존하지 않는다. **RESTRICTIVE 정책**이라 나중에 누가
실수로 위임 정책을 추가해도 실제 조직 멤버가 아니면 통과하지 못한다.

## ⚠ T06(mod.notify) 머지 후 반드시 정리할 것

T06 PR #50 이 인앱 알림의 **정본 계약**을 가져온다. T08 은 그 전에 만들어져
**임시 알림 테이블**(`support_notifications`)을 자체 보유한다. T06 머지 후 아래를 수행한다.

### (1) 마이그레이션 번호 — 매 리베이스마다 재실측할 것

**번호는 고정값이 아니다.** T08 은 최초 `008` 로 냈으나 그 사이 `008`~`016` 이 머지돼
**`017`** 로 재배정했다. T06 도 `008 → 015` 로 옮겼는데 main 에 이미 `015`·`016` 이 있어
**T06 역시 재배정이 필요**하다(#50 미머지 상태에서 확인).

규칙: **머지 직전에 `git ls-tree origin/main -- supabase/migrations` 로 최신 번호를 실측하고
그다음 번호를 쓴다.** 나중에 머지되는 쪽이 양보한다. 추측 금지.

### (2) 알림 테이블 통합 — `support_notifications` → `notifications`
T06 의 핵심 계약은 **"봤다(`read_at`) ≠ 했다(`resolved_at`)"** 이다.

| 뱃지 | 조건 | 사라지는 시점 |
|---|---|---|
| 🔴 숫자 | `is_action && resolved_at is null` | **처리해야** 사라짐 |
| • 점 | 미열람 | 화면 진입 시 |

T08 의 현재 구현은 `read_at` 하나뿐이라 이 계약을 만족하지 못한다. 매핑:

| T08 알림 | T06 `type` | `is_action` | 근거 |
|---|---|---|---|
| `grant_started` | `access_grant` | **true** | 오너가 "강제 종료할지" 판단해야 하는 **행동 항목**. 화면만 열었다고 사라지면 안 된다 |
| `grant_ended` | `access_grant` | false | 통지일 뿐 행동 불필요 |
| `support_reply` | `support_reply` | false | 확인이면 충분 → 점 뱃지 |

> ⚠ **알려진 계약 위반(현재)**: `SupportLauncher` 가 문의 목록을 열 때 `markRead()` 를 호출해
> **위임 알림까지 지운다**. T06 계약에서는 `grant_started` 가 화면 진입만으로 사라지면 안 된다.
> 통합 시 `resolved_at` 은 **위임을 실제로 종료했을 때만** 찍어야 한다.

T06 은 클라이언트 insert 정책을 두지 않는다(위조·남발 방지). 발행은 **definer 트리거/서버 경로**로만 —
`create_access_grant()` / `revoke_access_grant()` 가 이미 SECURITY DEFINER 라 그 안에서 발행하면 된다.

### (3) 소식창 표면 일원화
T06 은 **회사 소식 = `audit_logs` 재사용**으로 확정했다(신규 테이블 없음).
T08 의 `SupportService.postNotice()` 는 T04 보드 엔진의 공지보드에 쓰고 있어 **표면이 다르다**.
위임 수명주기는 이미 `audit_logs` 에도 적재하므로, 통합 시 `postNotice()` 를 **제거**하면
소식창이 `audit_logs` 하나로 수렴한다.

`audit_select` 정책은 T06 이 교체한다. 위임 감사행은 `target_type='access_grants'` 라
새 정책의 `or target_type is distinct from 'deal'` 절에 걸려 **계속 보인다**(확인 완료).

## 파킹 (T08 소관 아님)

1. `is_platform_admin()`(006)은 `app_admins.role='admin'` 을 요구하는데 005 시드의 belie 행은
   `role='owner'` 다. → **프로덕션에서 운영자 판정이 false** 라 위임 수임이 실동작하지 않는다.
   **T03/T07 소관**이라 건드리지 않았다.
2. `Org` 타입(T03 소유)에 `slug` 가 없어 진단 컨텍스트 `org_slug` 에 `org.id` 를 넣는다.

## 프라이버시

진단 컨텍스트는 **화이트리스트 6키만**: `path` · `org_slug` · `role` · `app_version` · `browser` · `last_error_id`.
고객사명·대표자명·연락처·금액은 자동 첨부하지 않는다.

`sanitizeDiag()`(앱)와 `support_threads_diag_whitelist` CHECK(DB)가 **같은 목록**을 강제한다.
둘 중 하나만 고치지 말 것. 화이트리스트 밖 키는 **조용히 버린다** — 에러를 내면 클라이언트가
우회 문자열로 밀어 넣을 유인이 생긴다.
