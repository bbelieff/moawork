# T06 · 알림발송(mod.notify) 시스템 설계 — Phase 2

> 트랙: **T06 알림발송** · 상태: **설계(Phase 2 대비)** · 작성 2026-07-21
> 근거: `docs/PLAN-v0.2.md` §3(mod.notify)·§4(흐름 E) · `supabase/migrations/001_schema_v1.sql`(L15-22 enum, L281-302 테이블, L374-375·438-439 RLS)
> 전제: **mod.notify 는 Phase 2(벤더 연동)** — MVP(먼데이 파리티)에서는 entitlement OFF (`001_schema_v1.sql` L456-463). 본 문서는 Phase 2 진입 시 즉시 구현 가능하도록 미리 설계만 확정한다.

---

## 0. 요약 (한눈에)

| 항목 | 결정 |
|---|---|
| 목적 | 정보성 알림톡/문자(부재안내·미팅확정·계약안내·입금안내) 자동·수동 발송 + 실패 재시도 |
| 아키텍처 | App(Next.js API) → `messages` INSERT(queued) + pg-boss enqueue → **VPS 워커**가 벤더 어댑터로 발송 → 상태 갱신 |
| 발송 트리거 | ① 수동(딜 상세) ② 단계이동 자동 ③ 스케줄(정산 D+180/365 재접촉) |
| 벤더 | **1차 권장: SOLAPI**(개발 편의·알림톡+SMS 단일) / **전략 대안: 팝빌**(세금계산서·홈택스 통합) — belie 계약 결정(DI-5) 필요 |
| 채널 실패 대체 | 알림톡 발송 실패 시 SMS 대체발송(failover) |
| 스키마 | v1의 `message_templates`·`messages` 그대로 사용 + Phase 2 **추가 마이그레이션**(`00X_notify_phase2.sql`)으로 컬럼 보강(기존 파일 수정 금지) |
| 비밀값 | 벤더 API 키·발신프로필 ID 는 `worker/.env` 로만(저장소 기록 금지) |

---

## 1. 범위 / 비범위

**범위(Phase 2)**
- 정보성 메시지 발송(알림톡 우선, SMS 대체/직접).
- 템플릿 관리(등록·카카오 심사 상태 추적).
- 발송 파이프라인(큐잉·워커 디스패치·상태 추적·재시도).
- 단계이동 자동 트리거, 정산 스케줄 트리거.
- 발송 로그·실패 재발송 UI 데이터.

**비범위**
- 광고성/마케팅 메시지(수신동의·야간발송 규제 대상) — 정보성만.
- 문자 외 채널(이메일/푸시) — 별도 트랙.
- 홈택스/세금계산서(mod.hometax·tax_invoices) — 별 트랙(T?/CODEF·팝빌). 단, **벤더 선정 시 통합 고려**(§6).

---

## 2. 데이터 모델

### 2.1 v1 기존 테이블 (그대로 사용)

```
message_templates(id, org_id, channel[alimtalk|sms], code, name, body, status, unique(org_id,channel,code))
messages(id, org_id, deal_id?, template_id?, to_addr, status[queued|sent|failed|canceled], sent_at?, error?, created_at)
  index(org_id, status)
```
- RLS: 두 테이블 모두 `is_org_member(org_id)` 로 조직 격리(`001_schema_v1.sql` L438-439). Phase 2에도 유지.
- `message_templates.status`: `draft → 심사중 → 승인`. **알림톡은 승인된 템플릿만 발송 가능**(카카오 정책). SMS는 심사 불요.
- `messages.template_id` 는 nullable → SMS 직접발송(템플릿 없이)·알림톡→SMS 대체발송을 표현.

### 2.2 Phase 2 추가 마이그레이션 (제안 · `00X_notify_phase2.sql`)

> CLAUDE.md 규칙: 기존 마이그레이션 수정 금지 → **새 파일로 additive** 만. 아래는 발송 파이프라인 견고성을 위한 최소 보강. Phase 2 착수 시 생성.

