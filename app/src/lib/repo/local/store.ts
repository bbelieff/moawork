import type {
  Activity,
  Company,
  Deal,
  FieldDef,
  FieldValue,
  Org,
  OrgEntitlement,
  OrgMember,
  Pipeline,
  SavedView,
  Settlement,
  Stage,
  User,
} from "@/lib/types";
import type {
  Board,
  BoardColumn,
  BoardGroup,
  BoardItem,
  BoardView,
  ItemValue,
} from "@/lib/boards/types";
import { seedDb } from "./seed";

// 로컬 개발용 인메모리 데이터베이스. Supabase 연결 전까지의 저장소.
// 프로세스 단일(dev 서버) 기준으로만 유효하며, 프로덕션에서는 Supabase 어댑터로 교체한다.

export interface Db {
  orgs: Org[];
  users: User[];
  members: OrgMember[];
  entitlements: OrgEntitlement[];
  companies: Company[];
  pipelines: Pipeline[];
  stages: Stage[];
  deals: Deal[];
  activities: Activity[];
  fieldDefs: FieldDef[];
  fieldValues: FieldValue[];
  savedViews: SavedView[];
  settlements: Settlement[];
  // ── 003 사용자 임의 보드 엔진 (ADR-0003) — 001 typed 코어와 분리 저장 ──
  boards: Board[];
  boardGroups: BoardGroup[];
  boardColumns: BoardColumn[];
  /** 003 `items` 테이블. 001 deals 와 혼동 방지를 위해 boardItems 로 명명. */
  boardItems: BoardItem[];
  itemValues: ItemValue[];
  boardViews: BoardView[];
}

// HMR/요청 간에 상태를 유지하도록 globalThis 에 보관(dev 편의).
const globalStore = globalThis as unknown as { __moaworkDb?: Db };

export function db(): Db {
  if (!globalStore.__moaworkDb) {
    globalStore.__moaworkDb = seedDb();
  }
  return globalStore.__moaworkDb;
}

/** 테스트/리셋용 — 시드 상태로 되돌린다. */
export function resetDb(): void {
  globalStore.__moaworkDb = seedDb();
}
