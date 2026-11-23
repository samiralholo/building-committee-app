import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.isLoggedIn()
    ? true
    : router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

/** Keeps logged-in admins away from the login screen. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.isLoggedIn() ? router.createUrlTree(['/admin']) : true;
};