| 대상 | 추가 | 이유 |
|---|---|---|
| `messages` | `channel message_channel` | 실제 발송 채널(대체발송 시 template.channel 과 달라짐) 기록 |
| `messages` | `retry_count int not null default 0` | 재시도 횟수(운영 가시성) |
| `messages` | `provider_message_id text` | 벤더 발송 ID(전달/실패 콜백 대사) |
| `messages` | `scheduled_at timestamptz` | 예약/스케줄 트리거(D+180/365) |
| `messages` | `payload_jsonb jsonb` | 템플릿 변수 치환값 스냅샷(감사·재발송) |
| `message_templates` | `variables_jsonb jsonb` | `#{변수}` 정의(치환 검증용) |
| (신규) `message_events` | `id, message_id, kind[queued/sent/failed/delivered], at, detail` | 발송 상태 이벤트 이력(선택 — 콜백 수신 시) |

인덱스: `messages(org_id, scheduled_at) where status='queued'`(스케줄 픽업), `messages(provider_message_id)`(콜백 대사).

---

## 3. 아키텍처 / 발송 파이프라인

```
┌─────────────┐   1.발송요청        ┌──────────────┐  2.INSERT messages(queued)
│ App (Next.js)│ ─── API route ───▶ │  Supabase PG  │◀────────────────────────┐
│  - 수동 발송  │                     │ messages/tpl  │                          │
│  - 상태 트리거│ ─── enqueue ──▶ pg-boss job(notify.send {message_id})         │
└─────────────┘                     └──────┬───────┘                          │
                                           │ 3.job 수신                        │
                                    ┌──────▼────────┐  4.템플릿+변수 로드        │
                                    │  VPS Worker    │──────────────────────────┘
                                    │ (pg-boss)      │  5.벤더 어댑터 발송
                                    │  notify.send   │──────▶ [SOLAPI/팝빌 REST]
                                    │  notify.schedule│◀───── 결과(성공/실패)
                                    └──────┬─────────┘  6.UPDATE messages(sent/failed, sent_at, error, provider_message_id)
                                           │ 7.실패 시 pg-boss 재시도(backoff)
                                           └── 소진 시 status=failed → UI 재발송
```

### 3.1 큐 설계 (pg-boss)

| 큐 | 페이로드 | 역할 | 옵션 |
|---|---|---|---|
| `notify.send` | `{ message_id }` | 단건 발송 | `retryLimit:3`, `retryBackoff:true`, `singletonKey: message_id`(중복발송 차단), `expireInMinutes:15` |
| `notify.schedule` | — (cron) | 예약/스케줄 픽업: `scheduled_at <= now()` 인 queued 를 `notify.send` 로 승격 | pg-boss `schedule('notify.schedule','*/5 * * * *')` |

- **워커는 `worker/src/index.ts` 골격의 `boss.work(...)` TODO 자리에 등록**(현재 pg-boss 부트스트랩만 존재).
- 페이로드에 원문/수신번호를 넣지 않고 **`message_id` 만** 실어 DB를 단일 진실원으로(민감정보 큐 미저장, 재구성 가능).

### 3.2 벤더 어댑터 추상화

```ts
// worker/src/notify/provider.ts (Phase 2)
export interface NotifyProvider {
  sendAlimtalk(p: { to: string; templateCode: string; vars: Record<string,string>;
                    fallbackSms?: string }): Promise<SendResult>;
  sendSms(p: { to: string; text: string }): Promise<SendResult>;
}
export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };
```
- 구현체: `SolapiProvider`, `PopbillProvider` — 환경변수(`NOTIFY_VENDOR`)로 선택. 벤더 교체 = 어댑터 1개 추가.
- `retryable` 구분: 일시 오류(네트워크/rate limit)만 pg-boss 재시도, 영구 오류(잘못된 번호·미승인 템플릿)는 즉시 `failed`.

### 3.3 알림톡 → SMS 대체발송

