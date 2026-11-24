// POST /api/superadmin/reset-admin-password
// Body: { user_id, password }
// Superadmin only. Sets a new password for a BUILDING ADMIN account.
// Superadmin accounts are refused here (they change their own password in the app).
// Works for phone-based admins: the password belongs to the auth user, whatever its login email.
import { HttpError, handle, json, readBody, requirePassword, requireSuperadmin, requireUuid, serviceClient } from '../_lib/admin';

export const POST = handle(async (req) => {
  await requireSuperadmin(req);
  const body = await readBody<{ user_id?: unknown; password?: unknown }>(req);
  const userId = requireUuid(body.user_id, 'user_id');
  const password = requirePassword(body.password);

  const admin = serviceClient();
  const { data: target, error: tErr } = await admin
    .from('profiles')
    .select('role, full_name, phone')
    .eq('id', userId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!target) throw new HttpError(404, 'الحساب غير موجود');
  if (target.role === 'superadmin') throw new HttpError(403, 'ما بينفع تغيير كلمة سر مشرف عام من هون');

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw error;

  // Phone (not the hidden login email) so the UI can build the WhatsApp message.
  return json(200, { ok: true, user_id: userId, full_name: target.full_name, phone: target.phone });
});
