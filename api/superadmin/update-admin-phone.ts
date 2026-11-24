// POST /api/superadmin/update-admin-phone
// Body: { user_id, new_phone }
// Superadmin only. Changes a building admin's login phone: auth email becomes the new
// synthetic address and profiles.phone/email follow. Rolls auth back if profiles fails.
import { phoneToAuthEmail } from '../../src/app/core/phone-auth';
import { HttpError, handle, json, readBody, requirePhone, requireSuperadmin, requireUuid, serviceClient } from '../_lib/admin';

export const POST = handle(async (req) => {
  await requireSuperadmin(req);
  const body = await readBody<{ user_id?: unknown; new_phone?: unknown }>(req);
  const userId = requireUuid(body.user_id, 'user_id');
  const phone = requirePhone(body.new_phone);
  const authEmail = phoneToAuthEmail(phone);

  const admin = serviceClient();

  const { data: target, error: tErr } = await admin
    .from('profiles')
    .select('id, role, full_name, phone, email')
    .eq('id', userId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!target) throw new HttpError(404, 'الحساب غير موجود');
  if (target.role === 'superadmin') throw new HttpError(403, 'ما بينفع تعديل رقم مشرف عام من هون');

  if (target.phone === phone) {
    return json(200, { user_id: userId, full_name: target.full_name, phone });
  }

  const { data: taken, error: dErr } = await admin.from('profiles').select('id').eq('phone', phone).maybeSingle();
  if (dErr) throw dErr;
  if (taken && taken.id !== userId) throw new HttpError(409, 'هذا الرقم مستخدم بالفعل لمشرف آخر');

  const { data: current, error: gErr } = await admin.auth.admin.getUserById(userId);
  if (gErr || !current.user) throw gErr ?? new HttpError(404, 'الحساب غير موجود');
  const previousEmail = current.user.email ?? '';
  const previousMeta = current.user.user_metadata ?? {};

  const { error: uErr } = await admin.auth.admin.updateUserById(userId, {
    email: authEmail,
    email_confirm: true,
    user_metadata: { ...previousMeta, phone },
  });
  if (uErr) {
    if (uErr.message?.toLowerCase().includes('already')) throw new HttpError(409, 'هذا الرقم مستخدم بالفعل لمشرف آخر');
    throw uErr;
  }

  const { error: pErr } = await admin.from('profiles').update({ phone, email: authEmail }).eq('id', userId);
  if (pErr) {
    // keep auth and profiles consistent
    await admin.auth.admin.updateUserById(userId, { email: previousEmail, email_confirm: true, user_metadata: previousMeta });
    if (pErr.code === '23505') throw new HttpError(409, 'هذا الرقم مستخدم بالفعل لمشرف آخر');
    throw pErr;
  }

  return json(200, { user_id: userId, full_name: target.full_name, phone });
});
