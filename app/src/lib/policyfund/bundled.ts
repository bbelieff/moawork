// T09 · 번들 프리셋 스냅샷 로더.
//
// app/src/data/policyfund-presets.json 은 002_seed(SSOT)에서 추출한 스냅샷.
// 프로덕션 경로는 DB industry_modules.presets_jsonb 로드(팩 설치 시 조직 복사).
// MVP 오프라인 렌더용으로 이 스냅샷을 사용하며, presets 개수는 테스트로 가드한다.
//
// ※ 대용량 JSON 이므로 클라이언트 번들 팽창 방지를 위해 index 배럴에서 재수출하지 않는다.
//   필요한 서버 컴포넌트/로더에서 직접 import 한다.

import raw from "../../data/policyfund-presets.json";
import type { PolicyfundPresets } from "./types";

/** 002_seed 에서 추출한 정책자금 프리셋 스냅샷. */
export const BUNDLED_PRESETS = raw as unknown as PolicyfundPresets;

/** 번들 스냅샷 프리셋을 반환한다(MVP). 이후 DB 로더로 대체 가능. */
export function getBundledPresets(): PolicyfundPresets {
  return BUNDLED_PRESETS;
}
