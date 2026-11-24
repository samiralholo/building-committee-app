-- =====================================================================
--  لجنة البناء — Migration 002: super admin + assigned building admins,
--  slug redirects, active flag, landing RPC, RLS rewrite.
--  Idempotent: safe to run more than once. Run AFTER 001_initial_schema.sql.
--
--  After running it, promote your own account (1 command):
--    update public.profiles set role = 'superadmin' where email = 'you@example.com';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROFILES (one row per auth user)
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  role        text not null default 'admin' check (role in ('superadmin', 'admin')),
  created_at  timestamptz default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that existed before this migration
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '') from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. BUILDING ADMINS (who manages which building) + active flag
-- ---------------------------------------------------------------------

create table if not exists public.building_admins (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz default now(),
  unique (building_id, user_id)
);

create index if not exists building_admins_user_idx on public.building_admins (user_id);

-- Existing owners become the first admins of their buildings
insert into public.building_admins (building_id, user_id)
select b.id, b.owner_id from public.buildings b
where b.owner_id is not null
on conflict (building_id, user_id) do nothing;

-- owner_id is kept only as "created by" history; access now comes from building_admins
alter table public.buildings alter column owner_id drop not null;
alter table public.buildings add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------
-- 3. SLUG REDIRECTS (old elevator QR codes never break)
-- ---------------------------------------------------------------------

create table if not exists public.building_slug_redirects (
  old_slug     text primary key,
  building_id  uuid references public.buildings(id) on delete cascade,
  created_at   timestamptz default now()
);

create or replace function public.buildings_slug_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A slug that still redirects to ANOTHER building is reserved (its old QR codes are in elevators).
  if exists (select 1 from public.building_slug_redirects r
             where r.old_slug = new.slug and r.building_id is distinct from new.id) then
    raise exception 'slug "%" is reserved by another building (old QR code)', new.slug
      using errcode = '23505', constraint = 'buildings_slug_reserved';
  end if;

  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      insert into public.building_slug_redirects (old_slug, building_id)
      values (old.slug, new.id)
      on conflict (old_slug) do update set building_id = excluded.building_id, created_at = now();
    end if;
  end if;

  -- Renaming back to an old slug: it is the live slug again, not a redirect.
  delete from public.building_slug_redirects where old_slug = new.slug and building_id = new.id;
  return new;
end;
$$;

drop trigger if exists buildings_slug_history_trg on public.buildings;
create trigger buildings_slug_history_trg
  before insert or update of slug on public.buildings
  for each row execute function public.buildings_slug_history();

-- ---------------------------------------------------------------------
-- 4. ROLE HELPERS
-- ---------------------------------------------------------------------

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin');
$$;

create or replace function public.is_building_admin(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.building_admins
    where building_id = p_building_id and user_id = auth.uid()
  );
$$;

-- Old helper names (used by 001 objects) now mean "assigned admin"
create or replace function public.is_building_owner(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_building_admin(p_building_id);
$$;

create or replace function public.owns_building_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.building_admins
    where building_id::text = p_folder and user_id = auth.uid()
  );
$$;

revoke all on function public.is_superadmin() from public;
revoke all on function public.is_building_admin(uuid) from public;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_building_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS — drop every old policy, then recreate the role model
-- ---------------------------------------------------------------------

alter table public.profiles                enable row level security;
alter table public.building_admins         enable row level security;
alter table public.building_slug_redirects enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('buildings', 'units', 'billing_cycles', 'payments', 'expenses',
                        'profiles', 'building_admins', 'building_slug_redirects')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Anonymous visitors: no table access at all (public data = SECURITY DEFINER RPCs only)
revoke all on public.buildings, public.units, public.billing_cycles, public.payments, public.expenses,
              public.profiles, public.building_admins, public.building_slug_redirects
  from anon;
grant select, insert, update, delete on public.profiles, public.building_admins, public.building_slug_redirects
  to authenticated;

-- buildings: superadmin = full CRUD; building admin = read + update own building
create policy buildings_select on public.buildings for select to authenticated
  using (public.is_superadmin() or public.is_building_admin(id));
create policy buildings_insert on public.buildings for insert to authenticated
  with check (public.is_superadmin());
create policy buildings_update on public.buildings for update to authenticated
  using (public.is_superadmin() or public.is_building_admin(id))
  with check (public.is_superadmin() or public.is_building_admin(id));
create policy buildings_delete on public.buildings for delete to authenticated
  using (public.is_superadmin());

