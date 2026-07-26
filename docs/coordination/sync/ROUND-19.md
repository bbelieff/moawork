# SYNC Round 19 — 전체 한글화·UX 라이팅·브랜드 토큰

> 작성: MoaWork Control(MWC) · 2026-07-23 KST

## 사용자 결정

- 모든 사용자 UI와 목업을 한글 우선으로 작성한다.
- 공개된 토스 UX 라이팅 원칙을 참고해 직관적이고 친절한 MoaWork 문구로 다시 쓴다.
- 네 디자인 시안은 다양한 배치·탐색·정보 밀도·시각 은유를 유지하되 MoaWork 브랜드 디자인 토큰을 공통 사용한다.

## 공통 지침 반영

- MoaWork 운영프롬프트 §16.5에 한글 UX 라이팅과 브랜드 토큰 규칙을 추가했다.
- SalesPT 공통 운영프롬프트 §14.5에도 같은 원칙을 추가했다.
- 공식 참고자료: 토스의 8가지 라이팅 원칙들, 앱인토스 UX 라이팅, 좋은 에러 메시지를 만드는 6가지 원칙.
- 토스 문구를 복제하지 않고 해요체, 명확성, 간결함, 친근함, 존중, 다음 행동 안내 원칙만 적용한다.

## 디자인 토큰 정본

- `brand/assets/v1.1/moawork-color-tokens.css`
- `brand/assets/v1.1/moawork-color-tokens.json`
- Violet=주요 행동, Blue=기록·프로젝트, Teal=자동화·흐름, Coral=사람·협업 UI.
- Coral은 로고 내부에 사용하지 않는다.
- 한국어 UI는 Pretendard 우선, 브랜드 radius 32/22 계열을 사용한다.

## 배정

| WORK-ID | 세션 | 상태 | 계약 |
|---|---|---|---|
| COPY-BRAND-POLISH-01 | T04 | DISPATCHED | 기존 4안 HTML 전체 한글화·문구·토큰 교정 |
| COPY-BRAND-POLISH-VERIFY-01 | T10 | DISPATCHED | 영문 0건·라이팅·토큰·4안 차별성·반응형 독립 검수 |

## 게이트

- T04는 같은 HTML lease만 수정한다.
- T10 PASS 뒤 MWC가 열려 있는 로컬 비교 페이지를 reload해 사용자에게 전후 변화를 보여준다.
- 사용자 선택 전 제품 구현·PR·merge·배포를 시작하지 않는다.
