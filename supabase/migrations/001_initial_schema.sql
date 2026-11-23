-- =====================================================================
--  لجنة البناء — Building Committee App
--  Migration 001: initial schema, RLS, public RPC, storage
--  Run once in Supabase → SQL Editor (or `supabase db push`).
--  Requires PostgreSQL 15+ (all new Supabase projects).
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL 13+, no extension needed.

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.buildings (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text unique not null
                            check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  owner_id                uuid not null references auth.users(id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 120),
  currency                text not null default 'ل.س',
  default_monthly_fee     numeric(12, 2) not null default 0 check (default_monthly_fee >= 0),
  hide_resident_names     boolean not null default false,
  announcement            text,
  announcement_updated_at timestamptz,
  emergency_contacts      jsonb not null default '[]'::jsonb
                            check (jsonb_typeof(emergency_contacts) = 'array'),
  created_at              timestamptz default now()
);

create table if not exists public.units (
  id              uuid primary key default gen_random_uuid(),
  building_id     uuid not null references public.buildings(id) on delete cascade,
  label           text not null,
  floor           integer not null default 1,
  sort_order      integer not null default 0,
  resident_name   text not null,
  whatsapp_phone  text check (whatsapp_phone is null or whatsapp_phone ~ '^[0-9]{8,15}$'),
  is_occupied     boolean not null default true,
  created_at      timestamptz default now(),
  unique (id, building_id)              -- enables tenant-safe composite FKs
);

create table if not exists public.billing_cycles (
  id              uuid primary key default gen_random_uuid(),
  building_id     uuid not null references public.buildings(id) on delete cascade,
  title           text not null,
  cycle_type      text not null default 'monthly' check (cycle_type in ('monthly', 'special')),
  default_amount  numeric(12, 2) not null default 0 check (default_amount >= 0),
  cycle_date      date not null default current_date,
  created_at      timestamptz default now(),
  unique (id, building_id)
);

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id) on delete cascade,
  cycle_id     uuid not null references public.billing_cycles(id) on delete cascade,
  unit_id      uuid not null references public.units(id) on delete cascade,
  amount_due   numeric(12, 2) not null default 0 check (amount_due >= 0),
  amount_paid  numeric(12, 2) not null default 0 check (amount_paid >= 0),
  status       text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'exempt')),
  paid_at      timestamptz,
  notes        text,
  updated_at   timestamptz default now(),
  unique (cycle_id, unit_id),
  -- a payment can never point to a cycle/unit of another building
  foreign key (cycle_id, building_id) references public.billing_cycles(id, building_id) on delete cascade,
  foreign key (unit_id, building_id)  references public.units(id, building_id) on delete cascade
);

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id) on delete cascade,
  cycle_id      uuid references public.billing_cycles(id) on delete set null,
  title         text not null,
  category      text not null default 'general'
                  check (category in ('electricity', 'water', 'elevator', 'cleaning', 'maintenance', 'general')),
  amount        numeric(12, 2) not null check (amount >= 0),
  expense_date  date not null default current_date,
  receipt_url   text,
  notes         text,
  created_at    timestamptz default now(),
  foreign key (cycle_id, building_id) references public.billing_cycles(id, building_id)
    on delete set null (cycle_id)
);

create index if not exists units_building_idx     on public.units (building_id, sort_order);
create index if not exists cycles_building_idx    on public.billing_cycles (building_id, cycle_date desc);
create index if not exists payments_building_idx  on public.payments (building_id);
create index if not exists payments_unit_idx      on public.payments (unit_id);
create index if not exists expenses_building_idx  on public.expenses (building_id, expense_date desc);
create index if not exists buildings_owner_idx    on public.buildings (owner_id);

-- ---------------------------------------------------------------------
-- 2. TRIGGERS — keep payment status consistent no matter who writes it
-- ---------------------------------------------------------------------

create or replace function public.payments_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'exempt' then
    new.amount_due  := 0;
    new.amount_paid := 0;
    new.paid_at     := null;
  else
    if new.amount_paid >= new.amount_due and (new.amount_due > 0 or new.amount_paid > 0) then
      new.status := 'paid';
    elsif new.amount_paid > 0 then
      new.status := 'partial';
    elsif new.amount_due = 0 then
      new.status := 'paid';
    else
      new.status := 'unpaid';
    end if;

    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
    elsif new.status = 'unpaid' then
      new.paid_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_normalize_trg on public.payments;
