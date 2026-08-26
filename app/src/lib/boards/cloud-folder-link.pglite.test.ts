import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { inspectCloudFolderUrl } from "./cloud-folder-link";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/132_issue574_cloud_folder_link.sql"),
  "utf8",
);
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("Issue #574 canonical cloud folder persistence", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create table orgs(id uuid primary key);
      create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid not null);
      create table items(id uuid primary key,org_id uuid not null,board_id uuid not null,assigned_to uuid,deleted_at timestamptz);
      create table board_item_detail_links(
        id uuid primary key default gen_random_uuid(),
        org_id uuid not null references orgs(id),
        board_id uuid not null references boards(id),
        item_id uuid not null references items(id),
        created_by uuid references users(id),
        label text not null check(length(btrim(label)) between 1 and 200),
        url text not null check(url ~ '^https://'),
        request_id uuid not null,
        created_at timestamptz not null default now(),
        unique(org_id,request_id)
      );
      create function public.effective_permission(p_org uuid,p_permission text)
        returns boolean language sql stable
        as $$select exists(
          select 1 from public.org_members
           where org_id=p_org and user_id=auth.uid() and status='active'
        ) and p_permission='work.item_upsert'
          and coalesce(current_setting('test.permission.allowed',true),'true')='true'$$;
      create function public.begin_guarded_migration(
        p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
        p_executor text,p_thread_id text,p_foundation boolean
      ) returns void language sql as $$select$$;
      insert into orgs values('${id(1)}'),('${id(2)}');
      insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
      insert into org_members values
        ('${id(1)}','${id(10)}','owner','all','active'),
        ('${id(1)}','${id(11)}','member','assigned','active'),
        ('${id(1)}','${id(13)}','member','assigned','active'),
        ('${id(2)}','${id(12)}','owner','all','active');
      insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
      insert into items values
        ('${id(30)}','${id(1)}','${id(20)}','${id(11)}',null),
        ('${id(31)}','${id(1)}','${id(20)}','${id(10)}',null),
        ('${id(32)}','${id(2)}','${id(21)}','${id(12)}',null);
      insert into board_item_detail_links(org_id,board_id,item_id,created_by,label,url,request_id)
        values('${id(1)}','${id(20)}','${id(30)}','${id(10)}','기존 견적 폴더','https://legacy.example.com/folders/quote','${id(100)}');
    `);
    await db.exec(migration);
  });

  async function actor(userId: string) {
    await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
  }

  it("keeps legacy rows untouched and maintains exactly one cloud folder across edits and replay", async () => {
    const legacyBefore = (await db.query<{ label: string; url: string; link_kind: string | null }>(
      "select label,url,link_kind from board_item_detail_links where request_id=$1",
      [id(100)],
    )).rows[0];
    await actor(id(10));
    await db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "google_drive", "first", id(101),
    ]);
    await db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "dropbox", "scl/fo/second/share", id(102),
    ]);
    await db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "dropbox", "scl/fo/second/share", id(102),
    ]);

    expect((await db.query<{ count: number; url: string }>(
      "select count(*)::int count,max(url) url from board_item_detail_links where link_kind='cloud_folder'",
    )).rows[0]).toEqual({ count: 1, url: "https://www.dropbox.com/scl/fo/second/share" });
    expect((await db.query(
      "select label,url,link_kind from board_item_detail_links where request_id=$1",
      [id(100)],
    )).rows[0]).toEqual(legacyBefore);

    await db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), null, null, id(103),
    ]);
    await db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), null, null, id(103),
    ]);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from board_item_detail_links where link_kind='cloud_folder'",
    )).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from board_item_detail_links where link_kind is null",
    )).rows[0].count).toBe(1);
  });

  it("passes only provider references to the database canonical URL builder", async () => {
    const examples = [
      "https://drive.google.com/drive/folders/folder-id",
      "https://onedrive.live.com/?id=root%21folder&cid=drive-id",
      "https://tenant.sharepoint.com/sites/team/Forms/AllItems.aspx?id=%2FShared%20Documents%2FClient%20Folder",
      "https://tenant.sharepoint.com/:F:/g/team/folder",
      "https://www.dropbox.com/scl/fo/folder-id/example",
      "https://cloud.example.com/folders/Client%20Folder",
      "https://cloud.example.com/?folder=Client+Folder",
      "https://example.com/?folder=%2B",
      "https://example.com/?folder=client&preview=contract.pdf",
      "https://drive.google.com/drive/folders/%00",
      "https://drive.google.com/drive/folders/.",
      "https://drive.google.com/drive/folders/..",
      "https://drive.google.com/drive/folders/client/%7F/final",
      "https://onedrive.live.com/?id=abc%00def",
      "https://onedrive.live.com/?id=.",
      "https://onedrive.live.com/?id=..",
      "https://onedrive.live.com/?id=contract%25252Epdf",
      "https://onedrive.live.com/?id=%252520",
      "https://example.com/?folder=+%20",
      "https://example.com/folders/%ZZ",
      "https://example.com%2Ffolders%2Fclient",
      "https://drive.google.com%2Fdrive%2Ffolders%2Ffolder-id",
      "https://example.com/folders%2Fclient",
      "https://cloud.example.com/a%2Ffolders%2Fclient",
      "https://example.com/path%3Ffolder=client",
      "https://example.com/?ordinary=x%26folder=client",
      "https://example.com:99999/folders/client",
      "https://drive.google.com:8443/folders/fake",
      "https://onedrive.live.com:8443/?folder=fake",
      "https://www.dropbox.com:8443/folders/fake",
      "https://example.com/folders/contract%252Epdf",
      "https://tenant.sharepoint.com/:f:/g/team/%20",
      "https://tenant.sharepoint.com/:f:/g/team/%C2%A0",
      "https://tenant.sharepoint.com/:f:/g/team/%E2%80%83",
      "https://tenant.sharepoint.com/:f:/g/team/%E3%80%80",
      "https://example.com/folders/contract%2Epdf%20",
      "https://example.com/folders/contract.pdf%C2%A0",
      "https://example.com/folders/client/%1F/final",
      "https://example.com/folders/client/../../ordinary",
      "https://example.com/folders/client\\..\\..\\ordinary",
      "https://example.com/?folder=%252520",
      "https://example.com/path#?folder=client",
      "https://onedrive.live.com/#?id=folder",
      "https://example.com/path#&directory=client",
      "https://drive.google.com/DRIVE/FOLDERS/id",
      "https://www.dropbox.com/SCL/FO/id/example",
      "https://onedrive.live.com/?ID=folder",
      "https://example.com/?FOLDER=client",
      "https://example.com/?%2566older=client",
      "https://onedrive.live.com/?%2569d=folder",
      "https://example.com/an-ordinary-page",
    ];
    for (const raw of examples) {
      const inspected = inspectCloudFolderUrl(raw);
      if (!inspected.ok) continue;
      const databaseUrl = (await db.query<{ url: string | null }>(
        "select canonical_cloud_folder_url($1,$2) url",
        [inspected.provider, inspected.folderRef],
      )).rows[0].url;
      expect(databaseUrl, raw).toBe(inspected.url);
    }
    for (const [provider, folderRef] of [
      ["cloud_folder", "folders/client"],
      ["google_drive", "../ordinary"],
      ["google_drive", "contract.pdf"],
      ["onedrive", "short:../ordinary"],
      ["onedrive", "live:folder:"],
      ["onedrive", "sharepoint|999.999.999.999|:f:/g/team/client"],
      ["onedrive", "sharepoint|tenant|:f:////"],
      ["dropbox", "scl/fo/client/contract.pdf"],
      ["dropbox", "scl/fo/client/../../ordinary"],
      ["dropbox", "scl/fo"],
      ["dropbox", "scl/fo////"],
    ]) {
      expect((await db.query<{ url: string | null }>(
        "select canonical_cloud_folder_url($1,$2) url",
        [provider, folderRef],
      )).rows[0].url, `${provider}:${folderRef}`).toBeNull();
    }
  });

  it("rejects files, unsafe schemes, cross-org access and an unassigned member", async () => {
    await actor(id(10));
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "https://example.com/files/contract.pdf",
      "https://drive.google.com/drive/folders/",
      "https://drive.google.com/drive/folders/%20",
      "https://drive.google.com/drive/folders/%00",
      "https://drive.google.com/drive/folders/.",
      "https://drive.google.com/drive/folders/..",
      "https://drive.google.com/drive/folders/client/contract%2Epdf",
      "https://drive.google.com/drive/folders/client/%7F/final",
      "https://onedrive.live.com/?id=contract.pdf",
      "https://onedrive.live.com/?id=contract.pdf%3Fdownload%3D1",
      "https://onedrive.live.com/?id=%00",
      "https://onedrive.live.com/?id=%1F",
      "https://onedrive.live.com/?id=abc%00def",
      "https://onedrive.live.com/?id=.",
      "https://onedrive.live.com/?id=..",
      "https://onedrive.live.com/?id=contract%25252Epdf",
      "https://onedrive.live.com/?id=%252520",
      "https://onedrive.live.com/?cid=only-a-drive-id",
      "https://tenant.sharepoint.com/sites/team/Forms/AllItems.aspx?id=contract.pdf",
      "https://tenant.sharepoint.com/:f:",
      "https://tenant.sharepoint.com/:f:////",
      "https://tenant.sharepoint.com/abc:f:def/g/team/folder",
      "https://tenant.sharepoint.com/:f:/g/team/%20",
      "https://tenant.sharepoint.com/:f:/g/team/%C2%A0",
      "https://tenant.sharepoint.com/:f:/g/team/%E2%80%83",
      "https://tenant.sharepoint.com/:f:/g/team/%E3%80%80",
      "https://example.com/folders/contract.pdf",
      "https://example.com/folders/contract%2Epdf",
      "https://example.com/folders/contract%2Epdf%20",
      "https://example.com/folders/contract.pdf%C2%A0",
      "https://example.com/folders/client/%1F/final",
      "https://example.com/folders/client/../../ordinary",
      "https://example.com/folders/client\\..\\..\\ordinary",
      "https://example.com/folders/%ZZ",
      "https://example.com%2Ffolders%2Fclient",
      "https://drive.google.com%2Fdrive%2Ffolders%2Ffolder-id",
      "https://example.com/folders%2Fclient",
      "https://cloud.example.com/a%2Ffolders%2Fclient",
      "https://example.com/path%3Ffolder=client",
      "https://example.com/?ordinary=x%26folder=client",
      "https://example.com:99999/folders/client",
      "https://drive.google.com:8443/folders/fake",
      "https://onedrive.live.com:8443/?folder=fake",
      "https://www.dropbox.com:8443/folders/fake",
      "https://www.dropbox.com/home/contract%2Epdf",
      "https://www.dropbox.com/scl/fo",
      "https://www.dropbox.com/sh",
      "https://www.dropbox.com/home",
      "https://example.com/?folder=%20",
      "https://example.com/?folder=%2520",
      "https://example.com/?folder=%252520",
      "https://example.com/?folder=+",
      "https://example.com/?folder=+%20",
      "https://example.com/?path=home",
      "https://example.com/path#?folder=client",
      "https://onedrive.live.com/#?id=folder",
      "https://example.com/path#&directory=client",
      "https://drive.google.com/DRIVE/FOLDERS/id",
      "https://www.dropbox.com/SCL/FO/id/example",
      "https://onedrive.live.com/?ID=folder",
      "https://example.com/?FOLDER=client",
      "https://example.com/?%2566older=client",
      "https://onedrive.live.com/?%2569d=folder",
      "https://999.999.999.999/folders/client",
      "https://example.com/ordinary-page",
    ]) {
      expect(inspectCloudFolderUrl(unsafe).ok, unsafe).toBe(false);
    }
    for (const [provider, folderRef] of [
      ["cloud_folder", "folders/client"],
      ["google_drive", "contract.pdf"],
      ["onedrive", "short:../ordinary"],
      ["onedrive", "sharepoint|tenant|:f:////"],
      ["dropbox", "scl/fo/client/contract.pdf"],
      ["dropbox", "scl/fo"],
      ["dropbox", "scl/fo////"],
    ]) {
      await expect(db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
        id(1), id(20), id(30), provider, folderRef, crypto.randomUUID(),
      ])).rejects.toThrow(/invalid_cloud_folder_reference/);
    }
    await actor(id(12));
    await expect(db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "google_drive", "cross-org", id(110),
    ])).rejects.toThrow(/permission_denied/);
    await actor(id(13));
    await expect(db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "google_drive", "unassigned", id(111),
    ])).rejects.toThrow(/permission_denied/);
    await actor(id(11));
    await db.exec("select set_config('test.permission.allowed','false',false)");
    await expect(db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "google_drive", "permission-denied", id(112),
    ])).rejects.toThrow(/permission_denied/);
    await db.exec("select set_config('test.permission.allowed','true',false)");
    await expect(db.query("select * from set_board_item_cloud_folder($1,$2,$3,$4,$5,$6)", [
      id(1), id(20), id(30), "google_drive", "assigned", id(113),
    ])).resolves.toBeTruthy();
  });

  it("leaves the request ledger private and grants only the authenticated RPC", async () => {
    expect((await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','public.set_board_item_cloud_folder(uuid,uuid,uuid,text,text,uuid)','EXECUTE') allowed",
    )).rows[0].allowed).toBe(true);
    for (const role of ["anon", "service_role"]) {
      expect((await db.query<{ allowed: boolean }>(
        `select has_function_privilege('${role}','public.set_board_item_cloud_folder(uuid,uuid,uuid,text,text,uuid)','EXECUTE') allowed`,
      )).rows[0].allowed).toBe(false);
    }
    for (const signature of [
      "public.canonical_cloud_folder_url(text,text)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect((await db.query<{ allowed: boolean }>(
          `select has_function_privilege('${role}','${signature}','EXECUTE') allowed`,
        )).rows[0].allowed).toBe(false);
      }
      const helper = (await db.query<{ definer: boolean; config: string }>(`
        select prosecdef definer,coalesce(array_to_string(proconfig,','),'') config
          from pg_proc where oid='${signature}'::regprocedure
      `)).rows[0];
      expect(helper.definer).toBe(false);
      expect(helper.config).toContain("search_path=");
      expect(helper.config).not.toContain("public");
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect((await db.query<{ allowed: boolean }>(
          `select has_table_privilege('${role}','public.board_item_cloud_folder_requests','${privilege}') allowed`,
        )).rows[0].allowed).toBe(false);
      }
    }
    for (const removedSignature of [
      "public.is_cloud_folder_url(text)",
      "public.decode_cloud_folder_url(text)",
    ]) {
      expect((await db.query<{ signature: string | null }>(
        "select to_regprocedure($1)::text signature",
        [removedSignature],
      )).rows[0].signature).toBeNull();
    }
    expect((await db.query<{ signature: string | null }>(
      "select to_regprocedure('public.set_board_item_cloud_folder(uuid,uuid,uuid,text,uuid)')::text signature",
    )).rows[0].signature).toBeNull();
    expect((await db.query<{ rls: boolean; forced: boolean }>(
      "select relrowsecurity rls,relforcerowsecurity forced from pg_class where oid='public.board_item_cloud_folder_requests'::regclass",
    )).rows[0]).toEqual({ rls: true, forced: true });
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from pg_policies where schemaname='public' and tablename='board_item_cloud_folder_requests'",
    )).rows[0].count).toBe(0);
    const procedure = (await db.query<{ definer: boolean; config: string }>(`
      select prosecdef definer,coalesce(array_to_string(proconfig,','),'') config
        from pg_proc
       where oid='public.set_board_item_cloud_folder(uuid,uuid,uuid,text,text,uuid)'::regprocedure
    `)).rows[0];
    expect(procedure.definer).toBe(true);
    expect(procedure.config).toContain("search_path=");
    expect(procedure.config).not.toContain("public");
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:items|item_values|companies|deals)\b/iu);
  });
});
