# supabase

moawork 의 DB + Auth 레이어. Supabase(PostgreSQL) 를 사용한다.

## 구조

- `migrations/` — 순번이 붙은 SQL 마이그레이션. `0001_init.sql` 부터 시작.

## 규칙

- 스키마 변경은 항상 새 마이그레이션 파일로 추가한다(기존 파일 수정 금지).
- 파일명: `NNNN_snake_case.sql` (예: `0002_boards.sql`).
- 비밀값(DB 비밀번호, 서비스 롤 키 등)은 저장소에 기록하지 않는다. 환경변수로만 주입.

## 로컬 적용 (예시)

Supabase CLI 사용 시:

```bash
supabase db push        # migrations/ 를 원격 DB에 적용
```

또는 psql 로 직접:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```
