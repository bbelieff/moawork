# SYNC Round 1 — 전수조사 결과

> 작성: 디스패치(허브) 2026-07-22
> 대상: T01~T10 + 기획1 (T08 세션 부재)

## 종합표

| 트랙 | 생존 | 원격 | 최신PR | .env.local | 워크로그 | 주요블로커 |
|---|---|---|---|---|---|---|
| T01 | ✅ | O | #13 MERGED | ❌ | O | Vercel 오버라이드 해제(belie) |
| T02 | ✅ | O | #9 MERGED | ❌ | O | Repo동기포트, /contract명명 |
| T03 | ✅ | O | #14 MERGED | ❌ | O | RLS크리덴셜, OAuth, DI-A4색 |
| T04 | ✅ | O | #10 MERGED | ❌ | O | 공지RLS충돌(004필요) |
| T05 | ✅ | O | #12 MERGED | ❌ | O | subitems스키마(DQ-0013) |
| T06 | ✅ | O | #8 MERGED | ❌ | O | 벤더미결, 설계문서미머지 |
| T07 | ✅ | O | #11 MERGED | ❌ | O | 디렉터리이원화, 렌더테스트인프라 |
| T08 | ❌부재 | — | — | — | — | 세션 미생성 |
| T09 | ✅ | O | #7 MERGED | ❌ | O | G8차단(004+11그룹), 공유트리오염 |
| T10 | ✅ | O | 머지큐완료 | ❌ | O | RLS크리덴셜, 정산parity |

## 공통 사실
- provider: 전원 claude(Opus 4.8). codex 0.
- `.env.local`: **전 트랙 전 폴더 부재**. 실DB 테스트 전면 불가.
- START/END 워크로그 규약: **미도입**. `## 날짜 — 트랙 · 제목` 형식만 사용.
- `next-prompt_B2-B7.md`: 전 ref·히스토리에 **0건**.

