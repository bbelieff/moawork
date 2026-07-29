# 세션 정보추출·생성 프롬프트 (접근 불가 세션용)

> **📄 이 문서는 무엇인가요?**
> - **한 줄 요약**: Cowork(샌드박스)가 직접 볼 수 없는 세션(디스패치·기존 A~F·카페봇)에 그대로 붙여넣어, 인수인계에 필요한 상태를 스스로 채워 넣게 하는 프롬프트 모음.
> - **누가 읽나요**: 운영자(belie)가 복사 → 해당 세션 창에 붙여넣기. 대상 세션의 AI가 실행.
> - **어떤 작업과 연결?**: `session-registry.yaml`·`docs/handoffs/*`·카페봇 로컬 3종의 빈칸 채우기(스펙 §7·§8·§17-9).
> - **관련 문서**: [session-registry.yaml](./session-registry.yaml), [codex-bootstrap.md](./codex-bootstrap.md), [takeover-runbook.md](./takeover-runbook.md)

**왜 필요한가**: Cowork는 git 쓰기 금지(CLAUDE.md §6.7)이고 `projects/salespt-cafe-bot`는 샌드박스에
마운트되지 않는다. 그래서 각 세션의 branch·SHA·미커밋 상태·checkpoint는 **그 세션만이 정확히 안다**.
추측으로 채우면 안 되므로(스펙 §5), 각 세션이 자기 상태를 직접 기록하게 한다.

**공통 안전**: 아래 프롬프트는 모두 **읽기·기록만** 시킨다. 비밀값(토큰·비번·URI)은 어떤 칸에도 쓰지 않는다.

---

## 1. 기존 코드 트랙(A~F) — 각 Claude Code 창에 붙여넣기

> 트랙마다 한 번씩. `<트랙>`을 A/B/C/D/E/F 중 자기 것으로 바꿔서.

```
너는 기존 TRACK-<트랙> 세션이다. 인수인계 레지스트리의 네 칸을 채운다. 읽기·기록만 하고, 코드·git은 바꾸지 마라.

1) 아래를 실측해서 답하라 (모르면 unknown, 추측 금지):
   - 현재 역할 / 최종 목표 / 지금 하는 작업
   - branch 이름 / worktree 절대경로
   - base_sha(git merge-base origin/master HEAD) / head_sha(git rev-parse HEAD)
   - Open PR 번호(있으면) / 변경 파일 목록
   - git status 요약: staged·unstaged·untracked 각 몇 건, 핵심 파일명
   - 마지막 완료 작업 / 마지막 성공 검사(check.sh 등) / 실패한 명령과 원인
   - 현재 블로커 / 다음 원자 행동(한 문장) / 절대 건드리면 안 되는 범위
   - 관련 plan·ADR·incident·worklog 경로 / 마지막 checkpoint 시각
2) 위 내용을 docs/worklog.md 맨 위에 "[checkpoint] TRACK-<트랙> 2026-..." 항목으로 추가하라(형식은 파일 상단 규칙).
3) 비밀값은 어떤 칸에도 쓰지 마라. 커밋·푸시는 하지 말고 belie에게 "기록 완료" 한 줄만 보고하라.
```

**belie 사용법**: 각 창에 붙여넣기 → 각 세션이 worklog에 checkpoint 한 줄 추가 → 다음 Cowork 세션이
그걸 읽어 `session-registry.yaml`의 해당 legacy_track / DEV 칸을 갱신. (Cowork는 git 못 쓰니 세션이 기록.)

---

## 2. CLAUDE-DISPATCH 세션 — 디스패치 창에 붙여넣기

```
너는 CLAUDE-DISPATCH다. 인수인계용으로 아래만 기록하라(읽기·기록만).
- 지금 belie가 너를 통해 진행 중인 작업 목록(트랙별 최근 지시 1줄씩)
- 아직 belie 결정 대기 중인 항목(📥결정함과 대조 — 누락 있으면 추가)
- 각 트랙에 마지막으로 내린 지시와 그 상태(착수/진행/완료/블로킹)
이걸 docs/worklog.md 디스패치 섹션과 대조해 어긋난 것만 정정하라. 비밀값 금지. 완료 후 belie에게 한 줄 보고.
```

---

## 3. CAFE-TELEBOT(→OPS-CAFE-BOT) 세션 — 카페봇 창에 붙여넣기

> Cowork는 `projects/salespt-cafe-bot`에 접근 못 함. 이 세션이 자기 폴더에 로컬 3종을 만들어야 한다.
> **웹앱과 카페봇 운영 상태를 한 파일에 섞지 말 것**(스펙 §8) — 카페봇 상태는 카페봇 폴더에만.

```
너는 salespt-cafe-bot 운영 세션(→ 새 이름 OPS-CAFE-BOT)이다.
로컬 projects/salespt-cafe-bot 안에 인수인계 3종을 만들어라(비밀값·토큰·SSH키·비번은 절대 기록 금지 — "환경변수로 주입" 같은 참조만).

1) HANDOFF.md — 이 봇이 뭘 하는지 / 네이버 카페 게시·Telegram·과제확인 자동화의 흐름 / 크론 스케줄 요약 /
   VPS 원격경로(/opt/bots/salespt-cafe-bot, 웹앱 /opt/salespt-log와 분리) / 자주 터지는 함정 / 다음 할 일.
2) ops-status.yaml — 기계 판독용:
   bot:
     status: active | paused | unknown
     provider: claude
     writer_session: OPS-CAFE-BOT
     local_path: 'C:\Users\belie\Desktop\Belief\클로드\projects\salespt-cafe-bot'
     remote_path: /opt/bots/salespt-cafe-bot
     last_deploy: <날짜 또는 unknown>
     cron_jobs: [ {name:, schedule_kst:, next_run:, last_result:} ... ]
     scope_forbidden: ["dev-harness 코드", "VPS /opt/salespt-log"]
     secrets_location: "환경변수/서버 .env (값은 기록 안 함)"
   3) worklog.md — 카페봇 전용 작업 로그(웹앱 worklog와 별개). 최근 게시·장애·예약 항목.
게시(외부 발행)는 belie 기승인 범위만. 신규 채널·신규 유형은 belie 재확인. 완료 후 "카페봇 인수인계 3종 생성 완료" 보고.
```

---

## 4. Codex 세션 — `codex-bootstrap.md` 사용

Codex 트랙/Failover-Control 시작은 이 파일이 아니라 **[codex-bootstrap.md](./codex-bootstrap.md)**의
블록을 붙여넣는다. (여기 1~3은 "기존 Claude 세션의 상태를 뽑아내는" 용도, bootstrap은 "새 Codex를 규약에
맞게 세우는" 용도로 목적이 다르다.)

---

## 채워지는 경로 (누가 어디를)

| 프롬프트 | 대상 세션 | 채우는 곳 |
|---|---|---|
| 1 | 기존 A~F | `docs/worklog.md` checkpoint → 다음 Cowork가 `session-registry.yaml` 반영 |
| 2 | CLAUDE-DISPATCH | `docs/worklog.md` 디스패치·📥결정함 정정 |
| 3 | CAFE-TELEBOT | `projects/salespt-cafe-bot/{HANDOFF.md, ops-status.yaml, worklog.md}` (로컬) |
| 4 | Codex | 해당 트랙 handoff + `session-registry.yaml` (bootstrap 규약대로) |
