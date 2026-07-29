# dev-drop — MWC가 작성한 실코드 (코덱스가 복사해 적용)

> 2026-07-27 · MWC(코워크) 작성 · **디스패치 큐 미등재**
> MWC는 git push 권한이 없어 파일로만 전달한다. **커밋·머지·배포는 코덱스.**

---

## 이번 드롭: C1 회사 전환 스위처 + 회사 표식

| 이 파일 | 레포에 놓을 위치 |
|---|---|
| `components/workspace/WorkspaceSwitcher.tsx` | `app/src/components/workspace/WorkspaceSwitcher.tsx` |
| `components/workspace/WorkspaceMark.tsx` | `app/src/components/workspace/WorkspaceMark.tsx` |
| `components/workspace/workspace-switcher.module.css` | `app/src/components/workspace/workspace-switcher.module.css` |
| `components/workspace/WorkspaceMark.test.ts` | 프로젝트 테스트 규약에 맞춰 배치 |

## 검증 상태 (MWC 실행)

```
순수 함수 단위테스트 7/7 PASS (node --test)
 · 한글 1자 / 영문 2자 이니셜
 · 이모지·특수문자 스킵
 · 법인 표기 제외 ★
 · 빈 값 폴백
 · 해시 결정적·비음수
 · 색 분산
```

**★ 테스트가 실제 결함을 잡았습니다.** 초안에서는 `(주)엘에스` → `주`, `주식회사 모아워크` → `주` 로 나와 **법인 회사가 전부 같은 글자로 보였습니다.** `LEGAL_FORM` 정규식으로 (주)·㈜·주식회사·유한회사·재단법인 등을 걷어낸 뒤 이니셜을 뽑도록 수정했고, 회귀 테스트를 고정했습니다.

## 설계 계약 (코드에 반영된 것)

- **D-S1** 좌상단 배치 · **D-S2** 우상단은 사람 축만 · **D-S3** UI 어휘 "회사" · **D-S4** 목록+만들기/합류 · **D-S5** 2클릭
- 목록은 **내 소속만**(열거 방지). 요청 중은 표시하되 `aria-disabled`로 **진입 불가**
- 전환 목적지는 **`/w/{slug}` 루트** — 현재 경로 승계 금지(회사마다 권한이 다름)
- 뱃지 규칙: **숫자 = 할 일**(화면 진입만으로 안 사라짐) / **점 = 안 본 변화** / 숫자 우선, 99+ 절단
- 플랫폼 관리 항목은 `isPlatformAdmin` 일 때만 렌더 — **비관리자에겐 존재 자체가 안 보임**
- 색은 **브랜드 토큰만**(하드코딩 0). 회사 표식에 **People Coral 미사용**(담당자·멘션 전용). 뱃지에만 알림 성격으로 사용
- 접근성: `aria-haspopup/expanded/controls`, Esc→트리거 포커스 복귀, 바깥 클릭 닫힘, `:focus-visible` 아웃라인
- 모바일 640px 이하 **바텀시트** 전환 + `env(safe-area-inset-bottom)`, 터치 타깃 48px

## 코덱스가 채워야 할 연결부

1. **데이터 공급** — 호출부에서 아래를 넘긴다. 소속 조회는 기존 `/workspaces` 로직 재사용 권장.
   ```ts
   <WorkspaceSwitcher
     current={{ orgId, slug, name, role, iconUrl }}
     workspaces={activeMemberships}   // 최근 사용순 정렬은 호출부 책임
     pending={pendingRequests}        // 없으면 생략
     isPlatformAdmin={session.isPlatformAdmin}
   />
   ```
2. **사이드바 헤더 교체** — 현재 `"MoaWork 데모 조직 · 워크스페이스"` 텍스트 자리를 이 컴포넌트로. **어휘도 "내 회사"로 바뀐다(D-S3).**
3. **우상단 계정 메뉴** — 회사명 표기 제거 + "회사 전환은 왼쪽 위에서 해요" 1줄 추가.
4. **아이콘 업로드** — `iconUrl`은 서명 URL을 받는다. 업로드/리사이즈(WebP 32·64·256)·SVG 정제·매직넘버 검증은 서버 몫(C1 지시서 참조).
5. **CSS 토큰 확인** — `--mw-ink/surface/line/muted/hover`가 토큰 파일에 있는지 확인하고, 이름이 다르면 **CSS 쪽만** 맞춰라(컴포넌트 수정 불필요).
6. **테스트 러너** — MWC는 `node --test`로 검증했다. 프로젝트 규약(vitest 등)에 맞춰 옮겨라.

---

## 드롭 2: 채팅 첨부 (사진·영상 + Ctrl+V 붙여넣기) — belie 요청 2026-07-27

| 이 파일 | 레포에 놓을 위치 |
|---|---|
| `components/support/attachment-rules.ts` | `app/src/components/support/attachment-rules.ts` |
| `components/support/useChatAttachments.ts` | `app/src/components/support/useChatAttachments.ts` |
| `components/support/attachment-rules.test.ts` | 프로젝트 테스트 규약에 맞춰 |

### 검증 상태 (MWC 실행) — **13/13 PASS** (`node --test`)
이미지·영상 통과 / MOV 허용 / **SVG 거부** / 실행파일 거부 / 용량 상한(이미지 10MB·영상 50MB) /
빈 파일 / 5개 상한 / partition 통과·거절 동시 반환 / 누적 개수 / 붙여넣기 파일명 / formatBytes

### 계약
- **고객·운영자 양쪽이 같은 훅을 쓴다.** 위젯과 어드민 화면의 동작이 갈리면 안 된다.
- 허용: 사진 PNG·JPG·WebP·GIF(10MB) / 영상 MP4·WebM·MOV(50MB) / 메시지당 5개
- **Ctrl+V**: 클립보드에 이미지가 있을 때만 `preventDefault`. 텍스트 붙여넣기는 그대로 통과시킨다.
  이름 없는 클립보드 이미지는 `붙여넣기_20260727_210509.png` 형식으로 자동 명명.
- 드래그&드롭·파일선택도 같은 경로로 처리. 같은 파일 재선택 가능하도록 input value 초기화.
- 거절 시 **조용히 버리지 않는다** — 파일명 + 사유를 `onReject`로 올려 토스트로 보여준다.
- `previewUrl`(objectURL)은 제거·언마운트 시 **반드시 revoke**(누수 방지) — 훅에 구현돼 있다.

### ⚠️ 서버가 반드시 해야 할 것 (클라이언트만으로는 못 막는다)
1. **같은 함수로 재검증** — `checkAttachment`를 업로드 API에서도 호출한다.
2. **매직넘버 검사** — 확장자·MIME은 위조된다. 실제 바이트로 형식을 확인.
3. **이미지 EXIF 제거** — GPS 좌표가 들어 있을 수 있다(고객사 위치 유출). 저장 전 스트립.
4. **Storage 비공개 버킷 + 서명 URL(만료)** — 기존 계약서·서류 정책과 동일 규칙.
5. 영상은 자동재생 금지, 썸네일/길이 표시.

## 아직 안 만든 것 (다음 드롭 후보)
`WorkspaceIconUploader`(업로드 UI) · 알림 패널(C2) · 지원 위젯(C3). 필요 순서를 알려주면 이어서 작성한다.
