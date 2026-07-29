# belie 직접 작업 — 구글 로그인 마무리 (클릭 단위)

> 작성 2026-07-22 · 기획-Cowork. 제가 GCP 쪽은 전부 끝냈고, **Client Secret이 걸린 3단계만** belie 몫입니다.
> 총 소요 5~7분. 순서대로만 하면 됩니다.

## 전체 그림 (지금 어디쯤인가)

```
[1] GCP 프로젝트 moa-work 생성        ✅ 완료(제가 함)
[2] 동의화면 MoaWork · 프로덕션 게시   ✅ 완료(제가 함)
[3] OAuth 클라이언트 moa-work-web     ✅ 완료(제가 함) → Client ID 발급됨
[4] 서비스계정 moawork-server         ✅ 완료(제가 함)
────────────────────────────────────────────────
[5] Secret 복사                       ⬅ belie · STEP 1
[6] Supabase에 ID/Secret 넣고 켜기     ⬅ belie · STEP 2
[7] Supabase 돌아올 주소 등록          ⬅ belie · STEP 3
[8] 실제 구글 로그인 테스트            ⬅ 같이 · STEP 4
```

지금 www.moa-work.com은 **dev-session(가짜 로그인)** 으로 돌고 있습니다. STEP 3까지 끝나면 진짜 구글 계정으로 들어가지고, `user1@example.com`은 005 마이그레이션에 예약해 둔 대로 **자동으로 오너/플랫폼 관리자**가 됩니다.

---

## STEP 1 — Client Secret 복사 (GCP)

🔗 https://console.cloud.google.com/auth/clients?authuser=1&project=moa-work

1. 위 링크 클릭. 상단에 프로젝트가 **`moa-work`** 인지 확인 (아니면 상단 프로젝트 이름 클릭 → moa-work 선택)
2. 목록에서 **`moa-work-web`** 이름 클릭
3. 오른쪽 위 **"추가 정보"** 영역의 **클라이언트 보안 비밀번호(Client secret)** 찾기
4. 값 오른쪽 **복사 아이콘(⧉)** 클릭 → 클립보드에 담김
   - 값이 `···`로 가려져 있으면 **눈 아이콘**을 먼저 눌러 표시
   - `GOCSPX-` 로 시작하는 문자열입니다

> ⚠️ 이 값은 **비밀번호와 동급**입니다. 카톡·메모장·이 대화창에 붙여넣지 마세요. 복사한 채로 바로 STEP 2로 갑니다.

---

## STEP 2 — Supabase에 구글 로그인 켜기

🔗 https://supabase.com/dashboard/project/srtvmpcosekduvsscsyz/auth/providers?provider=Google

1. 위 링크 클릭 (화면이 비어 보이면 새로고침 F5)
2. 목록에서 **Google** 행 클릭 → 펼쳐짐
3. 맨 위 **"Enable Sign in with Google"** 토글을 **켬(초록)**
4. **Client IDs** 칸에 아래 값 붙여넣기 (이건 공개값이라 안전)
   ```
   81243211765-aotr01j6lltqg59n90p9brv0ffm0pk3g.apps.googleusercontent.com
   ```
5. **Client Secret** 칸에 STEP 1에서 복사한 값 붙여넣기 (Ctrl+V)
6. 그 아래 **Callback URL (for OAuth)** 이 아래와 같은지 눈으로 확인 (수정 불가·확인만)
   ```
   https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback
   ```
7. 오른쪽 아래 **Save** 클릭 → "Successfully updated" 토스트 확인

---

## STEP 3 — 로그인 후 돌아올 주소 등록 (Supabase)

🔗 https://supabase.com/dashboard/project/srtvmpcosekduvsscsyz/auth/url-configuration

1. **Site URL** 칸을 아래로 교체 → **Save**
   ```
   https://www.moa-work.com
   ```
2. **Redirect URLs** 영역 → **Add URL** 버튼 클릭 → 아래 입력 → 저장. 두 번 반복해서 2개 등록
   ```
   https://www.moa-work.com/**
   ```
   ```
   http://localhost:3000/**
   ```
   - `/**` 는 "그 아래 모든 주소 허용"이라는 뜻입니다(와일드카드)
   - `localhost:3000`은 개발자들이 자기 컴퓨터에서 테스트할 때 쓰는 주소

---

## STEP 4 — 실제 로그인 테스트

🔗 https://www.moa-work.com

1. 접속 → 로그인 화면
2. **구글로 로그인** 버튼 (T03 트랙이 셸에 붙이는 중이라, 아직 없으면 이 단계는 트랙 배포 후)
3. 계정 선택 화면에 **"MoaWork에서 액세스를 요청합니다"** 로 뜨는지 확인 ← 브랜딩 검증 포인트
4. 로그인 후 관리자 메뉴가 보이면 005 자동부여까지 정상

---

## 안 될 때 (증상 → 원인)

| 증상 | 원인 | 조치 |
|---|---|---|
| `redirect_uri_mismatch` | GCP 리디렉션 URI 불일치 | GCP 클라이언트에 `https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback` 정확히 있는지 확인 |
| 로그인 후 빈 화면/엉뚱한 주소 | Supabase Site URL·Redirect 미등록 | STEP 3 재확인 |
| "확인되지 않은 앱" 경고 | 민감 범위 요청 시 | MVP는 email·profile만 쓰므로 정상적으로 안 떠야 함. 뜨면 알려주세요 |
| 동의화면에 `salesptlog` 표시 | 잘못된 프로젝트의 클라이언트 사용 | Client ID가 `81243211765-` 로 시작하는지 확인 |
| 5분~몇 시간 반영 지연 | 구글 설정 전파 | GCP 안내 문구대로 대기 후 재시도 |

---

## 참고 — 이번에 만들어진 것 (SSOT)

| 항목 | 값 |
|---|---|
| GCP 프로젝트 | `moa-work` (계정 user1@example.com) |
| 동의화면 앱이름 | `MoaWork` · 외부 · **프로덕션 게시** |
| OAuth 클라이언트 | `moa-work-web` (웹 애플리케이션) |
| Client ID | `81243211765-aotr01j6lltqg59n90p9brv0ffm0pk3g.apps.googleusercontent.com` |
| Client Secret | **기록하지 않음** (GCP 콘솔에서만 확인) |
| 승인된 JS 원본 | `https://www.moa-work.com` · `https://moa-work.com` · `http://localhost:3000` |
| 리디렉션 URI | `https://srtvmpcosekduvsscsyz.supabase.co/auth/v1/callback` |
| 서비스 계정 | `user1@example.com` (역할·키 없음) |

> 기존 `saleslog-494703` 프로젝트(salesptlog-prod · Masterbot)는 **건드리지 않았습니다.** 완전 분리 운영.
