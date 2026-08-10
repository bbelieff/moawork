# MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-04

## 0. 검수 신원·경계

- WORK-ID: `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-04`
- 실제 독립 검수 worker: `T03`
- 배정/소비: `T05` / `T09`
- 단독 file lease: `docs/design/round-25/03-multi-workspace-entry-review-delta.md`
- 검수 시각: `2026-07-25T08:13:46+09:00`
- 쓰기 경계: 이 파일만 생성했다. 기존 리뷰, HTML, 제품 코드, Git, DB, coordination, worklog, ROUND는 변경하지 않았다.
- 검수 방식: 현재 exact bytes를 대상으로 한 비승인 source/static delta 검수. 브라우저·DB lab은 재실행하지 않았다.

## 1. 입력과 이전 증거의 경계

### 현재 검수 대상

| 파일 | bytes | lines | SHA-256 |
|---|---:|---:|---|
| `brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html` | 41,687 | 425 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` |

기대 bytes/lines/hash와 모두 일치한다.

### 이전 PASS의 적용 범위

이전 독립 리뷰 `03-multi-workspace-entry-review.md`는 다음 구 HTML만 검수했다.

- old reviewed SHA-256: `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`
- 이전 결과: static/state `25/25`, DB lab `27/27 skip 0`, contract/privacy `20/20`, browser 보강 `24/24 + 8/8 + 3/3`
- 위 결과를 현재 `D3A4…A2A5`에 실행한 것처럼 소급하지 않는다.
- 이번 문서에서 현재 해시에 다시 실행한 것은 아래 source syntax와 16개 bounded static/delta 검사뿐이다.

## 2. Exact old↔current byte diff

이전 검수 runtime에 남아 있던 실제 구 HTML 41,687 bytes를 다시 SHA-256으로 확인했다.

- old bytes/hash: `41,687 / 2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`
- current bytes/hash: `41,687 / D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`
- differing bytes: `18`
- byte ranges: `34131–34136`, `34253–34258`, `36698–36703`
- changed source lines: `363`, `369`
- action inventory: old `23`, current `23`, exact set 동일

실제 변경은 주장된 두 문자열뿐이 아니라 세 문자열이다.

| line | old | current | 선언 여부 |
|---:|---|---|---|
| 363 | `tenant 소속 0곳` | `회사 소속 0곳` | 선언됨 |
| 363 | `tenant 진입 0` | `회사 진입 0` | 선언됨 |
| 369 | `tenant 진입 0` | `회사 진입 0` | **선언되지 않음** |

line 369는 8개 정상 상태가 아닌 unknown-state 안전정지 fallback이다. 변경 내용은 안전 의미를 약화하지 않고 새로운 action도 만들지 않지만, “operator D 문구 두 곳만 변경”이라는 exact-delta 주장과 일치하지 않는다.

두 operator 문자열만 역치환한 결과의 SHA-256은 `2F83F676B82D94CDB02738C7314D0BA97FE232A66546851303BCFD24559032FA`로, 구 SHA와 일치하지 않는다. line 369까지 포함해 실제 구 바이트와 비교했을 때 위 세 byte range만 다르다.

## 3. 현재 해시 source/static 재검수

### 3.1 Source syntax

- inline script blocks: `1`
- `node --check`: `PASS`
- HTML shell (`doctype/html/body`): `PASS`

### 3.2 P0와 상태 계약

| 검사 | 기대 | 현재 실측 | 결과 |
|---|---:|---:|---|
| concept panels | A/B/C/D | A/B/C/D | PASS |
| scenario options | 8 | 8 (`zero`, `one`, `multiple`, `pending-create`, `pending-join`, `new-owner`, `joiner`, `operator`) | PASS |
| D / one workspace nodes | 1 | 1 | PASS |
| D / multiple workspace nodes | 2 | 2 | PASS |
| D / new-owner workspace nodes | 1 | 1 | PASS |
| D / joiner workspace nodes | 1 | 1 | PASS |
| D / operator workspace nodes | 0 | 0 | PASS |
| C / operator tenant transition actions | 0 | 0 | PASS |
| C / operator 허용 action | `operator-check`만 | `operator-check`만 | PASS |

T10이 발견했던 두 P0는 현재 해시에서도 source/state 기준으로 계속 수정된 상태다.

### 3.3 문구·열거·가짜 성공·action 회귀

| 검사 | 결과 |
|---|---|
| operator D에 `회사 소속 0곳`, `회사 진입 0` 존재 | PASS |
| operator D에 `tenant` 잔존 | 0, PASS |
| old↔current action inventory | 동일 23개, PASS |
| generic 이름 검색의 존재/개수/이름 열거 | 0, PASS |
| exact lookup의 자동 합류/접근 부여 | 0, PASS |
| 요청·승인·회사 생성·CSV 저장의 가짜 성공 표시 | 0, PASS |
| 선언된 두 operator 문구만 변경 | **FAIL — line 369 추가 변경** |

보정된 bounded 하네스 집계:

- total: `16`
- pass: `15`
- fail: `1`
- 유일한 FAIL: `claimed-delta-only-operator-line`

## 4. 실행하지 않은 검사

- browser: `NOT_RUN`
- responsive/visual/light-dark/keyboard/focus/reduced-motion/console: 현재 해시에서 `NOT_RUN`
- DB lab: 현재 해시 delta 검수에서 `NOT_RUN`
- hosted Supabase, true multi-connection, JWT→GUC, PostgREST/pooler, hosted migration, production: `NOT_RUN`

이 항목들은 이전 해시의 증거나 다른 worker의 결과로 현재 해시 실행 완료를 주장하지 않는다. 이번 FAIL은 브라우저 승인 대기와 무관하다.

## 5. 최종 판정

**FINAL VERDICT: FAIL — DECLARED DELTA MISMATCH**

세부 판정은 분리한다.

- P0 security/state regression: `0`, 해당 하위 검사는 PASS
- syntax: PASS
- action/enumeration/fake-success regression: `0`, PASS
- exact declared change scope: FAIL

현재 artifact가 위험해졌다는 판정이 아니다. 그러나 exact-hash delta review에서 실제 세 번째 변경을 “operator 문구 두 곳만 변경”으로 축소할 수 없으므로 전체 PASS를 선언하지 않는다.

## 6. 필요한 rework와 다음 경계

actual T04가 다음 중 하나를 명시적으로 처리해야 한다.

1. line 369 fallback을 구 문구로 되돌려 선언된 두 operator 변경만 남긴 새 exact hash를 제출한다.
2. line 369의 안전정지 fallback 한국어화까지 의도한 변경임을 delta 계약에 포함하고, 세 변경을 정확히 선언한 새 review 요청을 제출한다.

- rework owner: actual `T04`
- re-reviewer: actual `T03` 또는 controller가 새로 지정한 독립 T
- consumer: `T05 / T09`
- `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`: 현재 FAIL 해소 전 `BLOCKED`
- merge/deploy/production: 기존 `HOLD`
- 제품 HTML 수정 권한: 이 리뷰에는 없음

