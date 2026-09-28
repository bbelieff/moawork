# CLAUDE.md — 모아워크 제품과 저장소

2026-09-15 정리. 개발 방식은 `AGENTS.md`, 제품 기준은 이 파일이 소유한다.
Codex는 이 파일도 직접 읽는다. Claude는 마지막의 `@AGENTS.md`로 개발 방식을 함께 읽는다.

## 제품

- 모아워크는 여러 회사가 각자의 워크스페이스에서 쓰는 monday.com 형태의 업무관리 SaaS다. 첫 고객을 위한 전용 앱이 아니다.
- 새 워크스페이스는 보드 0·회사 0·만든 사람 1명인 빈 상태가 기본이다. 다른 고객의 데이터나 샘플을 자동 삽입하지 않는다.
- 고객 예시를 비울 때 컬럼·타입·이동규칙 같은 제품 구조를 함께 지우지 않는다. 기존 기능 축소는 최신 사용자 요구와 계약에 근거해야 한다.
- 제품 판단: 최신 명시 사용자 지시 → issue/date/rationale가 있는 `docs/design/board-parity-overrides.json` 및 시각 override → 목업 v6 → 일반 제품 규칙 → 역사 기록.
- 구조 유입은 `structure-packs`와 `default-tabs`의 현재 구현을 확인해 구분한다. 과거의 설치 절차를 모든 화면에 강제하지 않는다.

## UI 어휘와 디자인

| 화면 용어 | 코드/DB | 의미 |
| --- | --- | --- |
| 회사 | 해당 회사 엔터티 | 화면에서 ‘업체’로 섞어 쓰지 않는다 |
| 아이템 | `sectionPreset`, `board_groups` | 탭 안의 그룹; monday API item과 다르다 |
| 행/카드/건 | `items` | 그룹 안의 개별 데이터 행 |
| 프리셋 | 해당 구조 템플릿 | 적용 대상과 구조 유입 경로를 확인한다 |

- 브랜드 값은 `--mw-*`, `--sp-*`, `--fs-*` 토큰을 사용한다.
- 기본 화면 기준은 `1440×900`, 모바일은 `375×812`다. 실제 화면·행동 검증 범위는 `AGENTS.md §3`을 따른다.
- 시각 계약: `docs/design/visual-block-contract.json`. 위치·순서·sticky·겹침·잘림·가독성·상태 피드백과 저장 후 재조회까지 해당 변경에서 확인한다.
- 실행 검사: `node docs/design/qa-visual-blocks.mjs --self-test` 및 `node docs/design/qa-visual-blocks.mjs`. 기존 계약의 시각 70점 중 65점 기준을 임의로 낮추지 않는다.
- `node docs/design/qa-app.mjs`는 구조, `qa-board-parity.mjs`는 기본 보드 계약을 보조 검사한다. `qa-mockup.mjs`는 목업 자체만 검사하며 제품 화면 QA가 아니다.

## 데이터·보안 경계

- 특정 고객의 사람 이름·회사명·부서명·보드 ID를 제품 코드·프리셋·시드에 넣지 않는다. 담당자는 해당 워크스페이스의 멤버 계정에서 가져온다. 목업의 이름은 예시다.
- 키·토큰·쿠키·비밀번호·연결 문자열·실제 고객 데이터를 출력·문서화·커밋하지 않는다. `.env.example`에는 형태만 쓴다. `service_role` 키는 사용하거나 저장하지 않는다.
- 워크스페이스 경계와 RLS를 유지하고 권한 변경은 허용/거부 양쪽을 검증한다. `app_admins`를 직접 select하지 않고 `app_admin_role()`을 사용한다.
- 운영 데이터 변경과 hosted migration은 대상·영향·기존 승인·복구 수단을 확인한다. migration은 새 파일로 추가하며 기존 적용 파일을 수정하지 않는다.

## 현재 인프라

- Next.js 프론트/API는 기존 공유 VPS에서 서비스한다. 공개 주소는 `https://www.moa-work.com`이다.
- DB·Auth는 기존 Supabase를 유지한다. 호스팅 이전을 새 DB 구축이나 유료 제공자 도입으로 확대하지 않는다.
- VPS 배포 소스는 `ops/vps/deploy-source.sh`, systemd 서비스는 `ops/vps/moawork-direct.service`다. 배포 시 현재 스크립트와 `/api/health/ready`를 확인한다.
- Node worker(pg-boss)는 별도 구성이다. 웹 배포 성공을 worker 활성화·외부 발송 성공으로 간주하지 않는다. 기존 실행 잠금을 유지한다.
- PostHog는 선택 기능이다. 활성화하는 경우 기존 US 리전·프록시 설계를 따른다. 설정이 없다는 이유로 핵심 서비스 출시를 막거나 비용을 추가하지 않는다.
- 2026-09-10 확인 기록상 Vercel은 Hobby로 전환됐다. 결제 상태와 Git 연결은 별개다. 현재 상태가 필요한 작업에서는 다시 조회한다.

## 저장소와 기록

| 위치 | 역할 |
| --- | --- |
| `app/` | Next.js 앱과 API |
| `worker/` | 백그라운드 작업 |
| `supabase/` | DB migration |
| `ops/vps/` | VPS 배포·서비스 소스 |
| `scripts/`, `.githooks/`, `.github/workflows/` | 실제 검사·병합·CI |
| GitHub Issues + Project #1 | 현재 작업 범위·담당·진행·완료 증거 |
| `docs/**` | 설계 자료·실행 계약·역사 기록; 개발 방식의 별도 정본은 아님 |

기본 브랜치는 `main`, npm workspaces는 `app`, `worker`다. Linear는 읽기 전용 역사다.

## 개발 명령과 필수 검사

```bash
npm ci                              # 의존성이 필요할 때 lockfile로 설치
npm run dev
bash scripts/check.sh                # 전체 품질 게이트
node scripts/merge-pr.mjs <PR번호>    # 검증된 head 병합
```

- 커밋 전 `.githooks/pre-commit`이 staged tree 기준 fast gate를 실행한다. 훅은 `.githooks`를 사용한다.
- PR CI의 실제 필수 검사는 통과해야 한다. 전체 게이트가 CI에서 실행되면 동일한 검사를 로컬에서 의례적으로 다시 실행하지 않는다.
- 문서/지침 작업도 실제 훅·CI가 요구하는 검사는 따른다. 화면 변경이 없는 문서 작업에 운영 배포·스크린샷을 추가하지 않는다.
- 제품 출시의 완료는 main 병합·운영 source SHA/readiness·변경된 실제 동작 증거다. 소스 존재나 CI만으로 사용자 기능 완료를 주장하지 않는다.

@AGENTS.md
