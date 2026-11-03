import type { ResolvedConfig } from './types.js';

/** Builds `https://host:port/b1s/v2/` from the configuration. */
export function buildBaseUrl(config: ResolvedConfig): string {
  const host = config.host.trim().replace(/\/+$/, '');
  const port = config.port ? `:${config.port}` : '';
  return `${host}${port}/b1s/${config.version}/`;
}

/**
 * Converts a resource path or an OData `nextLink` into a path relative to the base URL.
 *
 * Depending on the version, the Service Layer returns `Orders?$skip=20`,
 * `/b1s/v1/Orders?$skip=20` or a full URL. Axios would append an absolute path
 * to the base URL (`/b1s/v1/b1s/v1/Orders`), so the prefix is stripped here.
 */
export function toRelativePath(path: string, version: string): string {
  let result = path.trim();

  if (/^https?:\/\//i.test(result)) {
    const url = new URL(result);
    result = url.pathname + url.search;
  }

  const prefix = `/b1s/${version}/`;
  if (result.startsWith(prefix)) {
    result = result.slice(prefix.length);
  } else if (result.startsWith(prefix.slice(1))) {
    result = result.slice(prefix.length - 1);
  }

  return result.replace(/^\/+/, '');
}
