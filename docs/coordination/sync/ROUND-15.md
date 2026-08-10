# SYNC Round 15 — 고객사 Workspace 회원구조 기획

> 작성: MoaWork Control(MWC) · 2026-07-23 KST

## 사용자 결정

- 회원은 고객사 Workspace 단위로 움직인다.
- 목표 위계는 `Platform Admin > Workspace > Owner > C-level > 팀장 > 사원 > 사용자 정의 하위계층`이다.
- Owner는 Admin 승인 후 진입하고, 일반 멤버는 동일 base level로 가입한 뒤 Owner가 승격한다.
- 상급자는 자기 하급자에게 editor/viewer/접근불가를 위임할 수 있다.
- 멤버관리에서 등급·계층·팀·권한을 편집하고 상단 조직도가 즉시 갱신된다.
- 작은 조직의 대표·팀장·사원 구성이 가장 쉽게 작동해야 한다.
- 충돌 우선순위는 `tenant 격리 > owner 보호 > 최소권한 기본값 > 위임 자유도 > 직관적 UX`다.

## Parallel Wave 1

| WORK-ID | 담당 | 상태 | 결과 |
|---|---|---|---|
| MEMBER-BENCHMARK-01 | T01 | RUNNING | Slack·monday 공식 구조 비교 |
| MEMBER-TENANCY-01 | T02 | RUNNING | Workspace multi-tenant 데이터 모델 |
| MEMBER-AUTHZ-01 | T03 | QUEUED | 선행 권한 작업 후 role·RLS 설계 |
| MEMBER-FLEX-01 | T05 | RUNNING | 사용자 정의 계층·ACL·위임 |
| MEMBER-LIFECYCLE-01 | T06 | RUNNING | 초대·승인·승격·이동·알림 |
| MEMBER-GOVERNANCE-01 | T07 | RUNNING | 감사·복구·보안 테스트 |
| MEMBER-ENTITLEMENT-01 | T09 | RUNNING | seat·플랜·Workspace 제한 |
| NEXT-IDEA-BUFFER | T08 | PARKED | 새 아이디어 intake |

## Serial Wave 2·3

1. T10이 upstream 결과를 `brand/MoaWork_Member_Architecture_v0.1.md`로 통합한다.
2. T10이 T04에 명세 delta를 전달한다.
3. T04가 `brand/MoaWork_Member_Management_Mockup_v0.1.html` interactive 목업을 만든다.
4. T04가 로컬 브라우저에 목업을 열고 T10에 재검수를 요청한다.
5. T10이 직관성·권한 일관성·접근성·분기를 최종 판정한다.

## 선행 owner 보호 위험

진행 중인 검수에서 현행 멤버 관리가 호출자의 owner/admin 여부만 검사하고 변경 대상 owner를 별도로 보호하지 않을 가능성이 발견됐다. 따라서 기존 동업자 `admin + 전체 scope` 운영 반영은 안전성 확정 전 보류한다. 새 회원구조에서는 owner 보호를 불변조건과 migration gate로 다룬다.

## MWC 상태

T01·T02·T05·T06·T07·T09의 실제 active를 확인했다. T03·T10은 선행 작업 뒤 새 작업을 이어받는다. T04는 통합 명세 대기, T08은 intake buffer다. MWC는 동기 대기 없이 PARKED로 복귀한다.
