import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCrmSource } from "./index";
import { SupabaseCrmSource } from "./supabaseCrmSource";
import type { CrmSource } from "./source";

type ServerSourceDependencies = {
  isSupabaseConfigured: () => boolean;
  createSupabaseClient: () => Promise<SupabaseClient>;
  getLocalSource: () => CrmSource;
};

const defaultDependencies: ServerSourceDependencies = {
  isSupabaseConfigured: hasSupabaseEnv,
  createSupabaseClient: createClient,
  getLocalSource: getCrmSource,
};

/**
 * 서버 요청의 CRM 소스를 만든다.
 *
 * Supabase 환경은 cookie가 연결된 SSR client를 요청마다 새로 사용해 사용자 JWT/RLS를
 * 보존한다. 환경변수가 없는 로컬 개발만 기존 프로세스 cache를 재사용한다.
 */
export async function getServerCrmSource(
  dependencies: ServerSourceDependencies = defaultDependencies,
): Promise<CrmSource> {
  if (!dependencies.isSupabaseConfigured()) {
    return dependencies.getLocalSource();
  }

  return new SupabaseCrmSource(await dependencies.createSupabaseClient());
}
