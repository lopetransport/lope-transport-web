-- Paid fleet clients are distinct from subcontracted haulers.
create table public.client_memberships (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null unique references public.profiles(id),
 onboarding_status text not null default 'awaiting_payment' check(onboarding_status in ('awaiting_payment','payment_under_review','paid')),
 subscription_status text not null default 'not_started' check(subscription_status in ('not_started','active','past_due','paused','cancelled')),
 package_name text not null default 'Fleet & telematics' check(length(package_name) between 2 and 120),
 subscription_until date,
 created_at timestamptz not null default now(),
 check(subscription_status<>'active' or (onboarding_status='paid' and subscription_until is not null))
);
create table public.client_fleet_assets (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.profiles(id),
 registration_number text not null check(length(registration_number) between 2 and 30),
 vehicle_description text not null check(length(vehicle_description) between 2 and 160),
 created_at timestamptz not null default now(),
 unique(client_id,registration_number)
);
create index client_fleet_owner_idx on public.client_fleet_assets(client_id);
create function portal_private.guard_client_service() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=new.client_id and role='client') then raise exception 'Fleet subscriptions require a client account';end if;
 if tg_op='UPDATE' and (new.id<>old.id or new.client_id<>old.client_id or new.created_at<>old.created_at) then raise exception 'Service ownership cannot be changed';end if;
 return new;
end;$$;
revoke all on function portal_private.guard_client_service() from public,anon,authenticated;
create trigger guard_membership before insert or update on public.client_memberships for each row execute function portal_private.guard_client_service();
create trigger guard_client_fleet before insert or update on public.client_fleet_assets for each row execute function portal_private.guard_client_service();
alter table public.client_memberships enable row level security;
alter table public.client_fleet_assets enable row level security;
revoke all on public.client_memberships,public.client_fleet_assets from public,anon,authenticated;
grant select,insert,update on public.client_memberships,public.client_fleet_assets to authenticated;
create policy membership_read on public.client_memberships for select to authenticated using((client_id=(select auth.uid()) and (select portal_private.member('client'))) or (select portal_private.active('admin')));
create policy membership_add on public.client_memberships for insert to authenticated with check((select portal_private.active('admin')));
create policy membership_edit on public.client_memberships for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
create policy client_fleet_read on public.client_fleet_assets for select to authenticated using((select portal_private.active('admin')) or (client_id=(select auth.uid()) and (select portal_private.active('client')) and exists(select 1 from public.client_memberships m where m.client_id=(select auth.uid()) and m.onboarding_status='paid' and m.subscription_status='active' and m.subscription_until >= (now() at time zone 'Africa/Johannesburg')::date)));
create policy client_fleet_add on public.client_fleet_assets for insert to authenticated with check((select portal_private.active('admin')));
create policy client_fleet_edit on public.client_fleet_assets for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
alter publication supabase_realtime add table public.client_memberships,public.client_fleet_assets;
