-- =====================================================================
--  لجنة البناء — Migration 003: phone-based building admins
--  - profiles.phone normalized (international digits, no "+") + unique
--  - platform_settings (superadmin-only) + get_support_whatsapp() public RPC
--  - get_my_access() also returns the caller's phone
--  Idempotent: safe to run more than once. Run AFTER 002.
--
--  Building admins sign in with "phone + password". Under the hood their Supabase
--  Auth email is <digits>@phone.lajna.app (never shown in the app).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Phone normalization in SQL (same rules as src/app/core/phone-auth.ts)
-- ---------------------------------------------------------------------

create or replace function public.normalize_phone_digits(p_raw text, p_cc text default '963')
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s    text;
  intl boolean := false;
begin
  if p_raw is null then
    return null;
  end if;
  s := translate(p_raw, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(s, '[[:space:]  -​‐-―−().\/‎‏‪-‮⁦-⁩﻿-]', '', 'g');
  if s !~ '^\+?[0-9]+$' then
    return null;
  end if;
  if left(s, 1) = '+' then
    s := substr(s, 2); intl := true;
  elsif left(s, 2) = '00' then
    s := substr(s, 3); intl := true;
  end if;
  if intl then
    if left(s, length(p_cc) + 1) = p_cc || '0' then
      s := p_cc || substr(s, length(p_cc) + 2);
    end if;
  elsif left(s, 1) = '0' and length(s) between 9 and 11 then
    s := p_cc || substr(s, 2);
  elsif left(s, 1) = '9' and length(s) = 9 then
    s := p_cc || s;
  end if;
  return case when s ~ '^[1-9][0-9]{9,14}$' then s else null end;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. profiles.phone: clean existing values, then one account per number
-- ---------------------------------------------------------------------

update public.profiles
set phone = public.normalize_phone_digits(phone)
where phone is not null
  and phone is distinct from public.normalize_phone_digits(phone);

-- If two accounts now share a number, keep it on the oldest and clear the others (never block the migration).
with ranked as (
  select id, row_number() over (partition by phone order by created_at, id) as rn
  from public.profiles
  where phone is not null and phone <> ''
)
update public.profiles p
set phone = null
from ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists profiles_phone_unique_idx
  on public.profiles (phone)
  where phone is not null and phone <> '';

-- New auth users: store the normalized phone from user metadata (the API already sends it normalized).
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
    public.normalize_phone_digits(nullif(new.raw_user_meta_data ->> 'phone', ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. platform_settings (superadmin only) + public support WhatsApp RPC
-- ---------------------------------------------------------------------

create table if not exists public.platform_settings (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz default now()
);

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon;
grant select, insert, update, delete on public.platform_settings to authenticated;

drop policy if exists platform_settings_superadmin on public.platform_settings;
create policy platform_settings_superadmin on public.platform_settings
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create or replace function public.platform_settings_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_settings_touch_trg on public.platform_settings;
create trigger platform_settings_touch_trg
  before insert or update on public.platform_settings
  for each row execute function public.platform_settings_touch();

-- Exposes ONLY the support number (for "نسيت كلمة المرور؟" on the login page).
create or replace function public.get_support_whatsapp()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(value, '') from public.platform_settings where key = 'support_whatsapp_phone';
$$;
revoke all on function public.get_support_whatsapp() from public;
grant execute on function public.get_support_whatsapp() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. get_my_access(): also return the caller's phone (shown instead of any login email)
-- ---------------------------------------------------------------------

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
    'phone',     (select phone from public.profiles where id = auth.uid()),
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
