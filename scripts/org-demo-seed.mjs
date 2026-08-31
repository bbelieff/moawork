#!/usr/bin/env node
/**
 * 조직도 데모 인원 — 넣고 · 보고 · 지운다. (#640)
 *
 * ★ 왜 필요한가
 *   조직관리 화면은 «사람이 여럿 있어야» 비로소 보인다. 그런데 운영 DB 의 모든 워크스페이스가
 *   1명(대표 혼자)이고 부서는 0개다. 그래서 만든 사람도 총괄도 화면을 눈으로 확인할 수 없었다.
 *   AGENTS.md §3 은 「그 화면 주소를 열어 본 증거」를 완주 조건으로 요구한다 —
 *   이 도구가 그 증거를 만들 수 있게 한다.
 *
 * ★ 이것은 «제품» 이 아니다. 개발·검수용 도구다.
 *   CLAUDE.md 「빈 상태가 기본」은 그대로다. 새 워크스페이스는 여전히 0명·0부서로 시작한다.
 *   이 스크립트를 «돌려야만» 데모 인원이 생긴다. 제품 코드도 프리셋도 시드도 건드리지 않는다.
 *
 * ★ 고객 고유값 없음 (CLAUDE.md 절대 금지 ①)
 *   이름은 전부 「데모 …」 이고 메일은 예약 도메인 .invalid 다 — 실제로 존재할 수 없는 주소다.
 *   부서명도 업종 일반 명사이지 특정 회사의 부서가 아니다.
 *
 * ★ 로그인할 수 없는 계정이다 (CLAUDE.md 절대 금지 ②)
 *   public.users.id 는 auth.users.id 를 참조하므로 auth 행도 같이 만들어야 한다.
 *   다만 «들어올 수 있는 문» 을 하나도 열지 않는다:
 *     · encrypted_password 를 비운다        → 비밀번호 로그인 불가
 *     · email_confirmed_at 을 비운다        → 미확인 계정
 *     · 메일은 .invalid 예약 도메인(RFC 2606) → 메일이 도달할 수 없어 매직링크·재설정 불가
 *   즉 비밀번호도 토큰도 «만들지 않는다». 기록하거나 출력할 비밀값이 애초에 없다.
 *   auth.users 는 ON DELETE CASCADE 라 그 한 행만 지우면 public.users 까지 같이 사라진다.
 *
 * ★ 지울 때 «정확히 이것만» 지운다
 *   - 사람: 아래 DEMO_UUID 8개. 그 밖의 user_id 는 어떤 경우에도 손대지 않는다.
 *   - 부서: key 가 'demo:' 로 시작하는 것만. 그 밖의 부서는 어떤 경우에도 손대지 않는다.
 *   지우기 전에 «데모가 아닌 것이 데모를 참조하는지» 먼저 보고, 있으면 멈추고 알린다.
 *
 * 사용법
 *   node scripts/org-demo-seed.mjs --list                  워크스페이스 목록 (어디에 넣을지 고른다)
 *   node scripts/org-demo-seed.mjs --status --org <id|이름>  지금 무엇이 들어가 있나
 *   node scripts/org-demo-seed.mjs --apply  --org <id|이름>  데모 8명 + 부서 6개 넣기 (여러 번 돌려도 같다)
 *   node scripts/org-demo-seed.mjs --remove --org <id|이름>  그 워크스페이스에서 빼기
 *   node scripts/org-demo-seed.mjs --remove-all             모든 워크스페이스에서 빼고 데모 사람도 지우기
 *
 *   --org 는 uuid 또는 이름 일부로 찾는다. 이름이 여럿 걸리면 멈추고 후보를 보여 준다.
 *
 * 접속 문자열은 «파일에서만» 온다 — .env / .env.local 의 SUPABASE_DB_URL.
 * 이 스크립트는 접속 문자열을 절대 출력하지 않는다. 오류 메시지에서도 지운다.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const ENV_FILES = [".env.local", ".env"];
const URL_KEY = "SUPABASE_DB_URL";

/** 부서 표식. 지울 때의 «정확한 경계» 다. departments_key_check 정규식을 만족한다. */
const DEPT_KEY_PREFIX = "demo:";
/** 예약 도메인(RFC 2606). 실제로 존재할 수 없어 진짜 메일이 섞일 수 없다. */
const EMAIL_DOMAIN = "demo.invalid";

