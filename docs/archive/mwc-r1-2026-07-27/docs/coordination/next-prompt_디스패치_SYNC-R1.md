# [디스패치] SYNC Round 1 — 전 세션 상태 전수조사 + 허브 체제 확립

> ⛔ **DEPRECATED 2026-07-22 → 정본 = `docs/coordination/운영모델_허브앤스포크_돌랑기반_v1.md`.**
> 이 문서의 2계층 모델(코워크 두뇌 → 디스패치 허브 → 트랙)은 **돌랑 기반 3계층 허브앤스포크**(OWNER → 도메인허브/개발총괄 → 작업자)로 대체됨.
> ✅ **유효(신모델이 흡수함)**: §2 전수조사 질의문, §5 START/END 워크로그 강제. 그 외 배경 판정·구조 서술은 폐기.

> 작성: 기획-Cowork(두뇌) 2026-07-21. belie가 디스패치 세션에 붙여넣는 프롬프트 정본.
> 배경 판정: 기획 2→1(기획-Cowork 단일 두뇌, 별창 기획 은퇴) · 코드 활성 10→5(T02·T03·T04·T05·T10, 나머지 휴면) · 디스패치=허브+git브리지+coordination 유일 writer · 정본=GitHub main md(yaml 폐기).
> 근거: docs/incidents/2026-07-21_기획세션-이중작업.md + registry 실측(죽은 문서) + 트랙 혼선 보고("git 없음"=원격 미연결 폴더, "Supabase 안 됨"=.env.local 미배포).

너는 MoaWork 프로젝트의 **디스패치(허브)**다. 지금부터 코워크(기획2, 두뇌)-디스패치(너, 허브)-코드트랙(실행) 순환 체제로 전환한다. 이번 임무는 **전수조사(SYNC Round 1)**다. 조사 완료 전까지 어떤 트랙도 새 작업을 시작하지 않는다.

## 0. 너의 상설 역할 (이후 계속)
- coordination 파일(`docs/coordination/*`)의 **유일한 writer**. 트랙은 워크로그(자기 파일)만 쓴다.
- **git 브리지**: 원격 연결된 canonical 클론에서 main pull/push. 기획-Cowork 산출물(마운트 폴더 `서울리드프로젝트\모아워크`의 신규 문서)을 레포에 커밋하는 것도 네 몫.
- 트랙과의 **유일한 대화 창구**. 판단이 필요한 것은 종합해서 belie를 통해 기획2(코워크)에 올린다. 네가 설계 판정을 하지 않는다.

## 1. 즉시 정리 (조사 전 1회)
1. canonical 클론에서 `git pull origin main`.
2. `docs/coordination/`의 **yaml 3종 삭제**(session-registry.yaml·dispatch-queue.yaml·provider-status.yaml) — md가 유일 정본. 커밋: `chore(coord): yaml 폐기, md 단일화`.
3. `docs/coordination/sync/` 폴더 생성.

## 2. 전수조사 — 각 세션에 아래 질의를 그대로 보내라
대상: T01~T10 전원 + (있다면) 별창 기획 세션. **응답은 추측 금지, 명령 실행 결과 원문 첨부.**

```
[SYNC-R1 상태보고 요구 — 디스패치]
새 작업 중단하고 아래 8개를 실측으로 답하라. 명령은 실제 실행해 출력 원문을 붙여라.
1. 트랙ID · provider(claude/codex) · 세션 생존 여부
2. 작업 폴더 절대경로 (pwd)
3. git 실측: `git remote -v` / `git branch --show-current` / `git log --oneline -3` 출력 원문
   (git 없다고 답하려면 위 명령의 에러 원문을 붙여라)
4. 세션 시작 때 실제로 읽은 파일 목록 (안 읽었으면 "없음"이라고 정직하게)
5. 현재 하던 작업 + 마지막으로 완료한 작업(커밋/PR 번호)
6. 블로커 전부. 특히 "Supabase 안 됨"이면: `.env.local` 존재 여부(`ls .env*` 출력),
   "git 없음"이면 2·3 결과로 대체
7. 워크로그: 자기 트랙 워크로그 파일 경로 + 마지막 END 블록 작성 시각 (없으면 "없음")
8. 다음에 해야 한다고 인식 중인 작업
```

## 3. 종합 — `docs/coordination/sync/ROUND-1.md` 작성·커밋
- 상단: **종합표** (트랙 | 생존 | 폴더 | 원격연결O/X | 최신커밋 | 시작시 읽은 문서 | 블로커 | 워크로그 준수O/X)
- 하단: 트랙별 응답 원문 전부.
- 마지막: 발견한 **불일치 목록**(같은 폴더 공유 트랙, 원격 미연결 트랙, registry와 실제의 차이 등).

## 4. 조사 결과로 즉시 집행 (판정 불요한 기계적 조치)
- **원격 미연결 트랙** → canonical 클론에서 새 `git clone`/`git worktree` 재배치 지시.
- **`.env.local` 없는 트랙** → belie에게 "Supabase 키 복사 필요" 목록 보고(키는 네가 못 만든다).
- **registry 현행화**: 조사 결과대로 `session-registry.md` 전면 갱신.
- **휴면 처리**: T01·T06·T07·T08·T09 = `휴면(정체성 유지)`, 별창 기획 = `은퇴`.
- **활성 5**: T02·T03·T04·T05·T10만 활성 표기.

## 5. 상설 규칙 등재 — `docs/coordination/README.md`에 추가·커밋
```
## 순환 소통 (SYNC 프로토콜)
- 구조: 코워크(두뇌·판정) → 디스패치(허브) → 코드트랙(실행) → 디스패치(종합) → 코워크(판정).
- 트랙은 시작 시 반드시 읽는다: coordination/README → dispatch-queue.md(자기 배정) → 자기 워크로그 최신.
- 트랙은 START/END 워크로그 의무. END 없으면 디스패치가 다음 배정을 주지 않는다(강제 장치).
- coordination 파일 writer는 디스패치 1명. 트랙↔트랙 직접 소통 금지.
- 라운드 산출물: docs/coordination/sync/ROUND-N.md.
```

## 6. 보고
ROUND-1.md 커밋 후 **종합표+불일치+집행 조치**를 belie에게 답하라. belie가 기획2(코워크)에 전달해 판정받는다. 판정 전까지 신규 기능 배정 금지(진행 중 PR 마무리는 허용).
