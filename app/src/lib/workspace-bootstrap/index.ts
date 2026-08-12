/**
 * 새 워크스페이스가 «태어날 때» 갖추는 것 — BBE-46 · D76.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 구조는 이미 다 있었다(`SEOUL_STRUCTURE_PACK` — 보드 3 · 그룹 32 · 컬럼 69).
 * 없던 것은 **연결**이다. `installStructurePack()` 을 부르는 곳이 딱 두 군데였는데
 * 둘 다 워크스페이스 «생성» 경로가 아니었다:
 *
 * ```
 * boards/InstallPackButton.tsx   ← 사용자가 눌러야 하는 «구조 팩 설치» 버튼
 * lib/onboarding/server.ts       ← 연습 회사 전용
 * ```
 *
 * 그래서 새 회사를 만들면 탭이 0개였고, 화면은 «구조 팩을 설치하면» 이라는 안내만 띄웠다.
 * belie 가 프로덕션에서 실제로 부딪힌 그 막다른 길이다(진단 2026-08-12 §1 · 인수인계 §1).
 *
 * **D76 이 그 «설치» 라는 단계 자체를 폐기했다.** 목업 어디에도 없고 제품 개념으로도 불필요하다.
 * 새 워크스페이스는 «구조는 채워져 있고 데이터는 0» 이다.
 *
 * ## 이 함수가 유일한 «생성 시 지급» 지점이다
 *
 * 앱에서 워크스페이스를 만드는 경로는 `getRepo().createOrg()` **하나뿐**이다(실측).
 * 앞으로 «새 회사가 무엇을 갖고 시작하는가» 를 바꾸려면 여기만 고치면 된다 —
 * 호출부에 하나씩 흩뿌리지 않는다.
 *
 * ⚠️ **hosted(Supabase) 측 생성 경로는 이 함수를 타지 않는다.** 플랫폼 어드민이 워크스페이스
 * 생성 요청을 승인하는 흐름은 006 마이그레이션의 DB 함수에 있다. 그쪽에도 같은 보장이
 * 필요하지만 SQL 은 DG-02 소유라 손대지 않았다 — 후속 과제로 남긴다.
 */

import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { installStructurePack } from "@/lib/structure-packs";
import type { InstallResult } from "@/lib/structure-packs/install";

export interface BootstrapResult {
  /** 심긴 구조. 이미 있던 보드는 `skipped` 로 빠진다(멱등). */
  structure: InstallResult;
}

/**
 * 새로 만들어진 워크스페이스에 기본 구조를 지급한다.
 *
 * **구조만 만든다. 데이터(행)는 0 이다** — D72. 담당자별 그룹은 실명이 아니라 슬롯이라
 * 멤버가 만든 사람 1명뿐이면 슬롯 0 만 채워진다(D73 · BBE-130). 그게 «빈 상태» 다.
 *
 * 멱등하다 — `installStructurePack()` 이 같은 이름의 보드를 건너뛰므로 두 번 불려도
 * 두 벌 생기지 않는다. 생성 실패로 재시도되는 경우에도 안전하다.
 */
export function bootstrapNewWorkspace(
  ctx: Ctx,
  options: { repo?: BoardsRepo } = {},
): BootstrapResult {
  return { structure: installStructurePack(ctx, options) };
}
