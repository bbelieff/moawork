import type { CellValue } from "./types";

export function boardCellValueFromFormData(formData: FormData): CellValue {
  const raw = formData.get("value");
  const kind = formData.get("kind");
  if (kind === "checkbox") return raw === "on" || raw === "true";
  if (kind === "person") return typeof raw === "string" && raw !== "" ? raw : null;
  if (kind === "people" || kind === "multiselect") {
    // 여러 값을 같은 이름으로 보낸다 — 첫 값만 읽으면 배열이 아니라며 저장이 거절된다(Issue 857 검토).
    return formData.getAll("value").filter((entry): entry is string => typeof entry === "string" && entry !== "");
  }
  return raw as CellValue;
}