- 알림톡 발송 실패(친구톡 미등록·미승인·전송불가) 시 **동일 내용 SMS 대체**(카카오 표준). 어댑터가 `fallbackSms` 를 벤더에 위임하거나, 워커가 실패 감지 후 `messages` 에 SMS 레코드 파생 생성.
- 대체발송 시 `messages.channel = 'sms'` 로 실제 채널 기록.

---

## 4. 트리거 (발송 진입점)

| # | 트리거 | 진입 | 처리 |
|---|---|---|---|
| ① 수동 | 딜 상세에서 템플릿 선택·발송 | App API `POST /api/notify/send` | 승인 템플릿 검증 → `messages` INSERT → `notify.send` enqueue |
| ② 상태 자동 | `deals.stage` 변경(단계이동) | 단계이동 처리(core.crm) 후 이벤트 → 매핑된 템플릿 조회 | 조직이 `stage→template` 매핑 등록 시에만 발송(옵트인) |
| ③ 스케줄 | 정산 `settlements.d180`/`d365` 도래 | `notify.schedule` cron이 `scheduled_at` 도래분 픽업 | 재접촉 안내 발송 |

- ②는 core.crm(T02) 의 단계이동 자동화와 접점 → **조율 필요**(dispatch-queue). 결합은 "이벤트 방출 → notify 구독"으로 느슨하게(단계이동이 알림 실패에 막히지 않도록 **비동기·베스트에포트**).
- 정보성 판단: 모든 템플릿 code(부재안내/미팅확정/계약안내/입금안내)는 정보성. 광고성 문구 삽입 방지 가이드(템플릿 심사 단계).

---

## 5. Entitlement / 활성화 게이트

- Phase 2 이므로 MVP `plan_features` 에 `mod.notify` **없음**(`001_schema_v1.sql` L461-462). App API·워커는 발송 전 **`org_entitlements` 로 `mod.notify` 보유 확인** 후 진행, 미보유 시 큐잉 자체를 막음.
- 설계·테이블·코드는 미리 두되, **엔타이틀먼트 ON 은 Phase 2 계약 후**. → 무료 베타 단계에서 오발송 원천 차단.

---

## 6. 알림톡/문자 벤더 비교표 (비용·API·리드타임)

> ⚠️ 아래 단가·리드타임은 **2026-07 기준 공개정보 근사치** — 실제 계약은 belie 결정(PLAN §7 DI-5) 및 견적 재확인 필요. 알림톡 단가는 통상 **카카오 중계수수료(약 3~4원) + 대행사 마진** 구조. SMS 발신번호 사전등록제(전기통신사업법) 적용.

| 벤더 | 알림톡 단가(정보성) | SMS(단문/LMS) | API/DX | Node SDK | 리드타임(연동가능까지) | 강점 | 약점 |
|---|---|---|---|---|---|---|---|
| **SOLAPI**(구 쿨SMS) | 약 **6.5~9원**/건 | 약 8.4원 / 25~30원 | REST, 문서·예제 우수 | ✅ 공식 `solapi` | **짧음** — 가입 즉시 개발, 알림톡 발신프로필+템플릿 심사 1~2영업일 | 개발 편의 최상, 알림톡+SMS 단일 창구, 대체발송 내장 | 순수 발송 특화(세금계산서 등 B2B 문서 없음) |
| **팝빌(Popbill)** | 약 7~9원/건 | 약 9원 / 30원 | REST/SOAP, B2B 방대 | ✅ 공식 SDK | 중간 — 사업자 인증·연동키 발급 | **세금계산서·홈택스·현금영수증 통합**(mod.hometax·tax_invoices 와 단일 벤더) | API 스타일 다소 레거시, 콘솔 복잡 |
| **NHN Cloud(Toast) Notification** | 약 7~9원/건 | 약 9원 / 30원 | REST, 콘솔 성숙 | ⚠️ REST(공식 전용 SDK 약함) | 중간 — 클라우드 가입+발신프로필 심사 | 대량발송 안정성·모니터링 콘솔, 클라우드 통합 | 콘솔/프로젝트 설정 러닝커브 |
| **NCP SENS**(네이버클라우드) | 약 7~9원/건 | 약 9원 / 30원 | REST(HMAC 서명) | ⚠️ REST 직접 | 중간 — NCP 가입+서명 구현 | 네이버 클라우드 스택 통합 | 서명·인증 구현 부담 |
| **알리고(Aligo)** | 약 6.5~8원/건 | 약 8.4원 / 25원 | 단순 REST(form) | ⚠️ 커뮤니티 | **짧음** — 가입 간단 | 저가·간단, 소규모 빠른 도입 | 문서/SDK 빈약, 대량·운영기능 약함 |
| **비즈엠(BizM)** | 약 7~9원/건 | 별도(문자 재판매) | REST | ⚠️ 커뮤니티 | 중간 | 카카오 공식 대행, 알림톡 특화 | SMS는 별도 연동 필요 |

