import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

// Demo-mode bootstrap: seed users + fake Firestore data and auto-login.
// The `firebase/*` imports below resolve to our mocks via Vite alias when
// VITE_DEMO_MODE === 'true' (see vite.config.ts).
if (import.meta.env.VITE_DEMO_MODE === 'true') {
  const { seedDemo, autoSignInIfNeeded } = await import('./lib/mock/demo-seed');
  const { owner } = seedDemo();
  autoSignInIfNeeded(owner);
}

createRoot(document.getElementById('root')!).render(<App />);
