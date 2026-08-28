import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { CompanyPickerLoadResult } from "./picker-server";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

type StartWorkAction = (
  previous: CompanyIntakeActionState,
  formData: FormData,
) => Promise<CompanyIntakeActionState>;

/**
 * 「＋ 업체 추가」를 «모든» 그룹에 단다 (#588 ①).
 *
 * ★ 전에는 첫 그룹(blockIndex === 0)에만 달았다. 그건 서버가 어느 그룹에서 눌러도
 *   첫 그룹에 행을 넣던 것을 «가리는» 처방이었지 고치는 게 아니었다 —
 *   2분기 그룹에서는 회사 고르기 자체를 못 썼고, 이름 입력칸으로 되돌아갔다.
 *   마이그레이션 140 이 그룹을 인자로 받으므로 이제 모든 그룹에서 제대로 동작한다.
 *
 * ★ 컴포넌트 밖에 있는 이유 — 여기가 «아무도 안 보던 자리» 였다 (#588 ③).
 *   서버가 「목록이 잘렸다」고 말해도 이 세 줄이 그걸 안 실어 보내면 화면은 모른 채
 *   「없으면 새로 등록하세요」라고 말한다. 그러면 이 화면이 막으려던 중복을 이 화면이 만든다.
 *   순수 함수라 테스트가 BoardWorkspace 의 import 트리 없이 직접 잰다.
 */
export function buildCompanyPickerProps(
  boardSource: string | null | undefined,
  picker: CompanyPickerLoadResult,
  action?: StartWorkAction,
) {
  if (boardSource !== CONTRACT_WORK_TAB_SOURCE || !action) return {};
  return {
    companyPicker: {
      rows: picker.rows,
      loadError: picker.error,
      truncated: picker.truncated,
      action,
    },
  };
}
