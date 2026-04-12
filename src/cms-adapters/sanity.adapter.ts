import { createHmac, timingSafeEqual } from 'crypto';
import type { CmsAdapter, WebhookPayload } from '../types.js';

export interface SanityAdapterOptions {
  /** Sanity webhook signing secret */
  secret: string;
  /**
   * Maps Sanity document _type values to cache tags.
   * Default: uses the _type value as a tag.
   */
  documentTypeTagMap?: Record<string, string[]>;
  /**
   * Extracts the URL path from a Sanity document.
   * Default: tries doc.slug?.current or doc.path
   */
  pathResolver?: (doc: Record<string, unknown>, type: string) => string | string[] | undefined;
}

interface SanityWebhookBody {
  _type?: string;
  _id?: string;
  slug?: { current?: string };
  path?: string;
  [key: string]: unknown;
}

/**
 * Sanity CMS webhook adapter.
 *
 * Verifies the HMAC-SHA256 signature from the `sanity-webhook-signature` header
 * and normalizes Sanity document webhooks into the canonical WebhookPayload.
 *
 * Usage:
 * ```ts
 * const adapter = new SanityIsrAdapter({ secret: process.env.SANITY_WEBHOOK_SECRET! });
 * const payload = await adapter.parseWebhook(req);
 * ```
 */
export class SanityIsrAdapter implements CmsAdapter {
  readonly name = 'sanity';

  constructor(private readonly options: SanityAdapterOptions) {}

  async parseWebhook(req: unknown): Promise<WebhookPayload> {
    const request = req as {
      headers: Record<string, string | undefined>;
      body: SanityWebhookBody;
      rawBody?: string;
    };

    // Verify HMAC signature
    const signature = request.headers['sanity-webhook-signature'];
    if (!signature) {
      throw new Error('Missing sanity-webhook-signature header');
    }

    const rawBody = request.rawBody ?? JSON.stringify(request.body);
    if (!verifyHmac(rawBody, this.options.secret, signature)) {
      throw new Error('Invalid Sanity webhook signature');
    }

    const doc = request.body ?? {};
    const docType = doc._type ?? '';

    const tags = this.resolveTags(docType);
    const paths = this.resolvePaths(doc, docType);

    return { paths, tags };
  }

  private resolveTags(docType: string): string[] {
    if (this.options.documentTypeTagMap?.[docType]) {
      return this.options.documentTypeTagMap[docType];
    }
    return docType ? [docType] : [];
  }

  private resolvePaths(doc: SanityWebhookBody, docType: string): string[] | undefined {
    if (this.options.pathResolver) {
      const result = this.options.pathResolver(doc as Record<string, unknown>, docType);
      if (!result) return undefined;
      return Array.isArray(result) ? result : [result];
    }

    const slug = doc.slug?.current ?? doc.path;
    return slug ? [`/${slug}`] : undefined;
  }
}

function verifyHmac(payload: string, secret: string, signature: string): boolean {
  try {
    // Sanity signature format: "v1=<hex>"
    const [, hex] = signature.split('=');
    if (!hex) return false;

    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(hex, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
