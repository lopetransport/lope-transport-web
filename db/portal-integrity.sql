create policy document_object_required on public.compliance_documents as restrictive for insert to authenticated
with check(exists(select 1 from storage.objects o where o.bucket_id='portal-compliance' and o.name=storage_path));
create function portal_private.guard_quote_owner() returns trigger language plpgsql security invoker set search_path='' as $$
begin if new.id<>old.id or new.client_id<>old.client_id or new.created_at<>old.created_at then raise exception 'Quote ownership is immutable';end if;return new;end;$$;
revoke all on function portal_private.guard_quote_owner() from public,anon,authenticated;
create trigger guard_quote_owner before update on public.quotes for each row execute function portal_private.guard_quote_owner();
