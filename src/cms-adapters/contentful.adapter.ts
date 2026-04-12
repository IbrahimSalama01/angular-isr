import type { CmsAdapter, WebhookPayload } from '../types.js';

export interface ContentfulAdapterOptions {
  /** Shared secret set in Contentful webhook settings */
  secret: string;
  /**
   * Maps Contentful contentType IDs to cache tags.
   * e.g. { blogPost: ['blog', 'content'], author: ['authors'] }
   * Default: uses the contentType ID as a tag.
   */
  contentTypeTagMap?: Record<string, string[]>;
  /**
   * Extracts the URL path from an entry's fields.
   * Default: tries fields.slug?.['en-US'] or fields.path?.['en-US']
   */
  pathResolver?: (fields: Record<string, unknown>, contentType: string) => string | string[] | undefined;
}

interface ContentfulWebhookBody {
  sys?: {
    type?: string;
    contentType?: { sys?: { id?: string } };
    id?: string;
  };
  fields?: Record<string, Record<string, unknown>>;
}

/**
 * Contentful CMS webhook adapter.
 *
 * Verifies X-Contentful-Webhook-Secret header and normalizes
 * Contentful entry/asset webhooks into the canonical WebhookPayload.
 *
 * Usage:
 * ```ts
 * const adapter = new ContentfulIsrAdapter({ secret: process.env.CONTENTFUL_WEBHOOK_SECRET! });
 * const payload = await adapter.parseWebhook(req);
 * ```
 */
export class ContentfulIsrAdapter implements CmsAdapter {
  readonly name = 'contentful';

  constructor(private readonly options: ContentfulAdapterOptions) {}

  async parseWebhook(req: unknown): Promise<WebhookPayload> {
    const request = req as { headers: Record<string, string | undefined>; body: ContentfulWebhookBody };

    // Verify secret
    const providedSecret = request.headers['x-contentful-webhook-secret'];
    if (!providedSecret || providedSecret !== this.options.secret) {
      throw new Error('Invalid Contentful webhook secret');
    }

    const body = request.body ?? {};
    const contentType = body.sys?.contentType?.sys?.id ?? '';
    const fields = body.fields ?? {};

    const tags = this.resolveTags(contentType);
    const paths = this.resolvePaths(fields, contentType);

    return { paths, tags };
  }

  private resolveTags(contentType: string): string[] {
    if (this.options.contentTypeTagMap?.[contentType]) {
      return this.options.contentTypeTagMap[contentType];
    }
    return contentType ? [contentType] : [];
  }

  private resolvePaths(fields: Record<string, Record<string, unknown>>, contentType: string): string[] | undefined {
    if (this.options.pathResolver) {
      const result = this.options.pathResolver(fields, contentType);
      if (!result) return undefined;
      return Array.isArray(result) ? result : [result];
    }

    // Default: try common slug/path field names
    const locale = 'en-US';
    const slug =
      (fields['slug']?.[locale] as string | undefined) ??
      (fields['path']?.[locale] as string | undefined) ??
      (fields['url']?.[locale] as string | undefined);

    return slug ? [`/${slug}`] : undefined;
  }
}
