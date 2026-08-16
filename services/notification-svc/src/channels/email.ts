/**
 * Email channel adapter.
 *
 * Tries the primary provider (default: Resend) and falls back to the
 * secondary (default: SendGrid) on transient errors. Permanent failures
 * (bad address, rejected by both) are recorded in `deliveries` with the
 * failure reason.
 *
 * In dev, set EMAIL_PROVIDER_PRIMARY=mock to bypass provider calls.
 */

import { Resend } from 'resend';

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('email');

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface EmailSendResult {
  provider: 'resend' | 'sendgrid' | 'mock';
  provider_msg_id: string | null;
  latency_ms: number;
}

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend === null) {
    const cfg = getConfig();
    if (!cfg.RESEND_API_KEY) {
      throw new AppError(ErrorCode.CHANNEL_UNAVAILABLE, 'Resend not configured');
    }
    _resend = new Resend(cfg.RESEND_API_KEY);
  }
  return _resend;
}

async function sendViaResend(input: EmailSendInput): Promise<EmailSendResult> {
  const cfg = getConfig();
  const client = getResend();
  const start = Date.now();
  const result = await client.emails.send({
    from: `${cfg.EMAIL_FROM_NAME} <${cfg.EMAIL_FROM_ADDRESS}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.reply_to ?? cfg.EMAIL_REPLY_TO,
    tags: input.tags?.map((t) => ({ name: t.name, value: t.value })),
  });
  const latency = Date.now() - start;
  if (result.error) {
    throw new AppError(ErrorCode.DELIVERY_FAILED, `Resend error: ${result.error.message}`, {
      provider: 'resend',
      error_name: result.error.name,
    });
  }
  return {
    provider: 'resend',
    provider_msg_id: result.data?.id ?? null,
    latency_ms: latency,
  };
}

async function sendViaSendGrid(input: EmailSendInput): Promise<EmailSendResult> {
  // SendGrid SDK isn't in deps; we hit their REST API directly. This is fine —
  // it's a small surface area for a failover path.
  const cfg = getConfig();
  if (!cfg.SENDGRID_API_KEY) {
    throw new AppError(ErrorCode.CHANNEL_UNAVAILABLE, 'SendGrid not configured');
  }
  const start = Date.now();
  const body = {
    personalizations: [{ to: [{ email: input.to }], subject: input.subject }],
    from: { email: cfg.EMAIL_FROM_ADDRESS, name: cfg.EMAIL_FROM_NAME },
    reply_to: input.reply_to ? { email: input.reply_to } : undefined,
    content: [
      { type: 'text/plain', value: input.text },
      { type: 'text/html', value: input.html },
    ],
    categories: input.tags?.map((t) => `${t.name}:${t.value}`),
  };
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latency = Date.now() - start;
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new AppError(
      ErrorCode.DELIVERY_FAILED,
      `SendGrid HTTP ${response.status}: ${errText.slice(0, 500)}`,
      { provider: 'sendgrid', status: response.status },
    );
  }
  return {
    provider: 'sendgrid',
    provider_msg_id: response.headers.get('x-message-id'),
    latency_ms: latency,
  };
}

function sendViaMock(input: EmailSendInput): EmailSendResult {
  log.info(
    { to: input.to, subject: input.subject, body_preview: input.text.slice(0, 200) },
    'mock_email_sent',
  );
  return { provider: 'mock', provider_msg_id: `mock_${Date.now()}`, latency_ms: 0 };
}

/**
 * Send an email via the configured primary provider, falling back to the
 * failover on transient failures.
 */
export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const cfg = getConfig();
  const primary = cfg.EMAIL_PROVIDER_PRIMARY;

  if (primary === 'mock') {
    return sendViaMock(input);
  }

  try {
    if (primary === 'resend') return await sendViaResend(input);
    return await sendViaSendGrid(input);
  } catch (err) {
    log.warn({ err, provider: primary, to: input.to }, 'email_primary_failed');
    const failover = cfg.EMAIL_PROVIDER_FAILOVER;
    if (failover === 'none' || failover === primary) {
      throw err;
    }
    if (failover === 'mock') return sendViaMock(input);
    if (failover === 'resend') return sendViaResend(input);
    return sendViaSendGrid(input);
  }
}
