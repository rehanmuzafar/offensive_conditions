/**
 * HTTP request/response Zod schemas.
 */

import { z } from 'zod';

export const UuidSchema = z.string().uuid();

// =============================================================================
// Notifications
// =============================================================================

export const NotificationReadSchema = z.object({
  id: UuidSchema,
  event_type: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  title: z.string(),
  body: z.string(),
  action_url: z.string().nullable(),
  icon: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  read_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type NotificationRead = z.infer<typeof NotificationReadSchema>;

export const NotificationListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  unread_only: z.coerce.boolean().default(false),
});

export const MarkReadSchema = z.object({
  ids: z.array(UuidSchema).optional(),
  all: z.boolean().default(false),
}).refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
  message: 'Provide either ids or all=true',
});

// =============================================================================
// Preferences
// =============================================================================

export const PreferenceSchema = z.object({
  event_type: z.string().min(1).max(100),
  email_enabled: z.boolean(),
  in_app_enabled: z.boolean(),
  push_enabled: z.boolean(),
  sms_enabled: z.boolean(),
  digest_enabled: z.boolean(),
  digest_frequency: z.enum(['daily', 'weekly', 'never']),
});

export const PreferencesBulkUpdate = z.object({
  preferences: z.array(PreferenceSchema),
  master_unsubscribe: z.boolean().optional(),
  timezone: z.string().optional(),
  quiet_hours_start: z.number().int().min(0).max(23).optional(),
  quiet_hours_end: z.number().int().min(0).max(23).optional(),
  respect_quiet: z.boolean().optional(),
});

// =============================================================================
// Webhooks
// =============================================================================

export const WebhookCreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().refine((u) => u.startsWith('https://'), {
    message: 'webhook URL must use https',
  }),
  event_types: z.array(z.string().min(1).max(80)).min(1).max(50),
});

export const WebhookUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().optional(),
  event_types: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export const WebhookReadSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  url: z.string().url(),
  event_types: z.array(z.string()),
  is_active: z.boolean(),
  failure_count: z.number().int(),
  last_success_at: z.string().datetime().nullable(),
  last_failure_at: z.string().datetime().nullable(),
  last_failure_msg: z.string().nullable(),
  disabled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

// =============================================================================
// Admin: templates
// =============================================================================

export const TemplateCreateSchema = z.object({
  code: z.string().regex(/^[a-z0-9_.]{2,80}$/i),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  event_type: z.string().min(1).max(80),
  channel: z.enum(['email', 'in_app', 'webhook', 'push', 'sms']),
  locale: z.string().min(2).max(8).default('en'),
  subject: z.string().max(500).nullable().optional(),
  body_source: z.string().min(1).max(200_000),
  variables: z.array(z.string()).default([]),
});

export const TemplateUpdateSchema = TemplateCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const TemplateReadSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  event_type: z.string(),
  channel: z.string(),
  locale: z.string(),
  subject: z.string().nullable(),
  body_source: z.string(),
  body_compiled: z.string().nullable(),
  variables: z.array(z.string()),
  is_active: z.boolean(),
  version: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// =============================================================================
// Admin: broadcast
// =============================================================================

export const BroadcastSchema = z.object({
  event_type: z.string().default('system.announcement'),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  channels: z.array(z.enum(['email', 'in_app'])).default(['in_app']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  action_url: z.string().url().optional(),
  target: z.object({
    all_users: z.boolean().default(false),
    tier: z.enum(['free', 'vip', 'vip_plus', 'team', 'enterprise']).optional(),
    user_ids: z.array(UuidSchema).max(10_000).optional(),
  }),
});

// =============================================================================
// gRPC SendNotification (also used by /v1/internal/send)
// =============================================================================

export const InternalSendSchema = z.object({
  user_id: UuidSchema,
  event_id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(80),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  channels: z.array(z.enum(['email', 'in_app', 'webhook', 'push', 'sms'])).optional(),
  template_code: z.string().optional(),
  variables: z.record(z.string(), z.unknown()).default({}),
  // Optional direct content (skips template lookup)
  title: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
  action_url: z.string().url().optional(),
});
export type InternalSend = z.infer<typeof InternalSendSchema>;

// =============================================================================
// Common
// =============================================================================

export const PageMetaSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
