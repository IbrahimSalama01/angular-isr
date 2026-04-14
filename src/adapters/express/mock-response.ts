import type { Response } from 'express';

export interface MockResponseResult {
  mockRes: Partial<Response>;
  getHtml: () => Promise<string>;
  /** Rejects the HTML promise. Call this when the Angular handler errors so the promise never hangs. */
  rejectHtml: (err: Error) => void;
}

/**
 * Creates a mock Express Response object that captures HTML output
 * from Angular SSR handlers (AngularNodeAppEngine, CommonEngine, etc.)
 *
 * Returns both the mock response and a promise that resolves with the
 * captured HTML string when the handler calls res.end() or res.send().
 */
export function createMockResponse(): MockResponseResult {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  let resolveHtml!: (html: string) => void;
  let rejectHtml!: (err: Error) => void;

  const htmlPromise = new Promise<string>((resolve, reject) => {
    resolveHtml = resolve;
    rejectHtml = reject;
  });

  const mockRes: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
      return this;
    },
    write(chunk: Buffer | string) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    },
    end(chunk?: Buffer | string) {
      if (chunk) this.write(chunk);
      resolveHtml(Buffer.concat(chunks).toString('utf8'));
      return this;
    },
    send(body: any) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        this.write(body);
        this.end();
      } else {
        this.json(body);
      }
      return this;
    },
    json(obj: any) {
      this.setHeader('Content-Type', 'application/json');
      this.write(JSON.stringify(obj));
      this.end();
      return this;
    },
    on() { return this; },
    once() { return this; },
    emit() { return false; },
  };

  return { mockRes, getHtml: () => htmlPromise, rejectHtml };
}
