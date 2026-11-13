create type public.portal_role as enum ('client','hauler','admin');
create type public.portal_account_status as enum ('pending_review','active','suspended');
create type public.vehicle_approval as enum ('pending_lts_approval','approved','rejected');
create type public.insurance_status as enum ('active','expired','pending_upload');
create type public.freight_job_status as enum ('quote_received','assigned','in_transit','delivered','cancelled');
create schema portal_private;
revoke all on schema portal_private from public,anon;
grant usage on schema portal_private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 company_name text not null default '' check(length(company_name)<=160),
 contact_person text not null default '' check(length(contact_person)<=120),
 email text not null check(length(email)<=254), phone text not null default '' check(length(phone)<=30),
 role public.portal_role not null default 'client',
 account_status public.portal_account_status not null default 'pending_review',
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;

-- These narrowly scoped helpers read only the caller's current database role.
-- Private schema avoids exposed security-definer RPCs and recursive profile policies.
create function portal_private.member(wanted public.portal_role) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role=wanted and p.account_status<>'suspended' and (wanted<>'admin' or p.account_status='active'));
$$;
create function portal_private.active(wanted public.portal_role) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role=wanted and p.account_status='active');
$$;
revoke all on function portal_private.member(public.portal_role),portal_private.active(public.portal_role) from public,anon;
grant execute on function portal_private.member(public.portal_role),portal_private.active(public.portal_role) to authenticated;

create function portal_private.bootstrap_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,company_name,contact_person,phone,role)
 values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'company_name',''),160),left(coalesce(new.raw_user_meta_data->>'contact_person',''),120),left(coalesce(new.raw_user_meta_data->>'phone',''),30),case when new.raw_user_meta_data->>'account_type'='hauler' then 'hauler'::public.portal_role else 'client'::public.portal_role end);
 return new;
end; $$;
revoke all on function portal_private.bootstrap_profile() from public,anon,authenticated;
create trigger portal_profile_created after insert on auth.users for each row execute function portal_private.bootstrap_profile();
create function portal_private.sync_profile_email() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.profiles set email=coalesce(new.email,'') where id=new.id;return new;end;$$;
revoke all on function portal_private.sync_profile_email() from public,anon,authenticated;
create trigger portal_email_updated after update of email on auth.users for each row execute function portal_private.sync_profile_email();

create function portal_private.guard_profile() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('postgres','service_role','supabase_auth_admin','supabase_admin') then return new;end if;
 if new.id<>old.id or new.email<>old.email or new.created_at<>old.created_at then raise exception 'Identity fields are managed by authentication';end if;
 if (new.role<>old.role or new.account_status<>old.account_status) and not portal_private.active('admin') then raise exception 'Only LTS administrators can manage access';end if;
 if new.role<>old.role then raise exception 'Role changes require a trusted database administrator';end if;
 if new.id=auth.uid() and new.account_status<>old.account_status then raise exception 'Administrators cannot change their own account status';end if;
 return new;
end;$$;
revoke all on function portal_private.guard_profile() from public,anon,authenticated;
create trigger guard_profile before update on public.profiles for each row execute function portal_private.guard_profile();
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select portal_private.active('admin')));
create policy profile_edit on public.profiles for update to authenticated using((id=(select auth.uid()) and account_status<>'suspended') or (select portal_private.active('admin'))) with check(id=(select auth.uid()) or (select portal_private.active('admin')));
grant select on public.profiles to authenticated;
grant update(company_name,contact_person,phone,account_status) on public.profiles to authenticated;

