/**
 * core.crm 배럴 + 스토어/서비스 팩토리 (T02).
 *
 * 환경변수(SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)가 있으면 PostgREST 어댑터,
 * 없으면 인메모리 어댑터(개발/테스트)를 사용한다.
 * ⚠ 비밀값은 코드/문서에 기록 금지 — .env* 로만 주입(.env.example 참고).
 */

import { CrmService } from "./service";
import { InMemoryCrmStore, type CrmStore } from "./store";
import { PostgrestCrmStore } from "./postgrest";

export * from "./types";
export * from "./service";
export * from "./store";
export * from "./context";

let cachedStore: CrmStore | null = null;

/** 프로세스 단위 스토어 싱글턴. */
export function getStore(): CrmStore {
  if (cachedStore) return cachedStore;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cachedStore =
    url && key ? new PostgrestCrmStore({ url, serviceKey: key }) : new InMemoryCrmStore();
  return cachedStore;
}

/** 테스트에서 스토어를 주입/초기화. */
export function setStore(store: CrmStore | null): void {
  cachedStore = store;
}

export function getService(): CrmService {
  return new CrmService(getStore());
}
