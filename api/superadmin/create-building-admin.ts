// POST /api/superadmin/create-building-admin
// Body: { building_id, full_name, phone, password }
// Superadmin only. Building admins log in with PHONE + password: the auth account uses the hidden
// synthetic email <digits>@phone.lajna.app. If the phone already has an account it is just linked
// (password untouched, a superadmin is never downgraded). The synthetic email is never returned.
import { phoneToAuthEmail } from '../../src/app/core/phone-auth';
import {
  HttpError,
  cleanName,
  handle,
  json,
  readBody,
  requirePassword,
  requirePhone,
  requireSuperadmin,
  requireUuid,
  serviceClient,
} from '../_lib/admin';

interface Body {
  building_id?: unknown;
  full_name?: unknown;
  phone?: unknown;
  password?: unknown;
}

interface ProfileRow {
  id: string;
  role: 'superadmin' | 'admin';
  full_name: string;
  phone: string | null;
}

export const POST = handle(async (req) => {
  const caller = await requireSuperadmin(req);
  const body = await readBody<Body>(req);
  const buildingId = requireUuid(body.building_id, 'building_id');
  const fullName = cleanName(body.full_name);
  const phone = requirePhone(body.phone);
  const authEmail = phoneToAuthEmail(phone);

  const admin = serviceClient();

  const { data: building, error: bErr } = await admin
    .from('buildings')
    .select('id, name, slug')
    .eq('id', buildingId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!building) throw new HttpError(404, 'البناء غير موجود');

  // Existing account? By phone first, then by its synthetic login email.
  let existing: ProfileRow | null = null;
  {
    const byPhone = await admin.from('profiles').select('id, role, full_name, phone').eq('phone', phone).maybeSingle();
    if (byPhone.error) throw byPhone.error;
    existing = (byPhone.data as ProfileRow | null) ?? null;
    if (!existing) {
      const byEmail = await admin.from('profiles').select('id, role, full_name, phone').eq('email', authEmail).maybeSingle();
      if (byEmail.error) throw byEmail.error;
      existing = (byEmail.data as ProfileRow | null) ?? null;
    }
  }

  let userId: string;
  let alreadyExisted: boolean;
  let resultName = fullName;

  if (existing) {
    userId = existing.id;
    alreadyExisted = true;
    resultName = existing.full_name || fullName;
    const patch: Record<string, string> = {};
    if (!existing.full_name) patch['full_name'] = fullName;
    if (!existing.phone) patch['phone'] = phone;
    if (Object.keys(patch).length) {
      const { error } = await admin.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
    }
  } else {
    const password = requirePassword(body.password);
    const { data, error } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    });
    if (error || !data.user) {
      if (error?.message?.toLowerCase().includes('already')) throw new HttpError(409, 'هذا الرقم مستخدم بالفعل لمشرف آخر');
      throw error ?? new Error('createUser failed');
    }
    userId = data.user.id;
    alreadyExisted = false;
    const { error: pErr } = await admin
      .from('profiles')
      .upsert({ id: userId, email: authEmail, full_name: fullName, phone, role: 'admin' }, { onConflict: 'id' });
    if (pErr) {
      await admin.auth.admin.deleteUser(userId);
      if (pErr.code === '23505') throw new HttpError(409, 'هذا الرقم مستخدم بالفعل لمشرف آخر');
      throw pErr;
    }
  }

  const { error: linkErr } = await admin
    .from('building_admins')
    .upsert(
      { building_id: buildingId, user_id: userId, assigned_by: caller.id },
      { onConflict: 'building_id,user_id', ignoreDuplicates: true },
    );
  if (linkErr) {
    if (!alreadyExisted) await admin.auth.admin.deleteUser(userId);
    throw linkErr;
  }

  return json(alreadyExisted ? 200 : 201, {
    user_id: userId,
    full_name: resultName,
    phone,
    already_existed: alreadyExisted,
    building,
  });
});
