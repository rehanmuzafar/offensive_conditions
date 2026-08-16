/**
 * Template rendering.
 *
 * Handlebars is the variable-substitution engine for every channel. For
 * email, the source is MJML — we compile to HTML once at template-create
 * time (caching `body_compiled`), then run Handlebars over the compiled
 * HTML per-recipient.
 *
 * Plain-text email fallback is derived via html-to-text.
 */

import { createHash } from 'node:crypto';

import Handlebars from 'handlebars';
import mjml2html from 'mjml';
import { convert as htmlToText } from 'html-to-text';

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('template-render');

// Cache compiled Handlebars templates by source hash to avoid recompiling per render.
const handlebarsCache = new Map<string, HandlebarsTemplateDelegate>();

function hbCompile(source: string): HandlebarsTemplateDelegate {
  const key = createHash('sha1').update(source).digest('hex');
  const cached = handlebarsCache.get(key);
  if (cached) return cached;
  const compiled = Handlebars.compile(source, {
    noEscape: false,
    strict: false,
    preventIndent: true,
  });
  handlebarsCache.set(key, compiled);
  return compiled;
}

// Register a few helpers used across templates
Handlebars.registerHelper('formatCents', function (cents: unknown, currency: unknown) {
  const c = Number(cents);
  const cur = typeof currency === 'string' ? currency : 'USD';
  if (!Number.isFinite(c)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);
});

Handlebars.registerHelper('default', function (value: unknown, fallback: unknown) {
  return value === undefined || value === null || value === '' ? fallback : value;
});

Handlebars.registerHelper('json', function (value: unknown) {
  return JSON.stringify(value);
});

export interface RenderedTemplate {
  subject: string | null;
  body_html: string | null;   // Channel email: HTML; in_app: NULL (use body_text)
  body_text: string;          // Always present (in_app uses this as body)
}

/**
 * Compile MJML source to HTML. Returns the HTML, throws AppError on invalid
 * MJML.
 */
export function compileMjml(source: string): string {
  // mjml2html is synchronous — cast to any to avoid version type drift.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (mjml2html as any)(source, {
    keepComments: false,
    validationLevel: 'soft',
    minify: true,
  }) as { errors: { formattedMessage: string }[]; html: string };
  if (result.errors.length > 0) {
    const messages = result.errors.map((e) => e.formattedMessage).join('; ');
    log.warn({ errors: result.errors }, 'mjml_warnings');
    if (!result.html) {
      throw new AppError(ErrorCode.TEMPLATE_INVALID, `MJML compile failed: ${messages}`);
    }
  }
  return result.html;
}

export interface RenderOptions {
  channel: 'email' | 'in_app' | 'webhook' | 'push' | 'sms';
  subject_template: string | null;   // Handlebars template; null/empty for in-app body-only
  body_source: string;                // MJML for email, plaintext / handlebars for others
  body_compiled: string | null;       // Pre-compiled HTML for email (skips MJML step)
  variables: Record<string, unknown>;
}

/**
 * Render a template for a single recipient.
 */
export function render(opts: RenderOptions): RenderedTemplate {
  const vars = opts.variables ?? {};
  let subject: string | null = null;
  if (opts.subject_template) {
    try {
      subject = hbCompile(opts.subject_template)(vars);
    } catch (err) {
      throw new AppError(
        ErrorCode.TEMPLATE_INVALID,
        `subject template failed to render: ${(err as Error).message}`,
      );
    }
  }

  if (opts.channel === 'email') {
    // Use compiled HTML if available; otherwise compile MJML now (slow path)
    const htmlSource = opts.body_compiled ?? compileMjml(opts.body_source);
    let html: string;
    try {
      html = hbCompile(htmlSource)(vars);
    } catch (err) {
      throw new AppError(
        ErrorCode.TEMPLATE_INVALID,
        `email body failed to render: ${(err as Error).message}`,
      );
    }
    const text = htmlToText(html, {
      wordwrap: 80,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { ignoreHref: false } },
      ],
    });
    return { subject, body_html: html, body_text: text };
  }

  // in_app / webhook / push / sms — Handlebars over plain source
  let body: string;
  try {
    body = hbCompile(opts.body_source)(vars);
  } catch (err) {
    throw new AppError(
      ErrorCode.TEMPLATE_INVALID,
      `body failed to render: ${(err as Error).message}`,
    );
  }
  return { subject, body_html: null, body_text: body };
}

/**
 * Compile a Handlebars expression once. Used by tests + event_routes for inline
 * title/body templates that don't live in the DB.
 */
export function compileInline(source: string, variables: Record<string, unknown>): string {
  try {
    return hbCompile(source)(variables);
  } catch (err) {
    log.warn({ err, source: source.slice(0, 100) }, 'inline_template_failed');
    return source;
  }
}
