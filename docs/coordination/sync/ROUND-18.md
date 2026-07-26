# SYNC Round 18 — 어드민·계정·세션 기획 확정과 4안 디자인

> 작성: MoaWork Control(MWC) · 2026-07-23 KST

## 역인터뷰 확정 결정

1. MVP Workspace protected Owner는 정확히 1명이다.
2. Workspace 문맥은 `/w/{workspaceSlug}` URL에 고정한다.
3. 플랫폼 운영은 `권한 등급 + 담당 영역`으로 분리한다.
   - `1급 총괄 관리자 > 2급 영역 관리자 > 3급 실무 담당자 > 4급 조회 담당자`
   - 담당영역: `운영 / 고객지원 / 보안 / 결제·플랜`
   - 상위 등급은 자신의 담당영역에서 하위 capability를 포함하며 1급은 전 영역을 담당한다.
4. 고객지원 접근은 기본지원, Owner 승인지원, 긴급보호의 세 단계다.
5. 긴급보호에서도 고객 업무데이터 수정은 금지하며 세션 폐기·계정 잠금·접근 동결만 허용한다.
6. 로그인 이메일 기본 마스킹, Global Account와 Workspace Profile 분리, 개인/업무 export 분리, 탈퇴 취소기간 Draft를 채택한다.
7. 모든 회원의 일반 로그인은 절대 30일, 미사용 7일이며 모든 기기 로그아웃은 계정 전체·모든 Workspace에 적용한다.

승인지원·긴급보호의 TTL은 일반 로그인 세션이 아니라 일시적으로 추가되는 elevated grant다.

## Serial DAG

1. T10이 세 upstream 결과와 사용자 결정을 `brand/MoaWork_Admin_Account_Session_Architecture_v0.1.md`로 통합한다.
2. T10이 T04에 `ADMIN-ACCOUNT-DESIGN-4A-01`을 실제 전달하고 ACK를 확인한다.
3. T04가 `brand/MoaWork_Admin_Account_Design_4Concepts_v0.1.html` 한 페이지에 네 개의 완전히 다른 디자인을 만든다.
4. 네 안은 `Control Tower / Guided Operations / Account Hub / Safety Map`이며 Dribbble·getdesign.md를 우선 참고 후보로 실제 조사하되 복제하지 않는다.
5. T04가 로컬 브라우저에 HTML을 열어 유지하고 T10에 검수를 요청한다.
6. T10은 구조 차별성, 핵심 시퀀스, 접근성, 권한·보안 상태를 검수한다.
7. 사용자가 안 또는 조합을 선택하기 전에는 제품 구현·PR·merge·배포를 시작하지 않는다.

## 현재 상태

- T10: `DISPATCHED`, 통합 명세 writer 및 T04 collector.
- T04: T10 명세 완료 후 직렬 실행 예정.
- 제품 코드·DB·PR·merge·배포 변경 없음.
