export function getApiBase() {
  // 1) Explicit env at build time (recommended for production)
  const envBase = import.meta.env && import.meta.env.VITE_API_BASE;
  if (envBase) return envBase;

  // 2) Prefer local dev server if running under Vite dev
  //    This avoids hitting production during LAN development.
  //    Force HTTP because the Express API server doesn't use TLS,
  //    even though the Vite dev server is HTTPS (via basicSsl plugin).
  if (typeof window !== 'undefined' && import.meta && import.meta.env && import.meta.env.DEV) {
    const { hostname } = window.location;
    const apiPort = 3001;
    return `http://${hostname}:${apiPort}`;
  }

  // 3) Meta tag allows post-build adjustment in static hosting
  const metaBase = typeof document !== 'undefined'
    ? document.querySelector('meta[name="api-base"]')?.content
    : null;
  if (metaBase) return metaBase;

  // 4) Same-origin + subpath fallback (matches Nginx /air-quality-monitoring/ deployment)
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/air-quality-monitoring`;
  }

  // 5) Final fallback: localhost
  return 'http://localhost:3001';
}
