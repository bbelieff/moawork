"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { writeRolePermission } from "@/lib/perm/server";
import type { Role } from "@/lib/perm/matrix";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || v === "") {
    throw new Error(`missing form field: ${key}`);
  }
  return v;
}

/**
 * 역할 매트릭스 토글 — 서버 액션. 소유자만 성공한다(RPC 가 강제, 여기서는 재확인하지 않는다).
 * `revalidatePath` 대상 경로는 hidden input `path` 로 호출부가 넘긴다 — 이 컴포넌트를
 * 어디에 붙일지 아직 정해지지 않았으므로(리스 밖) 경로를 하드코딩하지 않는다.
 */
export async function toggleRolePermissionAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  const role = str(formData, "role") as Role;
  const scopeKey = str(formData, "scopeKey");
  const nextAllowed = str(formData, "nextAllowed") === "true";
  const path = formData.get("path");

  await writeRolePermission(orgId, role, scopeKey, nextAllowed, randomUUID());

  if (typeof path === "string" && path !== "") {
    revalidatePath(path);
  }
}
