import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardsRepo, ColumnPatch, NewBoard, NewColumn, NewGroup } from "@/lib/boards/store";
import type { Board, BoardColumn, BoardGroup } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { DEFAULT_TABS, ensureDefaultTabAdditive, ensureDefaultTabs } from "./install";
import { NEW_LEAD_TAB } from "./new-lead";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";

const opened: PGlite[] = [];
afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

async function setup() {
  const db = new PGlite(); opened.push(db);
  await db.exec(`
    create table boards(id text primary key default gen_random_uuid()::text,org_id text not null,name text not null,description text,icon text,source text,sort_order int not null default 0,created_by text,is_system boolean default false,detail_layout_jsonb jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),unique(org_id,source));
    create table board_groups(id text primary key default gen_random_uuid()::text,org_id text not null,board_id text not null,name text not null,color text,sort_order int not null default 0,detail_layout_jsonb jsonb);
    create table board_columns(id text primary key default gen_random_uuid()::text,org_id text not null,board_id text not null,key text not null,label text not null,type text not null,source text,options_jsonb jsonb,width int,right_pinned boolean default false,is_readonly boolean default false,move_rule_jsonb jsonb,sort_order int not null default 0,archived_at timestamptz,deleted_by text,unique(board_id,key));
    create table board_views(id text primary key default gen_random_uuid()::text,org_id text not null,board_id text not null,user_id text,name text not null,kind text not null,filters_jsonb jsonb not null default '{}',sort_jsonb jsonb not null default '[]',visible_columns_jsonb jsonb not null default '[]',shared boolean not null default false,unique(board_id,name));
    create table items(id text primary key,org_id text not null,board_id text not null,group_id text,title text,updated_at timestamptz default now());
    create table item_values(org_id text not null,item_id text not null,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
    create role authenticated;
    grant usage on schema public to authenticated;
    grant select,insert,update,delete on boards,board_groups,board_columns,board_views to authenticated;
    alter table boards enable row level security; alter table board_groups enable row level security; alter table board_columns enable row level security; alter table board_views enable row level security;
    create policy boards_read on boards for select to authenticated using(org_id=current_setting('app.org_id',true));
    create policy boards_write on boards for all to authenticated using(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin')) with check(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin'));
    create policy groups_read on board_groups for select to authenticated using(org_id=current_setting('app.org_id',true));
    create policy groups_write on board_groups for all to authenticated using(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin')) with check(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin'));
    create policy columns_read on board_columns for select to authenticated using(org_id=current_setting('app.org_id',true));
    create policy columns_write on board_columns for all to authenticated using(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin')) with check(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin'));
    create policy views_read on board_views for select to authenticated using(org_id=current_setting('app.org_id',true));
    create policy views_write on board_views for all to authenticated using(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin')) with check(org_id=current_setting('app.org_id',true) and current_setting('app.role',true) in ('owner','admin'));
  `);
  return db;
}

