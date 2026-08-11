# 기록 체계 감사·개편안 — Linear 도입 후 중복 제거 (2026-08-05 · MW-총괄)

목적: 토큰 절감 + 개발 환경 최적화. 원칙: **상태·이력은 Linear, 규칙·결정은 저장소 문서**로
정본을 하나씩만 둔다. 과거 기록은 지우지 않고 동결(아카이브)한다.

## 1. 실측 — 새 세션이 의무로 읽는 양

현행 읽기 순서(AGENTS.md): CLAUDE(46줄) → coordination README(68) → 최신 ROUND(~50)
→ **worklog(1,556)** → **T10 체크리스트(816)** = **약 2,540줄 ≈ 3만 토큰+ / 세션마다**.
worklog와 T10 이력이 전체의 93%다. 그 외: ROUND 35개 누적 3,071줄(읽기는 최신 1개만),
decision-inbox 207줄, T02/T03 286줄, plans 463줄(자기 PLAN만 읽으면 됨).

## 2. 중복 지도와 판정

| 기록물 | Linear와 겹치는 부분 | 판정 |
| --- | --- | --- |
| `docs/worklog.md` (1,556줄) | START/END 기록 = Linear 이슈 코멘트(receipt)와 동일 기능 | **동결** — 신규 기록은 Linear 코멘트로만. "END 없으면 배정 금지" 게이트는 "Linear END 코멘트 없으면 배정 금지"로 승계. 보고 양식(결과·파일·게이트·NOT_RUN·소비자)은 코멘트에 그대로 유지 |
| `sync/ROUND-N.md` | 레인 배치·카드 상태 스냅샷 = Linear 보드 | **다이어트** — ROUND는 규칙·승계 변경 로그만(목표 30줄 이내). 상태는 Linear 링크로 대체, 스냅샷 복붙 금지 |
| `T10-gate-checklist.md` (816줄) | 판정 이력 = PR 리뷰·Linear receipt | **분리** — 검수 기준만 `docs/plans/qa-gate.md`로 이관(수십 줄), 이력 부분은 동결 |
| `decision-inbox.md` (207줄) | 결정 요청/회신 = Linear 코멘트·PLAN 승인 기록 | **동결** |
| `T02/T03 문서` (286줄) | 역사 기록 | **동결** |
| `docs/plans/*` (463줄) | 없음 — 설계도·규약은 Linear에 없는 층 | **유지** (세션은 자기 PLAN만 읽음) |
| `_인수인계_MWC/` | 세션 간 인계 | 건 종료 시 **아카이브** |
| CLAUDE.md·AGENTS.md | 없음 | 유지 + 읽기 순서 조항 갱신 필요 |

## 3. 새 세션 부트스트랩 (개편 후)

CLAUDE.md(46) + AGENTS.md(47) + 최신 ROUND(~30) + 자기 PLAN의 WO 카드(~30)
= **약 150~200줄. 현행 대비 ~92% 절감.** 세션 수 × 매번 절감이므로 누적 효과가 크다.

## 4. 리스크와 안전장치

- Linear는 외부 서비스 — 유실·장애 대비 **월 1회 export**(또는 분기별) + "규칙·핵심 결정은 ROUND에도 1줄" 원칙.
- worklog의 서술형 맥락 가치는 END 코멘트 양식을 그대로 유지해 보존.
- append-only 정신: 과거 기록은 수정·삭제하지 않고 동결 선언 + `docs/archive/` 이동만 한다.

## 5. 시행 절차 — **사용자 승인 완료 2026-08-05**

1. 디스패치(MWC)가 다음 ROUND에 본 개편 채택을 박제.
2. 코드세션 1건(문서 전용 WO): `docs/archive/` 생성 → worklog·decision-inbox·T02/T03 이동+동결 헤더,
   T10 기준부 `docs/plans/qa-gate.md` 분리, CLAUDE.md·AGENTS.md 읽기 순서/워크로그 조항 갱신, 커밋.
3. 이후 모든 세션: 기록은 Linear 코멘트, 규칙 변경만 ROUND.

## 6. 이번에 건드리지 않는 것

Git/PR/CI(기술 정본), check.sh 게이트, 비주얼 컨펌 게이트, PLAN 체계 — 중복 없음, 그대로.
