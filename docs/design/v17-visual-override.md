# v17 vivid 시각 override (운영 적용 기록)

- 승인: v17 vivid 목업 사용자 승인 + 시각 override issue #761 (2026-09-25).
- 범위: 시각 배선만. 인증·RLS·API·데이터·모델·워크플로·마이그레이션 없음.
- 정본 우선순위(CLAUDE.md): 최신 명시 지시 → issue/date/rationale 있는 시각 override(본 문서) → 목업 v6 → 일반 규칙.

## 출처·복사/각색 (확인일 2026-09-25)

| 원천 | 가져온 것 | 구분 |
| --- | --- | --- |
| Soft UI Dashboard (Creative Tim, MIT, `app/src/styles/moawork-vivid-v17.LICENSE.txt`), https://github.com/creativetimofficial/soft-ui-dashboard | 310deg 쌍 5종: `#ea580c→#facc15`, `#0ea5e9→#06b6d4`, `#22c55e→#98ec2d`, `#eab308→#f97316`, `#ef4444→#ec4899` | copied (각도·스톱·순서 동일) |
| Mobbin Canva 팔레트 https://mobbin.com/colors/brand/canva | 스톱 `#07B9CE` `#3969E7` `#7D2AE7` | 스톱 copied, 다스톱 배치·비율은 모아워크 각색(공식 Canva 그라디언트 아님) |
| Figma Purity UI Dashboard (Simmmple/Creative Tim, CC BY 4.0) | 흰 카드·절제된 간격·유색 아이콘 타일 방향 | 레이아웃 참조만, 색 토큰·자산 복사 없음 |
| Pinterest colorful-dashboard (16핀 열람) | 중립 캔버스 위 vivid 블록 방향 | 영감만, 다운로드 없음 |

CTA 실제 채움은 목업 `vivid-v17.css` 최종 절이 정본: 파랑/보라(`contact`·`dash`)는
`#3969e7→#7d2ae7` + 흰 글자, 그 외 밝은 CTA는 원천 Soft UI 쌍 + `#111827` 글자.

## 실제 라우트 배선 (발명 없음)

| 강조 | 운영 라우트 | CTA |
| --- | --- | --- |
| new | `/newcust` (→ `/boards/<id>`) | 오렌지 `#ea580c→#facc15`, 글자 `#111827` |
| contact | `/contract` (→ `/boards/<id>`) | 블루→바이올렛 `#3969e7→#7d2ae7`, 흰 글자 |
| work | `/work` (→ `/boards/<id>`) | 그린 `#22c55e→#98ec2d`, 글자 `#111827` |
| company | `/companies` | 시안 `#0ea5e9→#06b6d4`, 글자 `#111827` |
| dash | 루트(대시보드) + 폴백 | 블루→바이올렛, 흰 글자 |

보드 주소는 `resolveActiveNavKey(pathname, boardNavKeys)` 로 탭을 되찾고,
모르는 보드는 대시보드 강조로 폴백한다(잔상 금지).
이번 시각 이식 PR은 `s2`/`s3` 독립 라우트·대면 신설을 포함하지 않는다. 상담 흐름 등 승인 목업의 기능 요구사항은 별도 구현 대상이며, 협력업체 기능만 사용자 지시로 보류한다.
미소비 토큰(`s3rose`·`honey`·`partners`·`news`)은 정의만 두고 어떤 선택자도 참조하지 않는다.

## 건드린 자리

- `app/src/styles/moawork-vivid-v17.css` (신규): `html[data-mw-accent]` 아래만 동작.
  표 셀·행·sticky·단일 스크롤·파괴적/비활성 버튼은 선택자에서 제외.
- `app/src/lib/appearance/vivid.ts` (신규): 매핑·검증 순수 모듈.
- `app/src/components/appearance/RouteAppearance.tsx` (신규): 라우트 강조+외관 적용 전담, DOM 미렌더.
- `app/src/components/appearance/AppearanceControl.tsx` (신규): ThemeToggle 옆 작은 팝오버.
  회사 강조 프리셋 10종(id 호환)·효과 on/off, `mw-appearance-v1` 개인 저장. 업무 데이터 무관.
- 명시 속성: `SidebarNav` 활성(`mw-nav-active`, 파랑 폴백 유지),
  `BoardHeader`·`NewLeadIntakeForm`·`WorkflowProgressCell`·`CompanyCsvImport` 주요 CTA
  (`data-mw-cta="primary"`), `WorkspaceMark`(`data-workspace-mark`).
- 라이트/다크·강제색상·모션감소·인쇄 분기 포함. 표 밀도·R3/R7/R11 기존 값 유지.

## 부모 확인용

- `node docs/design/qa-app.mjs`, 관련 vitest, typecheck, lint 결과는 작업 보고 참조.
- 화면 실측(1440×900·375×812, 다크·강제색상 실기기)은 Windows 부모 담당 — 본 작업에서 미실시.

## 부모 시각 통합
GroupBlock은 그룹색의 굵은 세로선과 넓은 틴트를 제거하고 8px 점으로 그룹색을 보존한다. 밝은 배경 위 제목은 본문색으로 읽는다. R3/R7/R11 토큰과 보드 제목 아이콘 타일을 승인 v17에 맞췄다. 드래그·접기·정렬·저장 로직은 유지한다.
## v17 후속 기능과 아이콘 적용 — Issue #797 · 2026-09-25

사용자 승인: v17 목업의 비비드 테마 및 비협력업체 기능을 운영까지 적용. 협력업체 기능만 이번 범위에서 제외한다.

- 정책자금뉴스는 업무도구 아래에서 최신호를 모아워크 셸 내부 iframe으로 표시한다. 읽는 도중 자동 새로고침하지 않으며, 수동 새로고침 또는 5분 이상 지난 화면 복귀 때 갱신한다.
- 승인된 자체 SVG 120개는 `/moa-icons/manifest.json`과 개별 SVG로 제공한다. 20px 원본 좌표계를 보존하고, 신규리드/업체관리/헤드셋 상담/실무/미팅/뉴스를 실제 셸에 적용한다. 임의 스크립트·외부 참조 없는 경로만 포함한다.
- 기본 보드 아이콘은 같은 SVG로 표시하고 사용자 지정 아이콘 값은 보존한다. 저장된 업체·업무 데이터 변경 없이 렌더링만 교체한다.
- 뉴스 팔레트는 승인 목업의 시안 `#07b9ce → #06b6d4`를 사용한다. 파트너 강조와 메뉴는 연결하지 않는다.

상담/계약, 등록/상세/파일/OCR 후속 통합은 #797에서 별도 추적한다. 이 변경만으로 전체 기능 완료를 뜻하지 않는다.
