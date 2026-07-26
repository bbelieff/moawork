# SYNC Round 13 — 10개 T세션 단일 두뇌 스케줄링

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 사용자 지시: `10개가 1개인 것처럼 움직이고 MWC는 빠르게 유휴로 돌아와 새 아이디어를 빈 세션에 넘겨라`

## 1. 확정 운영 모델

- `T01~T09`: 관련 도메인의 기획·구현·검토 실행 레인. 코드 작업 시 각각 독립 Worktree·branch·file lease의 단일 writer가 된다.
- `T10`: 구현 금지. 독립 검수·통합·merge gate.
- `DEV-1~3`: T 레인으로 안전하게 분리할 수 없는 경우만 사용하는 overflow Worktree thread.
- `MWC`: intake, 목표·계약·DAG 설계, 배정, delta 전달, 작업판·인계 갱신만 담당. 제품 코드 작성과 장기 대기 금지.

## 2. 직렬·병렬 규칙

### 즉시 병렬

- 수정 파일이 겹치지 않음
- 공통 타입·schema·API 계약을 동시에 바꾸지 않음
- 독립 검증·롤백 가능
- merge 순서가 결과 의미를 바꾸지 않음

### 반드시 직렬 wave

- schema/migration 결과를 후속 코드가 소비
- 공통 타입·API 계약을 선행 작업이 확정
- 동일 파일 또는 동일 file lease
- 앞 세션의 사용자 결정·실험 결과가 다음 구현 입력

## 3. 공유 문맥 패킷

모든 dispatch에는 다음을 포함한다.

`ROUND 경로·revision / base SHA / PR·branch / 사용자 결정 delta / upstream 결과 / 수정 허용·금지 파일 / lease / 병렬 group / 선행·후행 WORK-ID / 결과 패킷 형식`

각 세션 결과는 다음 형식으로 회수한다.

`변경 파일 / 계약 변경 / 테스트 / 확정 결정 / downstream delta / 위험·미검증`

다른 세션의 작업을 추측하거나 오래된 프롬프트를 기준으로 중복 구현하지 않는다. MWC 또는 batch collector가 upstream delta를 다음 wave에 전달한 뒤 시작한다.

## 4. MWC 신속 유휴 규칙

1. 사용자 요청 intake와 DAG·계약 작성
2. 실제 세션 전달과 수락 확인
3. 한 줄 배정 현황 보고
4. 동기 wait 없이 MWC 유휴 복귀
5. 새 아이디어 수신 시 진행 작업판·lease 확인 후 빈 레인 또는 직렬 queue에 즉시 배정

기본적으로 T01~T09 중 최소 1개는 새 아이디어·긴급 수정 intake buffer로 `PARKED` 유지한다. 전력 투입은 사용자가 명시하거나 임계경로상 필요한 경우에만 한다.

## 5. 현재 작업판

| WORK-ID | 담당 | 상태 | 증거 | 다음 행동 |
|---|---|---|---|---|
| ORCH-AUDIT-01 | T01 | DONE | 구조 감사 회수 | 규칙 반영 완료 |
| LOGIN-VISUAL-VERIFY | T10 | DONE | PASS, P0/P1 없음 | 사용자 시각 승인 대기 |
| LOGIN-UI-PR18 | MWC 과거 직접 수정 | VISUAL_REVIEW_PENDING | PR #18 `a50000b`, checks PASS | 승인 전 merge 금지 |
| NEXT-IDEA-BUFFER | T01~T09 중 빈 레인 | PARKED | 사용자 새 아이디어 대기 | 새 WORK-ID로 즉시 dispatch |

로컬 검수 서버 `http://127.0.0.1:3025/login`은 계속 유지한다.

## 6. 다음 적용

다음 사용자 아이디어부터 MWC는 직접 구현하지 않는다. 관련 T 레인과 독립 Worktree를 선택하고 공통 SYNC 패킷을 전달한 뒤 즉시 유휴로 돌아온다. downstream은 upstream 결과 패킷을 받은 뒤에만 시작한다.
