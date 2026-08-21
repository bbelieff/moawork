# 서브에이전트 자체 검수 — 표준안

**2026-08-21 BBE-267 개정.** 모든 워커와 엔진(Claude/Codex)에 같은 규칙이다.

## 한 카드 안에서 끝낸다

작성 워커가 PR과 CI를 만든 뒤 자기 서브에이전트를 새 문맥으로 띄운다. 작성자와 검수자를
별도 top-level 세션으로 나누지 않으며, 코디네이터가 reviewer를 호출하거나 판정을 writer에게
되돌려 주는 단계도 없다. root 코디네이터는 서브에이전트를 띄우지 않는다.

서브에이전트에는 부모의 결론·변명을 주지 않는다. 아래 네 가지만 준다.

- 카드 번호와 수용 조건
- PR 번호와 **exact head SHA**
- 선언된 파일 lease
- diff와 실행할 검증 명령

## 필수 검증

1. focused test와 회귀/변이 검증
2. `bash scripts/check.sh`
3. production build
4. CI·보안·Preview 상태
5. 명세 대비 diff, lease 위반, 비밀값·고객 고유값
6. UI 변경이면 현재 저장소가 요구하는 실제 화면 증거

못 실행한 항목은 PASS로 위장하지 않고 `NOT_RUN`으로 적는다.

## 판정과 진행

- **P0/P1 finding**: merge를 막는다. 같은 워커가 같은 카드에서 수정하고 새 exact head로 다시 검수한다.
- **P2/P3·시각 다듬기**: merge를 막지 않는다. Linear 후속 카드 또는 PR 기록에 남기고 진행한다.
- **P0/P1=0**: 별도 reviewer 승인을 기다리지 않고 expected-head merge → 배포 → health까지 간다.
- **강한 정지선**: 인증, 보안/권한 하향, 발송/과금, 비가역 고객 데이터 변경은 등급과 무관하게
  필요한 사용자 승인·실행 권한 없이는 merge하지 않는다.

자기 PR을 GitHub에서 스스로 approve하지 않는다. 서브에이전트 판정 원문과 ID를 PR 댓글과
Linear 카드에 남기는 것이 검수 증거다.

## 붙여넣는 프롬프트

```
너는 독립 검수자다. 부모의 구현 설명이나 결론 없이 카드 명세와 exact diff만 판정한다.

카드: <BBE-번호와 수용조건>
PR: #<번호>
exact head: <SHA>
lease: <파일 목록>

focused test, check, production build, CI 상태와 diff를 직접 확인하라.
finding마다 P0/P1/P2/P3를 붙이고 근거 파일·행·재현을 적어라.
P0/P1은 blocking, P2/P3·visual polish는 non-blocking follow-up이다.
인증·보안/권한 하향·발송/과금·비가역 고객 데이터 변경은 strong stop으로 별도 표시하라.
마지막 줄은 `VERDICT: PASS (P0=0, P1=0)` 또는 `VERDICT: BLOCK (P0=n, P1=n)`이다.
```

## 증거

PR 댓글과 Linear 완료 도장에 카드 번호, PR exact head, 서브에이전트 판정 원문/ID,
P0/P1 개수, P2/P3 후속 링크를 남긴다.
