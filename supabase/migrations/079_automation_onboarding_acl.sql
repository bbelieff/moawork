-- BBE-113: close default EXECUTE privileges on onboarding automation RPCs.
-- Trigger execution does not require callers to execute the trigger function.

revoke all on function public.reconcile_automation_onboarding_quest()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_my_automation_onboarding_quests(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_my_automation_onboarding_quest(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.sync_my_automation_onboarding_quests(uuid)
  to authenticated;
grant execute on function public.update_my_automation_onboarding_quest(uuid, uuid, boolean, text)
  to authenticated;
