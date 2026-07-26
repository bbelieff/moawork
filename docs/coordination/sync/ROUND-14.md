# SYNC Round 14 — 동업자 계정 진입·권한 배정

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 개인정보 보호를 위해 대상 이메일 원문은 coordination 문서에 기록하지 않는다.

## 사용자 결정

- 지정한 동업자 Google 계정의 MoaWork 진입을 허용한다.
- 기존 사용자는 보호된 owner로 유지한다.
- 동업자는 owner를 강등·삭제·권한변경하는 기능을 제외한 전체 업무·관리 권한을 갖는다.
- 예상 매핑은 `admin + 전체 scope`이나 실제 role·RLS·관리 경계를 T10이 독립 확인한 뒤 적용한다.

## 작업판

| WORK-ID | 담당 | thread | 상태 | 범위 | 다음 행동 |
|---|---|---|---|---|---|
| ACCESS-PARTNER-VERIFY-01 | 영구 T10 | `019f8056-311c-7402-81cd-247526ca457c` | RUNNING | role·scope·owner 보호 READ-ONLY 감사 | 판정을 T03에 직접 전달 |
| ACCESS-PARTNER-01 | 영구 T03 | `019f7fe5-9278-7f61-9d4a-698fcd476303` | RUNNING | 실제 workspace·초대 경로 확인, 조건부 운영 반영 | T10 PASS 수신 후 적용·read-back |
| MWC | dispatcher | 현재 thread | PARKED | 새 사용자 아이디어 intake | 완료 대기 없이 유휴 복귀 |

## 직렬·병렬 DAG

1. T03 권한 모델·운영 경로 조사와 T10 독립 권한 검수를 병렬 실행한다.
2. 실제 멤버십·초대 쓰기는 T10 PASS가 T03에 전달된 뒤에만 진행한다.
3. T03은 적용 후 계정 매핑·role·scope·owner 불변을 읽기로 재검증한다.
4. 코드 변경이 필요하면 현재 공유 checkout을 수정하지 않고 별도 Worktree·lease를 MWC에 요청한다.

## 안전 경계

- owner 권한 변경 금지.
- 동업자에게 owner 또는 owner 관리 권한 부여 금지.
- 정확한 운영 workspace가 모호하면 쓰기 금지.
- 비밀값·토큰·쿠키·실제 데이터 기록 금지.
- 첫 Google OAuth가 필요한 모델이면 사전 허용만 반영하고 사용자 행동을 명시한다.

## 현재 상태

T03과 T10의 실제 전달·수락을 확인했다. 두 세션은 active이며 MWC는 결과를 동기 대기하지 않고 유휴로 돌아간다.
