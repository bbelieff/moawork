import type PgBoss from "pg-boss";
import { Pool } from "pg";
import { registerDateScheduleWorker } from "./register.js";
import { PostgresDateScheduleStore, type DateScheduleQueryPort } from "./store.js";

export async function registerDateScheduleFromEnv(boss: PgBoss, env: NodeJS.ProcessEnv = process.env): Promise<{ stop(): Promise<void> } | null> {
  const connectionString=env.DATE_SCHEDULE_DATABASE_URL;
  if (!connectionString) return null;
  const pool=new Pool({connectionString,max:2});
  const db:DateScheduleQueryPort={query:(sql,values)=>pool.query(sql,values as unknown[])};
  try {
    const readiness=await db.query<{identity:string;row_security:string;can_dispatch:boolean;safe_attributes:boolean;membership_count:number;can_send_messages:boolean;can_send_esign:boolean}>(`select current_user identity,current_setting('row_security') row_security,
      has_function_privilege(current_user,'public.dispatch_due_board_column_date_schedules(integer)','execute') can_dispatch,
      not (r.rolsuper or r.rolinherit or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls) safe_attributes,
      (select count(*)::int from pg_auth_members m where m.member=r.oid) membership_count,
      has_function_privilege(current_user,'public.claim_message_outbox(integer,text,integer)','execute') can_send_messages,
      has_function_privilege(current_user,'public.list_queued_esign_requests(integer)','execute') can_send_esign
      from pg_roles r where r.rolname=current_user`);
    const row=readiness.rows[0];
    if(!row||row.identity!=="moawork_date_schedule_worker"||row.row_security!=="on"||!row.can_dispatch||!row.safe_attributes||row.membership_count!==0||row.can_send_messages||row.can_send_esign) throw new Error("date schedule constrained identity is not ready");
    await registerDateScheduleWorker(boss,new PostgresDateScheduleStore(db)); return {stop:()=>pool.end()};
  }
  catch(error){await pool.end();throw error;}
}