create table public.fleet_vehicles (
 id uuid primary key default gen_random_uuid(),hauler_id uuid not null references public.profiles(id),
 registration_number text not null unique check(length(registration_number) between 2 and 30),
 asset_kind text not null default 'truck' check(asset_kind in ('truck','trailer')),
 vehicle_type text not null check(length(vehicle_type) between 2 and 120),make_model text not null check(length(make_model) between 2 and 120),
 payload_capacity numeric(6,2) not null check(payload_capacity>0 and payload_capacity<=100),
 is_available boolean not null default false,
 git_insurance_status public.insurance_status not null default 'pending_upload',git_expires_on date,
 approval_status public.vehicle_approval not null default 'pending_lts_approval',rejection_reason text check(length(rejection_reason)<=1000),
 created_at timestamptz not null default now()
);
alter table public.fleet_vehicles enable row level security;
revoke all on public.fleet_vehicles from public,anon,authenticated;
create index fleet_hauler_idx on public.fleet_vehicles(hauler_id);
create function portal_private.guard_vehicle() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=new.hauler_id and role='hauler') then raise exception 'Vehicle owner must be a hauler';end if;
 if tg_op='UPDATE' and (new.id<>old.id or new.hauler_id<>old.hauler_id or new.created_at<>old.created_at) then raise exception 'Vehicle ownership cannot be changed';end if;
 if current_user not in ('postgres','service_role','supabase_admin') and not portal_private.active('admin') then
  if tg_op='INSERT' then
   if new.approval_status<>'pending_lts_approval' or new.git_insurance_status<>'pending_upload' or new.git_expires_on is not null or new.rejection_reason is not null then raise exception 'LTS review is required';end if;
  else
   if new.approval_status<>old.approval_status or new.git_insurance_status<>old.git_insurance_status or new.git_expires_on is distinct from old.git_expires_on or new.rejection_reason is distinct from old.rejection_reason then raise exception 'Only LTS can approve compliance';end if;
   if (new.registration_number,new.vehicle_type,new.make_model,new.payload_capacity,new.asset_kind) is distinct from (old.registration_number,old.vehicle_type,old.make_model,old.payload_capacity,old.asset_kind) then
    new.approval_status='pending_lts_approval';new.rejection_reason=null;new.git_insurance_status='pending_upload';new.git_expires_on=null;
   end if;
  end if;
 end if;
 if new.approval_status='rejected' and length(trim(coalesce(new.rejection_reason,'')))<2 then raise exception 'Provide a rejection reason';end if;
 if new.approval_status<>'approved' then new.is_available=false;end if;
 return new;
end;$$;
revoke all on function portal_private.guard_vehicle() from public,anon,authenticated;
create trigger guard_vehicle before insert or update on public.fleet_vehicles for each row execute function portal_private.guard_vehicle();
create policy fleet_read on public.fleet_vehicles for select to authenticated using((hauler_id=(select auth.uid()) and (select portal_private.member('hauler'))) or (select portal_private.active('admin')));
create policy fleet_add on public.fleet_vehicles for insert to authenticated with check((hauler_id=(select auth.uid()) and (select portal_private.member('hauler'))) or (select portal_private.active('admin')));
create policy fleet_edit on public.fleet_vehicles for update to authenticated using((hauler_id=(select auth.uid()) and (select portal_private.member('hauler'))) or (select portal_private.active('admin'))) with check((hauler_id=(select auth.uid()) and (select portal_private.member('hauler'))) or (select portal_private.active('admin')));
grant select,insert,update on public.fleet_vehicles to authenticated;