**권장**
1. **1차: SOLAPI** — VPS Node 워커 + pg-boss 구조에 **DX·단일 벤더(알림톡+SMS)·대체발송 내장**이 가장 잘 맞고 리드타임 최단. mod.notify 단독 최적.
2. **전략 대안: 팝빌** — Phase 2 에서 **mod.hometax(홈택스 수집)·세금계산서 발행(tax_invoices)** 까지 한 벤더로 묶으면 계약·정산·유지보수 단순화. PLAN 이 이미 홈택스/세금계산서 후보로 팝빌·CODEF 를 명시 → **벤더 통합 시 총소유비용 유리**.
3. 결정 기준: 알림/문자만이면 **SOLAPI**, 홈택스·세금계산서까지 한 벤더면 **팝빌**. → **belie 계약 결정(DI-5) 요청**. 어댑터 추상화로 어느 쪽이든 교체 비용 최소.

---

## 7. 운영/규정 고려

- **발신번호 사전등록제**: SMS 발신번호는 통신사 등록 필요(리드타임 포함). 알림톡은 카카오 채널(발신프로필) 등록.
- **정보성 한정**: 광고성 전환 시 수신동의·야간(21~08시) 발송 제한 대상 → 템플릿 심사 가이드로 광고 문구 차단.
- **멱등성**: `singletonKey = message_id` + `messages` 상태 전이(queued→sent 1회)로 중복발송 방지.
- **관측성**: `messages.status` 인덱스로 실패 대시보드, `retry_count`·`provider_message_id` 로 대사. (선택) `message_events` 로 전달 콜백 수신.
- **레이트리밋**: 벤더별 TPS 상한 → 워커 동시성(pg-boss `teamSize`) 조절.

---

## 8. Phase 2 착수 순서(안)

1. `00X_notify_phase2.sql` 추가(§2.2 컬럼 보강) → Supabase 적용.
2. `worker/src/notify/` — `provider.ts`(인터페이스) + `solapi.ts`(1차 구현) + `templates.ts`(변수 치환).
3. `worker/src/index.ts` 의 `boss.work("notify.send", handler)`·`boss.schedule("notify.schedule", ...)` 등록.
4. App API `POST /api/notify/send` + 엔타이틀먼트 게이트 + 템플릿 승인 검증.
5. core.crm(T02) 단계이동 이벤트 구독(②) — 조율 후.
6. 발송 로그/재발송 UI 데이터(messages 조회).
7. T10 게이트: 침투(RLS)·오발송·재시도 시나리오 검증.

## 9. 열린 항목 / 조율

- **DI-5(belie)**: 벤더 계약(SOLAPI vs 팝빌) — §6 결정 요청.
- **T02 조율**: 단계이동 → 알림 트리거 이벤트 계약(dispatch-queue).
- **mod.hometax 트랙**: 팝빌 채택 시 벤더 공유 → 계약 통합 논의.
- 발신번호·카카오채널 등록(사용자 액션, 리드타임 선반영).
