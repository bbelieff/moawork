import { describe,expect,it,vi } from "vitest";
import { registerDateScheduleFromEnv } from "./runtime.js";

vi.mock("pg",()=>({Pool:class {query=vi.fn(async()=>({rows:[{identity:"moawork_date_schedule_worker",row_security:"on",can_dispatch:true,safe_attributes:false,membership_count:1,can_send_messages:true,can_send_esign:false}]}));end=vi.fn(async()=>undefined);}}));

describe("date schedule runtime identity boundary",()=>{
  it("fails closed before queue registration for a correctly named but privileged database identity",async()=>{
    const boss={createQueue:vi.fn(),work:vi.fn(),schedule:vi.fn()};
    await expect(registerDateScheduleFromEnv(boss as never,{DATE_SCHEDULE_DATABASE_URL:"postgres://fixture"})).rejects.toThrow("constrained identity");
    expect(boss.createQueue).not.toHaveBeenCalled();
  });
});
