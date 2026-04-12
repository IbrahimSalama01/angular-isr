import { timingSafeEqual } from 'crypto';
import type { CmsAdapter, WebhookPayload } from '../types.js';

export interface StrapiAdapterOptions {
  /** Strapi webhook secret token */
  secret: string;
  /**
   * Maps Strapi model UIDs to cache tags.
   * e.g. { 'api::blog-post.blog-post': ['blog'] }
   * Default: uses the model UID as a tag.
   */
  modelTagMap?: Record<string, string[]>;
  /**
   * Extracts the URL path from a Strapi entry.
   * Default: tries entry.attributes?.slug or entry.attributes?.path
   */
  pathResolver?: (entry: Record<string, unknown>, model: string) => string | string[] | undefined;
}

interface StrapiWebhookBody {
  event?: string;
  model?: string;
  uid?: string;
  entry?: {
    id?: number;
    attributes?: {
      slug?: string;
      path?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/**
 * Strapi CMS webhook adapter.
 *
 * Verifies the Authorization bearer token and normalizes
 * Strapi entry webhooks into the canonical WebhookPayload.
 *
 * Usage:
 * ```ts
 * const adapter = new StrapiIsrAdapter({ secret: process.env.STRAPI_WEBHOOK_TOKEN! });
 * const payload = await adapter.parseWebhook(req);
 * ```
 */
export class StrapiIsrAdapter implements CmsAdapter {
  readonly name = 'strapi';

  constructor(private readonly options: StrapiAdapterOptions) {}

  async parseWebhook(req: unknown): Promise<WebhookPayload> {
    const request = req as {
      headers: Record<string, string | undefined>;
      body: StrapiWebhookBody;
    };

    // Verify Authorization bearer token
    const authHeader = request.headers['authorization'];
    const token = authHeader?.replace(/^bearer\s+/i, '');
    if (!token || !verifyToken(token, this.options.secret)) {
      throw new Error('Invalid Strapi webhook authorization');
    }

    const body = request.body ?? {};
    // Strapi uses uid (v4) or model (v3)
    const model = body.uid ?? body.model ?? '';
    const entry = body.entry ?? {};

    const tags = this.resolveTags(model);
    const paths = this.resolvePaths(entry as Record<string, unknown>, model);

    return { paths, tags };
  }

  private resolveTags(model: string): string[] {
    if (this.options.modelTagMap?.[model]) {
      return this.options.modelTagMap[model];
    }
    return model ? [model] : [];
  }

  private resolvePaths(entry: Record<string, unknown>, model: string): string[] | undefined {
    if (this.options.pathResolver) {
      const result = this.options.pathResolver(entry, model);
      if (!result) return undefined;
      return Array.isArray(result) ? result : [result];
    }

    const attrs = entry['attributes'] as Record<string, unknown> | undefined;
    const slug =
      (attrs?.['slug'] as string | undefined) ??
      (attrs?.['path'] as string | undefined) ??
      (entry['slug'] as string | undefined);

    return slug ? [`/${slug}`] : undefined;
  }
}

function verifyToken(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
