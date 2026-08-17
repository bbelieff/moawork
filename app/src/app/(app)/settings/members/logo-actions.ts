"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  ORG_LOGO_BUCKET,
  orgLogoFailureMessage,
  orgLogoObjectPath,
  orgLogoReasonFromRpcError,
  validateOrgLogoUpload,
  type OrgLogoFailureReason,
} from "@/lib/org-logo/contracts";

export type OrgLogoActionState = Readonly<{
  ok: boolean;
  message: string;
  reason?: OrgLogoFailureReason;
}>;

export const ORG_LOGO_IDLE: OrgLogoActionState = { ok: false, message: "" };

function failure(reason: OrgLogoFailureReason): OrgLogoActionState {
  return { ok: false, reason, message: orgLogoFailureMessage(reason) };
}

/** 이전 오브젝트를 지우려면 경로를 알아야 한다. RLS 가 내 조직으로 이미 좁힌다. */
async function readCurrentPath(
  supabase: { from: (table: string) => never } | Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<string | null> {
  try {
    const { data, error } = await (supabase as Awaited<ReturnType<typeof createClient>>)
      .from("orgs")
      .select("logo_path")
      .eq("id", orgId)
      .maybeSingle();
    if (error) return null;
    const path = (data as { logo_path?: string | null } | null)?.logo_path ?? null;
    return typeof path === "string" && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

function revalidateLogoSurfaces() {
  // 설정 화면과 «사이드바가 있는 모든 화면» 둘 다 갱신한다.
  revalidatePath("/settings/members");
  revalidatePath("/", "layout");
}

export async function uploadOrgLogoAction(
  _previous: OrgLogoActionState,
  formData: FormData,
): Promise<OrgLogoActionState> {
  const ctx = await getSession();

  // ★ 권한 판정. 화면에서 숨기는 것과 별개로 서버가 막는다.
  if (!isManager(ctx.role)) return failure("permission");

  const file = formData.get("logo");
  if (!(file instanceof File)) return failure("empty");

  // ★ 서버측 형식·용량 검증. 화면의 accept 속성은 «안내» 일 뿐 관문이 아니다.
  const validation = validateOrgLogoUpload({ mime: file.type, bytes: file.size });
  if (!validation.ok) return failure(validation.reason);

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return failure("unavailable");
  }

  // ★ 조직 필터. 경로는 «서버가» ctx.org.id 로 조립한다.
  //   formData 에 무엇이 담겨 오든 org 를 바꿀 수 없다.
  const objectPath = orgLogoObjectPath(ctx.org.id, validation.mime, randomUUID());
  const previousPath = await readCurrentPath(supabase, ctx.org.id);

  const upload = await supabase.storage
    .from(ORG_LOGO_BUCKET)
    .upload(objectPath, file, { contentType: validation.mime, upsert: false });
  if (upload.error) return failure("upload_failed");

  const rpc = await supabase.rpc("set_org_logo", {
    p_org_id: ctx.org.id,
    p_path: objectPath,
    p_mime: validation.mime,
    p_bytes: file.size,
  });
  if (rpc.error) {
    // 저장에 실패했으면 방금 올린 파일을 남기지 않는다 — 주인 없는 오브젝트를 만들지 않는다.
    try {
      await supabase.storage.from(ORG_LOGO_BUCKET).remove([objectPath]);
    } catch {
      // 청소 실패는 원인이 아니다. 사용자에게는 저장 실패만 알린다.
    }
    return failure(orgLogoReasonFromRpcError(rpc.error as { code?: string; message?: string }));
  }

  if (previousPath && previousPath !== objectPath) {
    try {
      await supabase.storage.from(ORG_LOGO_BUCKET).remove([previousPath]);
    } catch {
      // 이전 파일 청소는 최선 노력이다. 실패해도 로고 교체는 이미 성공했다.
    }
  }

  revalidateLogoSurfaces();
  return { ok: true, message: "회사 로고를 저장했어요." };
}

export async function removeOrgLogoAction(
  _previous: OrgLogoActionState,
  _formData: FormData,
): Promise<OrgLogoActionState> {
  const ctx = await getSession();

  // ★ 권한 판정.
  if (!isManager(ctx.role)) return failure("permission");

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return failure("unavailable");
  }

  const previousPath = await readCurrentPath(supabase, ctx.org.id);

  const rpc = await supabase.rpc("clear_org_logo", { p_org_id: ctx.org.id });
  if (rpc.error) {
    return failure(orgLogoReasonFromRpcError(rpc.error as { code?: string; message?: string }));
  }

  if (previousPath) {
    try {
      await supabase.storage.from(ORG_LOGO_BUCKET).remove([previousPath]);
    } catch {
      // 파일 청소 실패는 사용자에게 실패로 보이지 않는다 — 로고는 이미 내려갔다.
    }
  }

  revalidateLogoSurfaces();
  return { ok: true, message: "회사 로고를 지웠어요." };
}
