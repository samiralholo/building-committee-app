// POST /api/superadmin/reset-admin-password
// Body: { user_id, password }
// Superadmin only. Sets a new password for a BUILDING ADMIN account.
// Superadmin accounts are refused here (they change their own password in the app).
import { HttpError, handle, json, readBody, requirePassword, requireSuperadmin, requireUuid, serviceClient } from '../_lib/admin';

export const POST = handle(async (req) => {
  await requireSuperadmin(req);
  const body = await readBody<{ user_id?: unknown; password?: unknown }>(req);
  const userId = requireUuid(body.user_id, 'user_id');
  const password = requirePassword(body.password);

  const admin = serviceClient();
  const { data: target, error: tErr } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (tErr) throw tErr;
  if (!target) throw new HttpError(404, 'الحساب غير موجود');
  if (target.role === 'superadmin') throw new HttpError(403, 'ما بينفع تغيير كلمة سر مشرف عام من هون');

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw error;

  return json(200, { ok: true });
});
