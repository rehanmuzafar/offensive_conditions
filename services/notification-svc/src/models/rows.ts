/**
 * TypeScript shapes mirroring the `notification` schema tables.
 */

export type Channel = 'email' | 'in_app' | 'webhook' | 'push' | 'sms';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'dropped';
export type DigestFrequency = 'daily' | 'weekly' | 'never';

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  event_type: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  body_source: string;
  body_compiled: string | null;
  variables: string[];
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string;
  event_type: string;
  priority: Priority;
  title: string;
  body: string;
  action_url: string | null;
  icon: string | null;
  metadata: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface PreferenceRow {
  user_id: string;
  event_type: string;
  email_enabled: boolean;
  in_app_enabled: boolean;
  push_enabled: boolean;
  sms_enabled: boolean;
  digest_enabled: boolean;
  digest_frequency: DigestFrequency;
  updated_at: Date;
}

export interface UserSettingsRow {
  user_id: string;
  timezone: string;
  quiet_hours_start: number;
  quiet_hours_end: number;
  respect_quiet: boolean;
  email_address: string | null;
  preferred_locale: string;
  master_unsubscribe: boolean;
  updated_at: Date;
}

export interface WebhookRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  secret: string;
  event_types: string[];
  is_active: boolean;
  failure_count: number;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_failure_msg: string | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DeliveryRow {
  id: string;
  user_id: string;
  notification_id: string | null;
  webhook_id: string | null;
  event_id: string;
  event_type: string;
  channel: Channel;
  provider: string | null;
  provider_msg_id: string | null;
  status: DeliveryStatus;
  attempt: number;
  failure_reason: string | null;
  latency_ms: number | null;
  sent_at: Date | null;
  created_at: Date;
}

export interface ConsumedEventRow {
  event_id: string;
  source_topic: string;
  event_type: string;
  kafka_offset: string | null;
  kafka_partition: number | null;
  consumed_at: Date;
}
