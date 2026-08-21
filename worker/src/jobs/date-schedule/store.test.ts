import { describe, expect, it, vi } from "vitest";
import { PostgresDateScheduleStore, type DateScheduleQueryPort } from "./store.js";

describe("date schedule constrained DB dispatcher",()=>{
  it("bounds a drain and reports replay duplicates without customer payloads",async()=>{
    const query=vi.fn(async()=>({rows:[{schedule_id:"s1",inserted:true},{schedule_id:"s1",inserted:false}]}));
    const db:DateScheduleQueryPort={query:query as DateScheduleQueryPort["query"]};
    await expect(new PostgresDateScheduleStore(db).dispatchDue(999)).resolves.toEqual({dispatched:1,duplicates:1});
    expect(query).toHaveBeenCalledWith("select * from public.dispatch_due_board_column_date_schedules($1)",[100]);
  });
});
