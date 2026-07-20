# AGENTS.md — moawork

여러 에이전트/트랙이 병렬로 moawork 를 구축한다. 각 트랙의 역할과 규칙을 정의한다.

## 트랙

| 트랙 | 역할 |
| --- | --- |
| **T01 (기반)** | 모노레포 골격 — app/worker/supabase 레이어, check.sh 게이트, CI, .githooks, SSOT 4문서. |

> 신규 트랙은 `docs/coordination/session-registry.yaml` 에 등록하고, 맡은 작업을 `docs/coordination/dispatch-queue.yaml` 로 옮긴다.

## 공통 규칙

1. **게이트 우선**: 커밋 전 `bash scripts/check.sh` 통과 필수.
2. **비밀값 금지**: 키·토큰·비밀번호를 코드/문서/설정에 기록하지 않는다.
3. **SSOT 갱신**: 완료 단위마다 `docs/worklog.md` 에 기입. 조율 상태 변화는 `docs/coordination/*` 갱신.
4. **checkpoint 유지**: 의미 있는 단위마다 커밋해 진행을 보존한다.
5. **경계 존중**: 다른 트랙의 담당 영역을 임의로 바꾸지 않는다. 조율은 `dispatch-queue.yaml` 로.

## 개발 명령

```bash
npm install          # 워크스페이스 의존성 설치 (+ githooks 경로 설정)
npm run dev          # app 개발 서버
npm run check        # lint + typecheck + test (게이트)
```
