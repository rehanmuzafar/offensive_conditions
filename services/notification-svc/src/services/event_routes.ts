/**
 * Event routing table.
 *
 * Maps an inbound domain event_type to:
 *   - The default channels to fire on
 *   - The template code to use per channel
 *   - The priority level
 *   - A small projection function that pulls the right variables out of the
 *     event payload for template rendering
 *
 * Adding a new event type means adding a row here and the corresponding
 * templates in the database via seed or admin endpoint.
 */

import type { Channel, Priority } from '@/models/rows.js';

export interface NotificationSpec {
  channels: Channel[];
  templateCode: string;       // base code; per-channel = `${code}.${channel}`
  priority: Priority;
  /**
   * Project the event envelope payload into template variables. Default is
   * identity — the payload is passed through verbatim. Provide a custom
   * function when the payload needs reshaping (e.g. flattening nested objects
   * or fetching a related entity name).
   */
  projector?: (payload: Record<string, unknown>) => Record<string, unknown>;
  /** Short title for in-app — Handlebars over the projected vars. */
  inAppTitle: string;
  /** Short body for in-app — Handlebars. */
  inAppBody: string;
  /** Action URL template (Handlebars), opens when user clicks the notif. */
  actionUrlTemplate?: string;
  /** Icon name (rendered client-side). */
  icon?: string;
}

