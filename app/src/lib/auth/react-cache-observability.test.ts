// BBE-214 후속 — 「React `cache()` 로 세션 중복을 없애자」를 «착수 전에» 막은 사실을 못 박는다.
//
// ★ 무엇을 재는가
//   React 의 `cache()` 는 «요청 스코프» 에 붙는다. 그 스코프는 React 서버 렌더러가 만든다.
//   vitest 의 평범한 node 환경에는 그 디스패처가 «없다». 그래서 `cache()` 는
//   메모하지 않고 매번 원본을 부른다 — 아래가 그것을 실측으로 고정한다.
//
// ★ 왜 이 파일이 존재하는가 (지우지 마라)
//   이 사실을 모르면 다음 두 가지가 «조용히» 일어난다:
//     ① 「캐시로 왕복이 4 → 1 이 됐다」는 테스트를 쓰면 — 프로덕션 코드가 옳아도 «빨간불» 이다.
//        캐시가 테스트에서 안 도니까. 그걸 보고 멀쩡한 구현을 되돌리게 된다.
//     ② 「캐시가 다른 사용자의 답을 섞지 않는다」는 테스트를 쓰면 — «초록불» 이다.
//        그런데 애초에 캐시가 안 돌아서 초록인 것이라 **아무것도 증명하지 못한다.**
//        ②가 더 위험하다. 권한이 새지 않는다는 «거짓 안심» 을 주기 때문이다.
//
//   즉 이 저장소의 테스트로는 `cache()` 기반 중복 제거를 **증명할 수도, 반증할 수도 없다.**
//   증명할 수 없는 최적화는 이 팀 기준으로 착수 대상이 아니다 — 근거는 이 파일이다.

import { cache } from "react";
import { describe, expect, it } from "vitest";

describe("BBE-214 · React cache() 는 이 테스트 환경에서 메모하지 않는다", () => {
  it("같은 인자로 두 번 불러도 원본이 두 번 돈다 — 요청 스코프가 없다", async () => {
    let runs = 0;
    const load = cache(async (key: string) => {
      runs += 1;
      return `${key}:${runs}`;
    });

    const first = await load("same-key");
    const second = await load("same-key");

    // 요청 스코프가 있었다면 runs === 1 이고 first === second 였을 것이다.
    expect(runs, "cache() 가 이 환경에서 메모하기 시작했다면 이 파일의 전제가 바뀐 것이다").toBe(2);
    expect(first).not.toBe(second);
  });

  it("모듈 전역에 새지도 않는다 — 캐시가 아예 없다는 뜻이다", async () => {
    // 만약 «요청 스코프가 없을 때 모듈 전역으로 대체» 되는 구현이었다면
    // 서로 다른 호출자 사이에 답이 섞여 «권한 누수» 가 된다. 그건 아니라는 것까지 못 박는다.
    let runs = 0;
    const load = cache(async () => {
      runs += 1;
      return runs;
    });

    const a = await load();
    const b = await load();

    expect(a).toBe(1);
    expect(b).toBe(2); // 전역 캐시였다면 b === 1 이었을 것이다
  });
});
