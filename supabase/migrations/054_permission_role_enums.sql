-- BBE-122: add the fourth company role and department visibility scope.
-- Keep enum additions in their own migration transaction. PostgreSQL does not
-- allow a newly-added enum value to be consumed safely before that transaction
-- commits; 053 installs the functions, seeds, and RLS-facing RPCs that use them.
alter type public.member_role add value if not exists 'team_lead';
alter type public.member_scope add value if not exists 'department';
