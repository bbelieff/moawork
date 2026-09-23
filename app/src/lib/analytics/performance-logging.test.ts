import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/app/(app)/(tabs)/newcust/page.tsx",
  "src/app/(app)/boards/[id]/page.tsx",
  "src/app/(app)/boards/new-lead-actions.ts",
];

describe("BBE-214 production performance logging", () => {
  it("records only bounded route phases without tenant or customer payloads", () => {
    const source = files.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(source).toContain('event: "mw.performance"');
    expect(source).toContain('route: "newcust_entry"');
    expect(source).toContain('route: "board_detail"');
    expect(source).toContain('route: "new_lead_create"');

    const logBlocks = source.match(/console\.info\(JSON\.stringify\(\{[\s\S]*?\}\)\);/gu) ?? [];
    expect(logBlocks).toHaveLength(3);
    for (const block of logBlocks) {
      expect(block).not.toMatch(/orgId|org_id|userId|user_id|boardId|board_id|title|slug|email|phone/u);
    }
  });

  it("board correlation accepts only a UUID and never claims transport first-byte or finish timing", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/(app)/boards/[id]/page.tsx"), "utf8");
    expect(source).toContain("TRACE_ID_PATTERN");
    expect(source).toContain('normalizeTraceId(requestHeaders.get("x-mw-trace-id"))');
    expect(source).toContain('...(traceId ? { trace_id: traceId } : {})');
    expect(source).toContain('const REQUEST_START_HEADER = "x-mw-request-start-ms"');
    expect(source).toContain("normalizeRequestStartedAt(requestHeaders.get(REQUEST_START_HEADER))");
    expect(source).toContain("request_elapsed_at_pre_return_ms");
    expect(source).not.toMatch(/first_byte_ms|finish_ms/u);
    expect(source).toContain("permission_guard");
    expect(source).toContain("scoped_items_guard");
    expect(source).toContain("post_snapshot_tail_reads");
    expect(source).toContain("pre_return");
  });
});
