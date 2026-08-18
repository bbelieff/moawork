// BBE-192 — 하네스의 시간 예산이 «조용히» 사라지지 않게 한다.
//
// 이 파일이 지키는 것은 「테스트가 빠른가」가 아니라 「판정이 기계의 붐빔에 좌우되지 않는가」다.
// vitest 기본값은 5s 이고, 이 저장소는 PGlite 를 띄우는 파일을 병렬로 돌린다.
// 실측: 단독 2.6s 인 테스트가 부하 중 5s 를 넘겼고, 같은 실행에서 PGlite 파일이 26.7s 를 썼다.
//
// ★ 왜 «값» 을 박아 두는가
//   설정 한 줄은 지우기 쉽고, 지워도 대부분의 실행은 초록이다. 빨간불은 붐빌 때만,
//   그것도 남의 PR 에서 뜬다. 그래서 지운 사람은 자기가 지웠다는 것을 모른다.
//   BBE-187 이 파일 두 개의 예산만 올리고 하네스에는 testTimeout 을 «아예 두지 않은» 채
//   닫혔던 것도 같은 종류의 빈틈이다.
import { describe, expect, it } from "vitest";

import config from "../vitest.config";

describe("BBE-192 테스트 하네스 시간 예산", () => {
  it("★ testTimeout 이 하네스에 «있다» — 기본값 5s 로 돌아가지 않는다", () => {
    // 문자열 검색이 아니라 «실제 설정 객체» 를 읽는다. 주석에 적힌 값에는 속지 않는다.
    expect(config.test?.testTimeout).toBeDefined();
    expect(config.test?.testTimeout).toBeGreaterThanOrEqual(15_000);
  });

  it("★ hookTimeout 도 같이 있다 — beforeAll 에서 붐비면 같은 증상이 난다", () => {
    expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(15_000);
  });

  it("★ 그래도 무한대는 아니다 — 진짜로 매달린 테스트는 여전히 빨간불이어야 한다", () => {
    // 예산을 키우는 처치의 반대편 위험이다. 「넘기려고」 무한대로 두면
    // 매달린 테스트가 CI 를 통째로 세운다.
    expect(config.test?.testTimeout).toBeLessThanOrEqual(60_000);
  });
});