export const EVENT_ROUTES: Record<string, NotificationSpec> = {
  // ===========================================================================
  // Auth
  // ===========================================================================
  'auth.user.registered': {
    channels: ['email', 'in_app'],
    templateCode: 'auth.welcome',
    priority: 'normal',
    inAppTitle: 'Welcome to Offensive Conditions',
    inAppBody: 'Glad to have you, {{username}}. Start with the beginner track.',
    actionUrlTemplate: '/onboarding',
    icon: 'sparkles',
  },
  'auth.login.alert': {
    channels: ['email'],
    templateCode: 'auth.login_alert',
    priority: 'high',
    inAppTitle: 'New sign-in detected',
    inAppBody: 'A new sign-in from {{ip}} ({{location}}) at {{time}}.',
    icon: 'shield',
  },
  'auth.password.changed': {
    channels: ['email', 'in_app'],
    templateCode: 'auth.password_changed',
    priority: 'high',
    inAppTitle: 'Password changed',
    inAppBody: 'Your password was changed. If this wasn’t you, contact support.',
    icon: 'key',
  },
  'auth.tfa.enabled': {
    channels: ['email', 'in_app'],
    templateCode: 'auth.tfa_enabled',
    priority: 'high',
    inAppTitle: 'Two-factor enabled',
    inAppBody: 'Your account now requires 2FA at sign-in.',
    icon: 'shield-check',
  },

  // ===========================================================================
  // Scoring + achievements
  // ===========================================================================
  'scoring.solve': {
    channels: ['in_app'],
    templateCode: 'scoring.solve',
    priority: 'low',
    inAppTitle: 'Solve recorded',
    inAppBody: '+{{points}} pts for solving {{target_name}}.',
    actionUrlTemplate: '/profile/me',
    icon: 'check-circle',
  },
  'scoring.first_blood': {
    channels: ['email', 'in_app'],
    templateCode: 'scoring.first_blood',
    priority: 'high',
    inAppTitle: '🩸 First blood!',
    inAppBody: 'You got first blood on {{target_name}}. +{{bonus_points}} bonus points!',
    actionUrlTemplate: '/machines/{{target_slug}}',
    icon: 'flame',
  },
  'scoring.badge.earned': {
    channels: ['email', 'in_app'],
    templateCode: 'scoring.badge_earned',
    priority: 'normal',
    inAppTitle: 'New badge: {{badge_name}}',
    inAppBody: '{{badge_description}}',
    actionUrlTemplate: '/profile/me/badges',
    icon: 'badge',
  },
  'scoring.season.winner': {
    channels: ['email', 'in_app'],
    templateCode: 'scoring.season_winner',
    priority: 'high',
    inAppTitle: 'Season {{season_number}} — rank #{{rank}}',
    inAppBody: 'You finished season {{season_number}} at rank #{{rank}}.',
    actionUrlTemplate: '/seasons/{{season_number}}',
    icon: 'trophy',
  },

  // ===========================================================================
  // Payment
  // ===========================================================================
  'payment.subscription.updated': {
    channels: ['in_app'],
    templateCode: 'payment.subscription_updated',
    priority: 'normal',
    inAppTitle: 'Subscription updated',
    inAppBody: 'Your {{plan_code}} subscription is now {{status}}.',
    actionUrlTemplate: '/settings/billing',
    icon: 'credit-card',
  },
  'payment.subscription.canceled': {
    channels: ['email', 'in_app'],
    templateCode: 'payment.subscription_canceled',
    priority: 'normal',
    inAppTitle: 'Subscription canceled',
    inAppBody: 'Your subscription has ended. Access will continue until {{period_end}}.',
    actionUrlTemplate: '/settings/billing',
    icon: 'credit-card-off',
  },
  'payment.invoice.paid': {
    channels: ['email', 'in_app'],
    templateCode: 'payment.invoice_paid',
    priority: 'normal',
    inAppTitle: 'Payment received',
    inAppBody: 'We received your payment of {{amount_formatted}}.',
    actionUrlTemplate: '/settings/billing/invoices',
    icon: 'receipt',
  },
  'payment.invoice.failed': {
    channels: ['email', 'in_app'],
    templateCode: 'payment.invoice_failed',
    priority: 'urgent',
    inAppTitle: 'Payment failed',
    inAppBody: 'We couldn’t process your payment. Please update your card.',
    actionUrlTemplate: '/settings/billing',
    icon: 'alert-triangle',
  },
  'payment.refund.issued': {
    channels: ['email', 'in_app'],
    templateCode: 'payment.refund_issued',
    priority: 'normal',
    inAppTitle: 'Refund issued',
    inAppBody: 'A refund of {{amount_formatted}} is on its way.',
    actionUrlTemplate: '/settings/billing/invoices',
    icon: 'receipt-refund',
  },

  // ===========================================================================
  // Forum
  // ===========================================================================
  'forum.post.reply': {
    channels: ['in_app'],
    templateCode: 'forum.reply',
    priority: 'normal',
    inAppTitle: 'New reply on "{{thread_title}}"',
    inAppBody: '{{author_username}} replied to your thread.',
    actionUrlTemplate: '/forum/threads/{{thread_id}}#post-{{post_id}}',
    icon: 'message-circle',
  },
  'forum.user.mentioned': {
    channels: ['email', 'in_app'],
    templateCode: 'forum.mention',
    priority: 'high',
    inAppTitle: '{{author_username}} mentioned you',
    inAppBody: '...in "{{thread_title}}"',
    actionUrlTemplate: '/forum/threads/{{thread_id}}#post-{{post_id}}',
    icon: 'at-sign',
  },
  'forum.post.solution_marked': {
    channels: ['in_app'],
    templateCode: 'forum.solution_marked',
    priority: 'normal',
    inAppTitle: 'Your answer was accepted!',
    inAppBody: 'Your reply on "{{thread_title}}" was marked as the solution.',
    actionUrlTemplate: '/forum/threads/{{thread_id}}',
    icon: 'check',
  },

  // ===========================================================================
  // Writeups
  // ===========================================================================
  'writeup.approved': {
    channels: ['email', 'in_app'],
    templateCode: 'writeup.approved',
    priority: 'normal',
    inAppTitle: 'Your writeup is live',
    inAppBody: '"{{title}}" has been approved and published.',
    actionUrlTemplate: '/writeups/{{slug}}',
    icon: 'book-open',
  },
  'writeup.rejected': {
    channels: ['email', 'in_app'],
    templateCode: 'writeup.rejected',
    priority: 'normal',
    inAppTitle: 'Writeup needs changes',
    inAppBody: 'Reason: {{reason}}',
    actionUrlTemplate: '/writeups/{{writeup_id}}/edit',
    icon: 'edit',
  },
  'writeup.featured': {
    channels: ['email', 'in_app'],
    templateCode: 'writeup.featured',
    priority: 'high',
    inAppTitle: '⭐ Your writeup is featured!',
    inAppBody: '"{{title}}" was selected for the homepage.',
    actionUrlTemplate: '/writeups/{{slug}}',
    icon: 'star',
  },

  // ===========================================================================
  // CTF
  // ===========================================================================
  'ctf.starting_soon': {
    channels: ['email', 'in_app'],
    templateCode: 'ctf.starting_soon',
    priority: 'high',
    inAppTitle: '{{ctf_name}} starts in {{minutes_until}}m',
    inAppBody: 'Get your team ready.',
    actionUrlTemplate: '/ctf/{{ctf_id}}',
    icon: 'flag',
  },
  'ctf.team.invited': {
    channels: ['email', 'in_app'],
    templateCode: 'ctf.team_invited',
    priority: 'high',
    inAppTitle: 'Team invite: {{team_name}}',
    inAppBody: '{{inviter_username}} invited you to join {{team_name}} for {{ctf_name}}.',
    actionUrlTemplate: '/ctf/{{ctf_id}}/teams/{{team_id}}',
    icon: 'users',
  },
  'ctf.completed': {
    channels: ['email', 'in_app'],
    templateCode: 'ctf.completed',
    priority: 'normal',
    inAppTitle: '{{ctf_name}} has ended',
    inAppBody: 'Your team finished at rank #{{rank}} with {{score}} points.',
    actionUrlTemplate: '/ctf/{{ctf_id}}/results',
    icon: 'trophy',
  },

  // ===========================================================================
  // System
  // ===========================================================================
  'system.announcement': {
    channels: ['in_app'],
    templateCode: 'system.announcement',
    priority: 'normal',
    inAppTitle: '{{title}}',
    inAppBody: '{{body}}',
    icon: 'megaphone',
  },
};

export function getRoute(eventType: string): NotificationSpec | null {
  return EVENT_ROUTES[eventType] ?? null;
}

export function listRouteKeys(): string[] {
  return Object.keys(EVENT_ROUTES);
}
