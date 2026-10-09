"use client";

import type { ReactNode } from "react";
import { TabSettingsDialog } from "@/components/board/TabSettingsDialog";
import { TabSettingsGeneral } from "@/components/board/TabSettingsGeneral";
import { TabSettingsStages } from "@/components/board/TabSettingsStages";
import type { TabStageRow } from "@/lib/boards/tab-settings";

/**
 * 시각 픽스처의 「탭 설정」 (#845 — 옛 「⚙ 보드 설정」 자리). 제품 대화상자와 칸을 그대로 그리고
 * 저장소 경계만 바꾼다: 일반 칸의 저장은 브라우저 저장소에 남겨 다시 읽은 뒤에도 «저장됨» 을 잰다.
 * 단계 칸은 순서·이름·추가를 화면 안에서만 받는다(픽스처에는 보드 저장소가 없다).
 */
const VISUAL_SETTINGS_SAVED_KEY = "visual-settings-saved";

function remember() {
  try {
    localStorage.setItem(VISUAL_SETTINGS_SAVED_KEY, "1");
  } catch {
    // 저장소가 막힌 브라우저 — 저장 유지 검사만 실패하고 화면은 그대로 동작한다.
  }
}

export function VisualSettingsSlot({
  board,
  stages,
  stageNote,
  fields,
  subtitles,
}: {
  board: { id: string; name: string; icon: string | null; source: string | null; description: string | null };
  stages: readonly TabStageRow[];
  stageNote: string | null;
  fields: ReactNode;
  subtitles: { general: string; fields: string; stages: string };
}) {
  return (
    <TabSettingsDialog
      subtitles={subtitles}
      general={(
        <TabSettingsGeneral
          boardId={board.id}
          name={board.name}
          icon={board.icon}
          source={board.source}
          description={board.description}
          renameAction={async (_boardId, value) => {
            remember();
            return { ok: true, name: value };
          }}
          identityAction={async (_boardId, patch) => {
            remember();
            return { ok: true, ...patch };
          }}
        />
      )}
      fields={fields}
      stages={(
        <TabSettingsStages
          boardId={board.id}
          stages={stages}
          note={stageNote}
          reorderAction={async () => remember()}
          renameAction={async (_boardId, _groupId, value) => {
            remember();
            return { ok: true, name: value };
          }}
          addAction={async () => remember()}
        />
      )}
    />
  );
}
