/**
 * Mock of `firebase/app` — just enough to keep app code happy.
 */

export interface FirebaseApp { _name: string; }

const apps = new Map<string, FirebaseApp>();

export function initializeApp(_config: any, name: string = '[DEFAULT]'): FirebaseApp {
  let app = apps.get(name);
  if (!app) { app = { _name: name }; apps.set(name, app); }
  return app;
}

export async function deleteApp(app: FirebaseApp): Promise<void> {
  apps.delete(app._name);
}

export function getApps(): FirebaseApp[] {
  return Array.from(apps.values());
}
