// WorkspaceMark 순수 함수 테스트 — 이니셜 폴백 + 색 배정 안정성
// 실행: node --test (또는 프로젝트 러너에 맞춰 코덱스가 조정)
// 작성: MWC(코워크).

import assert from "node:assert/strict";
import { test } from "vitest";
import { hashCode, toInitial } from "./WorkspaceMark.tsx";

test("toInitial — 한글은 첫 글자 1자", () => {
  assert.equal(toInitial("서울경영지원센터"), "서");
  assert.equal(toInitial("모아워크"), "모");
});

test("toInitial — 영문은 앞 2자 대문자", () => {
  assert.equal(toInitial("moawork"), "MO");
  assert.equal(toInitial("LS Partners"), "LS");
});

test("toInitial — 이모지·특수문자는 건너뛴다", () => {
  assert.equal(toInitial("🔥신규고객"), "신");
  assert.equal(toInitial("  ※ 공지 "), "공");
});

// ★ 회귀 방지 — 이 테스트가 실제 결함을 잡았다.
//   법인 표기를 안 걸러내면 "(주)엘에스"·"주식회사 모아"가 전부 "주"로 보여
//   회사끼리 구분이 안 된다.
test("toInitial — 법인 표기는 이니셜에서 제외한다", () => {
  assert.equal(toInitial("(주)엘에스"), "엘");
  assert.equal(toInitial("주식회사 모아워크"), "모");
  assert.equal(toInitial("㈜똑똑한개발자"), "똑");
  assert.equal(toInitial("유한회사 서울경영"), "서");
  assert.equal(toInitial("(주)"), "주", "다 걷어내면 원본으로 폴백");
});

test("toInitial — 글자가 없으면 물음표", () => {
  assert.equal(toInitial(""), "?");
  assert.equal(toInitial("   "), "?");
  assert.equal(toInitial("!!!"), "?");
});

test("hashCode — 결정적이다(서버·클라이언트 동일 색 보장)", () => {
  assert.equal(hashCode("서울경영지원센터"), hashCode("서울경영지원센터"));
  assert.ok(hashCode("가") >= 0, "음수가 나오면 배열 인덱스가 깨진다");
  assert.ok(hashCode("") >= 0);
});

test("hashCode — 이름이 다르면 대체로 다른 색", () => {
  const names = ["서울경영지원센터", "엘에스파트너스", "똑똑한개발자", "모아워크"];
  const tones = new Set(names.map((n) => hashCode(n) % 6));
  assert.ok(tones.size >= 2, "전부 같은 색으로 몰리면 구분이 안 된다");
});
