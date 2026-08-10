# 일감 분배 — MWC ↔ 코덱스 병렬 개발 (MWC 초안)

> 실측 2026-07-27 · MWC · canonical **읽기 전용** 조사 · belie 지시("일감 나눠서 같이 개발, 속도 올리자")

---

## 0. 먼저 — 코덱스는 지금 **belie를 기다리는 중**이다 (최대 병목)

`ROUND-31`(07-26) 최종 상태:
```
PASS_EXACT_CURRENT_HASH / PROTOTYPE_BROWSER_RECOVERY_COMPLETE
/ USER_VISUAL_SELECTION_READY / PRODUCT_HOLD

명시적 NOT_RUN/HOLD:
 - 실제 product server redirect
 - callback, session, RLS, DB
 - production deployment
 - **사용자 B-1/B-2/B-3/B-4 선택**       ← 여기서 멈춤
 - product implementation, merge, deploy
```

즉 프로토타입 검수는 264/264 PASS까지 끝났고, **belie가 4안 중 하나를 고르지 않아 제품 구현이 통째로 HOLD**다.

### belie가 30초에 할 일 — 4안 중 택1
| 안 | 이름 | 성격 |
|---|---|---|
| **B-1** 함께 보기 | Guided Fork | 선택이 필요할 때만 두 경로를 함께 제시. 서버가 목적지를 확인했으면 질문 건너뜀 |
| **B-2** 나눠 보기 | Guided Split | 서버가 확인한 근거(소속·목적지)와 사용자 행동을 분리해 제시 |
| **B-3** 하나씩 묻기 | One Question | 라우팅 확정 시 질문 0개, 필요할 때만 질문 1개에 집중 |
| **B-4** 짧게 모아 보기 | Compact Guided Hub | 소속·대기요청·검증결과를 작은 조직용 허브로 압축 |

시안 파일: `brand/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html` (52,654 bytes — ROUND-31 receipt와 일치)

---

## 1. 머지 지뢰 (코덱스에 전달 — 진단서 보완)

**마이그레이션 번호 `006` 충돌**: 두 스택이 같은 번호를 다르게 씀.
```
feat/public-workspace-entry      → supabase/migrations/006_public_workspace_entry.sql
feat/workspace-bootstrap         → supabase/migrations/006_workspace_bootstrap.sql
agent/p0-session-integration     → 006_workspace_bootstrap.sql + 007_p0_authz_expand.sql
```
→ 두 스택을 함께 머지하면 **번호 중복·적용 순서 붕괴**. 먼저 머지되는 쪽이 006을 갖고, 나중 쪽은 **리넘버링(007→008…)** 필요. 순서를 먼저 확정할 것.

---

## 2. 분업 원칙 — 능력으로 나눈다 (충돌 0)

| | 코덱스 | MWC |
|---|---|---|
| 영역 | `app/src/**` · 머지 · 배포 | `supabase/migrations/**`(신규 번호) · 외부 콘솔 · 브라우저 검증 |
| 근거 | 8개 브랜치 전부 `app/src/**`를 만짐 | 그중 **`supabase/`를 만지는 건 일부뿐이고, MWC는 008 이후 신규 번호만 사용** → 파일 충돌 0 |
| 고유 능력 | git push·머지·배포 | **먼데이 라이브 실측**·Supabase 콘솔·구글/GCP·실사용자 브라우저 검증 |

> **핵심**: 코덱스가 `B4 정산` 머지 때 **"G8 자동이동은 근거 부재로 차단"** 했다. 그 '근거' = 먼데이 실측 데이터이고, **먼데이 커넥터는 MWC만 갖고 있다.** 코덱스가 못 하는 일을 MWC가 채우는 구조.

---

## 3. 일감 배분

### 🔵 코덱스 (레포 안)
| # | 일감 | 비고 |
|---|---|---|
| C1 | **`feat/public-workspace-entry` → main 머지 + 배포** | 최우선. 153파일·+25,091줄. belie 요구 ①로그인 ②워크스페이스 진입 포함 |
| C2 | `entry-db` 고유 3커밋 반영 | 보안: 가입 열거 취약점·예약어 라우트 |
| C3 | 006 번호 충돌 정리 | §1 참조 |
| C4 | B-N 선택안 제품 구현 | belie 선택 직후 착수 |
| C5 | p0-* 스택 정리(중복 판정) | 후순위 |

### 🟢 MWC (레포 밖 + 신규 SQL)
| # | 일감 | 산출물 | 충돌 |
|---|---|---|---|
| **M1** | **status 라벨 시드** — 먼데이 라이브에서 상담상황·업종·진행기관·진행상품 등 **라벨+hex+is_done+index** 실측 → `board_columns.options_jsonb` 시드 | `supabase/migrations/008_status_labels_seed.sql` (신규) | 0 |
| **M2** | **G8 자동화 프리셋 시드** — 먼데이 자동화 19개 전수 실측(트리거 라벨→대상 그룹) → `board_automation_rules` 시드. **코덱스가 "근거 부재"로 차단한 건의 근거 공급** | `009_automation_presets_seed.sql` + 실측표 | 0 |
| **M3** | 로그인 P0 원인 확정 — Supabase 콘솔에서 `app_admin_role()`·`org_members` 실데이터 조회 | 진단 리포트 | 0 |
| **M4** | 배포 후 회귀 검증 — belie 계정 + **제2계정**(`user1@example.com`) 로그인 → 진입 화면 도달, 잠금 해제, 375px | 검증 리포트 | 0 |
| **M5** | B-N 선택 지원 — 시안 4안 비교 제시 | (진행 중) | 0 |

**근거**: main의 `002_seed_policyfund.sql`은 2,404줄이지만 `hex`·`labels`·`is_done` 언급이 **0건** — status 라벨 시드가 여전히 비어 있다. 원래 기획2 몫이었고 **아무도 하지 않았다.** M1·M2가 바로 그 구멍.

---

## 4. 순서

```
[지금] belie: B-N 택1  ─────────────────┐
[지금] 코덱스: C1 머지·배포              │
[지금] MWC: M1·M2 시드 개발(병렬, 충돌 0) │
   ↓ 배포 완료                          ↓ 선택 완료
[다음] MWC: M4 회귀검증 ← → 코덱스: C4 B-N 구현
```

MWC는 코덱스의 머지를 기다리지 않는다. 시드는 신규 파일이라 언제 합쳐도 안전하다.

---

## 5. 인계 방식
MWC 산출 SQL은 `_MWC초안` 없이 **정식 파일명**으로 작성하되, **커밋·머지는 코덱스**가 한다(MWC는 git 쓰기 0). belie가 파일 경로만 코덱스에 전달.
