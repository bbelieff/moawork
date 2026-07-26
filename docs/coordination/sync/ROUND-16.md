# SYNC Round 16 — 공통 기획·디자인·사용자 승인 게이트

> 작성: MoaWork Control(MWC) · 2026-07-23 KST

## 사용자 결정

모든 기획·기능·디자인·merge 작업에 다음 네 게이트를 공통 적용한다.

1. 한국어 Blindspot Pass: `전체 → 부분 → 전체`로 의도, 확정·미결정, unknown unknowns, 충돌과 후속 영향을 점검한다.
2. 기능 착수 전 역인터뷰: 이미 정한 내용은 제외하고 결과를 바꾸는 중요 미결정 3~7개와 추천안을 먼저 묻는다.
3. 신규 디자인·정보구조는 구조·시각언어·상호작용이 완전히 다른 네 안을 한 로컬 HTML 페이지에서 비교한다. Dribbble과 getdesign.md를 우선 참고 후보로 조사하되 복제하지 않는다.
4. merge 전 실제 화면, 동일 상태 전후 비교, 정적 화면 뒤의 다음 시퀀스, 이해 확인 퀴즈 2~4개, 사용자 명시 승인을 요구한다.

## 공통 지침 정본

- MoaWork: `C:\Users\belie\Desktop\Belief\클로드\prompts\moawork-collaboration\01-MoaWork-Control-운영프롬프트.txt` §16
- SalesPT/CFC: `C:\Users\belie\Desktop\Belief\클로드\prompts\salespt-collaboration\01-공통-세션-운영-프롬프트.txt` §14
- CFC에는 공통 프롬프트 필수 로드와 routing-loop proof에 같은 delta를 반영하도록 실제 전달했다.

## 현재 적용 상태

| WORK-ID | 세션 | 상태 | 결과 |
|---|---|---|---|
| ADMIN-CONTROL-PLANE-01 | T03 | DRAFT_COMPLETE | 맹점 훑기와 역인터뷰 7문항 반환. 확정안 아님 |
| AUTH-SESSION-01 | T07 | DRAFT_COMPLETE | 세션·로그아웃 구조와 맹점·질문 반환. 확정안 아님 |
| ACCOUNT-PRIVACY-01 | T08 | DRAFT_COMPLETE | 글로벌 계정·Workspace 프로필·개인정보 분리 Draft 반환 |
| ACCOUNT-CONTROL-INTEGRATION-01 | T10 | COLLECTING | 세 결과를 7개 통합 역인터뷰로 정규화 중 |
| ADMIN-ACCOUNT-MOCKUP-01 | T04 | PARKED | 사용자 역인터뷰와 T10 통합 전 착수 금지 |

## Blindspot Pass에서 확인된 P0 후보

- Platform Admin을 Workspace `owner/all`처럼 합성하는 현재 세션 구조는 control-plane 분리 원칙과 충돌한다.
- Google 재로그인 때 전역 사용자 프로필이 다시 덮어써져 사용자 편집값을 잃을 가능성이 있다.
- 계정 hard-delete cascade가 멤버십·업무·감사 계보를 함께 지울 가능성이 있다.
- 현재 기기/모든 기기 로그아웃, 세션 registry·epoch, 권한변경 시 강제 revoke 계약이 없다.
- 기존 `members_manage`, 광범위한 `users_select`, invite 부재 문제와 함께 migration/security gate로 먼저 닫아야 한다.

## 다음 직렬 게이트

1. T10이 세 Draft를 회수해 중복 없는 역인터뷰 3~7개를 반환한다.
2. MWC가 사용자에게 추천안을 포함한 질문을 한 번에 제시한다.
3. 사용자 답변 뒤 T10이 통합 설계를 확정한다.
4. T04가 네 개의 완전히 다른 HTML 목업을 만든다.
5. 사용자가 안 또는 조합을 선택한 뒤에만 구현 Worktree를 생성한다.
6. merge 전 화면·전후 비교·다음 시퀀스·퀴즈·명시 승인을 통과한다.

현재 제품 코드·DB·PR·배포 변경은 없다. 기준 coordination HEAD는 `40c6b69`이며 docs branch는 `origin/main` 대비 ahead 상태다.