create table public.quotes (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 freight_enquiry_id uuid unique references public.freight_enquiries(id),
 origin text not null check(length(origin) between 2 and 160),destination text not null check(length(destination) between 2 and 160),
 cargo_type text not null check(length(cargo_type) between 2 and 3000),tonnage numeric(6,2) not null check(tonnage>0 and tonnage<=100),preferred_date date,
 status text not null default 'submitted' check(status in ('submitted','reviewing','quoted','accepted','declined')),
 quoted_amount numeric(14,2) check(quoted_amount>=0),currency text not null default 'ZAR' check(currency='ZAR'),
 created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;
revoke all on public.quotes from public,anon,authenticated;
create index quotes_client_idx on public.quotes(client_id);
create policy quotes_read on public.quotes for select to authenticated using((client_id=(select auth.uid()) and (select portal_private.member('client'))) or (select portal_private.active('admin')));
create policy quotes_add on public.quotes for insert to authenticated with check((client_id=(select auth.uid()) and (select portal_private.member('client')) and status='submitted' and quoted_amount is null and freight_enquiry_id is null) or (select portal_private.active('admin')));
create policy quotes_edit on public.quotes for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
grant select,insert,update on public.quotes to authenticated;

create table public.client_jobs (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.profiles(id),quote_id uuid unique references public.quotes(id),
 origin text not null check(length(origin) between 2 and 160),destination text not null check(length(destination) between 2 and 160),cargo_type text not null check(length(cargo_type) between 2 and 3000),tonnage numeric(6,2) not null check(tonnage>0 and tonnage<=100),
 status public.freight_job_status not null default 'quote_received',assigned_hauler_id uuid references public.profiles(id),assigned_vehicle_id uuid references public.fleet_vehicles(id),
 pickup_instructions text not null default '' check(length(pickup_instructions)<=2000),delivery_instructions text not null default '' check(length(delivery_instructions)<=2000),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.client_jobs enable row level security;
revoke all on public.client_jobs from public,anon,authenticated;
create index jobs_client_idx on public.client_jobs(client_id);
create index jobs_hauler_idx on public.client_jobs(assigned_hauler_id);
create index jobs_vehicle_idx on public.client_jobs(assigned_vehicle_id);
create policy jobs_read on public.client_jobs for select to authenticated using((client_id=(select auth.uid()) and (select portal_private.member('client'))) or (assigned_hauler_id=(select auth.uid()) and (select portal_private.active('hauler'))) or (select portal_private.active('admin')));
create policy jobs_admin_add on public.client_jobs for insert to authenticated with check((select portal_private.active('admin')));
create policy jobs_admin_edit on public.client_jobs for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
grant select,insert,update on public.client_jobs to authenticated;
create function portal_private.guard_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=new.client_id and role='client') then raise exception 'Job must belong to a client';end if;
 if new.quote_id is not null and not exists(select 1 from public.quotes where id=new.quote_id and client_id=new.client_id) then raise exception 'Quote owner mismatch';end if;
 if new.status in ('assigned','in_transit') then
  if not exists(select 1 from public.fleet_vehicles v join public.profiles p on p.id=v.hauler_id where v.id=new.assigned_vehicle_id and v.hauler_id=new.assigned_hauler_id and p.role='hauler' and p.account_status='active' and v.approval_status='approved' and v.git_insurance_status='active' and v.git_expires_on>=current_date) then raise exception 'Assign an active hauler with an approved, insured vehicle';end if;
 end if;
 new.updated_at=now();return new;
end;$$;
revoke all on function portal_private.guard_job() from public,anon,authenticated;
create trigger guard_job before insert or update on public.client_jobs for each row execute function portal_private.guard_job();
create function portal_private.quote_to_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or (auth.uid()<>new.client_id and not portal_private.active('admin')) then raise exception 'Quote ownership required';end if;
 insert into public.client_jobs(client_id,quote_id,origin,destination,cargo_type,tonnage) values(new.client_id,new.id,new.origin,new.destination,new.cargo_type,new.tonnage);
 return new;
end;$$;
revoke all on function portal_private.quote_to_job() from public,anon,authenticated;
create trigger quote_creates_job after insert on public.quotes for each row execute function portal_private.quote_to_job();

create table public.compliance_documents (
 id uuid primary key default gen_random_uuid(),hauler_id uuid not null references public.profiles(id),vehicle_id uuid references public.fleet_vehicles(id),
 document_type text not null check(document_type in ('git','cof','pdp','licence','other')),
 storage_path text not null unique check(length(storage_path)<=500),file_name text not null check(length(file_name)<=200),
 expires_on date,status text not null default 'pending_review' check(status in ('pending_review','approved','rejected')),
 review_notes text check(length(review_notes)<=1000),created_at timestamptz not null default now()
);
alter table public.compliance_documents enable row level security;
revoke all on public.compliance_documents from public,anon,authenticated;
create index documents_hauler_idx on public.compliance_documents(hauler_id);
create index documents_vehicle_idx on public.compliance_documents(vehicle_id);
create policy documents_read on public.compliance_documents for select to authenticated using((hauler_id=(select auth.uid()) and (select portal_private.member('hauler'))) or (select portal_private.active('admin')));
create policy documents_add on public.compliance_documents for insert to authenticated with check(hauler_id=(select auth.uid()) and (select portal_private.member('hauler')) and status='pending_review' and review_notes is null and split_part(storage_path,'/',1)=(select auth.uid())::text and (vehicle_id is null or exists(select 1 from public.fleet_vehicles v where v.id=vehicle_id and v.hauler_id=(select auth.uid()))));
create policy documents_admin_edit on public.compliance_documents for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
grant select,insert on public.compliance_documents to authenticated;
grant update(status,review_notes) on public.compliance_documents to authenticated;
create function portal_private.review_document() returns trigger language plpgsql security definer set search_path='' as $$
declare expiry date;
begin
 if auth.uid() is null or not portal_private.active('admin') then raise exception 'LTS admin required';end if;
 if new.status='rejected' and length(trim(coalesce(new.review_notes,'')))<2 then raise exception 'Provide a rejection reason';end if;
 if new.status='approved' and (new.expires_on is null or new.expires_on<current_date) then raise exception 'A valid expiry date is required';end if;
 if new.vehicle_id is not null and new.document_type='git' then
  select max(d.expires_on) into expiry from public.compliance_documents d where d.vehicle_id=new.vehicle_id and d.document_type='git' and d.status='approved';
  update public.fleet_vehicles set git_expires_on=expiry,git_insurance_status=case when expiry>=current_date then 'active'::public.insurance_status when expiry is null then 'pending_upload'::public.insurance_status else 'expired'::public.insurance_status end where id=new.vehicle_id;
 end if;
 return new;
end;$$;
revoke all on function portal_private.review_document() from public,anon,authenticated;
create trigger document_reviewed after update of status on public.compliance_documents for each row execute function portal_private.review_document();

create table public.invoices (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.profiles(id),job_id uuid references public.client_jobs(id),invoice_number text not null unique check(length(invoice_number) between 1 and 60),
 amount numeric(14,2) not null check(amount>=0),currency text not null default 'ZAR' check(currency='ZAR'),due_date date not null,
 status text not null default 'unpaid' check(status in ('draft','unpaid','paid','void')),created_at timestamptz not null default now()
);
alter table public.invoices enable row level security;
revoke all on public.invoices from public,anon,authenticated;
create index invoices_client_idx on public.invoices(client_id);
create index invoices_job_idx on public.invoices(job_id);
create policy invoices_read on public.invoices for select to authenticated using((client_id=(select auth.uid()) and status<>'draft' and (select portal_private.member('client'))) or (select portal_private.active('admin')));
create policy invoices_admin_add on public.invoices for insert to authenticated with check((select portal_private.active('admin')));
create policy invoices_admin_edit on public.invoices for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
grant select,insert,update on public.invoices to authenticated;
create function portal_private.guard_invoice() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=new.client_id and role='client') then raise exception 'Invoice owner must be a client';end if;
 if new.job_id is not null and not exists(select 1 from public.client_jobs where id=new.job_id and client_id=new.client_id) then raise exception 'Invoice and job owner mismatch';end if;
 return new;
