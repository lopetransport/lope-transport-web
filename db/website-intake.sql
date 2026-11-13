-- Website intake. Private rows: no anonymous or signed-in client access.
create table public.freight_enquiries (
 id uuid primary key,
 created_at timestamptz not null default now(),
 pickup text not null check (length(pickup) between 2 and 160),
 delivery text not null check (length(delivery) between 2 and 160),
 capacity text not null check (capacity in ('1—4','5—12','14—28','34')),
 cargo text not null check (length(cargo) between 2 and 3000),
 date date,
 name text not null check (length(name) between 2 and 120),
 company text not null check (length(company) between 1 and 160),
 email text not null check (length(email) between 3 and 254),
 phone text not null check (length(phone) between 7 and 30),
 consented_at timestamptz not null,
 status text not null default 'new' check (status in ('new','in_progress','closed')),
 source text not null default 'website'
);
create table public.dispatch_enquiries (
 id uuid primary key,
 created_at timestamptz not null default now(),
 name text not null check (length(name) between 2 and 120),
 email text not null check (length(email) between 3 and 254),
 message text not null check (length(message) between 2 and 2500),
 consented_at timestamptz not null,
 status text not null default 'new' check (status in ('new','in_progress','closed')),
 source text not null default 'website'
);
create index freight_enquiries_created_at_idx on public.freight_enquiries(created_at desc);
create index dispatch_enquiries_created_at_idx on public.dispatch_enquiries(created_at desc);
alter table public.freight_enquiries enable row level security;
alter table public.dispatch_enquiries enable row level security;
revoke all on public.freight_enquiries, public.dispatch_enquiries from public, anon, authenticated;
grant select, insert, update, delete on public.freight_enquiries, public.dispatch_enquiries to service_role;

create schema website_private;
revoke all on schema website_private from public, anon, authenticated;
grant usage on schema website_private to service_role;
create table website_private.submission_limits (
 key text not null,
 window_start timestamptz not null,
 attempts integer not null default 1,
 primary key (key, window_start)
);
alter table website_private.submission_limits enable row level security;
revoke all on website_private.submission_limits from public, anon, authenticated;
grant select, insert, update, delete on website_private.submission_limits to service_role;

create function public.capture_website_enquiry(
 p_kind text, p_payload jsonb, p_id uuid, p_email_hash text, p_ip_hash text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
 bucket timestamptz := date_trunc('hour', now());
 rate record;
 attempts integer;
begin
 if p_kind not in ('quote','dispatch') then raise exception 'Invalid enquiry type'; end if;
 -- Serialize retries for one submission, then return the existing receipt.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if (p_kind='quote' and exists(select 1 from public.freight_enquiries where id=p_id))
 or (p_kind='dispatch' and exists(select 1 from public.dispatch_enquiries where id=p_id)) then
   return p_id;
 end if;
 -- Updates and insertion share one transaction; concurrent submissions cannot bypass limits.
 for rate in select * from (values ('global',200), ('email:'||p_email_hash,5), ('ip:'||p_ip_hash,30)) as limits(key,max_attempts)
 loop
  insert into website_private.submission_limits as limits(key,window_start,attempts)
  values(rate.key,bucket,1)
  on conflict(key,window_start) do update set attempts=limits.attempts+1
  returning limits.attempts into attempts;
  if attempts>rate.max_attempts then raise exception using errcode='P0001', message='submission_limit'; end if;
 end loop;
 delete from website_private.submission_limits where window_start < now()-interval '24 hours';
 if p_kind='quote' then
  insert into public.freight_enquiries(id,pickup,delivery,capacity,cargo,date,name,company,email,phone,consented_at)
  values(p_id,p_payload->>'pickup',p_payload->>'delivery',p_payload->>'capacity',p_payload->>'cargo',nullif(p_payload->>'date','')::date,p_payload->>'name',p_payload->>'company',p_payload->>'email',p_payload->>'phone',now());
 else
  insert into public.dispatch_enquiries(id,name,email,message,consented_at)
  values(p_id,p_payload->>'name',p_payload->>'email',p_payload->>'message',now());
 end if;
 return p_id;
end; $$;
revoke all on function public.capture_website_enquiry(text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.capture_website_enquiry(text,jsonb,uuid,text,text) to service_role;


-- Internal event-trigger helper; never callable by public clients.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
