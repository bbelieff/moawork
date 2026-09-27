import type { ItemDetailFile } from "@/app/(app)/boards/item-detail-actions";

/**
 * 증빙 파일 묶음(v17-detail) — 파일명 기준 표시용 분류.
 *
 * board_item_detail_files에 분류 컬럼이 없으므로(마이그레이션 124·128이
 * 정본) 서버 메타데이터로는 묶을 수 없다. 기존 name만으로 묶는다.
 * 사업자등록 / 부가세(VAT) / 기타 세 묶음으로 «보여주기만» 하며 저장값·순서를
 * 바꾸지 않는다. OCR은 이 과업 밖이다 — 파일 선택 input이 후속 진입점이다.
 */
export type DetailFileGroup = "biz_registration" | "vat" | "other";

export const DETAIL_FILE_GROUP_LABEL: Record<DetailFileGroup, string> = {
  biz_registration: "사업자등록",
  vat: "부가세(VAT)",
  other: "기타",
};

const BIZ_PATTERNS = ["사업자등록", "사업자_등록", "biz_reg", "bizreg", "business_license"];
const VAT_PATTERNS = ["부가세", "부가가치세", "vat", "v.a.t"];

export function groupDetailFile(name: string): DetailFileGroup {
  const lowered = name.toLowerCase();
  if (BIZ_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()))) {
    return "biz_registration";
  }
  if (VAT_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()))) {
    return "vat";
  }
  return "other";
}

export function groupDetailFiles(
  files: readonly ItemDetailFile[],
): { group: DetailFileGroup; files: ItemDetailFile[] }[] {
  const buckets: Record<DetailFileGroup, ItemDetailFile[]> = {
    biz_registration: [],
    vat: [],
    other: [],
  };
  for (const file of files) buckets[groupDetailFile(file.name)].push(file);
  return (Object.keys(buckets) as DetailFileGroup[])
    .filter((group) => buckets[group].length > 0)
    .map((group) => ({ group, files: buckets[group] }));
}