create trigger payments_normalize_trg
  before insert or update on public.payments
  for each row execute function public.payments_normalize();

create or replace function public.buildings_touch_announcement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.announcement is distinct from old.announcement then
    new.announcement_updated_at := case when nullif(trim(coalesce(new.announcement, '')), '') is null
                                        then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists buildings_announcement_trg on public.buildings;
create trigger buildings_announcement_trg
  before insert or update on public.buildings
  for each row execute function public.buildings_touch_announcement();

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

-- Ownership helper (SECURITY DEFINER so it can read buildings without RLS recursion)
create or replace function public.is_building_owner(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.buildings
    where id = p_building_id and owner_id = auth.uid()
  );
$$;

revoke all on function public.is_building_owner(uuid) from public;
grant execute on function public.is_building_owner(uuid) to authenticated;

alter table public.buildings      enable row level security;
alter table public.units          enable row level security;
alter table public.billing_cycles enable row level security;
alter table public.payments       enable row level security;
alter table public.expenses       enable row level security;

-- Anonymous visitors get NOTHING directly from tables (phones stay private).
-- They read only through get_public_building_dashboard() below.
revoke all on public.buildings, public.units, public.billing_cycles, public.payments, public.expenses from anon;

-- buildings: owner only
drop policy if exists buildings_owner_select on public.buildings;
drop policy if exists buildings_owner_insert on public.buildings;
drop policy if exists buildings_owner_update on public.buildings;
drop policy if exists buildings_owner_delete on public.buildings;
create policy buildings_owner_select on public.buildings for select to authenticated using (owner_id = auth.uid());
create policy buildings_owner_insert on public.buildings for insert to authenticated with check (owner_id = auth.uid());
create policy buildings_owner_update on public.buildings for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy buildings_owner_delete on public.buildings for delete to authenticated using (owner_id = auth.uid());

-- child tables: owner of the parent building only
do $$
declare t text;
begin
  foreach t in array array['units', 'billing_cycles', 'payments', 'expenses'] loop
    execute format('drop policy if exists %1$s_owner_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_owner_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_owner_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_owner_delete on public.%1$s', t);
    execute format('create policy %1$s_owner_select on public.%1$s for select to authenticated using (public.is_building_owner(building_id))', t);
    execute format('create policy %1$s_owner_insert on public.%1$s for insert to authenticated with check (public.is_building_owner(building_id))', t);
    execute format('create policy %1$s_owner_update on public.%1$s for update to authenticated using (public.is_building_owner(building_id)) with check (public.is_building_owner(building_id))', t);
    execute format('create policy %1$s_owner_delete on public.%1$s for delete to authenticated using (public.is_building_owner(building_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. PUBLIC READ-ONLY DASHBOARD (no phone numbers, no admin notes)
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
  select * into b from public.buildings where slug = lower(trim(p_slug));
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

-- ---------------------------------------------------------------------
-- 5. ADMIN HELPER — create a billing cycle + all payment rows atomically
--    (SECURITY INVOKER: RLS still applies, so only the owner can call it)
-- ---------------------------------------------------------------------

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
  if not public.is_building_owner(p_building_id) then
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

revoke all on function public.create_billing_cycle(uuid, text, text, numeric, date) from public;
grant execute on function public.create_billing_cycle(uuid, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. KEEP-ALIVE PING (used by the GitHub Actions cron; returns no data)
-- ---------------------------------------------------------------------

create or replace function public.keepalive_ping()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'buildings', (select count(*) from public.buildings), 'at', now());
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. STORAGE — public "receipts" bucket, path {building_id}/{expense_id}.jpg
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', true, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Safe folder-ownership check (no uuid cast errors on bad paths)
create or replace function public.owns_building_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.buildings
    where id::text = p_folder and owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_building_folder(text) from public;
grant execute on function public.owns_building_folder(text) to authenticated;

drop policy if exists receipts_public_read  on storage.objects;
drop policy if exists receipts_owner_insert on storage.objects;
drop policy if exists receipts_owner_update on storage.objects;
drop policy if exists receipts_owner_delete on storage.objects;

create policy receipts_public_read on storage.objects
  for select using (bucket_id = 'receipts');

create policy receipts_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));

create policy receipts_owner_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));

create policy receipts_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.owns_building_folder((storage.foldername(name))[1]));