-- operational tables: building admin = full CRUD on own building; superadmin = READ ONLY
do $$
declare t text;
begin
  foreach t in array array['units', 'billing_cycles', 'payments', 'expenses'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_building_admin(building_id) or public.is_superadmin())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_building_admin(building_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_building_admin(building_id)) with check (public.is_building_admin(building_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_building_admin(building_id))', t);
  end loop;
end $$;

-- profiles: everyone reads their own row; superadmin full CRUD. No self-update (no role escalation).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_superadmin());
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_superadmin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_superadmin());

-- building_admins: admins see their own assignments; superadmin full CRUD
create policy building_admins_select on public.building_admins for select to authenticated
  using (user_id = auth.uid() or public.is_superadmin());
create policy building_admins_insert on public.building_admins for insert to authenticated with check (public.is_superadmin());
create policy building_admins_update on public.building_admins for update to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy building_admins_delete on public.building_admins for delete to authenticated using (public.is_superadmin());

-- slug redirects: superadmin only (the rename trigger writes them as SECURITY DEFINER)
create policy slug_redirects_all on public.building_slug_redirects for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------
-- 6. STORAGE — receipts: public read; write/delete only by that building's admins
-- ---------------------------------------------------------------------

drop policy if exists receipts_public_read  on storage.objects;
drop policy if exists receipts_owner_insert on storage.objects;
drop policy if exists receipts_owner_update on storage.objects;
drop policy if exists receipts_owner_delete on storage.objects;
drop policy if exists receipts_admin_insert on storage.objects;
drop policy if exists receipts_admin_update on storage.objects;
drop policy if exists receipts_admin_delete on storage.objects;

create policy receipts_public_read on storage.objects
  for select using (bucket_id = 'receipts');
create policy receipts_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));
create policy receipts_admin_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));
create policy receipts_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- 7. PUBLIC RPCs
-- ---------------------------------------------------------------------

-- Slug → canonical active building id (follows old slugs)
create or replace function public.resolve_building_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select b.id from public.buildings b where b.slug = lower(trim(p_slug)) and b.is_active),
    (select b.id from public.building_slug_redirects r
       join public.buildings b on b.id = r.building_id
      where r.old_slug = lower(trim(p_slug)) and b.is_active)
  );
$$;
revoke all on function public.resolve_building_slug(text) from public;

-- Landing page state (also the keep-alive endpoint). Optional p_slug validates a remembered slug.
create or replace function public.get_public_landing_state(p_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with active as (select slug from public.buildings where is_active)
  select jsonb_build_object(
    'building_count', (select count(*) from active),
    'single_slug',    case when (select count(*) from active) = 1 then (select slug from active) end,
    'resolved_slug',  case when p_slug is null then null
                           else (select slug from public.buildings where id = public.resolve_building_slug(p_slug)) end
  );
$$;
revoke all on function public.get_public_landing_state(text) from public;
grant execute on function public.get_public_landing_state(text) to anon, authenticated;

-- Dashboard: same payload as 001, now resolving old slugs, skipping inactive buildings,
-- and returning the canonical slug (client redirects old QR links to it).
create or replace function public.get_public_building_dashboard(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b       public.buildings%rowtype;
  result  jsonb;
begin
  select * into b from public.buildings where id = public.resolve_building_slug(p_slug);
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'building', jsonb_build_object(
      'name',                    b.name,
      'slug',                    b.slug,
      'currency',                b.currency,
      'announcement',            b.announcement,
      'announcement_updated_at', b.announcement_updated_at,
      'emergency_contacts',      b.emergency_contacts,
      'hide_resident_names',     b.hide_resident_names
    ),
    'stats', (
      select jsonb_build_object(
        'total_collected', c.total_collected,
        'total_expenses',  e.total_expenses,
        'fund_balance',    c.total_collected - e.total_expenses,
        'last_updated',    greatest(
                             b.created_at,
                             b.announcement_updated_at,
                             (select max(updated_at) from public.payments       where building_id = b.id),
                             (select max(created_at) from public.expenses       where building_id = b.id),
                             (select max(created_at) from public.billing_cycles where building_id = b.id)
                           )
      )
      from (select coalesce(sum(amount_paid), 0) as total_collected from public.payments where building_id = b.id) c,
           (select coalesce(sum(amount), 0)      as total_expenses  from public.expenses where building_id = b.id) e
    ),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bc.id, 'title', bc.title, 'cycle_type', bc.cycle_type,
               'default_amount', bc.default_amount, 'cycle_date', bc.cycle_date, 'created_at', bc.created_at
             ) order by bc.cycle_date desc, bc.created_at desc)
      from public.billing_cycles bc where bc.building_id = b.id
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id,
               'label', u.label,
               'floor', u.floor,
               'sort_order', u.sort_order,
               'is_occupied', u.is_occupied,
               'display_name', case when b.hide_resident_names then u.label else u.resident_name end,
               'total_arrears', coalesce((
                  select sum(greatest(p.amount_due - p.amount_paid, 0))
                  from public.payments p
                  where p.unit_id = u.id and p.status in ('unpaid', 'partial')
               ), 0)
             ) order by u.sort_order, u.floor, u.label)
      from public.units u where u.building_id = b.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'cycle_id', p.cycle_id, 'unit_id', p.unit_id,
               'amount_due', p.amount_due, 'amount_paid', p.amount_paid,
               'status', p.status, 'paid_at', p.paid_at
             ))
      from public.payments p where p.building_id = b.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'cycle_id', x.cycle_id, 'title', x.title, 'category', x.category,
               'amount', x.amount, 'expense_date', x.expense_date,
               'receipt_url', x.receipt_url, 'notes', x.notes
             ) order by x.expense_date desc, x.created_at desc)
      from public.expenses x where x.building_id = b.id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_public_building_dashboard(text) from public;
