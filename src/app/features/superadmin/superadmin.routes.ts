import { Routes } from '@angular/router';
import { superAdminGuard } from '../../core/auth.guard';

export const SUPERADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [superAdminGuard],
    loadComponent: () => import('./superadmin-shell').then((m) => m.SuperadminShell),
    children: [
      { path: '', title: 'لوحة السوبر أدمن', loadComponent: () => import('./overview').then((m) => m.Overview) },
      {
        path: 'buildings/:id',
        title: 'معاينة البناء',
        loadComponent: () => import('./inspect-building').then((m) => m.InspectBuilding),
      },
    ],
  },
];
