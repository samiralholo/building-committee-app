// POST /api/superadmin/create-building-admin
// Body: { building_id, full_name, email, phone?, password }
// Superadmin only. Creates the auth user if the email is new (email pre-confirmed),
// otherwise links the existing account. Then assigns it to the building.
import {
  HttpError,
  cleanName,
  handle,
  json,
  optionalPhone,
  readBody,
  requireEmail,
  requirePassword,
  requireSuperadmin,
  requireUuid,
  serviceClient,
} from '../_lib/admin';

interface Body {
  building_id?: unknown;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
}

export const POST = handle(async (req) => {
  const caller = await requireSuperadmin(req);
  const body = await readBody<Body>(req);
  const buildingId = requireUuid(body.building_id, 'building_id');
  const fullName = cleanName(body.full_name);
  const email = requireEmail(body.email);
  const phone = optionalPhone(body.phone);

  const admin = serviceClient();

  const { data: building, error: bErr } = await admin
    .from('buildings')
    .select('id, name, slug')
    .eq('id', buildingId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!building) throw new HttpError(404, 'البناء غير موجود');

  // Existing account? (profiles mirrors auth.users and is kept in sync by a trigger)
  const { data: existing, error: eErr } = await admin
    .from('profiles')
    .select('id, role, full_name, phone')
    .ilike('email', email)
    .maybeSingle();
  if (eErr) throw eErr;

  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id as string;
    // Fill missing details, never demote a superadmin.
    const patch: Record<string, string> = {};
    if (!existing.full_name) patch['full_name'] = fullName;
    if (!existing.phone && phone) patch['phone'] = phone;
    if (Object.keys(patch).length) {
      const { error } = await admin.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
    }
  } else {
    const password = requirePassword(body.password);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    });
    if (error || !data.user) {
      if (error?.message?.toLowerCase().includes('already')) throw new HttpError(409, 'البريد مسجّل من قبل');
      throw error ?? new Error('createUser failed');
    }
    userId = data.user.id;
    created = true;
    // The auth trigger creates the profile; upsert makes it deterministic.
    const { error: pErr } = await admin
      .from('profiles')
      .upsert({ id: userId, email, full_name: fullName, phone, role: 'admin' }, { onConflict: 'id' });
    if (pErr) {
      await admin.auth.admin.deleteUser(userId);
      throw pErr;
    }
  }

  const { error: linkErr } = await admin
    .from('building_admins')
    .upsert({ building_id: buildingId, user_id: userId, assigned_by: caller.id }, { onConflict: 'building_id,user_id', ignoreDuplicates: true });
  if (linkErr) {
    if (created) await admin.auth.admin.deleteUser(userId);
    throw linkErr;
  }

  return json(created ? 201 : 200, { user_id: userId, email, created, building });
});
