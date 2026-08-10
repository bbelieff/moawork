# 워크로그 — 로컬 백엔드 코어 · 2026-07-21 · writer=cowork(기획)

## 배경
belie 지시 "더 효율적으로": 코드트랙 다중 창 대신 Cowork 가 로컬 백엔드 코어를 직접 구현(예외 — 통상 Cowork=문서전용). 프레임워크 없이 도는 순수 TS, Supabase 미연결.

## 구현
- `lib/types/domain.ts`, `lib/repo/{formula,access,types,index}.ts`, `lib/repo/local/{store,seed,localRepo}.ts`, `lib/service/{session,authz,crm,dashboard}.ts`.
- 인메모리 저장소 + 가상 시드(조직 A/B, 파이프라인 6단계, 딜/활동/정산). org_id + 담당범위(scope) 격리 = RLS 패리티.
- 정산 수식(먼데이): 수수료(원)=round(실행액×%/100), 총매출=계약금+수수료, D+180/365.
- import 규약: 명시적 `.ts` + tsconfig `allowImportingTsExtensions`; `npm run test` 에 `--experimental-strip-types`. `package.json` engines ≥22.6.
- 테스트 3종 신설(정산수식·조직격리·CRM흐름).

## 검증(샌드박스)
- `tsc --noEmit` = PASS(0).
- `node --experimental-strip-types --test` = **17/17 PASS**(기존 path-policy 3 포함).
- `lib` 에 `any`/`console` 없음.
- ⚠️ **ESLint 전체는 샌드박스 시간제한으로 미실행** — belie 의 `npm run check`(PowerShell)에서 확정 필요. 코드는 tseslint strict 규약 준수해 작성.

## 남은 것(비범위)
- Next.js/React/Tailwind 설치 + 화면(app/·components/) = 프론트 트랙(T02·T03·T04).
- Supabase 어댑터(`lib/repo` 에 SupabaseRepo) + 실제 RLS 침투테스트 = 연결 후.
- git 커밋/푸시 = Dev/Codex 트랙(Cowork 미실행).
