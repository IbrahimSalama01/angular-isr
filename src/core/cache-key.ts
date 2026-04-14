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
 * Ensures a leading slash and strips query strings, fragments, and trailing slashes.
 */
export function normalizePath(path: string): string {
  if (!path) return '/';
  
  // Strip query string and fragment
  let clean = path.split('?')[0].split('#')[0];
  
  // Ensure leading slash
  if (!clean.startsWith('/')) {
    clean = '/' + clean;
  }
  
  // Remove trailing slash unless it's the root
  if (clean.length > 1 && clean.endsWith('/')) {
    clean = clean.slice(0, -1);
  }
  
  return clean;
}