type Filter = { column: string; value: unknown; operator: "eq" | "like" | "is" };
class PgliteQuery {
  private action: "select"|"insert"|"update"|"delete" = "select";
  private payload: Record<string,unknown>|null = null;
  private filters: Filter[] = [];
  private ordering: string|null = null;
  private head = false;
  constructor(private db:PGlite,private table:string) {}
  select(_columns="*",options?:{count?:string;head?:boolean}){this.head=options?.head??false;return this;}
  insert(payload:Record<string,unknown>){this.action="insert";this.payload=payload;return this;}
  update(payload:Record<string,unknown>){this.action="update";this.payload=payload;return this;}
  delete(){this.action="delete";return this;}
  eq(column:string,value:unknown){this.filters.push({column,value,operator:"eq"});return this;}
  like(column:string,value:unknown){this.filters.push({column,value,operator:"like"});return this;}
  is(column:string,value:null){this.filters.push({column,value,operator:"is"});return this;}
  order(column:string){this.ordering=column;return this;}
  async single(){const result=await this.run();return {...result,data:Array.isArray(result.data)?result.data[0]??null:result.data};}
  async maybeSingle(){return this.single();}
  then(resolve:(value:{data:unknown;error:null;count?:number})=>unknown,reject?:(reason:unknown)=>unknown){return this.run().then(resolve,reject);}
  private async run(){
    const allowed=new Set(["boards","board_groups","board_columns","board_views"]);if(!allowed.has(this.table))throw new Error("table denied");
    const values:unknown[]=[];const where=this.filters.length?" where "+this.filters.map(filter=>{if(filter.operator==="is")return `"${filter.column}" is null`;values.push(filter.value);return `"${filter.column}" ${filter.operator==="eq"?"=":"like"} $${values.length}`;}).join(" and "):"";
    if(this.action==="select"){const result=await this.db.query<Record<string,unknown>>(`select * from ${this.table}${where}${this.ordering?` order by "${this.ordering}"`:""}`,values);return {data:this.head?null:result.rows,error:null,count:result.rows.length};}
    if(this.action==="insert"){const entries=Object.entries(this.payload??{});for(const [,value] of entries)values.push(value);const start=values.length-entries.length+1;const sql=`insert into ${this.table}(${entries.map(([key])=>`"${key}"`).join(",")}) values(${entries.map((_,i)=>`$${start+i}`).join(",")}) returning *`;return {data:(await this.db.query(sql,values)).rows,error:null};}
    if(this.action==="update"){const entries=Object.entries(this.payload??{});const setValues=entries.map(([,value])=>{values.push(value);return `$${values.length}`;});const sql=`update ${this.table} set ${entries.map(([key],i)=>`"${key}"=${setValues[i]}`).join(",")}${where} returning *`;return {data:(await this.db.query(sql,values)).rows,error:null};}
    return {data:(await this.db.query(`delete from ${this.table}${where} returning *`,values)).rows,error:null};
  }
}
function supabaseRepo(db:PGlite){return new SupabaseBoardsRepo({from:(table:string)=>new PgliteQuery(db,table)} as never);}

function pgliteRepo(db: PGlite): BoardsRepo {
  const writable = (ctx: Ctx) => { if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("RLS denied"); };
  const rows = async <T>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const implementation: Partial<BoardsRepo> = {
    async listBoards(ctx) { return rows<Board>("select *,false is_system,null::jsonb detail_layout_jsonb,now()::text created_at,now()::text updated_at,null::text created_by from boards where org_id=$1 order by sort_order",[ctx.org.id]); },
    async createBoard(ctx,input:NewBoard) { writable(ctx); const id=crypto.randomUUID(); const n=(await rows<{n:number}>("select count(*)::int n from boards where org_id=$1",[ctx.org.id]))[0].n; return (await rows<Board>("insert into boards(id,org_id,name,description,icon,source,sort_order) values($1,$2,$3,$4,$5,$6,$7) returning *",[id,ctx.org.id,input.name,input.description??null,input.icon??null,input.source??null,n]))[0]; },
    async listGroups(ctx,boardId) { return rows<BoardGroup>("select *,null::jsonb detail_layout_jsonb from board_groups where org_id=$1 and board_id=$2 order by sort_order",[ctx.org.id,boardId]); },
    async createGroup(ctx,boardId,input:NewGroup) { writable(ctx); const id=crypto.randomUUID(); const n=(await rows<{n:number}>("select count(*)::int n from board_groups where org_id=$1 and board_id=$2",[ctx.org.id,boardId]))[0].n; return (await rows<BoardGroup>("insert into board_groups(id,org_id,board_id,name,color,sort_order) values($1,$2,$3,$4,$5,$6) returning *",[id,ctx.org.id,boardId,input.name,input.color??null,n]))[0]; },
    async deleteGroup(ctx,id) { writable(ctx); return (await rows("delete from board_groups where org_id=$1 and id=$2 returning id",[ctx.org.id,id])).length===1; },
    async listColumns(ctx,boardId) { return rows<BoardColumn>("select *,right_pinned as \"rightPinned\" from board_columns where org_id=$1 and board_id=$2 order by sort_order",[ctx.org.id,boardId]); },
    async createColumn(ctx,boardId,input:NewColumn) { writable(ctx); const id=crypto.randomUUID(); const n=(await rows<{n:number}>("select count(*)::int n from board_columns where org_id=$1 and board_id=$2",[ctx.org.id,boardId]))[0].n; return (await rows<BoardColumn>("insert into board_columns values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13) returning *,right_pinned as \"rightPinned\"",[id,ctx.org.id,boardId,input.key!,input.label,input.type,input.source??"in",JSON.stringify(input.options?{options:input.options}:null),input.width??null,input.rightPinned??false,input.readOnly??false,JSON.stringify(input.moveRule??null),n]))[0]; },
    async updateColumn(ctx,id,patch:ColumnPatch) { writable(ctx); return (await rows<BoardColumn>("update board_columns set options_jsonb=case when $3::boolean then $4::jsonb else options_jsonb end,move_rule_jsonb=case when $5::boolean then $6::jsonb else move_rule_jsonb end where org_id=$1 and id=$2 returning *,right_pinned as \"rightPinned\"",[ctx.org.id,id,patch.options!==undefined,JSON.stringify(patch.options?{options:patch.options}:null),patch.moveRule!==undefined,JSON.stringify(patch.moveRule??null)]))[0]; },
    async listItems() { return []; }, async updateItem() { return undefined; },
  };
  return implementation as BoardsRepo;
}

