-- =====================================================================
--  لجنة البناء — Migration 004: selective unit billing + reusable subscriber groups
--  A cycle may include only SOME units (e.g. 20 of 30 elevator subscribers):
--  units without a payments row in a cycle are simply "not included" —
--  not unpaid, not exempt, no arrears.
--  Idempotent: safe to run more than once. Run AFTER 003.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Subscriber groups (admin-only; never sent to residents)
-- ---------------------------------------------------------------------

create table if not exists public.unit_groups (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 80),
  created_at   timestamptz default now(),
  unique (building_id, name)
);

create table if not exists public.unit_group_members (
  group_id  uuid not null references public.unit_groups(id) on delete cascade,
  unit_id   uuid not null references public.units(id) on delete cascade,
  primary key (group_id, unit_id)
);

create index if not exists unit_groups_building_idx on public.unit_groups (building_id);
create index if not exists unit_group_members_unit_idx on public.unit_group_members (unit_id);

-- A group can only contain units of its own building
create or replace function public.unit_group_members_same_building()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select building_id from public.unit_groups where id = new.group_id)
     is distinct from (select building_id from public.units where id = new.unit_id) then
    raise exception 'unit and group belong to different buildings' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists unit_group_members_same_building_trg on public.unit_group_members;
create trigger unit_group_members_same_building_trg
  before insert or update on public.unit_group_members
  for each row execute function public.unit_group_members_same_building();

