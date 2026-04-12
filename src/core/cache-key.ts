const DEFAULT_VERSION = '0';

/**
 * Builds the default cache key: `tenantId:version:path`
 * Tenant isolation and cache versioning are enforced at this layer.
 */
export function defaultCacheKeyResolver(
  tenantId: string,
  version: string,
  path: string,
): string {
  const normalizedPath = normalizePath(path);
  const v = version || DEFAULT_VERSION;
  return `${tenantId}:${v}:${normalizedPath}`;
}

/**
 * Normalizes a URL path for consistent cache key generation.
 * Strips query strings and trailing slashes (except root '/').
 */
export function normalizePath(path: string): string {
  // Strip query string and fragment
  const clean = path.split('?')[0].split('#')[0];
  // Remove trailing slash unless it's the root
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}