/** 고정 UUID. 「지울 때 정확히 이것만」을 성립시키는 장치다. */
const demoUuid = (n) => `de300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * 부서 6개 — 3단 깊이 · 최상위 둘 · 책임자 공석 하나.
 * 조직도가 그려야 하는 «모양» 을 한 화면에 전부 담는다.
 *
 *   영업본부                (책임자 있음)
 *     ├ 영업1팀             (책임자 있음)
 *     │   └ 신규영업파트     (책임자 있음)  ← 3단
 *     └ 영업2팀             ★ 책임자 공석
 *   경영지원본부            (책임자 있음)
 *     └ 총무팀              ★ 책임자 공석 · 겸직자가 들어온다
 */
const DEPARTMENTS = [
  { key: "sales", name: "영업본부", parent: null, sort: 0 },
  { key: "sales-1", name: "영업1팀", parent: "sales", sort: 0 },
  { key: "sales-new", name: "신규영업파트", parent: "sales-1", sort: 0 },
  { key: "sales-2", name: "영업2팀", parent: "sales", sort: 1 },
  { key: "support", name: "경영지원본부", parent: null, sort: 1 },
  { key: "support-ga", name: "총무팀", parent: "support", sort: 0 },
];

/**
 * 사람 8명 — 화면이 «말해야 하는 상태» 를 하나씩 맡는다.
 *
 * ★ role/scope 에 team_lead 와 department 를 일부러 섞는다.
 *   member-org-summary.ts 의 isRole 은 owner/admin/member 만, isScope 는 all/assigned 만
 *   통과시킨다. 즉 그 둘은 «요약에 안 들어오는» 값이다.
 *   PR #641 이 고친 「사람이 사라지는 표」가 정확히 이 지점이었다 —
 *   왼쪽 트리는 4명이라 하고 오른쪽 표는 2행이라 하는 상태.
 *   데모에 이 값을 넣어 두어야 그 회귀가 «눈에» 다시 잡힌다.
 */
const PEOPLE = [
  { n: 1, name: "데모 본부장", role: "admin", scope: "all", title: "영업본부장", dept: "sales", head: true },
  // ★ team_lead — 요약이 못 읽는 역할. 조직도에는 「확인 못 함」으로라도 남아야 한다.
  { n: 2, name: "데모 팀장", role: "team_lead", scope: "department", title: "영업1팀장", dept: "sales-1", head: true },
  { n: 3, name: "데모 파트장", role: "member", scope: "assigned", title: "파트장", dept: "sales-new", head: true },
  { n: 4, name: "데모 실장", role: "admin", scope: "all", title: "경영지원실장", dept: "support", head: true },
  { n: 5, name: "데모 사원A", role: "member", scope: "assigned", title: "주임", dept: "sales-1" },
  // ★ 겸직 — 영업1팀(주부서) + 총무팀. 두 부서 어디를 골라도 보여야 한다.
  { n: 6, name: "데모 사원B", role: "member", scope: "assigned", title: "사원", dept: "sales-1", also: ["support-ga"] },
  // ★ 비활성 + 요약이 못 읽는 scope. 인원 수에서 빠지되 표에서 사라지면 안 된다.
  { n: 7, name: "데모 사원C", role: "member", scope: "department", title: null, dept: "support-ga", status: "suspended" },
  // ★ 미배정 — 부서가 없다. unassignedCount 가 이 사람을 세야 한다.
  { n: 8, name: "데모 미배정", role: "member", scope: "assigned", title: null, dept: null },
];

/**
 * 보고 «예외» 1건 (013 member_hierarchy_assignments).
 * 부서 계통대로면 사원A 는 영업1팀장에게 보고한다. 예외를 걸어 실장에게 보내
 * reporting.ts 의 예외 갈래가 실제로 화면에 나타나는지 본다 — 그 모듈의 첫 화면 소비자다.
 */
const REPORTING_EXCEPTIONS = [{ member: 5, reportsTo: 4 }];

/**
 * 인원을 «마음대로 늘리고 줄인다».
 *
 * 1~8 은 위 PEOPLE 의 설계된 배역이다 — 화면이 말해야 하는 상태를 하나씩 맡고 있어서
 * 순서를 바꾸면 덮이는 상태가 생긴다. 9번부터는 부서에 골고루 흩어지는 «머릿수» 다.
 * ★ 지울 때는 --people 값과 무관하게 «이 40칸 전부» 를 훑는다.
 *   8명으로 줄인 뒤에도 전에 만든 20번이 남아 떠도는 일이 없어야 한다.
 */
const MAX_PEOPLE = 40;
const FILL_DEPTS = ["sales-1", "sales-2", "sales-new", "support-ga", "support", "sales"];

function personAt(n) {
  const core = PEOPLE.find((person) => person.n === n);
  if (core) return core;
  const index = n - PEOPLE.length - 1;
  return {
    n,
    name: `데모 사원${index + 1}`,
    role: "member",
    scope: "assigned",
    title: null,
    dept: FILL_DEPTS[index % FILL_DEPTS.length],
  };
}

/** 지우기의 «정확한 경계». 이 40개 밖의 user_id 는 어떤 경우에도 손대지 않는다. */
const DEMO_UUIDS = Array.from({ length: MAX_PEOPLE }, (_, index) => demoUuid(index + 1));

// ─────────────────────────────────────────────────────────────────────────────

function readConnectionString() {
  for (const name of ENV_FILES) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== URL_KEY) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return { value, source: name };
    }
  }
  return null;
}

/** 접속 문자열이 어떤 경로로든 화면에 새지 않게 지운다. */
function redact(text, secret) {
  if (!text) return text;
  let out = String(text);
  if (secret) out = out.split(secret).join(`<${URL_KEY}>`);
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<redacted-connection-string>");
}

function parseArgs(argv) {
  const args = { mode: null, org: null, people: 8 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") args.mode = "list";
    else if (arg === "--status") args.mode = "status";
    else if (arg === "--apply") args.mode = "apply";
    else if (arg === "--remove") args.mode = "remove";
    else if (arg === "--remove-all") args.mode = "remove-all";
    else if (arg === "--org") {
      args.org = argv[i + 1];
      i += 1;
    } else if (arg === "--people") {
      args.people = Number.parseInt(argv[i + 1], 10);
      i += 1;
    }
  }
  return args;
}

const USAGE = [
  "사용법:",
  "  node scripts/org-demo-seed.mjs --list                     워크스페이스 목록",
  "  node scripts/org-demo-seed.mjs --status --org <id|이름>    지금 들어가 있는 것",
  "  node scripts/org-demo-seed.mjs --apply  --org <id|이름>    데모 8명 + 부서 6개 넣기",
  `  node scripts/org-demo-seed.mjs --apply  --org <id|이름> --people <1~${MAX_PEOPLE}>`,
  "                                                           인원을 그 수로 «맞춘다» (늘리기·줄이기 둘 다)",
  "  node scripts/org-demo-seed.mjs --remove --org <id|이름>    그 워크스페이스에서 전부 빼기",
  "  node scripts/org-demo-seed.mjs --remove-all               ★ 어디에 넣었든 전부 없애는 «한 방»",
].join("\n");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** --org 를 실제 워크스페이스 하나로 좁힌다. 여럿 걸리면 «고르라» 고 하고 멈춘다. */
async function resolveOrg(client, needle) {
  if (!needle) throw new Error("--org 가 필요합니다. --list 로 후보를 먼저 보세요.");
  const { rows } = UUID_RE.test(needle)
    ? await client.query("select id, name from orgs where id = $1", [needle])
    : await client.query("select id, name from orgs where name ilike $1 order by name", [`%${needle}%`]);
  if (rows.length === 0) throw new Error(`「${needle}」 에 맞는 워크스페이스가 없습니다. --list 로 확인하세요.`);
  if (rows.length > 1) {
    const names = rows.map((row) => `  ${row.id}  ${row.name}`).join("\n");
    throw new Error(`「${needle}」 에 ${rows.length}개가 걸립니다. id 로 지정하세요:\n${names}`);
  }
  return rows[0];
}

/** 부서를 만든 사람으로 기록할 계정. 대표를 쓴다 — 데모 사람을 쓰면 RESTRICT 때문에 못 지운다. */
async function findOwner(client, orgId) {
  const { rows } = await client.query(
    "select user_id from org_members where org_id = $1 and role = 'owner' limit 1",
    [orgId],
  );
  if (rows.length === 0) throw new Error("이 워크스페이스에 대표(owner)가 없습니다. 데모를 넣을 기준 계정이 없습니다.");
  return rows[0].user_id;
}

// ─────────────────────────────────────────────────────────────────── 조회

async function listOrgs(client) {
  const { rows } = await client.query(`
    select o.id, o.name,
           (select count(*) from org_members m where m.org_id = o.id) as 전체인원,
           (select count(*) from org_members m where m.org_id = o.id and m.user_id = any($1::uuid[])) as 데모인원,
           (select count(*) from departments d where d.org_id = o.id and d.key like $2) as 데모부서
    from orgs o order by o.created_at
  `, [DEMO_UUIDS, `${DEPT_KEY_PREFIX}%`]);
  console.table(rows);
  console.log("\n--org 에 위 id 또는 이름 일부를 넣어 주세요.");
}

async function status(client, org) {
  console.log(`워크스페이스: ${org.name}  (${org.id})\n`);
  const { rows: people } = await client.query(`
    select u.name as 이름, m.role as 역할, m.scope as 범위, m.status as 상태,
           coalesce(p.title, '—') as 호칭,
           coalesce((select string_agg(d.name, ' · ' order by dm.is_primary desc, d.name)
                     from department_members dm join departments d on d.id = dm.dept_id
                     where dm.user_id = u.id and dm.org_id = $1), '(미배정)') as 부서
    from users u
    join org_members m on m.user_id = u.id and m.org_id = $1
    left join member_account_profiles p on p.user_id = u.id and p.org_id = $1
    where u.id = any($2::uuid[])
    order by u.id
  `, [org.id, DEMO_UUIDS]);

  const { rows: depts } = await client.query(`
    select d.key as 키, d.name as 부서, coalesce(parent.name, '(최상위)') as 상위,
           coalesce(h.name, '★ 공석') as 책임자,
           (select count(*) from department_members dm where dm.dept_id = d.id) as 인원
    from departments d
    left join departments parent on parent.id = d.parent_id
    left join users h on h.id = d.head_user_id
    where d.org_id = $1 and d.key like $2
    order by d.sort_order, d.key
  `, [org.id, `${DEPT_KEY_PREFIX}%`]);

  if (people.length === 0 && depts.length === 0) {
    console.log("데모 데이터가 없습니다. --apply 로 넣으세요.");
    return;
  }
  console.log(`데모 인원 ${people.length}명`);
  if (people.length > 0) console.table(people);
  console.log(`데모 부서 ${depts.length}개`);
  if (depts.length > 0) console.table(depts);
}

// ─────────────────────────────────────────────────────────────────── 넣기

async function apply(client, org, count) {
  const ownerId = await findOwner(client, org.id);
  const roster = Array.from({ length: count }, (_, index) => personAt(index + 1));
  const keep = roster.map((person) => demoUuid(person.n));
  // «줄이기» — 이번 명수보다 위의 데모 사람은 이 워크스페이스에서 뺀다.
  const drop = DEMO_UUIDS.filter((id) => !keep.includes(id));
  await client.query("begin");
  try {
    await client.query(
      `delete from department_members where org_id = $1 and user_id = any($2::uuid[])`,
      [org.id, drop],
    );
    await client.query("update departments set head_user_id = null where org_id = $1 and head_user_id = any($2::uuid[])", [org.id, drop]);
    await client.query(
      "delete from member_hierarchy_assignments where org_id = $1 and (member_user_id = any($2::uuid[]) or reports_to_user_id = any($2::uuid[]))",
      [org.id, drop],
    );
    await client.query("delete from member_account_profiles where org_id = $1 and user_id = any($2::uuid[])", [org.id, drop]);
    await client.query("delete from org_members where org_id = $1 and user_id = any($2::uuid[])", [org.id, drop]);
    // ① 인증 행. public.users.id 가 auth.users.id 를 참조하므로 이것이 먼저다.
    //    ★ 비밀번호도 확인일시도 넣지 않는다 — 들어올 수 있는 문을 열지 않는다.
    for (const person of roster) {
      await client.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, null, null)
         on conflict (id) do nothing`,
        [demoUuid(person.n), `demo-${person.n}@${EMAIL_DOMAIN}`],
      );
    }

    // ② 사람. auth 행이 생긴 뒤라야 FK 를 통과한다.
    for (const person of roster) {
      await client.query(
        `insert into users (id, email, name, avatar_url)
         values ($1, $2, $3, null)
         on conflict (id) do update set email = excluded.email, name = excluded.name`,
        [demoUuid(person.n), `demo-${person.n}@${EMAIL_DOMAIN}`, person.name],
      );
    }

    // ② 소속. 대표(owner)는 절대 건드리지 않는다 — 데모 uuid 에는 owner 가 없다.
    for (const person of roster) {
      await client.query(
        `insert into org_members (org_id, user_id, role, scope, status)
         values ($1, $2, $3::member_role, $4::member_scope, $5)
         on conflict (org_id, user_id) do update
           set role = excluded.role, scope = excluded.scope, status = excluded.status`,
        [org.id, demoUuid(person.n), person.role, person.scope, person.status ?? "active"],
      );
    }

    // ③ 호칭. 없는 사람은 화면이 「호칭 미설정」이라고 말하는지 보기 위해 일부러 비운다.
    for (const person of roster) {
      if (!person.title) continue;
      await client.query(
        `insert into member_account_profiles (org_id, user_id, title, team_key, updated_by)
         values ($1, $2, $3, null, $4)
         on conflict (org_id, user_id) do update set title = excluded.title, updated_by = excluded.updated_by`,
        [org.id, demoUuid(person.n), person.title, ownerId],
      );
    }

    // ④ 부서 — 먼저 «상위 없이» 만든다. 부모가 아직 없을 수 있기 때문이다.
    const deptId = new Map();
    for (const dept of DEPARTMENTS) {
      const key = `${DEPT_KEY_PREFIX}${dept.key}`;
      const { rows } = await client.query(
        `insert into departments (org_id, parent_id, name, key, sort_order, created_by)
         values ($1, null, $2, $3, $4, $5)
         on conflict (org_id, key) do update set name = excluded.name, sort_order = excluded.sort_order
         returning id`,
        [org.id, dept.name, key, dept.sort, ownerId],
      );
      deptId.set(dept.key, rows[0].id);
    }

    // ⑤ 이제 상위와 책임자를 잇는다. 영업2팀·총무팀은 공석으로 «남긴다».
    for (const dept of DEPARTMENTS) {
      const head = roster.find((person) => person.head && person.dept === dept.key);
      await client.query(
        "update departments set parent_id = $2, head_user_id = $3, archived_at = null where id = $1",
        [deptId.get(dept.key), dept.parent ? deptId.get(dept.parent) : null, head ? demoUuid(head.n) : null],
      );
    }

    // ⑥ 배정. 겸직은 주부서 하나 + 보조 여럿이다.
    for (const person of roster) {
      if (!person.dept) continue;
      const assignments = [{ key: person.dept, primary: true }, ...(person.also ?? []).map((key) => ({ key, primary: false }))];
      for (const assignment of assignments) {
        await client.query(
          `insert into department_members (org_id, dept_id, user_id, role, is_primary)
           values ($1, $2, $3, $4, $5)
           on conflict (dept_id, user_id) do update set role = excluded.role, is_primary = excluded.is_primary`,
          [org.id, deptId.get(assignment.key), demoUuid(person.n), person.head && assignment.primary ? "head" : "member", assignment.primary],
        );
      }
    }

    // ⑦ 보고 예외. 부서 계통을 «거스르는» 한 줄이 화면에 나타나는지 보는 재료다.
    for (const exception of REPORTING_EXCEPTIONS) {
      // 인원을 줄여 둘 중 하나가 빠졌으면 예외도 걸지 않는다 — 없는 사람에게 보고할 수 없다.
      if (!keep.includes(demoUuid(exception.member)) || !keep.includes(demoUuid(exception.reportsTo))) continue;
      await client.query(
        `insert into member_hierarchy_assignments (org_id, member_user_id, reports_to_user_id, updated_by)
         values ($1, $2, $3, $4)
         on conflict (org_id, member_user_id) do update
           set reports_to_user_id = excluded.reports_to_user_id, updated_by = excluded.updated_by`,
        [org.id, demoUuid(exception.member), demoUuid(exception.reportsTo), ownerId],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  /*
   * ★ 줄였으면 «떨어져 나온» 계정을 그 자리에서 치운다.
   *   12명 → 5명으로 줄이면 6~12번이 이 워크스페이스에서 빠지는데, 다른 워크스페이스에도
   *   없으면 users/auth.users 에 소속 없는 행으로 남는다. 그것이 쌓이면 나중에
   *   「이게 뭐였더라」가 되고, belie 가 말한 «쓰레기 늘어놓지 않기»(AGENTS.md §2.6 ④)에 어긋난다.
   *   다른 워크스페이스에 아직 소속이 있으면 지우지 않는다 — 그쪽 조직도가 깨진다.
   */
  await purgeOrphanDemoUsers(client);

  console.log(`넣었습니다 — 데모 ${roster.length}명 · 부서 ${DEPARTMENTS.length}개 → ${org.name}\n`);
  await status(client, org);
  console.log("\n화면: /settings/members  (「조직도 한눈에 보기」 갈래에서 확인)");
  console.log(`인원 바꾸기: node scripts/org-demo-seed.mjs --apply --org ${org.id} --people <1~${MAX_PEOPLE}>`);
  console.log(`전부 없애기: node scripts/org-demo-seed.mjs --remove --org ${org.id}`);
}

// ─────────────────────────────────────────────────────────────────── 빼기

/**
 * 지우기 전에 «데모가 아닌 것이 데모를 참조하는가» 를 본다.
 * 있으면 멈춘다 — 남의 부서를 말없이 고아로 만들지 않는다.
 */
async function guardBeforeRemove(client, orgId) {
  const { rows: orphanParents } = await client.query(`
    select child.name as 부서, parent.name as 상위데모부서
    from departments child join departments parent on parent.id = child.parent_id
    where child.org_id = $1 and parent.key like $2 and child.key not like $2
  `, [orgId, `${DEPT_KEY_PREFIX}%`]);
  if (orphanParents.length > 0) {
    console.error("멈춥니다 — 데모가 아닌 부서가 데모 부서를 상위로 두고 있습니다:");
    console.table(orphanParents);
    throw new Error("이 부서들의 상위를 먼저 옮기고 다시 실행하세요.");
  }

  const { rows: heads } = await client.query(`
    select d.name as 부서 from departments d
    where d.org_id = $1 and d.key not like $2 and d.head_user_id = any($3::uuid[])
  `, [orgId, `${DEPT_KEY_PREFIX}%`, DEMO_UUIDS]);
  if (heads.length > 0) {
    console.error("멈춥니다 — 데모가 아닌 부서의 책임자가 데모 사람입니다:");
    console.table(heads);
    throw new Error("이 부서들의 책임자를 먼저 바꾸고 다시 실행하세요.");
  }
}

async function removeFromOrg(client, org) {
  await guardBeforeRemove(client, org.id);
  await client.query("begin");
  try {
    // 데모 사람의 배정 + 데모 부서의 배정. 둘 다 데모 경계 안이다.
    await client.query(
      `delete from department_members dm using departments d
       where dm.dept_id = d.id and dm.org_id = $1 and (d.key like $2 or dm.user_id = any($3::uuid[]))`,
      [org.id, `${DEPT_KEY_PREFIX}%`, DEMO_UUIDS],
    );
    // 상위·책임자를 먼저 끊는다 — 부모를 자식보다 먼저 지우다 FK 에 걸리지 않게.
    await client.query(
      "update departments set parent_id = null, head_user_id = null where org_id = $1 and key like $2",
      [org.id, `${DEPT_KEY_PREFIX}%`],
    );
    await client.query("delete from departments where org_id = $1 and key like $2", [org.id, `${DEPT_KEY_PREFIX}%`]);
    await client.query(
      "delete from member_hierarchy_assignments where org_id = $1 and (member_user_id = any($2::uuid[]) or reports_to_user_id = any($2::uuid[]))",
      [org.id, DEMO_UUIDS],
    );
    await client.query("delete from member_account_profiles where org_id = $1 and user_id = any($2::uuid[])", [org.id, DEMO_UUIDS]);
    // ★ 대표는 데모 uuid 가 아니므로 이 한 줄에 절대 걸리지 않는다.
    await client.query("delete from org_members where org_id = $1 and user_id = any($2::uuid[])", [org.id, DEMO_UUIDS]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  console.log(`뺐습니다 — ${org.name} 에서 데모 인원과 데모 부서를 제거했습니다.`);
  // 다른 워크스페이스에도 안 남았으면 계정까지 지운다 — «다 하고 나서 없앤다» 가 한 번에 끝나게.
  await purgeOrphanDemoUsers(client);
}

/**
 * 어느 워크스페이스에도 안 남은 데모 사람을 지운다.
 * auth.users 를 지우면 public.users 는 ON DELETE CASCADE 로 같이 사라진다.
 * ★ 데모 uuid 8개 밖은 어떤 경우에도 손대지 않는다.
 */
async function purgeOrphanDemoUsers(client) {
  const { rowCount } = await client.query(
    `delete from auth.users where id = any($1::uuid[])
       and not exists (select 1 from public.org_members m where m.user_id = auth.users.id)`,
    [DEMO_UUIDS],
  );
  console.log(`데모 계정 정리: ${rowCount}명 삭제 (남은 소속이 없는 사람만).`);
}

async function removeAll(client) {
  const { rows } = await client.query(
    `select distinct o.id, o.name from orgs o
     where exists (select 1 from org_members m where m.org_id = o.id and m.user_id = any($1::uuid[]))
        or exists (select 1 from departments d where d.org_id = o.id and d.key like $2)`,
    [DEMO_UUIDS, `${DEPT_KEY_PREFIX}%`],
  );
  if (rows.length === 0) console.log("데모 데이터가 있는 워크스페이스가 없습니다.");
  for (const org of rows) await removeFromOrg(client, org);
  await purgeOrphanDemoUsers(client);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    console.error(USAGE);
    process.exit(2);
  }

  const conn = readConnectionString();
  if (!conn) {
    console.error(
      `${URL_KEY} 가 없습니다. .env 또는 .env.local 에 다음 한 줄을 넣어 주세요:\n` +
        `  ${URL_KEY}=postgresql://...\n` +
        "(.env 는 .gitignore 에 잡혀 있어 저장소에 올라가지 않습니다.)",
    );
    process.exit(2);
  }

  const client = new pg.Client({
    connectionString: conn.value,
    ssl: { rejectUnauthorized: false },
    application_name: "moawork-org-demo-seed",
  });

  try {
    await client.connect();
    console.log(`접속됨 (${conn.source} 의 ${URL_KEY} 사용)\n`);
    if (args.mode === "list") await listOrgs(client);
    else if (args.mode === "remove-all") await removeAll(client);
    else {
      const org = await resolveOrg(client, args.org);
      if (args.mode === "status") await status(client, org);
      else if (args.mode === "apply") {
        if (!Number.isInteger(args.people) || args.people < 1 || args.people > MAX_PEOPLE) {
          throw new Error(`--people 는 1~${MAX_PEOPLE} 사이의 정수여야 합니다 (받은 값: ${args.people}).`);
        }
        await apply(client, org, args.people);
      } else if (args.mode === "remove") await removeFromOrg(client, org);
    }
  } catch (error) {
    console.error("실패:", redact(error.message, conn.value));
    if (error.code) console.error("  코드:", error.code);
    if (error.detail) console.error("  상세:", redact(error.detail, conn.value));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