const owner=(orgId:string):Ctx=>({org:{id:orgId,name:orgId,plan_tier:"free",created_at:"2026-08-16"},user:{id:"creator",name:"Creator",email:null,avatar_url:null,created_at:"2026-08-16"},role:"owner",scope:"all"});

describe("default-tab bootstrap PGlite boundary",()=>{
  it("BBE-184 additive repair preserves persisted rows/values and fills industry",async()=>{
    const db=await setup();const ctx=owner("org-a");const repo=pgliteRepo(db);
    const partial=await repo.createBoard(ctx,{name:NEW_LEAD_TAB.name,source:NEW_LEAD_TAB.source});
    const group=await repo.createGroup(ctx,partial.id,{name:NEW_LEAD_TAB.groups[0].name,color:NEW_LEAD_TAB.groups[0].color});
    await repo.createColumn(ctx,partial.id,{key:NEW_LEAD_TAB.columns[0].key,label:"customer label",type:NEW_LEAD_TAB.columns[0].type,source:NEW_LEAD_TAB.columns[0].source});
    const other=await repo.createBoard(ctx,{name:"other",source:"user.board/other"});
    await db.query("insert into items values($1,$2,$3,$4,$5,now())",["item-a",ctx.org.id,partial.id,group.id,"keep"]);
    await db.query("insert into item_values values($1,$2,$3,$4::jsonb)",[ctx.org.id,"item-a",NEW_LEAD_TAB.columns[0].key,JSON.stringify({keep:true})]);
    const beforeRows=(await db.query("select * from items order by id")).rows;
    const beforeValues=(await db.query("select * from item_values order by item_id,column_key")).rows;
    const beforeOther=(await db.query("select * from boards where id=$1",[other.id])).rows;
    await ensureDefaultTabAdditive(ctx,NEW_LEAD_TAB,repo,[{userId:"creator",displayName:"Creator"}]);
    const firstCount=(await db.query<{n:number}>("select ((select count(*) from board_groups where board_id=$1)+(select count(*) from board_columns where board_id=$1))::int n",[partial.id])).rows[0].n;
    await ensureDefaultTabAdditive(ctx,NEW_LEAD_TAB,pgliteRepo(db),[{userId:"creator",displayName:"Creator"}]);
    const secondCount=(await db.query<{n:number}>("select ((select count(*) from board_groups where board_id=$1)+(select count(*) from board_columns where board_id=$1))::int n",[partial.id])).rows[0].n;
    expect(secondCount).toBe(firstCount);
    expect((await db.query("select key from board_columns where board_id=$1 and key='industry'",[partial.id])).rows).toHaveLength(1);
    expect(await db.query("select * from items order by id").then(result=>result.rows)).toEqual(beforeRows);
    expect(await db.query("select * from item_values order by item_id,column_key").then(result=>result.rows)).toEqual(beforeValues);
    expect(await db.query("select * from boards where id=$1",[other.id]).then(result=>result.rows)).toEqual(beforeOther);
  });

  it("repairs four persisted shells, reloads idempotently, and isolates tenant/member",async()=>{
    const db=await setup(); const ctx=owner("org-a"); const first=pgliteRepo(db);
    for(const tab of DEFAULT_TABS) await first.createBoard(ctx,{name:tab.name,source:tab.source});
    await first.createGroup(ctx,(await first.listBoards(ctx))[0].id,{name:DEFAULT_TABS[0].groups[0].name});
    await ensureDefaultTabs(ctx,first,[{userId:"creator",displayName:"Creator"}]);
    const boards=await first.listBoards(ctx); expect(boards.map(b=>b.source)).toEqual(DEFAULT_TABS.map(t=>t.source));
    for(const tab of DEFAULT_TABS){const board=boards.find(b=>b.source===tab.source)!;const expectedGroups=tab.groups.filter(group=>group.assigneeSlot===undefined||group.assigneeSlot===0).length;expect(await first.listGroups(ctx,board.id)).toHaveLength(expectedGroups);expect(await first.listColumns(ctx,board.id)).toHaveLength(tab.columns.length);}
    const contact=boards.find(b=>b.source===DEFAULT_TABS[1].source)!;const ownerColumn=(await first.listColumns(ctx,contact.id)).find(c=>c.key==="owner")!;expect(JSON.stringify(ownerColumn.options_jsonb)).toContain("creator");
    const before=(await db.query<{n:number}>("select ((select count(*) from boards)+(select count(*) from board_groups)+(select count(*) from board_columns))::int n")).rows[0].n;
    await ensureDefaultTabs(ctx,pgliteRepo(db),[{userId:"creator",displayName:"Creator"}]);
    const after=(await db.query<{n:number}>("select ((select count(*) from boards)+(select count(*) from board_groups)+(select count(*) from board_columns))::int n")).rows[0].n;expect(after).toBe(before);
    expect(await pgliteRepo(db).listBoards(owner("org-b"))).toHaveLength(0);
    await expect(pgliteRepo(db).createBoard({...ctx,role:"member"},{name:"denied"})).rejects.toThrow("RLS denied");
    expect(await first.listBoards(ctx)).toHaveLength(4);
  });

  it("runs the production SupabaseBoardsRepo mapping against persisted PGlite rows",async()=>{
    const db=await setup();await db.exec("set role authenticated; select set_config('app.org_id','org-a',false); select set_config('app.role','owner',false);");const ctx=owner("org-a");const repo=supabaseRepo(db);
    await ensureDefaultTabs(ctx,repo,[{userId:"creator",displayName:"Creator"},{userId:"member-2",displayName:"Member 2"}]);
    const first=await repo.listBoards(ctx);expect(first.map(board=>board.source)).toEqual(DEFAULT_TABS.map(tab=>tab.source));
    const contact=first.find(board=>board.source===DEFAULT_TABS[1].source)!;
    expect(JSON.stringify((await repo.listColumns(ctx,contact.id)).find(column=>column.key==="owner")?.options_jsonb)).toContain("member-2");
    const reloaded=supabaseRepo(db);await ensureDefaultTabs(ctx,reloaded,[{userId:"creator",displayName:"Creator"},{userId:"member-2",displayName:"Member 2"}]);
    expect(await reloaded.listBoards(owner("org-b"))).toHaveLength(0);
    await db.exec("select set_config('app.role','member',false)");
    await expect(reloaded.createBoard({...ctx,role:"member"},{name:"denied"})).rejects.toThrow();
    await db.exec("select set_config('app.role','owner',false)");
    expect(await reloaded.listBoards(ctx)).toHaveLength(4);
  });
});
