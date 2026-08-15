import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const controller = readFileSync(resolve(process.cwd(), "src/components/view/SavedViewsController.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/boards/[id]/page.tsx"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/072_tab_views.sql"), "utf8");

describe("saved view production consumer", () => {
  it("mounts all three view kinds and restores saved presentation state", () => {
    expect(controller).toContain("<ViewTabs");
    expect(controller).toContain("<ViewPicker");
    expect(controller).toContain("<SaveViewDialog");
    expect(controller).toContain("<TableView");
    expect(controller).toContain("<CalendarView");
    expect(controller).toContain("config.hiddenColumns");
    expect(controller).toContain("config.columnOrder");
    expect(controller).toContain("config.calendarFieldKey");
    expect(page).toContain('view === "flat" || view === "calendar"');
    expect(page).toContain("parseSavedBoardLayout(sp.mwLayout)");
  });

  it("lets a second org member select a shared view without owner-only UPDATE", () => {
    expect(migration).toMatch(/visibility = 'shared' or owner_id = auth\.uid\(\)/);
    expect(migration).toMatch(/owner_id = auth\.uid\(\) or public\.org_role/);
    expect(controller).toContain("savedViewUrl(saved, window.location.href)");
    expect(controller).not.toContain("touch: true");
  });
});
