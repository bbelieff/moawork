"use server";

/**
 * 그룹(아이템) 프리셋 consumer — 저장 · 적용 · 되돌리기 (BBE-174).
 *
 * 이 파일이 이 카드의 핵심이다. 프리셋 «부품»(저장소·스냅샷·권한·배치 오버라이드)은
 * BBE-158 이 이미 다 만들어 놨는데 **그것을 부르는 화면이 하나도 없었다** — `GroupBlock`
 * 은 「저장·적용은 WO-6에서 연결됩니다」라는 안내 문구만 띄우고 있었다. AGENTS.md §1.3
 * 이 지목한 «소비자 0» 이 정확히 이 자리다. 그래서 여기서는 **새 저장소를 만들지 않는다.**
 *
 *   저장 형태 · 목록 · 삭제   `@/lib/presets/section-presets` (정본, 그대로)
 *   그룹 단위 계산            `@/lib/presets/group-preset`    (순수, 새로 만든 유일한 것)
 *   배치 오버라이드           `./groupLayout`                  (정본, 그대로)
 *   권한                     `structure.preset_edit` · `structure.column_manage`
 *
 * 상태 반환형(`{ok, message}`)은 `./trash-actions` 와 같은 규약이다 — 권한 거부를
 * 예외로 던져 500 화면을 띄우는 대신 **그 자리에 문장으로** 보여 주기 위해서다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { SectionPresetRepo } from "@/lib/presets/section-presets";
import {
  appliedColumnOrder,
  PresetActionError,
  groupPresetRequestSource,
  previewGroupPresetApply,
  snapshotGroupPreset,
} from "@/lib/presets/group-preset";
import { resolveColumnOrder } from "@/components/board/layout";
import type { Ctx } from "@/lib/types";
import { getBoardColumnOrder, setGroupColumnOrder } from "./groupLayout";

export interface GroupPresetActionState {
  ok: boolean;
  message: string | null;
}

export const INITIAL_GROUP_PRESET_STATE: GroupPresetActionState = { ok: true, message: null };

const DENIED = {
  preset_edit: "아이템 프리셋을 저장하거나 적용할 권한이 없습니다. 회사 관리자에게 요청해 주세요.",
  column_manage: "컬럼 구조를 바꿀 권한이 없습니다. 회사 관리자에게 요청해 주세요.",
} as const;

/**
 * 권한 확인. `denied/permission` 과 `denied/unavailable` 을 **다른 문장**으로 돌려준다 —
 * 「권한이 없다」와 「지금 확인이 안 된다」는 사용자가 할 행동이 다르기 때문이다
 * (`lib/perm/guard.ts` 머리말과 같은 규약). 판정 불능은 허용으로 승격하지 않는다.
 */
async function requirePermission(ctx: Ctx, scopeKey: keyof typeof DENIED): Promise<void> {
  const guard = await loadPermGuard(ctx.org.id, `structure.${scopeKey}`);
  if (guard.kind === "allowed") return;
  throw new PresetActionError(
    guard.reason === "permission" ? DENIED[scopeKey] : "권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
}

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new PresetActionError("요청 정보가 올바르지 않습니다.");
  return value;
}

/**
 * 오류를 화면 상태로 바꾼다.
 *
 * **내가 쓴 문장만 사용자에게 보여준다**(`PresetActionError`). 그 밖의 것은 저장소·네트워크가
 * 던진 원문일 수 있어, 그대로 띄우면 스키마가 새고(§9.2) 사용자는 할 수 있는 일이 없다.
 * 원문을 버리지는 않고 **서버 로그로만** 남긴다 — 디버깅에는 필요하고 화면에는 필요 없다.
 */
