import { Routes } from '@angular/router';
import { buildingAdminGuard, guestGuard } from '../../core/auth.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    title: 'دخول المشرف',
    canActivate: [guestGuard],
    loadComponent: () => import('./login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [buildingAdminGuard],
    loadComponent: () => import('./admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', title: 'لوحة المشرف', loadComponent: () => import('./dashboard').then((m) => m.Dashboard) },
      { path: 'payments', title: 'تحصيل الدفعات', loadComponent: () => import('./payments').then((m) => m.Payments) },
      { path: 'expenses', title: 'المصاريف', loadComponent: () => import('./expenses').then((m) => m.Expenses) },
      { path: 'units', title: 'الشقق', loadComponent: () => import('./units').then((m) => m.Units) },
      { path: 'settings', title: 'إعدادات البناء', loadComponent: () => import('./settings').then((m) => m.Settings) },
    ],
  },
];
