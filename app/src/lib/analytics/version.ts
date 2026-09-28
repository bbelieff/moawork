// 앱 버전 — 이벤트 필수 속성 `app_version` 의 값.
//
// `process.env.NEXT_PUBLIC_*` 는 Next 가 빌드 시점에 **문자열 리터럴로 치환**한다.
// 그래서 동적 접근이 아니라 리터럴로 적어야 한다(env.ts 와 같은 이유).
//
// 자체 호스팅 빌드는 `MOAWORK_BUILD_SHA` 로 커밋 SHA 를 넣는데, NEXT_PUBLIC_ 접두사가 없어
// 브라우저에서 못 읽는다. 빌드 환경변수에 `NEXT_PUBLIC_APP_VERSION=$MOAWORK_BUILD_SHA` 를
// 같이 넣으면 커밋 SHA 가 실린다.
// 미설정이면 "dev" — 값이 없다고 이벤트를 버리지는 않는다(분석 때문에 제품이 멈추지 않는다).

const RAW = process.env.NEXT_PUBLIC_APP_VERSION;

/** 빌드 버전. 40자 SHA 는 앞 7자리로 줄인다(카디널리티·가독성). */
export const APP_VERSION: string = (() => {
  const value = RAW?.trim();
  if (!value) return "dev";
  if (/^[0-9a-f]{40}$/i.test(value)) return value.slice(0, 7);
  // 자유 문자열이 길게 들어오는 것을 막는다(속성 폭주 방지).
  return value.slice(0, 32);
})();
