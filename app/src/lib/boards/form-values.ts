import type { CellValue } from "./types";

export function boardCellValueFromFormData(formData: FormData): CellValue {
  const raw = formData.get("value");
  const kind = formData.get("kind");
  if (kind === "checkbox") return raw === "on" || raw === "true";
  if (kind === "person") return typeof raw === "string" && raw !== "" ? raw : null;
  if (kind === "people") return formData.getAll("value").filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return raw as CellValue;
}