grant execute on function public.get_public_building_dashboard(text) to anon, authenticated;

-- 1-click cycle: now checks the assignment table (superadmin is read-only, so not allowed)
create or replace function public.create_billing_cycle(
  p_building_id uuid,
  p_title       text,
  p_cycle_type  text default 'monthly',
  p_amount      numeric default 0,
  p_cycle_date  date default current_date
)
returns public.billing_cycles
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.billing_cycles%rowtype;
begin
  if not public.is_building_admin(p_building_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.billing_cycles (building_id, title, cycle_type, default_amount, cycle_date)
  values (p_building_id, p_title, coalesce(p_cycle_type, 'monthly'), coalesce(p_amount, 0), coalesce(p_cycle_date, current_date))
  returning * into c;

  insert into public.payments (building_id, cycle_id, unit_id, amount_due, amount_paid, status)
  select p_building_id, c.id, u.id,
         case when u.is_occupied then c.default_amount else 0 end,
         0,
         case when u.is_occupied then 'unpaid' else 'exempt' end
  from public.units u
  where u.building_id = p_building_id;

  return c;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. SIGNED-IN RPCs
-- ---------------------------------------------------------------------

-- Who am I + which buildings do I manage (drives login redirect and guards)
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id',   auth.uid(),
    'role',      coalesce((select role from public.profiles where id = auth.uid()), 'admin'),
    'full_name', coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'is_active', b.is_active)
                       order by b.name)
      from public.building_admins ba join public.buildings b on b.id = ba.building_id
      where ba.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_my_access() from public;
grant execute on function public.get_my_access() to authenticated;

-- Super admin overview: every building with its admins, unit count and fund balance
create or replace function public.superadmin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total_buildings', (select count(*) from public.buildings),
    'active_buildings', (select count(*) from public.buildings where is_active),
    'total_units', (select count(*) from public.units),
    'active_admins', (select count(distinct user_id) from public.building_admins),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'slug', b.slug, 'is_active', b.is_active,
        'currency', b.currency, 'default_monthly_fee', b.default_monthly_fee, 'created_at', b.created_at,
        'unit_count', (select count(*) from public.units u where u.building_id = b.id),
        'fund_balance',
          (select coalesce(sum(amount_paid), 0) from public.payments p where p.building_id = b.id)
          - (select coalesce(sum(amount), 0) from public.expenses x where x.building_id = b.id),
        'admins', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'user_id', pr.id, 'email', pr.email, 'full_name', pr.full_name,
                   'phone', pr.phone, 'role', pr.role, 'assigned_at', ba.assigned_at
                 ) order by ba.assigned_at)
          from public.building_admins ba join public.profiles pr on pr.id = ba.user_id
          where ba.building_id = b.id
        ), '[]'::jsonb)
      ) order by b.created_at desc)
      from public.buildings b
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.superadmin_overview() from public;
grant execute on function public.superadmin_overview() to authenticated;

-- Keep-alive now uses get_public_landing_state; keepalive_ping stays for older workflows.
