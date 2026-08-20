"use server";

/**
 * 고객사 CSV 일괄 등록 서버 액션.
 *
 * ★ 이 파일은 "use server" 다 — top-level export 는 «전부 async 함수» 여야 한다.
 *   상수·타입을 여기서 export 하면 Turbopack 빌드가 모듈 단위로 깨진다(BBE-217).
 *   그래서 결과 타입은 ./csv-import-contract 에 둔다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { getCrmService } from "@/lib/crm";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { IMPORT_ROW_CAP, mapCsvToCompanies, type ImportRow } from "@/lib/companies/csv-import";
import type { CompanyImportResult } from "./csv-import-contract";

export async function importCompaniesCsvAction(
  rows: readonly ImportRow[],
  headers: readonly string[],
  requestId: string,
): Promise<CompanyImportResult> {
  const ctx = await getSession();

  // 가져오기는 조직 전체 데이터를 늘리는 동작이라 관리자로 제한한다.
  if (!isManager(ctx.role)) {
    return { ok: false, message: "고객사 일괄 등록은 관리자만 할 수 있어요.", imported: 0, rejected: [] };
  }
  if (rows.length === 0) {
    return { ok: false, message: "가져올 행이 없어요.", imported: 0, rejected: [] };
  }
  if (rows.length > IMPORT_ROW_CAP) {
    return {
      ok: false,
      message: `한 번에 ${IMPORT_ROW_CAP}행까지 가져올 수 있어요. 파일을 나눠 주세요.`,
      imported: 0,
      rejected: [],
    };
  }
  if (!hasSupabaseEnv()) {
    // «못 읽었다» 와 «아직 연결 안 됨» 을 가른다. 0건 성공으로 위장하지 않는다.
    return { ok: false, message: "워크스페이스 데이터베이스에 아직 연결되지 않았어요.", imported: 0, rejected: [] };
  }

  const { mapped, rejected, unrecognized } = mapCsvToCompanies(rows, headers);

  // ── 멱등: 같은 request_id 를 이미 처리했으면 다시 저장하지 않는다 ──
  const db = await createClient();
  const claim = await db
    .from("company_import_requests")
    .insert({ org_id: ctx.org.id, request_id: requestId, actor_id: ctx.user.id, row_count: mapped.length })
    .select("request_id")
    .maybeSingle();

  if (claim.error) {
    // 23505 = 이미 그 요청을 처리했다. 사용자가 다시 누른 것이므로 «성공» 으로 답한다.
    if (claim.error.code === "23505") {
      return {
        ok: true,
        message: "이미 가져온 파일이에요. 다시 눌러도 중복 저장되지 않았어요.",
        imported: 0,
        rejected: [],
        duplicate: true,
      };
    }
    return { ok: false, message: "가져오기를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", imported: 0, rejected: [] };
  }

  const crm = getCrmService();
  const failures = [...rejected];
  let imported = 0;

  for (const [index, row] of mapped.entries()) {
    try {
      await crm.createCompany(ctx, row.input);
      imported += 1;
    } catch {
      // ★ 한 행이 실패해도 «멈추지 않는다». 어디까지 들어갔는지 사용자가 알아야 한다.
      failures.push({ line: index + 2, title: row.input.name, reason: "저장하지 못했어요" });
    }
  }

  revalidatePath("/companies");

  const notes: string[] = [`${imported}개 회사를 가져왔어요.`];
  if (failures.length > 0) notes.push(`${failures.length}행은 넣지 못했어요.`);
  if (unrecognized.length > 0) notes.push(`알아보지 못한 열 ${unrecognized.length}개는 저장하지 않았어요: ${unrecognized.join(", ")}`);

  return { ok: imported > 0, message: notes.join(" "), imported, rejected: failures };
}
