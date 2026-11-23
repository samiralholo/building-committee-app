import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

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
    path: 'admin/login',
    title: 'دخول المشرف',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/admin/login').then((m) => m.Login),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: '',
        title: 'لوحة المشرف',
        loadComponent: () => import('./features/admin/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'payments',
        title: 'تحصيل الدفعات',
        loadComponent: () => import('./features/admin/payments').then((m) => m.Payments),
      },
      {
        path: 'expenses',
        title: 'المصاريف',
        loadComponent: () => import('./features/admin/expenses').then((m) => m.Expenses),
      },
      {
        path: 'units',
        title: 'الشقق',
        loadComponent: () => import('./features/admin/units').then((m) => m.Units),
      },
      {
        path: 'settings',
        title: 'إعدادات البناء',
        loadComponent: () => import('./features/admin/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
