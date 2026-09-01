import type { Ctx, FieldDef, FieldType } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { FEATURES } from "@/lib/product";
import type { Repo } from "@/lib/repo";

function localPresetRepo(): Repo {
  if (process.env.NODE_ENV !== "production") return getRepo();
  throw new Error("Production preset installation must use the workspace bootstrap port");
}

// 정책자금 업종팩(ind.policyfund) 프리셋 설치 — 온보딩 "업종팩 선택" 단계에서 호출.
// 딜(deal)에 정책자금용 커스텀필드를 전개하고 엔타이틀먼트를 켠다.
//
// 여기 선택지는 대표값(요약)이다. 전체 라벨(지역 218·진행상품 60여 등)은 002_seed_
// policyfund.sql(industry_modules.presets_jsonb)에서 로드해 채운다 — T09 로더와 연동 예정.

interface PresetField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

const POLICYFUND_DEAL_FIELDS: PresetField[] = [
  {
    key: "agency",
    label: "진행기관",
    type: "select",
    options: ["중진공", "소진공", "신용보증기금", "기술보증기금", "지역신보"],
  },
  {
    key: "fund_name",
    label: "세부자금",
    type: "select",
    options: ["운전자금", "시설자금", "창업자금", "혁신성장자금"],
  },
  {
    key: "region",
    label: "지역",
    type: "select",
    options: ["서울", "경기", "인천", "부산", "대구"],
  },
  { key: "exec_amount", label: "실행액", type: "number" },
  { key: "fee_pct", label: "수수료(%)", type: "number" },
  {
    key: "contract_status",
    label: "계약상황",
    type: "select",
    options: ["미작성", "작성중", "작성완료", "체결"],
  },
  { key: "fee_paid_at", label: "수수료 입금일", type: "date" },
];

export function installPolicyfundPreset(ctx: Ctx): FieldDef[] {
  const repo = localPresetRepo();

  // 엔타이틀먼트 ON (업종팩 설치 = 기능 활성)
  repo.setEntitlement(ctx.org.id, FEATURES.policyfund, true);

  const existing = repo.listFieldDefs(ctx.org.id, "deal");
  const created: FieldDef[] = [];

  POLICYFUND_DEAL_FIELDS.forEach((f, i) => {
    const dup = existing.some(
      (d) => d.key === f.key && d.module_key === FEATURES.policyfund,
    );
    if (dup) return; // 재설치 idempotent

    created.push(
      repo.createFieldDef({
        org_id: ctx.org.id,
        entity: "deal",
        key: f.key,
        label: f.label,
        type: f.type,
        options_jsonb: f.options
          ? {
              options: f.options.map((label, idx) => ({
                id: `${f.key}-${idx}`,
                label,
                order: idx,
              })),
            }
          : null,
        module_key: FEATURES.policyfund,
        sort_order: i,
      }),
    );
  });

  return created;
}
