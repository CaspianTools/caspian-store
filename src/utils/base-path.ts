/**
 * Mounting the store under a sub-path (`/store`) of a host app (v15.4.0).
 *
 * Library code renders and routes on root-relative paths (`/cart`,
 * `/product/x`, `/admin/orders`). The provider wraps the host's Link and
 * navigation adapters so those paths gain the base path on the way out and
 * lose it on the way in — the same approach as `localeInUrl`.
 */

/** `'store'`, `'/store/'` → `'/store'`; `''` / `'/'` → `''`. */
export function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) return '';
  const trimmed = basePath.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** `('/cart', '/store')` → `/store/cart`. Non-root-relative hrefs and already-based ones are left alone. */
export function withBasePath(href: string, basePath: string): string {
  if (!basePath || !href.startsWith('/') || href.startsWith('//')) return href;
  if (href === basePath || href.startsWith(`${basePath}/`) || href.startsWith(`${basePath}?`)) return href;
  if (href === '/') return basePath;
  return `${basePath}${href}`;
}

/** `('/store/cart', '/store')` → `/cart`; paths outside the base path are returned unchanged. */
export function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}
