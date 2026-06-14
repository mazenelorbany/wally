// Service-worker registration. We only register in production builds: in dev,
// Vite's module graph + HMR must not be intercepted by a cache. The SW itself
// (public/sw.js) is a plain script served at the origin root so its scope
// covers the whole app.

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Non-fatal: the app works online without the SW. Never throw.
         
        console.warn('[wally] service worker registration failed', err);
      });
  });
}
