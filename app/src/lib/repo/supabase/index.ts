import { getSupabaseClient } from "./client";
import { LocalCrmSource } from "./localCrmSource";
import { SupabaseCrmSource } from "./supabaseCrmSource";
import type { CrmSource } from "./source";

export { isSupabaseConfigured, readSupabaseEnv, resetSupabaseClient } from "./client";
export { SupabaseCrmSource, SupabaseCrmError, NewcustCutoverConflictError } from "./supabaseCrmSource";
export { SupabaseBoardsSource, SupabaseBoardsError } from "./supabaseBoardsSource";
export { NewcustLegacyMigrationSource, NewcustLegacyMigrationError } from "./newcustLegacyMigrationSource";
export { LocalCrmSource } from "./localCrmSource";
export { canSeeAll, type CrmSource } from "./source";

const g = globalThis as unknown as { __moaworkCrmSource?: CrmSource };

/**
 * core.crm 데이터 소스 (T02 · B2).
 *
 * 환경변수(NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)가 있으면 Supabase, 없으면 로컬 인메모리.
 * 호출부는 어느 쪽인지 몰라도 되고, 내일 Supabase 를 연결해도 코드 변경이 없다.
 */
export function getCrmSource(): CrmSource {
  if (!g.__moaworkCrmSource) {
    const db = getSupabaseClient();
    g.__moaworkCrmSource = db ? new SupabaseCrmSource(db) : new LocalCrmSource();
  }
  return g.__moaworkCrmSource;
}

/** 테스트용 — 소스를 주입하거나(인자) 캐시를 비운다(무인자). */
export function setCrmSource(source?: CrmSource): void {
  g.__moaworkCrmSource = source;
}
