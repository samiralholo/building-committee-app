import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccessService } from './access.service';
import { AuthService } from './auth.service';

async function signedInAccess() {
  const auth = inject(AuthService);
  const access = inject(AccessService);
  await auth.ready;
  if (!auth.isLoggedIn()) return null;
  try {
    return await access.load();
  } catch {
    return null;
  }
}

/** Building-admin portal (/admin): needs a login. A superadmin with no assigned building is sent to /superadmin. */
export const buildingAdminGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const acc = await signedInAccess();
  if (!acc) return router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
  if (acc.role === 'superadmin' && acc.buildings.length === 0) return router.createUrlTree(['/superadmin']);
  return true;
};

/** Super Admin portal (/superadmin). */
export const superAdminGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const acc = await signedInAccess();
  if (!acc) return router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
  return acc.role === 'superadmin' ? true : router.createUrlTree(['/admin']);
};

/** Keeps signed-in users away from the login screen, sending each role to its portal. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const access = inject(AccessService);
  const acc = await signedInAccess();
  return acc ? router.createUrlTree([access.homeUrl(acc)]) : true;
};
