// DELETE /api/superadmin/remove-building-admin
// Body: { building_id, user_id }
// Superadmin only. Unlinks the admin from the building; the account itself is kept
// (they may manage other buildings, and payment history stays intact).
import { handle, json, readBody, requireSuperadmin, requireUuid, serviceClient } from '../_lib/admin';

export const DELETE = handle(async (req) => {
  await requireSuperadmin(req);
  const body = await readBody<{ building_id?: unknown; user_id?: unknown }>(req);
  const buildingId = requireUuid(body.building_id, 'building_id');
  const userId = requireUuid(body.user_id, 'user_id');

  const { error } = await serviceClient()
    .from('building_admins')
    .delete()
    .eq('building_id', buildingId)
    .eq('user_id', userId);
  if (error) throw error;

  return json(200, { ok: true });
});