end;$$;
revoke all on function portal_private.guard_invoice() from public,anon,authenticated;
create trigger guard_invoice before insert or update on public.invoices for each row execute function portal_private.guard_invoice();

-- Guest website enquiries remain private; only an LTS admin can link them explicitly.
grant select on public.freight_enquiries,public.dispatch_enquiries to authenticated;
grant update(status) on public.freight_enquiries,public.dispatch_enquiries to authenticated;
create policy admin_freight_read on public.freight_enquiries for select to authenticated using((select portal_private.active('admin')));
create policy admin_freight_edit on public.freight_enquiries for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));
create policy admin_dispatch_read on public.dispatch_enquiries for select to authenticated using((select portal_private.active('admin')));
create policy admin_dispatch_edit on public.dispatch_enquiries for update to authenticated using((select portal_private.active('admin'))) with check((select portal_private.active('admin')));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('portal-compliance','portal-compliance',false,10485760,array['application/pdf','image/jpeg','image/png']);
create policy portal_storage_read on storage.objects for select to authenticated using(bucket_id='portal-compliance' and (((storage.foldername(name))[1]=(select auth.uid())::text and (select portal_private.member('hauler'))) or (select portal_private.active('admin'))));
create policy portal_storage_insert on storage.objects for insert to authenticated with check(bucket_id='portal-compliance' and (storage.foldername(name))[1]=(select auth.uid())::text and (select portal_private.member('hauler')));
create policy portal_storage_cleanup on storage.objects for delete to authenticated using(bucket_id='portal-compliance' and (storage.foldername(name))[1]=(select auth.uid())::text and (select portal_private.member('hauler')) and not exists(select 1 from public.compliance_documents d where d.storage_path=name));

-- Explicitly remove accidental default privileges on the new tables.
revoke all on public.profiles,public.fleet_vehicles,public.quotes,public.client_jobs,public.compliance_documents,public.invoices from anon;
grant all on public.profiles,public.fleet_vehicles,public.quotes,public.client_jobs,public.compliance_documents,public.invoices to service_role;
alter publication supabase_realtime add table public.profiles,public.fleet_vehicles,public.quotes,public.client_jobs,public.compliance_documents,public.invoices;

