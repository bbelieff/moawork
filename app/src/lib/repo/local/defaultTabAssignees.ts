import type { DefaultTabAssignee } from "@/lib/default-tabs/types";
import type { Ctx } from "@/lib/types";
import { db } from "./store";

/** Local-dev/test adapter. Production member reads stay on authenticated org_members. */
export function loadLocalDefaultTabAssignees(ctx: Ctx): DefaultTabAssignee[] {
  const store = db();
  return store.members
    .filter((member) => member.org_id === ctx.org.id)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((member) => {
      const user = store.users.find((candidate) => candidate.id === member.user_id);
      return {
        userId: member.user_id,
        displayName: user?.name?.trim() || user?.email?.trim() || "멤버",
      };
    });
}
