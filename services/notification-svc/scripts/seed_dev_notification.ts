/**
 * Seed dev: install canonical templates and default preferences.
 *
 * Usage:  npm run seed:dev
 *
 * Reads MJML email templates from src/templates/email/ and inserts them
 * into notification.templates with MJML pre-compiled. Also creates a
 * baseline preferences row for each test user.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import { loadConfig } from '../src/config/index.js';
import { initPool, query, closePool } from '../src/db/pool.js';
import { getLogger } from '../src/config/logger.js';
import { compileMjml } from '../src/services/templates.js';

const TEMPLATE_DIR = new URL('../src/templates/email', import.meta.url).pathname;

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const ALICE_ID = '22222222-2222-2222-2222-222222222222';
const BOB_ID = '33333333-3333-3333-3333-333333333333';

interface TemplateSeed {
  code: string;
  name: string;
  event_type: string;
  channel: 'email' | 'in_app';
  locale: string;
  subject: string | null;
  body_source: string;
  variables: string[];
}

const EVENT_TYPES_FOR_PREFS = [
  'auth.user.registered',
  'auth.login.alert',
  'auth.password.changed',
  'scoring.first_blood',
  'scoring.badge.earned',
  'payment.subscription.canceled',
  'payment.invoice.paid',
  'payment.invoice.failed',
  'forum.post.reply',
  'forum.user.mentioned',
  'writeup.approved',
  'writeup.featured',
  'ctf.starting_soon',
  'ctf.team.invited',
];

function loadMjmlTemplates(): TemplateSeed[] {
  let files: string[] = [];
  try {
    files = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.mjml'));
  } catch {
    return [];
  }
  const seeds: TemplateSeed[] = [];
  for (const file of files) {
    // file name pattern: {event_type}.{locale}.mjml  →  e.g. auth.welcome.en.mjml
    const stripped = basename(file, '.mjml');
    const parts = stripped.split('.');
    if (parts.length < 3) continue;
    const locale = parts.pop()!;
    const code = parts.join('.');
    const eventTypeMap: Record<string, { event_type: string; subject: string; vars: string[] }> = {
      'auth.welcome': {
        event_type: 'auth.user.registered',
        subject: 'Welcome, {{username}}, to Offensive Conditions',
        vars: ['username', 'onboarding_url', 'unsubscribe_url'],
      },
      'scoring.first_blood': {
        event_type: 'scoring.first_blood',
        subject: '🩸 First blood on {{target_name}}',
        vars: ['username', 'target_name', 'target_url', 'bonus_points', 'total_points', 'solve_time_formatted', 'preferences_url'],
      },
      'payment.invoice_failed': {
        event_type: 'payment.invoice.failed',
        subject: 'Payment failed — please update your card',
        vars: ['username', 'amount_due_cents', 'currency', 'billing_portal_url'],
      },
    };
    const meta = eventTypeMap[code];
    if (!meta) continue;
    const body_source = readFileSync(join(TEMPLATE_DIR, file), 'utf-8');
    seeds.push({
      code,
      name: code.replace(/[._]/g, ' '),
      event_type: meta.event_type,
      channel: 'email',
      locale,
      subject: meta.subject,
      body_source,
      variables: meta.vars,
    });
  }
  return seeds;
}

async function seed(): Promise<void> {
  loadConfig();
  const log = getLogger('seed');
  initPool();

  const templates = loadMjmlTemplates();
  log.info({ found: templates.length }, 'seeding_templates');

  for (const tpl of templates) {
    let compiled: string | null = null;
    try {
      compiled = compileMjml(tpl.body_source);
    } catch (err) {
      log.warn({ err, code: tpl.code }, 'mjml_compile_failed');
    }
    await query(
      `
      INSERT INTO notification.templates (
        code, name, event_type, channel, locale,
        subject, body_source, body_compiled, variables
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9::JSONB
      )
      ON CONFLICT (event_type, channel, locale) DO UPDATE
        SET code = EXCLUDED.code,
            name = EXCLUDED.name,
            subject = EXCLUDED.subject,
            body_source = EXCLUDED.body_source,
            body_compiled = EXCLUDED.body_compiled,
            variables = EXCLUDED.variables,
            version = notification.templates.version + 1,
            updated_at = NOW()
      `,
      [
        tpl.code,
        tpl.name,
        tpl.event_type,
        tpl.channel,
        tpl.locale,
        tpl.subject,
        tpl.body_source,
        compiled,
        JSON.stringify(tpl.variables),
      ],
    );
    log.info({ code: tpl.code, event_type: tpl.event_type }, 'template_upserted');
  }

  // Default preferences for the standard test users — everything on except SMS
  for (const userId of [ADMIN_ID, ALICE_ID, BOB_ID]) {
    for (const eventType of EVENT_TYPES_FOR_PREFS) {
      await query(
        `
        INSERT INTO notification.preferences (
          user_id, event_type,
          email_enabled, in_app_enabled, push_enabled, sms_enabled,
          digest_enabled, digest_frequency
        )
        VALUES ($1, $2, TRUE, TRUE, TRUE, FALSE, FALSE, 'daily')
        ON CONFLICT (user_id, event_type) DO NOTHING
        `,
        [userId, eventType],
      );
    }
    // user_settings
    await query(
      `
      INSERT INTO notification.user_settings (user_id, timezone, email_address, preferred_locale)
      VALUES ($1, 'Asia/Karachi', $2, 'en')
      ON CONFLICT (user_id) DO NOTHING
      `,
      [userId, `${userId}@offensiveconditions.org`],
    );
  }

  log.info('seed_complete');
  await closePool();
}

void seed();
