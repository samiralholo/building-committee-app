import { Routes } from '@angular/router';

// Only the landing page and the resident view live in the initial bundle path.
// Everything that needs supabase-js (auth, admin, super admin) is a lazy route group.
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'لجنة البناء',
    loadComponent: () => import('./features/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'b/:slug',
    title: 'صندوق البناء',
    loadComponent: () => import('./features/public/public-building').then((m) => m.PublicBuilding),
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'superadmin',
    loadChildren: () => import('./features/superadmin/superadmin.routes').then((m) => m.SUPERADMIN_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
