import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'geraete' },
  { path: 'geraete', title: 'Geräte', loadComponent: () => import('./pages/devices/devices').then((m) => m.Devices) },
  { path: 'geraete/tauschen', title: 'Gerät tauschen', loadComponent: () => import('./pages/swap/swap').then((m) => m.Swap) },
  { path: 'sicherungen', title: 'Sicherungen', loadComponent: () => import('./pages/backups/backups').then((m) => m.Backups) },
  {
    path: 'sicherungen/:id',
    title: 'Sicherung',
    loadComponent: () => import('./pages/backups/backup-detail').then((m) => m.BackupDetail),
  },
  { path: 'homeegramme', title: 'Homeegramme', loadComponent: () => import('./pages/homeegrams/homeegrams').then((m) => m.Homeegrams) },
  {
    path: 'homeegramme/:id',
    title: 'Homeegramm bearbeiten',
    loadComponent: () => import('./pages/homeegram-editor/homeegram-editor').then((m) => m.HomeegramEditor),
    canDeactivate: [(c: { canLeave(): boolean }) => c.canLeave()],
  },
  { path: 'protokoll', title: 'Verlauf', loadComponent: () => import('./pages/log/log').then((m) => m.Log) },
  { path: 'einrichtung', title: 'Einrichtung', loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup) },
  { path: 'konsole', title: 'Konsole', loadComponent: () => import('./pages/console/console').then((m) => m.Console) },
  { path: '**', redirectTo: 'geraete' },
];