-- Building of a group (for member RLS without recursion)
create or replace function public.unit_group_building(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select building_id from public.unit_groups where id = p_group_id;
$$;
revoke all on function public.unit_group_building(uuid) from public;
grant execute on function public.unit_group_building(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. RLS: anon nothing · building admin full CRUD on own building · superadmin read-only
-- ---------------------------------------------------------------------

alter table public.unit_groups        enable row level security;
alter table public.unit_group_members enable row level security;
revoke all on public.unit_groups, public.unit_group_members from anon;
grant select, insert, update, delete on public.unit_groups, public.unit_group_members to authenticated;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('unit_groups', 'unit_group_members')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy unit_groups_select on public.unit_groups for select to authenticated
  using (public.is_building_admin(building_id) or public.is_superadmin());
create policy unit_groups_insert on public.unit_groups for insert to authenticated
  with check (public.is_building_admin(building_id));
create policy unit_groups_update on public.unit_groups for update to authenticated
  using (public.is_building_admin(building_id)) with check (public.is_building_admin(building_id));
create policy unit_groups_delete on public.unit_groups for delete to authenticated
  using (public.is_building_admin(building_id));

create policy unit_group_members_select on public.unit_group_members for select to authenticated
  using (public.is_building_admin(public.unit_group_building(group_id)) or public.is_superadmin());
create policy unit_group_members_insert on public.unit_group_members for insert to authenticated
  with check (public.is_building_admin(public.unit_group_building(group_id)));
create policy unit_group_members_update on public.unit_group_members for update to authenticated
  using (public.is_building_admin(public.unit_group_building(group_id)))
  with check (public.is_building_admin(public.unit_group_building(group_id)));
create policy unit_group_members_delete on public.unit_group_members for delete to authenticated
  using (public.is_building_admin(public.unit_group_building(group_id)));

-- ---------------------------------------------------------------------
-- 3. Save a group (name + members) in ONE call. SECURITY INVOKER: RLS applies.
--    p_group_id null → create (or update the group that already has this name).
-- ---------------------------------------------------------------------

create or replace function public.save_unit_group(
  p_building_id uuid,
  p_name        text,
  p_unit_ids    uuid[],
  p_group_id    uuid default null
)
returns public.unit_groups
language plpgsql
security invoker
set search_path = public
as $$
declare
  g public.unit_groups%rowtype;
begin
  if not public.is_building_admin(p_building_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'group name required' using errcode = '22023';
  end if;

  if p_group_id is not null then
    update public.unit_groups set name = trim(p_name)
    where id = p_group_id and building_id = p_building_id
    returning * into g;
    if not found then
      raise exception 'group not found' using errcode = 'P0002';
    end if;
  else
    insert into public.unit_groups (building_id, name)
    values (p_building_id, trim(p_name))
    on conflict (building_id, name) do update set name = excluded.name
    returning * into g;
  end if;

  delete from public.unit_group_members where group_id = g.id;
  insert into public.unit_group_members (group_id, unit_id)
  select g.id, u.id from public.units u
  where u.building_id = p_building_id and u.id = any(coalesce(p_unit_ids, '{}'::uuid[]));

  return g;
end;
$$;
revoke all on function public.save_unit_group(uuid, text, uuid[], uuid) from public;
grant execute on function public.save_unit_group(uuid, text, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. create_billing_cycle: optional p_unit_ids (null = all units, as before)
--    Old 5-argument signature is replaced (not overloaded) so PostgREST calls stay unambiguous.
-- ---------------------------------------------------------------------

drop function if exists public.create_billing_cycle(uuid, text, text, numeric, date);

create or replace function public.create_billing_cycle(
  p_building_id uuid,
  p_title       text,
  p_cycle_type  text default 'monthly',
  p_amount      numeric default 0,
  p_cycle_date  date default current_date,
  p_unit_ids    uuid[] default null
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

  if p_unit_ids is not null and not exists (
    select 1 from public.units u where u.building_id = p_building_id and u.id = any(p_unit_ids)
  ) then
    raise exception 'no units selected' using errcode = '22023';
  end if;

  insert into public.billing_cycles (building_id, title, cycle_type, default_amount, cycle_date)
  values (p_building_id, p_title, coalesce(p_cycle_type, 'monthly'), coalesce(p_amount, 0), coalesce(p_cycle_date, current_date))
  returning * into c;

  -- Only the chosen units get a row; everyone else is simply "not included" in this cycle.
  insert into public.payments (building_id, cycle_id, unit_id, amount_due, amount_paid, status)
  select p_building_id, c.id, u.id,
         case when u.is_occupied then c.default_amount else 0 end,
         0,
         case when u.is_occupied then 'unpaid' else 'exempt' end
  from public.units u
  where u.building_id = p_building_id
    and (p_unit_ids is null or u.id = any(p_unit_ids));

  return c;
end;
$$;
revoke all on function public.create_billing_cycle(uuid, text, text, numeric, date, uuid[]) from public;
grant execute on function public.create_billing_cycle(uuid, text, text, numeric, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Public dashboard: per-cycle stats from INCLUDED units only + total_units.
--    (Groups are admin-only and deliberately not part of this payload.)
-- ---------------------------------------------------------------------

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
    'total_units', (select count(*) from public.units u where u.building_id = b.id),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bc.id, 'title', bc.title, 'cycle_type', bc.cycle_type,
               'default_amount', bc.default_amount, 'cycle_date', bc.cycle_date, 'created_at', bc.created_at,
               -- units that have a row in this cycle (incl. exempt): < total_units ⇒ selective cycle
               'scope_units_count',    s.scope_units_count,
               -- billable units only (exempt excluded), as required for progress & totals
               'included_units_count', s.included_units_count,
               'paid_units_count',     s.paid_units_count,
               'total_due',            s.total_due,
               'total_collected',      s.total_collected
             ) order by bc.cycle_date desc, bc.created_at desc)
      from public.billing_cycles bc
      cross join lateral (
        select count(*)                                                    as scope_units_count,
               count(*) filter (where p.status <> 'exempt')                as included_units_count,
               count(*) filter (where p.status = 'paid')                   as paid_units_count,
               coalesce(sum(p.amount_due)  filter (where p.status <> 'exempt'), 0) as total_due,
               coalesce(sum(p.amount_paid) filter (where p.status <> 'exempt'), 0) as total_collected
        from public.payments p where p.cycle_id = bc.id
      ) s
      where bc.building_id = b.id
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
