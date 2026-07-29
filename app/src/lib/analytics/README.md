# analytics — PostHog (C5)

제품 분석·세션 리플레이. **다른 트랙은 `posthog-js` 를 직접 import 하지 않는다** —
`@/lib/analytics` 배럴과 `@/lib/analytics/client` 만 쓴다. 직접 import 는 아래 스크러빙·마스킹
설정을 통째로 우회한다.

## 켜고 끄기

`.env.local` 의 `NEXT_PUBLIC_POSTHOG_KEY` 하나로 결정된다(형태: `phc_` + 영숫자 20자 이상).

- 비었거나 형태가 어긋나면 **완전히 꺼진다**: SDK 청크조차 내려받지 않는다.
- `NODE_ENV=test` 에서도 항상 꺼진다.
- 브라우저 Do Not Track 을 존중한다(`respect_dnt`).

키 값은 저장소·로그·ROUND 문서 어디에도 남기지 않는다. `.env.example` 에는 형태만 있다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `scrub.ts` | PII 스크러빙 순수함수. 키·값·URL 3중 규칙 |
| `config.ts` | env 해석(fail-closed) + `init` 옵션 + 리플레이 마스킹 정책 |
| `rewrites.ts` | `/ingest/*` 리버스 프록시 rewrite (next.config 가 읽는다) |
| `env.ts` | `process.env.NEXT_PUBLIC_*` 리터럴 판독 (Next 빌드 치환 때문에 분리) |
| `client.ts` | `capture`/`identify`/`reset` 얇은 래퍼. 꺼져 있으면 no-op |

## 프록시

이벤트는 항상 자기 도메인 `/ingest/*` 로 나가고 next.config 의 rewrites 가 PostHog 로 넘긴다.
차단기 우회 + 3rd-party 요청 제거가 목적이다.

`/ingest` 는 `app/src/proxy.ts` 의 matcher에서 제외돼 있다 — 로그인 화면에서도 이벤트가
나가야 하고, 수집 요청마다 세션 검증 왕복이 붙으면 안 되기 때문이다. 경로 상수
`ANALYTICS_PROXY_PATH` 를 바꾸면 **matcher 문자열도 함께** 고쳐야 한다.

## 무엇이 지워지는가

이메일 · 전화(휴대/유선) · 주민등록번호 · 사업자등록번호 · 카드번호 · IP · JWT/Bearer,
그리고 민감 키(`email`·`password`·`token`·`담당자`·`고객명` 등)의 값 전체.

남는 것: 내부 식별자(uuid·deal_id·org_id) · 이벤트 이름 · 화면 경로 · 숫자 지표.
`board_name`·`column_name` 같은 업무 키는 사람 이름이 아니므로 지우지 않는다.

URL 쿼리는 **allowlist** 다(`utm_*`·`error`·`tab`·`view`·`page`·`sort`·`status` 등).
목록 밖 파라미터는 키만 남고 값은 마스킹된다. 토큰이 실릴 수 있는 파라미터형 해시는 통째로 버린다.

## 리플레이 마스킹

`maskAllInputs: true` + `maskTextSelector: "*"` — 텍스트와 입력을 **전부** 가린다.
민감 요소만 골라 가리는 방식은 새 화면이 추가될 때마다 누락되고, 누락은 곧 고객 정보 유출이다.

posthog-js 1.407 의 `SessionRecordingOptions` 에는 unmask 계열 옵션이 없다. 즉 선택적 노출은
지원되지 않는다. 특정 영역을 아예 녹화에서 빼려면 DOM 에 `[data-mw-no-record]` 를 단다.
