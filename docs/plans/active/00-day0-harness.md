# 00 — Day-0 하네스 구축

- 상태: ready_for_handoff (로컬 검증 완료, 원격 작업은 비범위)
- task_id: `day0-harness-bootstrap`
- writer: `track-07 / codex` — 사용자 직접 배정 `!통합 T07 기반(260721)codex` · **재귀속: track-01(기반)** (오케스트레이터 정리 2026-07-21)
- 브랜치: `chore/day0-harness`
- file lease: `통합관리시스템/**` (제품 기능·기획서 v0.1 제외)
- 시작: 2026-07-21 01:31 KST

## 범위

로컬 Git, 앱·레이어·워커 골격, TypeScript strict/lint/단위·구조 검사, 500줄 제한, active-plan/SSOT 검사, pre-commit 훅, SSOT 4문서와 기계 판독 coordination 정본을 만든다.

## 비범위

CRM 기능, 업무 DB 스키마, Supabase·OAuth·외부 API 실제 연결, 제품명·가격·벤더 결정, 원격 저장소·push·PR·배포, 기존 기획서 v0.1 수정과 실고객 데이터 취급.

## 수용 기준

- `npm.cmd run check` 성공.
- 레이어 역참조와 외부 SDK 경계 위반 검출.
- active plan과 repository SSOT 누락 검출.
- pre-commit이 기본 브랜치 직접 커밋과 실패한 검사를 차단.
- 비밀값·개인정보·실고객 데이터 없음.

## 복구

원격 작업은 없다. 변경은 로컬 브랜치 diff로 개별 복구한다. `.git/` 제거 같은 전체 초기화는 별도 승인 없이는 하지 않는다.

## 관제 충돌

기존 `dispatch-queue.md`는 `T07=mod.perf`, `T01=기반`이며 활성화 게이트도 미충족이다. 이번 명령은 단일 Day-0 기반 작업의 사용자 직접 예외 배정으로 기록한다. 전체 `active_controller`는 Claude로 유지하고, 제품 트랙 로스터는 오케스트레이터가 후속 정리한다. **[정리 완료 2026-07-21] 오케스트레이터 결정: 이 Day-0 기반 작업 = track-01(기반)로 귀속, T07은 mod.perf로 환원. README 조직을 10트랙(T01~T10)으로 통일.**
