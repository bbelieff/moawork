import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardsRepo, ColumnPatch, NewBoard, NewColumn, NewGroup } from "@/lib/boards/store";
import type { Board, BoardColumn, BoardGroup } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { DEFAULT_TABS, ensureDefaultTabs } from "./install";

const opened: PGlite[] = [];
afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

async function setup() {
  const db = new PGlite(); opened.push(db);
  await db.exec(`
    create table boards(id text primary key,org_id text not null,name text not null,description text,icon text,source text,sort_order int not null default 0,unique(org_id,source));
    create table board_groups(id text primary key,org_id text not null,board_id text not null,name text not null,color text,sort_order int not null default 0);
    create table board_columns(id text primary key,org_id text not null,board_id text not null,key text not null,label text not null,type text not null,source text,options_jsonb jsonb,width int,right_pinned boolean,is_readonly boolean,move_rule_jsonb jsonb,sort_order int not null default 0,unique(board_id,key));
  `);
  return db;
}

function pgliteRepo(db: PGlite): BoardsRepo {
  const writable = (ctx: Ctx) => { if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("RLS denied"); };
  const rows = async <T>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const implementation: Partial<BoardsRepo> = {
    async listBoards(ctx) { return rows<Board>("select *,false is_system,null::jsonb detail_layout_jsonb,now()::text created_at,now()::text updated_at,null::text created_by from boards where org_id=$1 order by sort_order",[ctx.org.id]); },
    async createBoard(ctx,input:NewBoard) { writable(ctx); const id=crypto.randomUUID(); const n=(await rows<{n:number}>("select count(*)::int n from boards where org_id=$1",[ctx.org.id]))[0].n; return (await rows<Board>("insert into boards values($1,$2,$3,$4,$5,$6,$7) returning *,false is_system,null::jsonb detail_layout_jsonb,now()::text created_at,now()::text updated_at,null::text created_by",[id,ctx.org.id,input.name,input.description??null,input.icon??null,input.source??null,n]))[0]; },
    async listGroups(ctx,boardId) { return rows<BoardGroup>("select *,null::jsonb detail_layout_jsonb from board_groups where org_id=$1 and board_id=$2 order by sort_order",[ctx.org.id,boardId]); },
    async createGroup(ctx,boardId,input:NewGroup) { writable(ctx); const id=crypto.randomUUID(); const n=(await rows<{n:number}>("select count(*)::int n from board_groups where org_id=$1 and board_id=$2",[ctx.org.id,boardId]))[0].n; return (await rows<BoardGroup>("insert into board_groups values($1,$2,$3,$4,$5,$6) returning *,null::jsonb detail_layout_jsonb",[id,ctx.org.id,boardId,input.name,input.color??null,n]))[0]; },
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
});