function failure(error: unknown): GroupPresetActionState {
  if (error instanceof PresetActionError) return { ok: false, message: error.message };
  console.error("[BBE-174] 아이템 프리셋 처리 실패", error);
  return { ok: false, message: "아이템 프리셋을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

/**
 * 요청에 묶인 저장소 하나에서 서비스와 프리셋 저장소를 **같이** 만든다.
 *
 * `createRequestBoards()` 를 쓰는 이유는 두 가지다. 이 화면(`boards/[id]/page.tsx`)이 이미
 * 같은 함수로 보드를 읽으므로 **같은 인증 클라이언트**를 타야 RLS 판정이 갈리지 않고,
 * `getBoardsRepo()` 를 직접 부르면 `scripts/check-production-repo-boundaries.mjs` 의
 * 프로덕션 경계(로컬 저장소가 화면 체인에 새로 섞이는 것)를 새로 위반하게 된다.
 */
async function deps() {
  const { repo, service } = await createRequestBoards();
  return { service, presets: new SectionPresetRepo(repo) };
}

/**
 * ① 저장 — 지금 이 그룹에 보이는 구조를 새 아이템 프리셋으로 만든다.
 *
 * 스냅샷 대상은 «보드 기본 순서» 가 아니라 **그 그룹의 해결된 순서**다. 그렇지 않으면
 * 사용자가 이 그룹에서 맞춰 둔 배치가 프리셋에 담기지 않아, 버튼이 «지금 보이는 이 구조»
 * 를 뜻하지 않게 된다.
 *
 * 멱등성: 화면이 폼마다 한 번 만든 `requestId` 로 저장 source 를 **결정적으로** 만들고,
 * 만들기 전에 같은 source 가 있는지 본다. 새로고침·더블클릭·재시도가 두 번째 프리셋을
 * 만들지 않는다(예전 `create` 는 매번 randomUUID 라 그대로 중복이 됐다).
 */
export async function saveGroupPresetAction(
  _previous: GroupPresetActionState,
  formData: FormData,
): Promise<GroupPresetActionState> {
  try {
    const ctx = await getSession();
    await requirePermission(ctx, "preset_edit");

    const boardId = required(formData, "boardId");
    const groupKey = required(formData, "groupKey");
    const requestId = required(formData, "requestId");
    const name = required(formData, "name");

    const { service, presets } = await deps();
    const source = groupPresetRequestSource(ctx.org.id, boardId, groupKey, requestId);

    // 재전송이면 여기서 끝난다 — 아무것도 만들지 않고 «이미 저장됨» 으로 답한다.
    const replayed = await presets.findBySource(ctx, source);
    if (replayed) {
      return { ok: true, message: `«${replayed.name}» 은 이미 저장돼 있습니다.` };
    }

    const detail = await service.getBoardDetail(ctx, boardId);
    const group = detail.groups.find((candidate) => candidate.id === groupKey);
    if (!group) throw new PresetActionError("이 아이템을 찾을 수 없습니다.");

    const ordered = resolveColumnOrder(detail.columns, getBoardColumnOrder(ctx.org.id, boardId)[groupKey]);
    await presets.create(ctx, snapshotGroupPreset(name, group, ordered), source);

    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/presets");
    return { ok: true, message: `«${name}» 으로 저장했습니다. 컬럼 ${ordered.length}개.` };
  } catch (error) {
    return failure(error);
  }
}

/**
 * ② 적용 — 프리셋 구조를 이 그룹에 입힌다.
 *
 * ★ 값 유실 0 의 실행부. 하는 일은 **두 가지뿐**이다.
 *   ⓐ 프리셋에만 있는 컬럼을 보드에 **추가**한다
 *   ⓑ 이 그룹의 컬럼 **배치 오버라이드**를 프리셋 순서로 저장한다
 *
 * 컬럼을 지우지 않고(`deleteColumn` 을 부르지 않는다), 이미 있는 컬럼의 타입·선택지·
 * 이동규칙을 덮어쓰지도 않는다(`updateColumn` 을 부르지 않는다). 셀 값은
 * `item_values.column_key` 로 컬럼 key 에 매달려 있으므로, key 를 지우지도 바꾸지도
 * 않는 한 값은 건드려지지 않는다. 배치는 board_columns 가 아니라 오버라이드에 저장하니
 * 다른 그룹에도 영향이 없다.
 *
 * 미리보기와 결과가 갈라질 수 없도록, 화면이 계산한 결과를 받지 않고 **서버가 같은
 * 순수 함수를 다시 부른다.**
 */
export async function applyGroupPresetAction(
  _previous: GroupPresetActionState,
  formData: FormData,
): Promise<GroupPresetActionState> {
  try {
    const ctx = await getSession();
    await requirePermission(ctx, "preset_edit");
    await requirePermission(ctx, "column_manage");

    const boardId = required(formData, "boardId");
    const groupKey = required(formData, "groupKey");
    const presetId = required(formData, "presetId");

    const { service, presets } = await deps();
    const preset = await presets.get(ctx, presetId);
    if (!preset) throw new PresetActionError("프리셋을 찾을 수 없습니다.");

    const before = await service.getBoardDetail(ctx, boardId);
    const preview = previewGroupPresetApply(
      preset.columns,
      before.columns,
      getBoardColumnOrder(ctx.org.id, boardId)[groupKey],
    );

    /*
     * 프리셋 순서대로 훑으며 **실제로 확보한 key** 를 모은다.
     * 이미 있는 컬럼은 그 key 를 그대로, 새로 만든 컬럼은 `addColumn` 이 돌려준 key 를 쓴다 —
     * `createColumn` 이 충돌 시 `_2` 를 붙일 수 있어서, 프리셋이 말한 key 를 그대로 믿으면
     * 보드에 없는 key 가 배치에 박힌다.
     */
    const existingKeys = new Set(before.columns.map((column) => column.key));
    const resolvedKeys: string[] = [];
    const seen = new Set<string>();
    let createdCount = 0;

    /*
     * ⚠ 이 루프는 **원자적이지 않다.** 컬럼을 하나씩 만들기 때문에, 도중에 실패하면 앞의 몇 개는
     * 이미 보드에 만들어져 있고 배치 저장(아래)에는 닿지 못한다.
     *
     * 되돌리지 않는다 — 되돌리려면 `deleteColumn` 을 불러야 하는데 그것이 이 카드에서 유일한
     * 값 파손 경로다(그 key 의 `item_values` 를 함께 지운다). **절반 남기더라도 값은 지킨다.**
     *
     * 대신 **절반 남았다는 사실을 사용자에게 그대로 말한다.** 다시 «적용» 을 누르면 이미 있는
     * key 는 위에서 건너뛰므로 **이어하기가 안전하다** — 중복 컬럼이 생기지 않는다.
     */
    try {
      for (const column of preset.columns) {
        if (seen.has(column.key)) continue;
        seen.add(column.key);

        if (existingKeys.has(column.key)) {
          resolvedKeys.push(column.key);
          continue;
        }
        const created = await service.addColumn(ctx, boardId, {
          key: column.key,
          label: column.label,
          type: column.type,
          source: column.source,
          rightPinned: column.rightPinned,
          options: column.options,
          width: column.width,
          moveRule: column.move_rule_jsonb,
          readOnly: column.is_readonly,
        });
        resolvedKeys.push(created.key);
        createdCount += 1;
      }
    } catch (error) {
      console.error("[BBE-174] 프리셋 적용 중 컬럼 추가 실패", error);
      throw new PresetActionError(
        createdCount > 0
          ? `적용을 마치지 못했습니다. 컬럼 ${createdCount}개는 이미 추가됐고 배치는 아직 바뀌지 않았습니다. 다시 «적용» 하면 이어서 진행합니다.`
          : "적용을 마치지 못했습니다. 바뀐 것은 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    setGroupColumnOrder(ctx.org.id, boardId, groupKey, appliedColumnOrder(resolvedKeys, before.columns));

    revalidatePath(`/boards/${boardId}`);
    return {
      ok: true,
      message: preview.added.length > 0
        ? `«${preset.name}» 을 적용했습니다. 컬럼 ${preview.added.length}개 추가 · 기존 ${preview.kept.length}개는 그대로 남겼습니다.`
        : `«${preset.name}» 순서로 배치했습니다. 컬럼을 새로 만들지 않았습니다.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * ③ 기본으로 되돌리기 — 이 그룹의 배치 오버라이드만 비운다.
 *
 * **«비우기» 지 «지우기» 가 아니다**(AGENTS.md §9.3). 컬럼도 값도 그대로 두고, 이 그룹이
 * 보드 기본 순서를 다시 따르게 할 뿐이다. 적용으로 새로 생긴 컬럼은 보드 구조의 일부가
 * 됐으므로 남는다 — 되돌리기가 구조를 줄이면 그것이야말로 §9.3 위반이다.
 */
export async function resetGroupPresetAction(
  _previous: GroupPresetActionState,
  formData: FormData,
): Promise<GroupPresetActionState> {
  try {
    const ctx = await getSession();
    await requirePermission(ctx, "column_manage");

    const boardId = required(formData, "boardId");
    const groupKey = required(formData, "groupKey");

    // 접근 권한 확인 겸 존재 확인 — 남의 조직 보드 id 로 오버라이드를 건드리지 못하게 한다.
    const { service } = await deps();
    await service.getBoardDetail(ctx, boardId);

    setGroupColumnOrder(ctx.org.id, boardId, groupKey, []);
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "이 아이템의 컬럼 배치를 기본으로 되돌렸습니다." };
  } catch (error) {
    return failure(error);
  }
}
