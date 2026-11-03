import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { shouldRegisterServiceWorker } from './services/desktopBridge';

// Gestion du cache et du Service Worker PWA (désactivé sur l'application de bureau Electron)
if (typeof window !== 'undefined') {
  try {
    if (!shouldRegisterServiceWorker()) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((reg) => {
            reg.unregister().catch(() => {});
          });
        });
      }
    } else {
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key !== 'tot-stock-v5.6.0-live') {
              caches.delete(key).catch(() => {});
            }
          });
        });
      }
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker
            .register('/sw.js')
            .then((reg) => {
              reg.update().catch(() => {});
            })
            .catch(() => {});
        });
      }
    }
  } catch {}
}

createRoot(document.getElementById('root')!).render(<App />);

