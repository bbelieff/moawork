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
`s2`/`s3` 독립 라우트·대면 신설·파트너 기능 없음 — 사용자 지시대로 미배선.
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
