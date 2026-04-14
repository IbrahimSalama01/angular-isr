import type { Request } from 'express';

export interface MockRequestOptions {
  hostname?: string;
  protocol?: string;
  headers?: Record<string, string>;
}

/**
 * Creates a minimal but complete mock Express Request object for use in
 * background revalidation jobs where no real request is available.
 *
 * Angular SSR commonly accesses: req.hostname, req.protocol, req.url,
 * req.headers, req.query, req.params — all covered here.
 */
export function createMockRequest(path: string, options?: MockRequestOptions): Request {
  const hostname = options?.hostname ?? 'localhost';
  const protocol = options?.protocol ?? 'http';
  const headers = { host: hostname, ...options?.headers };

  return {
    path,
    url: path,
    originalUrl: path,
    baseUrl: '',
    method: 'GET',
    headers,
    hostname,
    host: hostname,
    protocol,
    secure: protocol === 'https',
    query: {},
    params: {},
    cookies: {},
    signedCookies: {},
    body: undefined,
    ip: '127.0.0.1',
    ips: [],
    subdomains: [],
    fresh: false,
    stale: true,
    xhr: false,
    app: {} as any,
    res: undefined as any,
    next: undefined as any,
    socket: { remoteAddress: '127.0.0.1' } as any,
    connection: { remoteAddress: '127.0.0.1' } as any,
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    complete: true,
    trailers: {},
    rawTrailers: [],
    rawHeaders: [],
    aborted: false,
    destroyed: false,
    get(name: string): string {
      return (headers as Record<string, string>)[name.toLowerCase()] ?? '';
    },
    header(name: string): string {
      return (headers as Record<string, string>)[name.toLowerCase()] ?? '';
    },
    accepts(): string { return 'text/html'; },
    acceptsCharsets(): string { return 'utf-8'; },
    acceptsEncodings(): string { return 'identity'; },
    acceptsLanguages(): string { return 'en'; },
    is(): string | false { return false; },
    range(): undefined { return undefined; },
    param(): string { return ''; },
    route: {} as any,
  } as unknown as Request;
}
