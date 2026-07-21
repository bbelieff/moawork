# T04 — 공지사항(core.notice) + 홈 최근 공지 위젯

작성: T04 · 2026-07-21
대상 스키마: `001_schema_v1.sql` + `002_seed_policyfund.sql` + `003_boards_engine.sql` (정본)

## 1. 결정 — 전용 테이블 없이 003 보드 엔진 위에 얹는다

ADR-0002/추가 지침에 따라 **독자 CREATE TABLE·신규 마이그레이션 금지**다.
따라서 공지사항은 새 테이블을 만들지 않고 003 임의 보드 엔진에 저장한다.

| 개념 | 저장 위치 |
| --- | --- |
| 공지 보드 | `boards` 1행 (`source='core.notice'`) |
| 공지 1건 | `items` 1행 (`title`) |
| 본문/분류/고정/게시일/작성자 | `item_values` 셀 5개 (EAV) |

컬럼 key는 전부 **영문 식별자**다 — BUG-0002(한글 라벨을 key로 쓴 불일치) 재발 방지.
`body` · `category` · `pinned` · `published_at` · `author`
(`app/src/lib/notices/types.ts` 의 `NOTICE_KEYS` 가 정본, 테스트가 패턴을 강제)

### 1.1 `is_system=false` 인 이유

`BoardsService.requireEditableBoard` 는 `is_system=true` 보드의 아이템 편집을 막는다.
공지 보드를 시스템 보드로 두면 **공지 작성 자체가 불가능**해진다.
그래서 `is_system=false` + `source='core.notice'` 조합으로, 시스템 성격은 `source` 로만 표시하고
CRUD는 기존 보드 엔진을 그대로 통과시킨다.

## 2. 레이어 경계

```
/notices 페이지 · 홈 위젯
        ↓
lib/notices (T04)      ← 보드 찾기 · EAV↔뷰모델 변환 · 공지 정렬만
        ↓
lib/boards  (T02b)     ← 셀 정규화 · 선택지 검증 · 담당범위  (재사용, 무수정)
        ↓
003 boards/items/item_values
```

- 공용 계약(`@/lib/types`, `@/lib/repo/index.ts`)과 T02b 보드 엔진 파일은 **수정하지 않았다**.
- 검증 로직을 다시 짜지 않고 보드 엔진에 위임한다(선택지 검증은 보드 엔진 테스트가 이미 커버).

## 3. ⚠ 미해소 — 공지 가시성과 003 `items` RLS 충돌 (기획 판정 요청)

003 `items_rw` 정책:

```sql
using ( is_org_member(org_id) and (
  org_role(org_id) in ('owner','admin') or org_scope(org_id) = 'all'
  or assigned_to = auth.uid() ) )
```

공지는 개인이 아니라 조직에 속하므로 `assigned_to = null` 로 저장한다.
그 결과 **`member` + `scope='assigned'` 사용자에게는 공지가 하나도 보이지 않는다.**

- 앱에서 우회 불가다. 로컬 repo뿐 아니라 **Supabase RLS가 서버측에서 동일하게 막는다** —
  즉 어댑터를 바꿔도 해소되지 않는 **스키마 레벨 제약**이다.
- 현재 구현은 계약대로(스코프 준수) 동작하고, 해당 사용자에게는 사유를 명시한 빈 상태를 보여준다.
- 테스트가 이 동작을 **의도된 현행 제약으로 고정**해 두었다(`service.test.ts` 담당범위 describe).

### 제안 (기획 결정 필요 — 스키마 변경이라 단독 진행하지 않음)

`items_rw` 에 공지 보드 예외를 추가:

```sql
or exists (select 1 from boards b
           where b.id = items.board_id and b.source = 'core.notice')
```

대안: 공지 보드를 별도 정책 테이블로 분리하거나, 조직 공지를 `scope` 무관 읽기로 규정.
→ **004 마이그레이션은 기획이 작성**한다. T04는 판정을 기다린다.

## 4. 프로비저닝 한계 (후속)

`BoardsRepo.createBoard` 는 `source` 를 `null` 로 하드코딩하고 `NewBoard` 에 인자가 없다.
런타임 `ensureBoard()` 로 만든 보드는 `source` 를 못 심으므로 **이름(`공지사항`) 폴백**으로 찾는다.
시드로 만든 보드는 `source` 가 정상이다.

→ 후속 요청(T02b): `NewBoard` 에 `source?: string | null` 추가.
   추가되면 폴백 제거 가능. 계약 파일이 아니므로 T02b 소유 판단에 맡긴다.

## 5. 산출물

| 경로 | 내용 |
| --- | --- |
| `lib/notices/types.ts` | 컬럼 key·분류 선택지·`Notice` 뷰모델 |
| `lib/notices/service.ts` | 보드 확보 · CRUD · 정렬(`compareNotices`) · `todayKst` |
| `lib/notices/http.ts` | 입력 검증 + 에러→상태코드 매핑 |
| `app/api/notices/*` | 목록/작성/상세/수정/삭제 |
| `app/(app)/notices/*` | 공지 보드 화면 + 서버 액션 |
| `components/dash/RecentNotices.tsx` | 홈 "최근 공지" 위젯(상단 5건) |
| `repo/local/seed.ts` | 공지 보드 + 컬럼 5 + 샘플 공지 3 |

테스트 38개 추가(service 24 + http 14). `check.sh` 초록 — app 347 / worker 1.
`next build` 로 `/notices`·`/api/notices` 라우트 생성 확인.

### 검증 한계

브라우저 렌더 확인은 하지 못했다 — 포트 3000을 다른 트랙의 dev 서버가 점유 중이라
프리뷰를 띄우면 그 서버를 침해하게 된다. 프로덕션 빌드 성공까지만 확인했다.
