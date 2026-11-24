-- =====================================================================
--  لجنة البناء — Seed data (one pilot building)
--
--  ⚠️ BEFORE running this file:
--    1. Run supabase/migrations/001_initial_schema.sql, then 002_superadmin_and_roles.sql
--    2. Create your admin user: Supabase Dashboard → Authentication → Users
--       → "Add user" → "Create new user" (email + password, tick "Auto Confirm User")
--
--  This seed assigns the building to the OLDEST user in auth.users
--  (i.e. the admin you just created). To assign another admin later, use the
--  Super Admin portal (/superadmin) or:
--
--    insert into public.building_admins (building_id, user_id)
--    select b.id, u.id from public.buildings b, auth.users u
--    where b.slug = 'al-yasmin-14' and u.email = 'someone@example.com';
--
--  Safe to re-run: it deletes and recreates the 'al-yasmin-14' building.
-- =====================================================================

do $$
declare
  v_owner    uuid;
  v_building uuid := '11111111-1111-4111-8111-111111111111';
  v_c1       uuid := '22222222-2222-4222-8222-222222222201'; -- previous month
  v_c2       uuid := '22222222-2222-4222-8222-222222222202'; -- current month
  u1 uuid := '33333333-3333-4333-8333-333333333301';
  u2 uuid := '33333333-3333-4333-8333-333333333302';
  u3 uuid := '33333333-3333-4333-8333-333333333303';
  u4 uuid := '33333333-3333-4333-8333-333333333304';
  u5 uuid := '33333333-3333-4333-8333-333333333305';
  u6 uuid := '33333333-3333-4333-8333-333333333306';
  u7 uuid := '33333333-3333-4333-8333-333333333307';
  u8 uuid := '33333333-3333-4333-8333-333333333308';
begin
  select id into v_owner from auth.users order by created_at asc limit 1;
  if v_owner is null then
    raise exception 'No users found. Create your admin user in Authentication → Users first, then run seed.sql again.';
  end if;

  delete from public.buildings where slug = 'al-yasmin-14';

  insert into public.buildings (id, slug, owner_id, name, currency, default_monthly_fee,
                                hide_resident_names, announcement, emergency_contacts)
  values (
    v_building, 'al-yasmin-14', v_owner, 'بناء الياسمين - مدخل أ', 'ل.س', 50000, false,
    'تنظيف خزان المياه يوم الجمعة من الساعة 9 الصبح حتى 12 الظهر. الرجاء تعبئة المياه مسبقاً 🙏',
    '[
      {"name": "أبو سامر", "role": "مشرف البناء",  "phone": "963933000111"},
      {"name": "أبو علي",  "role": "سبّاك",        "phone": "963944000222"},
      {"name": "أبو محمود","role": "كهربجي",       "phone": "963955000333"},
      {"name": "شركة الأمان للمصاعد", "role": "فني المصعد", "phone": "963966000444"}
    ]'::jsonb
  );

  insert into public.building_admins (building_id, user_id) values (v_building, v_owner)
  on conflict (building_id, user_id) do nothing;

  insert into public.units (id, building_id, label, floor, sort_order, resident_name, whatsapp_phone, is_occupied) values
    (u1, v_building, 'طابق 1 - يمين', 1, 1, 'أبو أحمد الحلبي',  '963933111001', true),
    (u2, v_building, 'طابق 1 - يسار', 1, 2, 'أم خالد',          '963933111002', true),
    (u3, v_building, 'طابق 2 - يمين', 2, 3, 'أبو يوسف',         '963933111003', true),
    (u4, v_building, 'طابق 2 - يسار', 2, 4, 'عائلة الشامي',     '963933111004', true),
    (u5, v_building, 'طابق 3 - يمين', 3, 5, 'أبو رامي',         '963933111005', true),
    (u6, v_building, 'طابق 3 - يسار', 3, 6, 'شقة فارغة',        null,           false),
    (u7, v_building, 'طابق 4 - يمين', 4, 7, 'أم سليم',          '963933111007', true),
    (u8, v_building, 'طابق 4 - يسار', 4, 8, 'أبو فادي',         null,           true);

  insert into public.billing_cycles (id, building_id, title, cycle_type, default_amount, cycle_date) values
    (v_c1, v_building, 'تشرين الأول 2026',  'monthly', 50000, date '2026-10-01'),
    (v_c2, v_building, 'تشرين الثاني 2026', 'monthly', 50000, date '2026-11-01');

  -- Previous month: almost everyone paid (status is normalized by trigger)
  insert into public.payments (building_id, cycle_id, unit_id, amount_due, amount_paid, status, paid_at, notes) values
    (v_building, v_c1, u1, 50000, 50000, 'paid',   timestamptz '2026-10-03 18:00+03', null),
    (v_building, v_c1, u2, 50000, 50000, 'paid',   timestamptz '2026-10-04 12:30+03', null),
    (v_building, v_c1, u3, 50000, 50000, 'paid',   timestamptz '2026-10-05 20:10+03', null),
    (v_building, v_c1, u4, 50000, 25000, 'partial', null, 'دفع نصف المبلغ والباقي أول الشهر'),
    (v_building, v_c1, u5, 50000, 50000, 'paid',   timestamptz '2026-10-07 09:15+03', null),
    (v_building, v_c1, u6, 0,     0,     'exempt', null, 'شقة فارغة'),
    (v_building, v_c1, u7, 50000, 50000, 'paid',   timestamptz '2026-10-02 17:45+03', null),
    (v_building, v_c1, u8, 50000, 0,     'unpaid', null, null);

  -- Current month: mixed
  insert into public.payments (building_id, cycle_id, unit_id, amount_due, amount_paid, status, paid_at, notes) values
    (v_building, v_c2, u1, 50000, 50000, 'paid',    timestamptz '2026-11-02 19:00+03', null),
    (v_building, v_c2, u2, 50000, 50000, 'paid',    timestamptz '2026-11-03 11:20+03', null),
    (v_building, v_c2, u3, 50000, 20000, 'partial', null, 'رح يكمّل الباقي آخر الشهر'),
    (v_building, v_c2, u4, 50000, 0,     'unpaid',  null, null),
    (v_building, v_c2, u5, 50000, 50000, 'paid',    timestamptz '2026-11-05 21:05+03', null),
    (v_building, v_c2, u6, 0,     0,     'exempt',  null, 'شقة فارغة'),
    (v_building, v_c2, u7, 50000, 50000, 'paid',    timestamptz '2026-11-01 16:40+03', null),
    (v_building, v_c2, u8, 50000, 0,     'unpaid',  null, null);

  insert into public.expenses (building_id, cycle_id, title, category, amount, expense_date, notes) values
    (v_building, v_c1, 'فاتورة كهرباء الدرج',    'electricity', 42000,  date '2026-10-12', 'فاتورة شهرين'),
    (v_building, v_c1, 'صيانة المصعد الدورية',   'elevator',    150000, date '2026-10-20', 'تبديل حبل وتزييت'),
    (v_building, v_c2, 'تنظيف الدرج والمدخل',    'cleaning',    30000,  date '2026-11-08', null);
end $$;