## 불일치
1. **공유 워킹트리 T09 점유** — T01/T05/T06이 pwd로 보고하나 브랜치는 T09 것. 미추적 파일(providers.tsx, supabase/*, proxy.ts)로 타입에러.
2. **전 트랙 로컬 브랜치 stale** — squash merge로 SHA 불일치. `git checkout main && git pull` 필요.
3. **T06 설계문서 미머지** — `feat/t06-notify-design` 브랜치에만 존재, PR 미생성.
4. **T04 워크로그 미기입** — PR#10 완료 후 worklog 누락.
5. **T08 세션 부재** — standby 등록만, 세션 미생성.
6. **registry yaml 정본 불일치** — `status: in_progress` 등 갱신 안 됨.
7. **잔여 worktree 3개** — wt-settlements, wt-salvage, wt-t02 (사용 트랙 없음).

## 집행 조치 (판정 불요)
- yaml 3종 삭제 (이 커밋에 포함)
- 활성 트랙: T02·T03·T04·T05·T10
- 휴면 트랙: T01·T06·T07·T09 (정체성 유지)
- T08: 미생성 확인
- 기획1: 은퇴 (별창 기획, 코워크 단일 두뇌로 전환)

---

# 승계 항목 (폐기 yaml 에서 이관 — T10 추출, 원문 기준)

> 아래는 삭제되는 `dispatch-queue.yaml` / `session-registry.yaml` 에만 존재하던 내용 중
> **여전히 유효하게 집행되는 규칙·판정**이다. 삭제로 소실되면 집행 근거가 사라지므로 이관한다.
> 완료된 DQ 항목과 이미 해소된 이력은 생략했다.

## S-1. 계약 파일 단일 소유 규칙 ★현행 집행 중

```
scope:  app/src/lib/types/**, app/src/lib/repo/index.ts
owner:  T03
```

> 타 트랙은 직접 편집하지 않는다. 필요한 포트/타입은 dispatch 로 T03 에 요청하고,
> T03 이 단일 선행 변경으로 추가한 뒤 소비한다. 구현체(local/localRepo.ts 등)와
> 업무 로직은 각 트랙 소유(예: settlements 업무로직=T09).

*(기획2 확정 2026-07-21. T10 은 매 PR 검수에서 이 규칙 위반 여부를 판정한다 —
2차 머지큐 8건 전부 "계약파일 미편집=클린", PR #14 는 "T03 소유자이므로 편집 정당"으로 통과시켰다.)*

## S-2. 승인 기록 요약 (AP-0001~0003 · RQ-0009)

| id | 주체 | 주제 | 판정 |
|---|---|---|---|
| **AP-0001** | T03 → 기획2 | 머지큐 ①T03(PR #1) — `lib/repo/index.ts` 계약 변경분 처리 | **APPROVED** — "안 1(계약 단일 소유) 이미 충족. 리워크 불필요." |
| **AP-0002** | T03 → 기획2 | `T02-repo-contract-review.md` 서명 — 계약 delta 승인 | **APPROVED** — "§1 인터페이스 delta 승인(수정 요구 없음)" |
| **AP-0003** | T03 → 기획2·T04 | DQ-0016 회신 — `getDeal`/`updateDeal` 포트 추가 요청 | **NO_ACTION_REQUIRED** — "요청한 2개 메서드는 이미 PR #1 에 존재. 추가 시 빌드 파손" |
| **RQ-0009** | T09 | B4 G8(상태→그룹 자동이동) 착수 불가 — 004 스키마·11그룹·지시문서 부재 | 미해소(아래 S-3) |

**AP-0002 부수 경고(여전히 유효)** — `Repo.updateDeal` 의 `DealPatch` 가 `stage_id` 를 허용하는데
"단계 변경은 move 전용(활동로그 보장)" 불변식은 **서비스 계층에만** 있다. `getRepo()` 를 직접 쓰는 트랙은
`updateDeal({stage_id})` 로 **활동로그 없이 단계 변경**이 가능하다.
해소안: 포트에 `moveDeal(ctx,id,toStageId)` 추가(갱신+로그 원자화) + `DealPatch` 에서 `stage_id` 제외.
담당 T03, 미착수.

**AP-0003 부수 경고(여전히 유효)** — `localRepo.updateDeal` 은 `Object.assign(d, rest)` 라서
`patch.custom` 이 **통째로 교체**된다(deep-merge 아님). 파일첨부 등이
`updateDeal(ctx,id,{custom:{files:[...]}})` 를 호출하면 **T05 커스텀필드 값·T09 정책자금 값이 전량 소실**된다.
→ 반드시 read-modify-write. 무증상 파손이므로 "에러 없음"이 아니라 **값 잔존을 긍정 확인**할 것.

## S-3. 미해소 DQ 항목만 (완료분 생략)

| id | 담당 | 상태 | 내용 |
|---|---|---|---|
| DQ-0001 | T01 | in_progress | Phase 0 → W1 모노레포 기반 구축 |
| DQ-0004 | T04 | in_progress | 문서·대시 — core.files 문서함 + contracts 상태 + core.dash |
| DQ-0005 | T05 | in_progress | 커스터마이징 — core.custom 커스텀필드/선택지/저장뷰 |
| DQ-0006 | T06 | **blocked** | 알림발송 — mod.notify + VPS 워커 발송 잡(pg-boss) |
| DQ-0007 | T07 | **blocked** | 성과·인센티브 — mod.perf 집계 + 리더보드 + 활동량 |
| DQ-0008 | T08 | **blocked** | 홈택스 — mod.hometax 조회→발행 + 워커 잡 |
| DQ-0009 | T09 | in_progress | 정책자금 업종팩 — ind.policyfund + settlements |
| DQ-0010 | T10 | in_progress | 게이트키퍼(검증) — parity/측정/RLS 침투테스트/완료판정 (상시) |
| DQ-0013 | 기획 | queued | 하위아이템(subitems) 스키마 — 003 items 에 parent 관계 |
| DQ-0017 | T05·T07 | in_progress | B3 상태컬럼 UI·board_views / B5 KPI 리더보드 |

*(완료: DQ-0002·0003·0012·0015 — 본 표에서 생략. 상세는 git 히스토리의 폐기 yaml 참조.)*

## S-4. 트랙 정체성 (session-registry 요약)

| 트랙 | 역할 |
|---|---|
| T01 | 기반 — 모노레포 / CI / check 게이트 / SSOT |
| T02 | 영업코어 core.crm — 보드 미러 / 파이프라인 / 단계 이동 |
| T03 | 조직·보안 core.org — RLS 멀티테넌시 / 구글 OAuth **/ 계약파일 소유** |
| T04 | 문서·대시 — core.files / contracts / core.dash |
| T05 | 커스터마이징 core.custom — 커스텀필드 / 선택지 / 저장뷰 |
| T06 | 알림발송 mod.notify — 알림톡·문자 / VPS 워커 |
| T07 | 성과·인센티브 mod.perf — 집계 / 리더보드 / 활동량 |
| T08 | 홈택스 mod.hometax — 조회→발행 / 워커 잡 (세션 미생성) |
| T09 | 정책자금 ind.policyfund + settlements 정산 |
| T10 | 게이트키퍼 — parity / 측정 / RLS 침투테스트 / 완료판정 |

## S-5. T10 검증 판정 SSOT 위치

트랙 완료판정·검수 기준·판정 이력은 **`docs/coordination/T10-gate-checklist.md`** 가 정본이다(본 폐기 대상 아님).
2차 머지큐 최종 판정(§10): main `6a57489`, 8 PR 전량 머지, 스모크 PASS=20/FAIL=0/SKIP=0.
**미검증 4건**(RLS 실DB 침투테스트 ★ / 구글 OAuth 실동작 / 정산 수식 parity / Storage org 격리)은 미해소 —
머지큐 완료는 **MVP 완료가 아니다**.
