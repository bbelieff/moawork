# CLAUDE.md — moawork

통합관리시스템(moawork) 저장소의 작업 지침. Claude/에이전트는 이 문서를 우선 따른다.

## 프로젝트

- **정의**: 먼데이(monday.com) 형태의 **업무관리 SaaS 제품**.
  여러 회사가 각자 워크스페이스를 만들어 쓴다.
- **서울경영지원센터는 «첫 고객» 이다.** 제품이 아니다.
  먼데이 실측은 «이 업종이 실제로 어떻게 일하는가» 를 알기 위한 근거일 뿐,
  서울경영 전용 앱을 만드는 것이 아니다.
- **빈 상태가 기본**: 새 워크스페이스를 만들면 업체 0 · 사람은 만든 사람 1명.
  서울경영이나 그 고객사 정보는 **어디에도 없어야 한다.**
- **기본 탭 4개는 설치 없이 이미 있다** (D76/D77, 2026-08-12로 확정 — «설치» 개념 자체를 폐기했다):
  신규리드·컨택관리·계약업체·공지사항이 워크스페이스 생성 시점에 자동으로 존재한다.
  이 탭들은 회사가 이름 변경·컬럼 추가삭제·탭 자체 삭제까지 전부 자유롭게 할 수 있다 — «시스템 보호 탭»은 없다.
  `boards.is_system`을 편집·삭제 금지 용도로 쓰지 않는다(그 용도로 쓰인 사례가 발견되면 회귀다).
- **스택**: Next.js(프론트 + API) · Supabase(DB + Auth) · Node worker(VPS, pg-boss).

## 모노레포 구조

```
app/       Next.js 앱 (프론트 + API 라우트)
worker/    Node 백그라운드 잡 러너 (pg-boss)
supabase/  DB 마이그레이션 (SQL)
scripts/   check.sh 등 게이트 스크립트
docs/      worklog.md, coordination/ (트랙 조율 SSOT)
```

npm workspaces 사용 (`app`, `worker`).

## 품질 게이트

- 모든 변경은 `bash scripts/check.sh`(= lint + typecheck + test)를 통과해야 한다.
- `.githooks/pre-commit` 이 커밋 전에 동일 게이트를 실행한다.
  최초 1회 `git config core.hooksPath .githooks` (루트 `npm install` 시 자동).
- CI(`.github/workflows/ci.yml`)가 push/PR 마다 동일 게이트를 재실행한다.

## SSOT (단일 진실 소스)

1. `CLAUDE.md` (이 문서) — 작업 지침.
2. `AGENTS.md` — 에이전트/트랙 역할.
3. `docs/worklog.md` — append-only 진행 로그. 완료 단위마다 기입.
4. `docs/coordination/` — 트랙 조율 마크다운.
   - `sync/ROUND-*.md` — 전수조사·집행 조치. **최신 라운드가 트랙 상태·규칙의 정본**(계약 단일소유, 승인기록, 미해소 DQ 포함).
   - `T10-gate-checklist.md` — 검수 기준·완료판정 이력(T10 소유).
   - `decision-inbox.md` — 결정 요청/회신.
   > 2026-07-22 SYNC R1 로 `session-registry.yaml`·`dispatch-queue.yaml`·`provider-status.yaml` 은 폐기.
   > 승계 내용은 `sync/ROUND-1.md` §승계 항목에 있다. 원문은 git 히스토리 참조.

## 규칙

- ★ **기준의 우선순위 (2026-08-19 총괄 확정)**
  1. **총괄이 직접 지시한 것** — 목업보다 **우선**한다. 목업과 달라도 그대로 유지한다.
     (예: 정산 원장 화면 ①②③ · 공지사항 보드 컬럼 자유 편집)
  2. **목업**(`docs/design/UI목업_워크스페이스_최종_v6.html`) — 그 외 **전부**의 기준.
     그룹 이름·순서, 컬럼 선택지, 자동 이동 규칙 등은 목업을 따라간다.
  - `node docs/design/qa-app.mjs` 가 이 차이를 잰다. **차이가 늘면 check 가 막는다**(래칫).
    실제로 줄였으면 `REGRESSION_CEILING` 도 같이 낮춘다. 천장을 올리려면 «1번(총괄 직접 지시)
    이라서 목업을 따르지 않는다» 는 근거를 커밋 메시지에 적는다 — 조용히 올리는 것은 금지.
- **고객 고유값 금지**: 특정 회사의 사람 이름·업체명·부서명을 제품 코드·프리셋·시드에 넣지 않는다.
  담당자는 «그 워크스페이스의 멤버 계정» 에서 온다. 목업에 보이는 이름은 전부 **예시**다.
  → 그래서 담당자·협업자 선택지는 목업과 **영원히 일치하지 않는다**(qa-app 차이 3건은 정상).
- **비밀값 금지**: 키·토큰·비밀번호·연결 문자열을 저장소에 절대 기록하지 않는다. `.env.example` 로만 형태를 남기고 실제 값은 `.env*`(gitignore).
- 커밋 전 반드시 check 게이트 통과.
- 작업 완료 시 `docs/worklog.md` 갱신, 관련되면 `docs/coordination/*`(마크다운) 도 갱신.
- Supabase 스키마 변경은 새 마이그레이션 파일로만 추가(기존 파일 수정 금지).
